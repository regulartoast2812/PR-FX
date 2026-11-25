import AppKit
import AVFoundation

// The palette's In/Out picker (2026-11-25): what Enter on a video or a sound opens in the Ctrl+Space palette. The
// frame (or the sound's waveform), a scrub bar with the marked part filled in, and a readout. The keys are Premiere's:
// I / O mark, ⌥I / ⌥O clear, ⇧I / ⇧O go to a mark, J K L shuttle, Space play, ← → a frame (⇧ ten), Home / End.
// ↵ places the marked part, ⇧↵ places it and keeps the palette open, ⌘↵ places the whole clip, esc or ⌫ goes back
// to the list. The model (RangePick, PRFXRangePick.swift) is pure and checked; this view only draws and plays.
// AVPlayer plays what macOS can (ProRes, H.264, HEVC, most sound); a file it can't is said so, and ↵ then places
// the whole clip.

final class RangePickerView: NSView {
    let media: PaletteMedia
    private(set) var pick: RangePick?
    var onPlace: ((_ range: (inSeconds: Double, outSeconds: Double)?, _ keepOpen: Bool) -> Void)?
    var onBack: (() -> Void)?
    /// The marks, as they change, for the palette to remember per media item.
    var onMarks: ((RangePick) -> Void)?
    /// The file couldn't be played: the palette's footer then says ↵ places the whole clip.
    var onFail: (() -> Void)?

    private let isSound: Bool
    private let sequenceFps: Double?
    private let saved: (markIn: Double?, markOut: Double?, playhead: Double)?
    private let tint: NSColor
    private var player: AVPlayer?
    private let videoHost = NSView()
    private var playerLayer: AVPlayerLayer?
    private var peaks: [Float] = []
    private var message: String? = "Opening…"
    private var failed = false
    private var tick: Timer?
    private var lastTick = Date()
    private var reverseNative = false
    private var dragging = false
    private var closed = false
    /// Tells the waveform reader, on its own thread, that the picker has closed.
    private let waveformStop = StopFlag()

    // Layout, top down (flipped): the picture, the scrub bar, the readout.
    private let side: CGFloat = 16
    private var mediaRect: NSRect { NSRect(x: side, y: 12, width: bounds.width - side * 2, height: bounds.height - 12 - 92) }
    private var scrubRect: NSRect { NSRect(x: side, y: bounds.height - 74, width: bounds.width - side * 2, height: 28) }
    private var readoutY: CGFloat { bounds.height - 36 }

    init(frame: NSRect, media: PaletteMedia, url: URL, sequenceFps: Double?, saved: (markIn: Double?, markOut: Double?, playhead: Double)?, tint: NSColor) {
        self.media = media
        self.isSound = media.kind == "audio"
        self.sequenceFps = sequenceFps
        self.saved = saved
        self.tint = tint
        super.init(frame: frame)
        wantsLayer = true
        videoHost.wantsLayer = true
        videoHost.layer?.backgroundColor = PaletteStyle.hex(0x1c1c1b).cgColor
        videoHost.layer?.cornerRadius = 8
        videoHost.layer?.masksToBounds = true
        videoHost.isHidden = isSound
        addSubview(videoHost)
        open(url)
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    override var isFlipped: Bool { true }
    override var acceptsFirstResponder: Bool { true }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    // The palette moves when its background is dragged; a drag here scrubs instead.
    override var mouseDownCanMoveWindow: Bool { false }

    override func layout() {
        super.layout()
        videoHost.frame = mediaRect
        playerLayer?.frame = videoHost.bounds
    }

    // MARK: Opening

    private func open(_ url: URL) {
        let asset = AVURLAsset(url: url)
        let player = AVPlayer(playerItem: AVPlayerItem(asset: asset))
        player.actionAtItemEnd = .pause
        // Scrubbing and stepping must show the frame asked for, not wait for buffering.
        player.automaticallyWaitsToMinimizeStalling = false
        self.player = player
        if !isSound {
            let layer = AVPlayerLayer(player: player)
            layer.videoGravity = .resizeAspect
            layer.frame = videoHost.bounds
            videoHost.layer?.addSublayer(layer)
            playerLayer = layer
        }
        let isSound = self.isSound
        Task { @MainActor [weak self] in
            do {
                let duration = try await asset.load(.duration)
                let playable = try await asset.load(.isPlayable)
                var fps: Double? = nil
                if let track = try await asset.loadTracks(withMediaType: .video).first {
                    fps = Double(try await track.load(.nominalFrameRate))
                }
                let hasSound = !(try await asset.loadTracks(withMediaType: .audio)).isEmpty
                guard let self, !self.closed else { return }
                let seconds = duration.seconds
                if !playable || !seconds.isFinite || seconds <= 0 || (isSound && !hasSound) {
                    self.fail("macOS can’t play this file.")
                    return
                }
                self.ready(duration: seconds, mediaFps: fps)
                if isSound { self.readWaveform(asset) }
            } catch {
                guard let self, !self.closed else { return }
                self.fail(error.localizedDescription)
            }
        }
    }

    private func ready(duration: Double, mediaFps: Double?) {
        var pick = RangePick(duration: duration, fps: RangePick.pickFps(media: isSound ? nil : mediaFps, sequence: sequenceFps))
        if let saved { pick.restore(markIn: saved.markIn, markOut: saved.markOut, playhead: saved.playhead) }
        self.pick = pick
        message = nil
        if let item = player?.currentItem { reverseNative = item.canPlayReverse }
        seekPlayer(exact: true)
        listenerLog("Palette picker: \(media.name) \(String(format: "%.2f", duration))s at \(pick.fps) fps, reverse \(reverseNative ? "native" : "stepped")")
        needsDisplay = true
    }

    private func fail(_ reason: String) {
        failed = true
        message = "Can’t play this file here. ↵ places the whole clip."
        // The picture's box sits above this view's drawing: hide it so the message shows.
        videoHost.isHidden = true
        player?.replaceCurrentItem(with: nil)
        onFail?()
        listenerLog("Palette picker could not open \(media.name): \(reason)")
        needsDisplay = true
    }

    // Peaks for the waveform, read once off the main thread: the loudest sample in each of ~600 slices.
    private func readWaveform(_ asset: AVURLAsset) {
        let width = max(100, Int(mediaRect.width))
        let stop = waveformStop
        Task.detached(priority: .userInitiated) { [weak self] in
            guard let track = try? await asset.loadTracks(withMediaType: .audio).first,
                  let reader = try? AVAssetReader(asset: asset) else { return }
            let output = AVAssetReaderTrackOutput(track: track, outputSettings: [
                AVFormatIDKey: kAudioFormatLinearPCM, AVLinearPCMBitDepthKey: 16, AVLinearPCMIsFloatKey: false,
                AVLinearPCMIsBigEndianKey: false, AVLinearPCMIsNonInterleaved: false,
            ])
            output.alwaysCopiesSampleData = false
            guard reader.canAdd(output) else { return }
            reader.add(output)
            guard reader.startReading() else { return }
            var samples: [Int16] = []
            // Keep every 8th sample: plenty for a 600-wide drawing, and an hour of sound stays small.
            while let buffer = output.copyNextSampleBuffer(), let block = CMSampleBufferGetDataBuffer(buffer) {
                let length = CMBlockBufferGetDataLength(block)
                var data = [Int16](repeating: 0, count: length / 2)
                data.withUnsafeMutableBytes { raw in
                    _ = CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: length, destination: raw.baseAddress!)
                }
                var index = 0
                while index < data.count { samples.append(data[index]); index += 8 }
                if stop.isSet { reader.cancelReading(); return }
            }
            guard !samples.isEmpty else { return }
            var peaks = [Float](repeating: 0, count: width)
            let per = max(1, samples.count / width)
            for slice in 0..<width {
                let start = slice * per
                guard start < samples.count else { break }
                var loudest: Int32 = 0
                for value in samples[start..<min(samples.count, start + per)] { loudest = max(loudest, abs(Int32(value))) }
                peaks[slice] = Float(loudest) / 32768
            }
            let top = max(peaks.max() ?? 1, 0.05)
            let scaled = peaks.map { $0 / top }
            await MainActor.run { [weak self] in
                guard let self, !self.closed else { return }
                self.peaks = scaled
                self.needsDisplay = true
            }
        }
    }

    /// Stop playing and let go of the file. The palette calls this when the picker closes or the palette hides.
    func close() {
        closed = true
        waveformStop.set()
        tick?.invalidate(); tick = nil
        player?.pause()
        player?.replaceCurrentItem(with: nil)
        player = nil
    }

    // MARK: Playing

    private func seekPlayer(exact: Bool) {
        guard let pick, let player else { return }
        // A quarter frame in, so rounding never shows the frame before.
        let time = CMTime(seconds: pick.playhead + pick.frame / 4, preferredTimescale: 240_000)
        let tolerance: CMTime = exact ? .zero : CMTime(seconds: pick.frame, preferredTimescale: 240_000)
        player.seek(to: time, toleranceBefore: tolerance, toleranceAfter: tolerance)
    }

    private func applyRate() {
        guard var pick, let player else { return }
        if pick.atBoundary { pick.stop(); self.pick = pick }
        if pick.rate == 0 {
            player.pause()
            tick?.invalidate(); tick = nil
            seekPlayer(exact: true)
        } else {
            if pick.rate > 0 || reverseNative { player.rate = Float(pick.rate) }
            else { player.pause() }
            lastTick = Date()
            if tick == nil {
                let timer = Timer(timeInterval: 1.0 / 30, repeats: true) { [weak self] _ in
                    MainActor.assumeIsolated { self?.playTick() }
                }
                RunLoop.main.add(timer, forMode: .common)
                tick = timer
            }
        }
        needsDisplay = true
    }

    private func playTick() {
        guard var pick, let player else { return }
        let now = Date()
        let elapsed = now.timeIntervalSince(lastTick)
        lastTick = now
        if pick.rate < 0 && !reverseNative {
            pick.seek(to: pick.playhead + pick.rate * elapsed)
            self.pick = pick
            seekPlayer(exact: false)
        } else {
            pick.seek(to: player.currentTime().seconds)
            self.pick = pick
        }
        // The player stops at either end on its own; the shuttle stops with it.
        if pick.atBoundary || (player.rate == 0 && (pick.rate > 0 || reverseNative)) {
            pick.stop()
            self.pick = pick
            applyRate()
        }
        needsDisplay = true
    }

    private func change(_ edit: (inout RangePick) -> Void, seek: Bool = true) {
        guard var pick else { return }
        let wasPlaying = pick.rate != 0
        edit(&pick)
        self.pick = pick
        onMarks?(pick)
        if pick.rate != 0 || wasPlaying { applyRate() }
        else if seek { seekPlayer(exact: true) }
        needsDisplay = true
    }

    // MARK: Keys

    override func keyDown(with event: NSEvent) {
        let flags = event.modifierFlags.intersection([.command, .shift, .option, .control])
        let key = event.charactersIgnoringModifiers?.lowercased() ?? ""
        switch event.keyCode {
        case 36, 76: // Return, Enter
            if flags.contains(.command) || failed || pick == nil { place(whole: true, keepOpen: flags.contains(.shift)) }
            else { place(whole: false, keepOpen: flags.contains(.shift)) }
            return
        case 53, 51: // esc, delete
            onBack?()
            return
        case 123: change { $0.step(frames: flags.contains(.shift) ? -10 : -1) }; return
        case 124: change { $0.step(frames: flags.contains(.shift) ? 10 : 1) }; return
        case 115: change { $0.goToStart() }; return
        case 119: change { $0.goToEnd() }; return
        default: break
        }
        guard pick != nil else { return }
        switch (key, flags) {
        case ("i", []): change({ $0.markInHere() }, seek: false)
        case ("o", []): change({ $0.markOutHere() }, seek: false)
        case ("i", [.option]): change({ $0.clearIn() }, seek: false)
        case ("o", [.option]): change({ $0.clearOut() }, seek: false)
        case ("i", [.shift]): change { $0.goToIn() }
        case ("o", [.shift]): change { $0.goToOut() }
        case ("x", [.option]): change({ $0.clearMarks() }, seek: false)
        case ("j", []): change { $0.shuttleBackward() }
        case ("k", []): change { $0.stop() }
        case ("l", []): change { $0.shuttleForward() }
        case (" ", []): change { $0.togglePlay() }
        default:
            // ⌥I arrives as "ˆ" on some layouts: go by the key's position too.
            if flags == [.option] && event.keyCode == 34 { change({ $0.clearIn() }, seek: false) }
            else if flags == [.option] && event.keyCode == 31 { change({ $0.clearOut() }, seek: false) }
            else { NSSound.beep() }
        }
    }

    private func place(whole: Bool, keepOpen: Bool) {
        player?.pause()
        onPlace?(whole ? nil : pick?.placeRange, keepOpen)
    }

    // MARK: Mouse: the scrub bar, and a click anywhere keeps the keys here

    override func mouseDown(with event: NSEvent) {
        window?.makeFirstResponder(self)
        let point = convert(event.locationInWindow, from: nil)
        let hit = scrubRect.insetBy(dx: -4, dy: -6)
        let onWave = isSound && mediaRect.contains(point)
        guard pick != nil, hit.contains(point) || onWave else { return }
        dragging = true
        scrub(to: point)
    }

    override func mouseDragged(with event: NSEvent) {
        guard dragging else { return }
        scrub(to: convert(event.locationInWindow, from: nil))
    }

    override func mouseUp(with event: NSEvent) {
        guard dragging else { return }
        dragging = false
        seekPlayer(exact: true)
    }

    private func scrub(to point: NSPoint) {
        guard var pick else { return }
        let fraction = Double((point.x - scrubRect.minX) / scrubRect.width)
        pick.stop()
        pick.seek(to: pick.seconds(atFraction: fraction))
        self.pick = pick
        onMarks?(pick)
        player?.pause()
        tick?.invalidate(); tick = nil
        seekPlayer(exact: false)
        needsDisplay = true
    }

    // MARK: Drawing

    override func draw(_ dirtyRect: NSRect) {
        if isSound { drawWaveform() }
        if let message {
            let text = NSAttributedString(string: message, attributes: [.font: NSFont.systemFont(ofSize: 12.5), .foregroundColor: PaletteStyle.muted])
            let size = text.size()
            let area = mediaRect
            if isSound || failed {
                PaletteStyle.hex(0x1c1c1b).setFill()
                NSBezierPath(roundedRect: area, xRadius: 8, yRadius: 8).fill()
            }
            text.draw(at: NSPoint(x: area.midX - size.width / 2, y: area.midY - size.height / 2))
        }
        drawScrub()
        drawReadout()
    }

    private func x(_ seconds: Double, in rect: NSRect) -> CGFloat {
        rect.minX + CGFloat(pick?.fraction(seconds) ?? 0) * rect.width
    }

    private func drawWaveform() {
        guard message == nil, let pick else { return }
        let area = mediaRect
        PaletteStyle.hex(0x1c1c1b).setFill()
        NSBezierPath(roundedRect: area, xRadius: 8, yRadius: 8).fill()
        guard !peaks.isEmpty else {
            let text = NSAttributedString(string: "Reading the sound…", attributes: [.font: NSFont.systemFont(ofSize: 12.5), .foregroundColor: PaletteStyle.faint])
            let size = text.size()
            text.draw(at: NSPoint(x: area.midX - size.width / 2, y: area.midY - size.height / 2))
            drawPlayheadLine(in: area)
            return
        }
        let inner = area.insetBy(dx: 10, dy: 14)
        let range = pick.placeRange
        let barWidth = inner.width / CGFloat(peaks.count)
        for (index, peak) in peaks.enumerated() {
            let barX = inner.minX + CGFloat(index) * barWidth
            let seconds = Double(index) / Double(peaks.count) * pick.duration
            let inside = range.map { seconds >= $0.inSeconds && seconds < $0.outSeconds } ?? true
            (inside ? tint : tint.withAlphaComponent(0.3)).setFill()
            let height = max(1, CGFloat(peak) * inner.height)
            NSRect(x: barX, y: inner.midY - height / 2, width: max(1, barWidth - 0.5), height: height).fill()
        }
        drawPlayheadLine(in: area)
    }

    private func drawPlayheadLine(in area: NSRect) {
        guard let pick else { return }
        let inner = area.insetBy(dx: 10, dy: 0)
        PaletteStyle.accent.setFill()
        NSRect(x: inner.minX + CGFloat(pick.fraction(pick.playhead)) * inner.width - 1, y: area.minY + 6, width: 2, height: area.height - 12).fill()
    }

    private func drawScrub() {
        let rect = scrubRect
        let track = NSRect(x: rect.minX, y: rect.midY - 3, width: rect.width, height: 6)
        PaletteStyle.line.setFill()
        NSBezierPath(roundedRect: track, xRadius: 3, yRadius: 3).fill()
        guard let pick else { return }
        if let range = pick.placeRange {
            let start = x(range.inSeconds, in: rect), end = max(x(range.outSeconds, in: rect), start + 2)
            tint.withAlphaComponent(0.28).setFill()
            NSBezierPath(roundedRect: NSRect(x: start, y: rect.minY + 4, width: end - start, height: rect.height - 8), xRadius: 3, yRadius: 3).fill()
            tint.setFill()
            NSRect(x: start, y: track.minY, width: end - start, height: track.height).fill()
            // Brackets at the marks the editor set (not at the ends a missing mark falls back to).
            if pick.markIn != nil { bracket(at: start, in: rect, opensRight: true) }
            if pick.markOut != nil { bracket(at: end, in: rect, opensRight: false) }
        }
        let head = x(pick.playhead, in: rect)
        PaletteStyle.accent.setFill()
        NSRect(x: head - 1, y: rect.minY, width: 2, height: rect.height).fill()
        let knob = NSBezierPath()
        knob.move(to: NSPoint(x: head - 5, y: rect.minY - 1))
        knob.line(to: NSPoint(x: head + 5, y: rect.minY - 1))
        knob.line(to: NSPoint(x: head, y: rect.minY + 5))
        knob.close()
        knob.fill()
    }

    private func bracket(at markX: CGFloat, in rect: NSRect, opensRight: Bool) {
        tint.setFill()
        let top = rect.minY + 2, bottom = rect.maxY - 2
        NSRect(x: markX - 1, y: top, width: 2, height: bottom - top).fill()
        let arm: CGFloat = opensRight ? 4 : -4
        NSRect(x: opensRight ? markX : markX + arm, y: top, width: 4, height: 2).fill()
        NSRect(x: opensRight ? markX : markX + arm, y: bottom - 2, width: 4, height: 2).fill()
    }

    private func show(_ seconds: Double) -> String {
        guard let pick else { return "–" }
        return isSound ? RangePick.clock(seconds) : RangePick.timecode(seconds, fps: pick.fps)
    }

    private func drawReadout() {
        let digits = NSFont.monospacedDigitSystemFont(ofSize: 13, weight: .medium)
        let small = NSFont.monospacedDigitSystemFont(ofSize: 12, weight: .regular)
        let label = NSFont.systemFont(ofSize: 11, weight: .medium)
        guard let pick else { return }
        let playhead = NSAttributedString(string: show(pick.playhead), attributes: [.font: digits, .foregroundColor: PaletteStyle.text])
        playhead.draw(at: NSPoint(x: side, y: readoutY))
        if pick.rate != 0 {
            let rate = NSAttributedString(string: (pick.rate < 0 ? "◀ " : "▶ ") + "\(Int(abs(pick.rate)))×", attributes: [.font: label, .foregroundColor: PaletteStyle.accent])
            rate.draw(at: NSPoint(x: side + playhead.size().width + 10, y: readoutY + 1.5))
        }
        // In, Out and the marked length, right-aligned: muted names, values in the text colour (faint when unset).
        let parts: [(String, String, Bool)] = [
            ("In", pick.markIn.map(show) ?? "–", pick.markIn != nil),
            ("Out", pick.markOut.map(show) ?? "–", pick.markOut != nil),
            (pick.hasMarks ? "Length" : "Whole clip", RangePick.length(pick.markedSeconds), true),
        ]
        let line = NSMutableAttributedString()
        for (index, part) in parts.enumerated() {
            if index > 0 { line.append(NSAttributedString(string: "     ", attributes: [.font: small])) }
            line.append(NSAttributedString(string: part.0 + "  ", attributes: [.font: label, .foregroundColor: PaletteStyle.faint]))
            line.append(NSAttributedString(string: part.1, attributes: [.font: small, .foregroundColor: part.2 ? PaletteStyle.text : PaletteStyle.faint]))
        }
        let size = line.size()
        line.draw(at: NSPoint(x: bounds.width - side - size.width, y: readoutY + 1))
    }
}

/// A flag one thread sets and another reads.
final class StopFlag: @unchecked Sendable {
    private let lock = NSLock()
    private var value = false
    var isSet: Bool { lock.lock(); defer { lock.unlock() }; return value }
    func set() { lock.lock(); value = true; lock.unlock() }
}
