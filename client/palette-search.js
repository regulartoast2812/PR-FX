/* The palette's search, laid out like Sage's vault search in Creative Assist (2026-11-23). A line-for-line port
   of native/PRFXPaletteSearch.swift (checked by tools/check-palette-search.swift) for the panel's own #palette and
   its Commands list; native/windows/Core/PaletteSearch.cs is the third copy. Change all three together.
   Rows: { kind: 'section', title, count, colour } | { kind: 'command', index, at } | { kind: 'media', index, at }
   | { kind: 'note', text }. `at` is [start, end) of the match in the name, or null. */
(function (root) {
  'use strict';
  var KINDS = [
    ['ai-function', 'AI functions'], ['custom', 'Functions'], ['effect', 'Effects'], ['audio-effect', 'Audio effects'],
    ['transition', 'Transitions'], ['audio-transition', 'Audio transitions'], ['preset', 'Presets']
  ];
  function rank(type) { for (var i = 0; i < KINDS.length; i++) if (KINDS[i][0] === type) return i; return KINDS.length; }
  function title(type) {
    for (var i = 0; i < KINDS.length; i++) if (KINDS[i][0] === type) return KINDS[i][1];
    type = String(type || '');
    return type.charAt(0).toUpperCase() + type.slice(1).replace(/-/g, ' ') + 's';
  }
  // Tabs, in Tab order. Media is everything placeable; Video, Audio (every sound), SFX (sound under 45 s) and BGM (45 s or longer)
  // are parts of it. Sequences are the project's sequences, opened rather than placed, so they are not in Media.
  var CATEGORIES = ['commands', 'media', 'video', 'audio', 'sfx', 'bgm', 'sequences'];
  var LABELS = { commands: 'Commands', media: 'Media', video: 'Video', audio: 'Audio', sfx: 'SFX', bgm: 'BGM', sequences: 'Sequences' };
  var SHORT_SOUND = 45;
  function step(category, by) {
    var i = CATEGORIES.indexOf(category);
    return CATEGORIES[(i + by + CATEGORIES.length) % CATEGORIES.length];
  }
  function isMediaCategory(category) { return category !== 'commands'; }
  function categoryOf(m) {
    if (m.kind === 'video') return 'video';
    if (m.kind === 'sequence') return 'sequences';
    if (m.kind === 'audio' && typeof m.seconds === 'number') return m.seconds < SHORT_SOUND ? 'sfx' : 'bgm';
    return null;
  }
  // Audio holds every sound, with or without a length; SFX and BGM only the sounds whose length Premiere gave.
  function inCategory(m, category) { return !category || (category === 'media' && m.kind !== 'sequence') || (category === 'audio' && m.kind === 'audio') || categoryOf(m) === category; }
  function mediaCount(media, category) { return media.filter(function (m) { return inCategory(m, category); }).length; }
  function sectionTitle(category, typed) {
    if (category === 'video') return 'Video';
    if (category === 'audio') return 'Audio';
    if (category === 'sfx') return 'SFX · under 45 s';
    if (category === 'bgm') return 'Ambient and BGM · 45 s or longer';
    if (category === 'sequences') return 'Sequences';
    return typed ? 'In the project' : 'All media';
  }
  function emptyNote(category) {
    if (category === 'video') return 'This project has no video.';
    if (category === 'audio') return 'This project has no sound.';
    if (category === 'sfx') return 'This project has no sound shorter than 45 seconds.';
    if (category === 'bgm') return 'This project has no sound 45 seconds or longer.';
    if (category === 'sequences') return 'This project has no sequences.';
    return 'This project has no media to place.';
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function duration(seconds) {
    if (seconds < 10) return (Math.floor(Math.max(0, seconds) * 10) / 10).toFixed(1) + ' s';
    if (seconds < 60) return Math.floor(seconds) + ' s';
    var t = Math.floor(seconds), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
    return h > 0 ? h + ':' + pad2(m) + ':' + pad2(sec) : m + ':' + pad2(sec);
  }

  function trim(s) { return String(s || '').replace(/^\s+|\s+$/g, ''); }
  function isWordChar(c) { return /[0-9A-Za-zÀ-￿]/.test(c); }

  function match(query, name) {
    var q = trim(query).toLowerCase();
    if (!q) return { score: 0, at: null };
    var n = String(name || '').toLowerCase();
    var start = n.indexOf(q);
    if (start !== -1) {
      var at = [start, start + q.length];
      if (start === 0) return { score: n.length === q.length ? 1000 : 900 - Math.min(n.length, 200), at: at };
      if (!isWordChar(n.charAt(start - 1))) return { score: 700 - Math.min(start, 200), at: at };
      return { score: 500 - Math.min(start, 200), at: at };
    }
    var words = q.split(' ').filter(function (w) { return w; });
    if (words.length < 2 || !words.every(function (w) { return n.indexOf(w) !== -1; })) return null;
    return { score: 300 - Math.min(n.length, 200), at: null };
  }

  // entries: [{ type, name, index }]; recent: indexes into entries.
  function commandRows(entries, query, recent) {
    var rows = [], typed = !!trim(query);
    if (!typed) {
      var shown = (recent || []).filter(function (i) { return i >= 0 && i < entries.length; });
      if (shown.length) {
        rows.push({ kind: 'section', title: 'Recent', count: shown.length, colour: 'recent' });
        shown.forEach(function (i) { rows.push({ kind: 'command', index: entries[i].index, at: null }); });
      }
    }
    var groups = {}, types = [];
    entries.forEach(function (e) {
      var m = match(query, e.name), hit = null;
      if (m) hit = { entry: e, score: m.score, at: m.at };
      else if (typed) { var k = match(query, title(e.type)); if (k) hit = { entry: e, score: k.score - 600, at: null }; }
      if (!hit) return;
      if (!groups[e.type]) { groups[e.type] = []; types.push(e.type); }
      groups[e.type].push(hit);
    });
    types.sort(function (a, b) { return rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0); });
    types.forEach(function (type) {
      var hits = groups[type];
      if (typed) hits.sort(function (a, b) { return b.score - a.score || a.entry.index - b.entry.index; });
      rows.push({ kind: 'section', title: title(type), count: hits.length, colour: type });
      hits.forEach(function (h) { rows.push({ kind: 'command', index: h.entry.index, at: h.at }); });
    });
    if (!rows.length) rows.push({ kind: 'note', text: typed ? 'No command is called that. Tab to look in Media.' : 'No commands yet.' });
    return rows;
  }

  function count(rows) { return rows.filter(selectable).length; }
  function selectable(row) { return !!row && (row.kind === 'command' || row.kind === 'media'); }

  function mediaHits(media, query, category) {
    var hits = [], typed = !!trim(query);
    media.forEach(function (m, i) {
      if (!inCategory(m, category)) return;
      var s = match(query, m.name);
      if (s) { hits.push({ index: i, score: s.score, at: s.at }); return; }
      if (typed) { var b = match(query, m.bin); if (b) hits.push({ index: i, score: b.score - 600, at: null }); }
    });
    hits.sort(function (a, b) {
      return b.score - a.score || String(media[a.index].name).localeCompare(String(media[b.index].name), undefined, { numeric: true, sensitivity: 'base' });
    });
    return hits;
  }

  function mediaRows(media, query, loading, error, recent, category, limit) {
    limit = limit || 300;
    if (!media.length) {
      if (loading) return [{ kind: 'note', text: 'Reading the project…' }];
      if (error) return [{ kind: 'note', text: error }];
      return [{ kind: 'note', text: 'This project has no media to place.' }];
    }
    var rows = [], typed = !!trim(query);
    if (!typed) {
      var shown = [];
      (recent || []).forEach(function (id) { for (var i = 0; i < media.length; i++) if (media[i].id === id) { if (inCategory(media[i], category)) shown.push(i); return; } });
      if (shown.length) {
        rows.push({ kind: 'section', title: category === 'sequences' ? 'Recently opened' : 'Recently placed', count: shown.length, colour: 'recent' });
        shown.forEach(function (i) { rows.push({ kind: 'media', index: i, at: null }); });
      }
    }
    var hits = mediaHits(media, query, category);
    if (!hits.length) return [{ kind: 'note', text: typed ? 'Nothing in the project is called that.' : emptyNote(category) }];
    rows.push({ kind: 'section', title: sectionTitle(category, typed), count: hits.length, colour: 'media' });
    hits.slice(0, limit).forEach(function (h) { rows.push({ kind: 'media', index: h.index, at: h.at }); });
    if (hits.length > limit) rows.push({ kind: 'note', text: (hits.length - limit) + ' more: type more of the name to narrow it down.' });
    return rows;
  }

  function firstSelectable(rows, from, step) {
    for (var i = from; i >= 0 && i < rows.length; i += step) if (selectable(rows[i])) return i;
    return -1;
  }
  function move(rows, current, delta) {
    var first = firstSelectable(rows, 0, 1);
    if (first === -1) return -1;
    var last = firstSelectable(rows, rows.length - 1, -1);
    var target = current, left = Math.abs(delta), step = delta < 0 ? -1 : 1;
    while (left > 0) { var next = firstSelectable(rows, target + step, step); if (next === -1) break; target = next; left--; }
    if (!selectable(rows[target])) target = first;
    return Math.max(first, Math.min(last, target));
  }
  function whereText(m) {
    var bins = m.bin ? m.bin : 'Top of the project';
    return typeof m.seconds === 'number' ? duration(m.seconds) + '  ·  ' + bins : bins;
  }

  root.PRFXPaletteSearch = {
    kinds: KINDS, title: title, rank: rank, match: match, commandRows: commandRows, count: count, selectable: selectable,
    mediaHits: mediaHits, mediaRows: mediaRows, firstSelectable: firstSelectable, move: move, whereText: whereText,
    categories: CATEGORIES, labels: LABELS, next: function (c) { return step(c, 1); }, previous: function (c) { return step(c, -1); },
    isMediaCategory: isMediaCategory, categoryOf: categoryOf, mediaCount: mediaCount, duration: duration
  };
}(typeof window !== 'undefined' ? window : this));
