"""PR FX's speech-to-text step for the Whisper caption functions (2026-11-22). Run with WhisperX's own Python.

Why not the whisperx command any more (seen on the user's quiet Vietnamese + English sequence, 7:19):
  * Its voice-activity gate (Silero) found speech in only two stretches, even at threshold 0.2. Whisper itself,
    run on the whole file, heard six more stretches, and the small model heard the same words there. Quiet,
    half-whispered speech is lost before Whisper ever hears it.
  * Its word timing comes from a wav2vec2 alignment model. Vietnamese's default
    (nguyenvulebinh/wav2vec2-base-vi-vlsp2020) needs custom model code that WhisperX doesn't load, so its output is
    noise: every word scored ~0.01 (1/98 tokens), lasted 0.02 s per letter, and a 9 s sentence was squeezed into 2 s.

This runs faster-whisper (already in WhisperX's environment, same model cache, nothing new to download) over the whole
file with no gate and Whisper's own word timestamps, and writes WhisperX-shaped <name>.json and <name>.srt so the panel
reads them as before. Every segment keeps its avg_logprob, compression_ratio, no_speech_prob and each word's probability:
the panel (client/prai/js/whisper-clean.js) drops what Whisper made up from those. Nothing here invents or edits text.
"""
import argparse
import json
import os
import subprocess
import sys
import wave

SAMPLE_RATE = 16000


def say(text):
    sys.stdout.write(text + "\n")
    sys.stdout.flush()


def load_audio(path):
    import numpy as np
    try:
        with wave.open(path, "rb") as w:
            if w.getframerate() == SAMPLE_RATE and w.getnchannels() == 1 and w.getsampwidth() == 2:
                return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
    except (wave.Error, EOFError):
        pass
    # Anything else: ffmpeg (the panel puts the one it found on PATH) decodes to 16 kHz mono.
    out = subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-i", path,
                          "-f", "s16le", "-ac", "1", "-ar", str(SAMPLE_RATE), "-"], capture_output=True, check=True).stdout
    return np.frombuffer(out, dtype=np.int16).astype(np.float32) / 32768.0


def stamp(seconds):
    ms = int(round(max(0.0, seconds) * 1000))
    return "%02d:%02d:%02d,%03d" % (ms // 3600000, ms // 60000 % 60, ms // 1000 % 60, ms % 1000)


def main():
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    ap = argparse.ArgumentParser()
    ap.add_argument("--audio", required=True)
    ap.add_argument("--output_dir", required=True)
    ap.add_argument("--model", default="large-v3-turbo")
    ap.add_argument("--language", default="auto")
    ap.add_argument("--device", default="cpu")
    ap.add_argument("--compute_type", default="int8")
    ap.add_argument("--beam_size", type=int, default=5)
    args = ap.parse_args()

    from faster_whisper import WhisperModel

    audio = load_audio(args.audio)
    say("Audio: %.1f s" % (len(audio) / float(SAMPLE_RATE)))
    threads = max(1, min(os.cpu_count() or 4, 16))
    try:
        model = WhisperModel(args.model, device=args.device, compute_type=args.compute_type, cpu_threads=threads)
    except Exception as err:  # e.g. "cuda" asked for on a machine without it
        if args.device == "cpu":
            raise
        say("Could not use %s (%s); using the CPU." % (args.device, err))
        model = WhisperModel(args.model, device="cpu", compute_type="int8", cpu_threads=threads)
    language = None if args.language in ("", "auto") else args.language

    def listen(clip, offset):
        segments, info = model.transcribe(
            clip,
            language=language,
            beam_size=args.beam_size,
            word_timestamps=True,
            # No voice gate: it dropped real quiet speech. Silence is handled by Whisper's own no-speech check and
            # the panel's filter instead.
            vad_filter=False,
            # Not conditioning on the previous text keeps one made-up line from seeding the next.
            condition_on_previous_text=False,
        )
        found = []
        for s in segments:
            words = [{"word": w.word.strip(), "start": round(w.start + offset, 3), "end": round(w.end + offset, 3),
                      "probability": round(w.probability, 3)} for w in (s.words or []) if w.word.strip()]
            found.append({"start": round(s.start + offset, 3), "end": round(s.end + offset, 3), "text": s.text.strip(),
                          "avg_logprob": round(s.avg_logprob, 4), "compression_ratio": round(s.compression_ratio, 4),
                          "no_speech_prob": round(s.no_speech_prob, 4), "temperature": s.temperature, "words": words})
            say("Transcript: [%.3f --> %.3f] %s" % (s.start + offset, s.end + offset, s.text.strip()))
        return found, info

    # One pass. Listening again to the stretch after a made-up line (Whisper skips ahead after one, and quiet speech
    # there can go unheard) was tried on the user's audio: it doubled the time and brought back only garbled,
    # low-confidence text (avg log-prob -1.09) or the same invention again, so it isn't done.
    out, info = listen(audio, 0.0)

    os.makedirs(args.output_dir, exist_ok=True)
    stem = os.path.splitext(os.path.basename(args.audio))[0]
    with open(os.path.join(args.output_dir, stem + ".json"), "w", encoding="utf-8") as f:
        json.dump({"segments": out, "language": info.language, "engine": "faster-whisper",
                   "timing": "whisper-words", "model": args.model}, f, ensure_ascii=False)
    with open(os.path.join(args.output_dir, stem + ".srt"), "w", encoding="utf-8") as f:
        for i, s in enumerate(out, 1):
            f.write("%d\n%s --> %s\n%s\n\n" % (i, stamp(s["start"]), stamp(s["end"]), s["text"]))
    say("Wrote %d segments (%s)" % (len(out), info.language))


if __name__ == "__main__":
    main()
