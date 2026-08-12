/* global app, qe */
var prfx = prfx || {};
prfx.lastPaletteUndoCount = 0;

prfx.getCatalog = function () {
    try {
        app.enableQE();
        var catalog = [];
        prfx.safeAppendCatalog(catalog, 'effect', 'getVideoEffectList');
        prfx.safeAppendCatalog(catalog, 'transition', 'getVideoTransitionList');
        prfx.safeAppendCatalog(catalog, 'audio-transition', 'getAudioTransitionList');
        return JSON.stringify(catalog);
    } catch (error) {
        return 'ERROR: Could not read Premiere’s Effects catalog: ' + error.toString();
    }
};

prfx.safeAppendCatalog = function (target, type, methodName) {
    try {
        if (qe.project[methodName]) prfx.appendCatalog(target, qe.project[methodName](), type);
    } catch (ignore) {}
};

prfx.appendCatalog = function (target, source, type) {
    if (!source) return;
    // QE collections expose both values in different Premiere builds; numItems is
    // the actual catalog count, while length can be a wrapper's property count.
    var count = source.numItems || source.length || 0;
    for (var i = 0; i < count; i++) {
        var entry = source[i] || (source.getItemAt ? source.getItemAt(i) : null);
        var name = typeof entry === 'string' ? entry : (entry.name || entry.displayName || '');
        if (name) target.push({ type: type, name: name, transitionFrames: 30 });
    }
};

prfx.apply = function (payload) {
    try {
        var command = JSON.parse(payload);
        if (!app.project || !app.project.activeSequence) {
            return 'ERROR: Open a sequence and select one or more clips first.';
        }
        app.enableQE();
        var publicSequence = app.project.activeSequence;
        var sequence = qe.project.getActiveSequence();
        if (!sequence) return 'ERROR: Premiere could not access the active sequence.';

        var item;
        if (command.type === 'custom' && command.id === 'undo-last-palette-action') {
            return prfx.undoLastPaletteAction();
        }
        if (command.type === 'custom' && command.id === 'remove-transitions') {
            var removed = prfx.removeTransitionsAtSelection(publicSequence, sequence);
            prfx.lastPaletteUndoCount = removed;
            return 'Removed ' + removed + ' transition' + (removed === 1 ? '' : 's') + ' from selected tracks.';
        }
        if (command.type === 'effect') {
            var selected = prfx.getSelectedQEClips(publicSequence, sequence, 'video');
            if (selected.length === 0) return prfx.selectionError('video');
            item = qe.project.getVideoEffectByName(command.name);
            if (!item) return 'ERROR: “' + command.name + '” is not available in this Premiere installation.';
            for (var i = 0; i < selected.length; i++) selected[i].addVideoEffect(item);
            prfx.lastPaletteUndoCount = selected.length;
            return 'Applied ' + command.name + ' to ' + selected.length + ' selected clip' + (selected.length === 1 ? '' : 's') + '.';
        }
        if (command.type === 'transition') {
            var selectedVideo = prfx.getSelectedQEClips(publicSequence, sequence, 'video');
            if (selectedVideo.length === 0) return prfx.selectionError('video');
            item = qe.project.getVideoTransitionByName(command.name);
            if (!item) return 'ERROR: “' + command.name + '” is not available in this Premiere installation.';
            var duration = prfx.framesToTimecode(Number(command.transitionFrames) || 30);
            for (var j = 0; j < selectedVideo.length; j++) {
                selectedVideo[j].addTransition(item, true, duration);
                selectedVideo[j].addTransition(item, false, duration);
            }
            prfx.lastPaletteUndoCount = selectedVideo.length * 2;
            return 'Applied ' + command.name + ' to both In and Out of ' + selectedVideo.length + ' selected clip' + (selectedVideo.length === 1 ? '' : 's') + '.';
        }
        if (command.type === 'audio-transition') {
            var selectedAudio = prfx.getSelectedQEClips(publicSequence, sequence, 'audio');
            if (selectedAudio.length === 0) return prfx.selectionError('audio');
            item = qe.project.getAudioTransitionByName(command.name);
            if (!item) return 'ERROR: “' + command.name + '” is not available in this Premiere installation.';
            var audioDuration = prfx.framesToTimecode(Number(command.transitionFrames) || 30);
            for (var k = 0; k < selectedAudio.length; k++) {
                selectedAudio[k].addTransition(item, true, audioDuration);
                selectedAudio[k].addTransition(item, false, audioDuration);
            }
            prfx.lastPaletteUndoCount = selectedAudio.length * 2;
            return 'Applied ' + command.name + ' to both In and Out of ' + selectedAudio.length + ' selected audio clip' + (selectedAudio.length === 1 ? '' : 's') + '.';
        }
        return 'ERROR: Unknown command type.';
    } catch (error) {
        return 'ERROR: ' + error.toString();
    }
};

prfx.undoLastPaletteAction = function () {
    var count = Number(prfx.lastPaletteUndoCount || 0);
    if (count < 1) return 'ERROR: No PR FX action is available to undo.';
    var undone = 0;
    try {
        for (var i = 0; i < count; i++) {
            // 16 is Premiere Pro's native Edit > Undo command. QE's project.undo()
            // throws in recent builds even when the UI undo command is available.
            app.executeCommand(16);
            undone++;
        }
        prfx.lastPaletteUndoCount = 0;
        return 'Undid last PR FX action (' + undone + ' change' + (undone === 1 ? '' : 's') + ').';
    } catch (error) {
        return 'ERROR: Undo stopped after ' + undone + ' change' + (undone === 1 ? '' : 's') + ': ' + error.toString();
    }
};

prfx.removeTransitionsAtSelection = function (publicSequence, qeSequence) {
    var selected = publicSequence.getSelection();
    var videoTracks = {};
    var audioTracks = {};
    for (var i = 0; i < selected.length; i++) {
        var clip = selected[i];
        if (!clip) continue;
        if (clip.type === 2) audioTracks[clip.parentTrackIndex] = true;
        else videoTracks[clip.parentTrackIndex] = true;
    }
    if (prfx.objectSize(videoTracks) + prfx.objectSize(audioTracks) === 0) {
        return 0;
    }
    // QE has no dependable transition-to-clip mapping in current Premiere builds.
    // Removing in reverse on only the selected clips' tracks is stable and avoids
    // shifting indexes while transitions are deleted.
    return prfx.removeTrackTransitions(qeSequence, videoTracks, 'video') + prfx.removeTrackTransitions(qeSequence, audioTracks, 'audio');
};

prfx.objectSize = function (object) {
    var count = 0;
    for (var key in object) count++;
    return count;
};

prfx.removeTrackTransitions = function (qeSequence, tracks, kind) {
    var removed = 0;
    for (var trackIndex in tracks) {
        var track;
        var transitionCount = 0;
        try {
            track = kind === 'audio' ? qeSequence.getAudioTrackAt(Number(trackIndex)) : qeSequence.getVideoTrackAt(Number(trackIndex));
            transitionCount = track ? Number(track.numTransitions || 0) : 0;
        } catch (ignoreTrack) { continue; }
        if (!track) continue;
        for (var transitionIndex = transitionCount - 1; transitionIndex >= 0; transitionIndex--) {
            try {
                var transition = track.getTransitionAt(transitionIndex);
                if (!transition) continue;
                transition.remove();
                removed++;
            } catch (ignoreTransition) {}
        }
    }
    return removed;
};

prfx.getSelectedQEClips = function (publicSequence, qeSequence, kind) {
    // QE's selection flag is unreliable. Premiere's public DOM provides the selected
    // TrackItems, so match each one back to its QE item by track + timeline range.
    var publicSelection = publicSequence.getSelection();
    prfx.lastPublicSelectionCount = publicSelection.length;
    var qeClips = [];
    var expectedType = kind === 'audio' ? 2 : 1;
    for (var i = 0; i < publicSelection.length; i++) {
        var selected = publicSelection[i];
        if (!selected) continue;
        // Some timeline items (notably adjustment layers) do not reliably expose
        // TrackItem.type in ExtendScript. Respect a known type, otherwise match it.
        if (selected.type && selected.type !== expectedType) continue;
        var trackIndex = selected.parentTrackIndex;
        var qeTrack = kind === 'audio' ? qeSequence.getAudioTrackAt(trackIndex) : qeSequence.getVideoTrackAt(trackIndex);
        if (!qeTrack) continue;
        var qeItemCount = qeTrack.numItems || 0;
        for (var j = 0; j < qeItemCount; j++) {
            var qeClip = qeTrack.getItemAt(j);
            if (qeClip && prfx.sameTimelineRange(selected, qeClip)) {
                qeClips.push(qeClip);
                break;
            }
        }
    }
    return qeClips;
};

prfx.selectionError = function (kind) {
    if (prfx.lastPublicSelectionCount > 0) {
        return 'ERROR: Premiere found ' + prfx.lastPublicSelectionCount + ' selected Timeline item(s), but could not resolve a compatible ' + kind + ' clip.';
    }
    return 'ERROR: No selected ' + kind + ' clips found in the active sequence.';
};

prfx.sameTimelineRange = function (publicClip, qeClip) {
    try {
        var epsilon = 0.0001;
        return Math.abs(prfx.timeInSeconds(publicClip.start) - prfx.timeInSeconds(qeClip.start)) < epsilon &&
            Math.abs(prfx.timeInSeconds(publicClip.end) - prfx.timeInSeconds(qeClip.end)) < epsilon;
    } catch (error) {
        return false;
    }
};

prfx.timeInSeconds = function (time) {
    if (typeof time === 'number') return time;
    if (time.seconds !== undefined) return Number(time.seconds);
    // QE exposes some timeline positions as ticks rather than Time.seconds.
    if (time.ticks !== undefined) return Number(time.ticks) / 254016000000;
    return -999999;
};

prfx.framesToTimecode = function (frames) {
    // QE accepts a timecode duration; 30 fps is a safe fallback until the sequence rate is queried.
    var seconds = Math.floor(frames / 30);
    var remainder = frames % 30;
    return '00:00:' + (seconds < 10 ? '0' : '') + seconds + ':' + (remainder < 10 ? '0' : '') + remainder;
};
