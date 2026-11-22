/* What Whisper heard, minus what it made up (2026-11-22). Pure functions, no Node or DOM; app/tools/check.js runs them.
 *
 * The user's first Windows caption run (quiet Vietnamese + English) imported "Hãy subscribe cho kênh Ghiền Mì Gõ Để không
 * bỏ lỡ…", never said: Whisper's best-known Vietnamese invention over silence. Run over the whole file it produced the
 * same line seven more times (as "La La School", "lalaschool"), and bare numbers ("2", "3", "11") over noise. Each kind
 * leaves a mark that real speech in the same file never did:
 *   - the known closing lines of YouTube channels, which Whisper learned from their subtitles;
 *   - word timing that collapses: several words of the line given no time at all, e.g. 13 of 15 words at
 *     153.82 s, because nothing in the audio matched them (every real line in that file had none);
 *   - text that is only digits or punctuation;
 *   - Whisper's own doubt, when it reports it: very low average log-probability, repetitive text (compression ratio),
 *     "no speech" with low confidence, or a low mean word probability.
 * A line is dropped whole or kept whole; no text is ever changed or added.
 *
 * Word timing is checked too. WhisperX's wav2vec2 alignment for Vietnamese is noise (every word scored ~0.01 and
 * squeezed to 0.02 s per letter); words like that are ignored, so captions fall back to the line's own times.
 * Whisper's own word times stretch a line's first word back over the silence before it ("Ê," from 23.32 s, speech from
 * about 23.9 s); a first or last word is held to a length its letters can fill.
 */
(function (global) {
  "use strict";

  // Closing lines of channels, in Vietnamese and English. Matched loosely (accents kept, case and spacing ignored).
  var KNOWN_MADE_UP = [
    /((các\s+bạn|mọi\s+người)\s+)?(hãy\s+)?(subscribe|đăng\s*k[ýí]|nhấn\s+đăng\s*k[ýí])(\s+(cho|ủng\s+hộ))?\s+kênh/i,
    /ghiền\s+mì\s+gõ/i,
    /la\s*la\s*school/i,
    /để\s+không\s+bỏ\s+lỡ(\s+(những\s+|các\s+)?video(\s+hấp\s+dẫn|\s+mới)?)?/i,
    /(cảm\s+ơn|cám\s+ơn)\s+(các\s+bạn\s+|mọi\s+người\s+)?đã\s+(theo\s+dõi|xem|lắng\s+nghe)/i,
    /hẹn\s+gặp\s+lại\s+(các\s+bạn\s+)?(trong|ở)\s+(những\s+|các\s+)?(video|tập)/i,
    /(thanks?|thank\s+you)\s+(so\s+much\s+)?for\s+watching/i,
    /(please\s+)?(like\s+(and|&)\s+)?subscribe(\s+to\s+(my|our|the)\s+channel)?/i,
    /subtitles?\s+(by|made\s+by)\b/i,
    /amara\.org/i
  ];

  var LIMITS = {
    avgLogprob: -1.0,          // Whisper's own "this decode failed" mark
    compressionRatio: 2.4,     // and its "this text repeats itself" mark
    noSpeechProb: 0.6,         // with avg_logprob below -0.5, Whisper's own silence test
    meanWordProbability: 0.4,  // real lines in the user's audio: 0.49 and up; invented ones lower
    collapsedWordSeconds: 0.03,
    collapsedWords: 3,         // at least 3 words, and at least 20% of them, with no time: nothing in the audio
    collapsedShare: 0.2,       // matched them (real lines here had none; invented ones 3 to 14)
    brokenAlignmentScore: 0.1  // wav2vec2 alignment scores; noise is ~1/vocabulary (0.01)
  };

  function trim(s) {
    return String(s == null ? "" : s).replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
  }

  function countWords(text) {
    var t = trim(text);
    return t ? t.split(" ").length : 0;
  }

  function median(values) {
    if (!values.length) return NaN;
    var v = values.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(v.length / 2);
    return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
  }

  function finite(n) {
    return typeof n === "number" && isFinite(n);
  }

  function segmentWords(segment) {
    var out = [];
    var list = segment && segment.words || [];
    for (var i = 0; i < list.length; i++) {
      var w = list[i] || {};
      var text = trim(w.word != null ? w.word : w.text);
      var start = Number(w.start), end = Number(w.end);
      if (!text || !isFinite(start) || !isFinite(end)) continue;
      var word = { word: text, start: start, end: Math.max(start, end) };
      if (finite(w.probability)) word.probability = w.probability;
      if (finite(w.score)) word.score = w.score;
      out.push(word);
    }
    return out;
  }

  /* wav2vec2 alignment that produced noise: its scores sit near 1/vocabulary. Only words with a `score` (WhisperX's
     alignment) are judged; Whisper's own word `probability` is a different measure. */
  function alignmentLooksBroken(words) {
    var scores = [];
    for (var i = 0; i < words.length; i++) {
      if (finite(words[i].score)) scores.push(words[i].score);
    }
    return scores.length >= 3 && median(scores) < LIMITS.brokenAlignmentScore;
  }

  // Text left once every known closing line is taken out.
  function withoutKnownLines(text) {
    var rest = trim(text), matched = false;
    if (rest.normalize) rest = rest.normalize("NFC");
    for (var i = 0; i < KNOWN_MADE_UP.length; i++) {
      var re = new RegExp(KNOWN_MADE_UP[i].source, "gi");
      if (re.test(rest)) {
        matched = true;
        rest = trim(rest.replace(re, " "));
      }
    }
    return { matched: matched, rest: rest };
  }

  /* Why this line is one Whisper made up, or "" when it's kept. */
  function madeUpReason(segment, words) {
    var text = trim(segment && segment.text);
    if (!text) return "empty";
    if (!/[^\d\s.,!?;:'"()\-–—…%]/.test(text)) return "only numbers or punctuation";
    var known = withoutKnownLines(text);
    // A real sentence that ends with "subscribe" keeps its other words; a line that is all closing line goes.
    var left = countWords(known.rest.replace(/[^\s\wÀ-ỹ]/g, ""));
    if (known.matched && (left < 3 || left < 0.4 * countWords(text))) return "a channel's closing line, not speech";
    if (finite(segment.compression_ratio) && segment.compression_ratio > LIMITS.compressionRatio) return "repeats itself";
    if (finite(segment.avg_logprob) && segment.avg_logprob < LIMITS.avgLogprob) return "Whisper unsure (avg log-prob " + segment.avg_logprob.toFixed(2) + ")";
    if (finite(segment.no_speech_prob) && segment.no_speech_prob > LIMITS.noSpeechProb && finite(segment.avg_logprob) && segment.avg_logprob < -0.5) return "Whisper heard no speech";
    var probs = [], collapsed = 0;
    for (var i = 0; i < words.length; i++) {
      if (finite(words[i].probability)) probs.push(words[i].probability);
      if (words[i].end - words[i].start < LIMITS.collapsedWordSeconds) collapsed++;
    }
    // Only Whisper's own word times say anything here; noisy wav2vec2 times are judged by alignmentLooksBroken.
    if (probs.length >= 4 && collapsed >= LIMITS.collapsedWords && collapsed / words.length >= LIMITS.collapsedShare) return "word timing collapsed (" + collapsed + " of " + words.length + " words have no time)";
    if (probs.length) {
      var sum = 0;
      for (var p = 0; p < probs.length; p++) sum += probs[p];
      if (sum / probs.length < LIMITS.meanWordProbability) return "Whisper unsure of its words (mean " + (sum / probs.length).toFixed(2) + ")";
    }
    return "";
  }

  /* Longest a word can plausibly be said for, from its letters. */
  function wordMaxSeconds(word) {
    var letters = String(word || "").replace(/[^\wÀ-ỹ]/g, "").length;
    return 0.3 + 0.1 * Math.max(1, letters);
  }

  /* A line's first word starts no earlier, and its last word ends no later, than its letters allow. */
  function tidyWordTimes(words) {
    if (!words.length) return words;
    var out = words.map(function (w) { var c = {}; for (var k in w) c[k] = w[k]; return c; });
    var first = out[0], last = out[out.length - 1];
    var maxFirst = wordMaxSeconds(first.word);
    if (first.end - first.start > maxFirst) first.start = first.end - maxFirst;
    var maxLast = wordMaxSeconds(last.word);
    if (last.end - last.start > maxLast) last.end = last.start + maxLast;
    return out;
  }

  /* payload: WhisperX-shaped JSON ({segments: [{start, end, text, words, ...}]}). Returns
     { segments, dropped: [{start, end, text, reason}], wordTiming: "whisper" | "aligned" | "broken-alignment" | "none" }. */
  function cleanTranscript(payload) {
    var segments = payload && payload.segments || [];
    var kept = [], dropped = [], timing = { whisper: 0, aligned: 0, broken: 0 };
    for (var s = 0; s < segments.length; s++) {
      var seg = segments[s] || {};
      var start = Number(seg.start), end = Number(seg.end);
      var text = trim(seg.text);
      var words = segmentWords(seg);
      var reason = madeUpReason(seg, words);
      if (!reason && !(isFinite(start) && isFinite(end) && end > start)) reason = "no time";
      if (reason) {
        dropped.push({ start: start, end: end, text: text, reason: reason });
        continue;
      }
      if (alignmentLooksBroken(words)) {
        timing.broken++;
        words = [];
      } else if (words.length) {
        if (finite(words[0].probability)) {
          timing.whisper++;
          words = tidyWordTimes(words);
        } else {
          timing.aligned++;
        }
        start = Math.max(start, words[0].start);
        end = Math.min(end, Math.max(words[words.length - 1].end, start + 0.1));
        if (end <= start) { start = Number(seg.start); end = Number(seg.end); }
      }
      var out = { start: start, end: end, text: text, words: words };
      ["avg_logprob", "compression_ratio", "no_speech_prob"].forEach(function (k) { if (finite(seg[k])) out[k] = seg[k]; });
      kept.push(out);
    }
    var wordTiming = timing.broken ? "broken-alignment" : timing.whisper ? "whisper" : timing.aligned ? "aligned" : "none";
    return { segments: kept, dropped: dropped, wordTiming: wordTiming };
  }

  var api = {
    cleanTranscript: cleanTranscript,
    madeUpReason: function (segment) { return madeUpReason(segment, segmentWords(segment)); },
    alignmentLooksBroken: function (segment) { return alignmentLooksBroken(segmentWords(segment)); },
    tidyWordTimes: tidyWordTimes,
    LIMITS: LIMITS
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.prfxWhisperClean = api;
})(typeof window !== "undefined" ? window : this);
