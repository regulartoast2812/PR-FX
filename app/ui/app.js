// PR FX app UI. Plain DOM, no framework: one file per concern would be nicer,
// but this stays small enough to read top to bottom.
'use strict';

const api = window.prfx;
const $ = id => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

let platform = 'darwin';
let settings = {};
let catalog = [];
let displays = [];
let health = null;
let journal = [];
let media = null;
let connectors = null;
const undoStack = [];
const isMac = () => platform === 'darwin';

// MARK: Shortcut helpers (same rules as client/app.js)

const TYPE_LABELS = { custom: 'Function', 'ai-function': 'AI function', preset: 'Preset', effect: 'Effect', 'audio-effect': 'Audio effect', transition: 'Transition', 'audio-transition': 'Audio transition' };
const TYPE_FILTERS = [['all', 'All'], ['ai-function', 'AI functions'], ['custom', 'Functions'], ['preset', 'Presets'], ['effect', 'Effects'], ['transition', 'Transitions'], ['audio', 'Audio']];
const PLACEMENTS = [
  ['both', 'Both In + Out on each selected clip'], ['in', 'In points only'], ['out', 'Out points only'],
  ['selected-cuts', 'Cuts between adjacent selected clips'], ['group-ends', 'Start + end of each selected group'], ['centered', 'Centered at every selected boundary'],
];

const commandKey = c => [c.type, c.id || '', c.moveMode || '', c.name].join('|');
const sameShortcut = (a, b) => a && b && a.code === b.code && !!a.ctrl === !!b.ctrl && !!a.alt === !!b.alt && !!a.shift === !!b.shift && !!a.meta === !!b.meta;
const validCode = code => code === 'Space' || /^Key[A-Z]$/.test(code) || /^Digit[0-9]$/.test(code);

function shortcutParts(s) {
  if (!s || !s.code) return [];
  const parts = [];
  if (isMac()) {
    if (s.ctrl) parts.push('⌃'); if (s.alt) parts.push('⌥'); if (s.shift) parts.push('⇧'); if (s.meta) parts.push('⌘');
  } else {
    if (s.ctrl) parts.push('Ctrl'); if (s.alt) parts.push('Alt'); if (s.shift) parts.push('Shift'); if (s.meta) parts.push('Win');
  }
  parts.push(s.code.replace(/^Key/, '').replace(/^Digit/, ''));
  return parts;
}
const shortcutText = s => shortcutParts(s).join(isMac() ? '' : '+');

// MARK: Settings with undo

async function saveSettings(patch, { undoable = true, label = '' } = {}) {
  if (undoable) {
    const before = {};
    for (const key of Object.keys(patch)) before[key] = structuredClone(settings[key]);
    undoStack.push({ before, label });
    if (undoStack.length > 50) undoStack.shift();
  }
  Object.assign(settings, patch);
  try {
    settings = await api.writeSettings(patch);
  } catch (error) {
    toast('Could not save settings: ' + error.message, 'bad');
  }
  renderAll();
}

async function undo() {
  const step = undoStack.pop();
  if (!step) { toast('Nothing to undo'); return; }
  await saveSettings(step.before, { undoable: false });
  toast('Undid ' + (step.label || 'change'), 'ok');
}

// MARK: Navigation

let view = 'status';
function show(name) {
  view = name;
  document.querySelectorAll('.nav').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  document.querySelectorAll('.view').forEach(v => { v.hidden = v.id !== 'view-' + name; });
  if (name === 'commands') { renderCommands(); setTimeout(() => $('search').focus(), 0); }
  if (name === 'activity') renderActivity();
}
document.querySelectorAll('.nav').forEach(b => b.addEventListener('click', () => show(b.dataset.view)));
document.querySelectorAll('[data-goto]').forEach(b => b.addEventListener('click', () => show(b.dataset.goto)));
document.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', async () => {
  const result = await api.open(b.dataset.open);
  if (!result.ok && result.message) toast(result.message);
}));

// MARK: Toasts (inside the app; the listener draws its own over Premiere)

function toast(text, kind = '', action) {
  const t = el('div', 'toast ' + kind);
  t.append(el('span', '', text));
  if (action) {
    const b = el('button', '', action.label);
    b.addEventListener('click', () => { action.run(); t.remove(); });
    t.append(b);
  }
  $('toasts').append(t);
  setTimeout(() => t.remove(), kind === 'bad' ? 6000 : 3200);
}

// MARK: Status

function heroState() {
  if (!health) return { cls: 'bad', title: 'Listener offline', detail: 'Shortcuts and the palette need the PR FX listener running.', action: ['Start listener', startListener] };
  if (!health.accessibilityTrusted && isMac()) return { cls: 'bad', title: 'Accessibility permission needed', detail: 'macOS blocks the listener from seeing keys until PR FX Shortcut Listener is allowed.', action: ['Open Accessibility', () => api.accessibility()] };
  const g = health.geometry || {};
  const live = health.armedBindings || 0;
  if (health.scopeKind === 'full') return { cls: 'armed', title: `Timeline armed · ${live} shortcut${live === 1 ? '' : 's'} live`, detail: health.keyScope || 'Keys pressed in the Timeline run PR FX commands.' };
  if (g.panelsHidden) return { cls: 'warn', title: 'Export or Import mode', detail: 'Plain-key shortcuts are paused so you can type. Chords with ⌃ ⌥ ⌘ still work.' };
  if (g.premiereFrontmost === false || /not frontmost/i.test(health.focus || '')) return { cls: '', title: 'Premiere is in the background', detail: 'Shortcuts wake up when Premiere is in front and you click the Timeline.' };
  if (health.scopeKind === 'modifier-only') return { cls: 'warn', title: 'Chords only', detail: (health.keyScope || '') + ' — click the Timeline to arm plain keys.' };
  return { cls: 'warn', title: 'Click the Timeline to arm shortcuts', detail: health.keyScope || health.focus || '' };
}

function renderHero() {
  const s = heroState();
  $('hero').className = 'hero ' + s.cls;
  $('navDot').className = 'nav-dot ' + s.cls;
  $('heroTitle').textContent = s.title;
  $('heroDetail').textContent = s.detail;
  const button = $('heroAction');
  button.hidden = !s.action;
  if (s.action) { button.textContent = s.action[0]; button.onclick = s.action[1]; }
  $('buildLine').textContent = health ? 'Listener ' + (health.listenerBuild || '') : 'Listener offline';
}

async function startListener() {
  $('heroAction').disabled = true;
  $('heroDetail').textContent = 'Starting…';
  const result = await api.startListener();
  $('heroAction').disabled = false;
  if (!result.ok) toast(result.message || 'Could not start the listener', 'bad');
}

const SVG = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs) => { const n = document.createElementNS(SVG, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); return n; };
const asRect = a => a && a.length === 4 ? { x: a[0], y: a[1], width: a[2], height: a[3] } : null;

function renderMap() {
  const map = $('map');
  map.textContent = '';
  const g = (health && health.geometry) || {};
  // Windows reports physical pixels; scale the displays to match.
  const physical = g.units === 'physical-pixels';
  const ds = displays.map(d => physical ? { ...d, bounds: { x: d.bounds.x * d.scale, y: d.bounds.y * d.scale, width: d.bounds.width * d.scale, height: d.bounds.height * d.scale } } : d);
  const live = asRect(g.live), saved = asRect(g.saved), win = asRect(g.window);
  const focusRects = [win, live, saved].filter(Boolean);
  // Frame the displays Premiere touches, or all of them if it is nowhere.
  const touched = ds.filter(d => focusRects.some(r => r.x < d.bounds.x + d.bounds.width && r.x + r.width > d.bounds.x && r.y < d.bounds.y + d.bounds.height && r.y + r.height > d.bounds.y));
  const frame = (touched.length ? touched : ds).map(d => d.bounds);
  if (!frame.length) frame.push({ x: 0, y: 0, width: 1600, height: 900 });
  const minX = Math.min(...frame.map(b => b.x)), minY = Math.min(...frame.map(b => b.y));
  const maxX = Math.max(...frame.map(b => b.x + b.width)), maxY = Math.max(...frame.map(b => b.y + b.height));
  const pad = Math.max(maxX - minX, maxY - minY) * 0.02;
  map.setAttribute('viewBox', `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`);
  const unit = (maxX - minX) / 1600;
  const stroke = (n, w) => { n.style.strokeWidth = w * unit; return n; };

  for (const d of ds) {
    map.append(stroke(svgEl('rect', { class: 'display', x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height, rx: 10 * unit }), 2));
    const label = svgEl('text', { class: 'display-label', x: d.bounds.x + 18 * unit, y: d.bounds.y + 40 * unit });
    label.style.fontSize = 30 * unit + 'px';
    label.textContent = d.primary ? 'Main display' : 'Display';
    map.append(label);
  }
  if (win) map.append(stroke(svgEl('rect', { class: 'win', ...win, rx: 8 * unit }), 2));
  const same = live && saved && ['x', 'y', 'width', 'height'].every(k => Math.abs(live[k] - saved[k]) < 3);
  if (saved && !same) { const r = stroke(svgEl('rect', { class: 'saved', ...saved }), 4); r.style.strokeDasharray = `${14 * unit} ${10 * unit}`; map.append(r); }
  if (live) {
    map.append(stroke(svgEl('rect', { class: 'live' + (health.scopeKind === 'full' ? '' : ' off'), ...live, rx: 4 * unit }), 5));
    const t = svgEl('text', { class: 'label', x: live.x + 12 * unit, y: live.y + 30 * unit });
    t.style.fontSize = 22 * unit + 'px';
    t.textContent = 'Timeline';
    map.append(t);
  }
  if (g.click) map.append(stroke(svgEl('circle', { class: 'click', cx: g.click[0], cy: g.click[1], r: 11 * unit }), 4));

  let note = '';
  if (!health) note = 'No listener, nothing to show.';
  else if (!health.geometry) note = 'This listener build does not report geometry yet. Restart it after updating.';
  else if (live) note = health.scopeKind === 'full' ? 'Green box = where keys arm. The dot is your last click, inside it.' : 'Timeline found. Click inside the box to arm shortcuts.';
  else if (saved) note = 'Live lookup found nothing; using the remembered Timeline (dashed).';
  else note = g.panelsHidden ? 'Panels are hidden (Export/Import mode).' : 'No Timeline found yet. Open a sequence in Premiere and click it.';
  $('mapNote').textContent = note;
}

function fact(label, value, cls) { return [label, value, cls || '']; }
function ago(ms) {
  if (ms == null || !isFinite(ms) || ms < 0 || ms > 864e5 * 365) return 'never';
  if (ms < 1500) return 'just now';
  if (ms < 60000) return Math.round(ms / 1000) + 's ago';
  if (ms < 3600000) return Math.round(ms / 60000) + 'm ago';
  return Math.round(ms / 3600000) + 'h ago';
}

function renderFacts() {
  const list = $('facts');
  list.textContent = '';
  const rows = [];
  if (!health) rows.push(fact('Listener', 'offline', 'bad'));
  else {
    const g = health.geometry || {};
    rows.push(fact('Listener', 'running', 'good'));
    rows.push(fact('Premiere', g.premiereFrontmost ? 'in front' : 'background', g.premiereFrontmost ? 'good' : ''));
    rows.push(fact('Timeline', g.live ? 'found live' : g.saved ? 'remembered' : 'not found', g.live ? 'good' : g.saved ? 'warn' : 'bad'));
    rows.push(fact('Shortcuts', `${health.armedBindings || 0} live · ${health.withheldBindings || 0} waiting`, health.armedBindings ? 'good' : ''));
    rows.push(fact('Key delivery', health.deliveryMode === 'event-tap' ? 'event tap' : health.deliveryMode || '—', health.deliveryMode === 'carbon' ? 'warn' : ''));
    const engine = health.enginePollAgeMs;
    rows.push(fact('Premiere engine', engine != null && engine < 3000 ? 'connected' : 'not polling', engine != null && engine < 3000 ? 'good' : 'bad'));
    if (health.lookupAgeSeconds != null) rows.push(fact('Last lookup', ago(health.lookupAgeSeconds * 1000)));
    if (health.queuedCommands) rows.push(fact('Queued', String(health.queuedCommands), 'warn'));
    if (health.droppedCommands) rows.push(fact('Dropped', String(health.droppedCommands), 'bad'));
    rows.push(fact('Banners', { all: 'every result', problems: 'problems only', off: 'off' }[settings.shortcutFeedback] || 'problems only'));
  }
  for (const [label, value, cls] of rows) {
    list.append(el('dt', '', label));
    list.append(el('dd', cls, value));
  }
}

// MARK: Connectors: what PR FX connects to on this OS (connectors.json)

const CONNECTOR_VALUE = {
  premiere: c => c.ok ? c.installs.map(i => i.year).join(', ') : 'not found',
  panel: c => c.ok ? 'installed' : 'not installed',
  cepDebug: c => c.ok ? 'on' : 'off',
  uxp: c => c.ok ? 'installed' : 'not installed',
  listener: c => c.ok ? 'found' : 'missing',
  bridge: c => c.ok ? 'answering' : 'not answering',
  autostart: c => c.ok ? 'on' : 'off',
  overlay: c => c.provider === 'listener' ? 'native' : 'Creative Assist',
  accessibility: c => c.ok ? 'granted' : 'not granted',
};

function renderConnectors() {
  const list = $('connectors');
  list.textContent = '';
  if (!connectors) { $('connectorsTitle').textContent = 'This computer'; return; }
  const missing = connectors.connectors.filter(c => !c.ok && !c.optional);
  $('connectorsTitle').textContent = connectors.label + (connectors.ready ? ' · all connected' : ` · ${missing.length} missing`);
  for (const c of connectors.connectors) {
    const dd = el('dd', c.ok ? (c.id === 'overlay' ? '' : 'good') : c.optional ? '' : 'bad', (CONNECTOR_VALUE[c.id] || (x => x.ok ? 'ok' : 'missing'))(c));
    dd.title = c.detail;
    list.append(el('dt', '', c.label), dd);
  }
}

// MARK: Activity

function groupJournal(entries) {
  const bySeq = new Map();
  const items = [];
  for (const e of entries) {
    if (e.event === 'passed' || !e.seq) {
      items.push({ seq: null, state: 'passed', name: e.command || e.key, key: e.key, msg: e.detail, time: e.time });
      continue;
    }
    // Sequence numbers restart with the listener, so "fired" always opens a
    // new item and the id carries its time.
    let item = e.event === 'fired' ? null : bySeq.get(e.seq);
    if (!item) {
      item = { id: e.time + '|' + e.seq, seq: e.seq, state: 'pending', name: e.command, key: e.key, msg: '', time: e.time };
      bySeq.set(e.seq, item);
      items.push(item);
    }
    if (e.event === 'ok' || e.event === 'failed' || e.event === 'expired') {
      item.state = e.event;
      const m = /^(\d+)ms\s?(.*)$/.exec(e.detail || '');
      item.ms = m ? Number(m[1]) : null;
      item.msg = m ? m[2] : e.detail;
      item.time = e.time;
    } else if (e.event === 'delivered' && item.state === 'pending') item.msg = 'Running in Premiere…';
  }
  return items.reverse();
}

const VIA = { palette: 'palette', app: 'this app' };
function feedRow(item) {
  const li = el('li', item.state);
  li.append(el('span', 'icon', { ok: '✓', failed: '!', expired: '!', passed: '–', pending: '…' }[item.state]));
  const name = el('div', 'name', item.name || '(unknown)');
  const via = VIA[item.key] || (item.key ? item.key : '');
  if (via) name.append(el('span', 'via', item.state === 'passed' ? via : 'via ' + via));
  li.append(name);
  const when = item.time ? new Date(item.time) : null;
  li.append(el('span', 'when', when ? when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + (item.ms != null ? ` · ${item.ms < 1000 ? item.ms + 'ms' : (item.ms / 1000).toFixed(1) + 's'}` : '') : ''));
  if (item.msg) li.append(el('div', 'msg', item.msg));
  return li;
}

let activityFilter = 'commands';
function renderActivity() {
  const chips = $('activityChips');
  chips.textContent = '';
  for (const [id, label] of [['commands', 'Commands'], ['problems', 'Problems'], ['all', 'Everything']]) {
    const b = el('button', 'chip' + (activityFilter === id ? ' on' : ''), label);
    b.addEventListener('click', () => { activityFilter = id; renderActivity(); });
    chips.append(b);
  }
  const items = groupJournal(journal).filter(i =>
    activityFilter === 'all' ? true : activityFilter === 'problems' ? (i.state === 'failed' || i.state === 'expired') : i.state !== 'passed');
  const feed = $('feed');
  feed.textContent = '';
  if (!items.length) feed.append(el('li', 'empty-row', 'Nothing yet. Run a command from a shortcut, the palette or the Shortcuts tab.'));
  for (const item of items.slice(0, 300)) feed.append(feedRow(item));
}

function renderMiniFeed() {
  const items = groupJournal(journal).filter(i => i.state !== 'passed').slice(0, 6);
  const feed = $('miniFeed');
  feed.textContent = '';
  if (!items.length) feed.append(el('li', 'empty-row', 'No commands yet.'));
  for (const item of items) feed.append(feedRow(item));
  const today = new Date().toDateString();
  const todays = groupJournal(journal).filter(i => i.time && new Date(i.time).toDateString() === today && i.state !== 'passed');
  const ok = todays.filter(i => i.state === 'ok').length;
  const bad = todays.filter(i => i.state === 'failed' || i.state === 'expired').length;
  const stats = $('todayStats');
  stats.textContent = '';
  const s = (n, t) => { const span = el('span'); span.append(el('b', '', String(n)), ' ' + t); stats.append(span); };
  s(ok, 'worked today'); s(bad, 'failed');
}

const announced = new Set();
let journalPrimed = false;
let journalBusy = false;
async function refreshJournal() {
  if (journalBusy) return;
  journalBusy = true;
  try { journal = await api.journal(500); } finally { journalBusy = false; }
  const items = groupJournal(journal);
  // Announce results that arrived while the app is open, so a run from here
  // (or a shortcut while you watch) always says how it went. A pending item
  // is not marked seen, so it is announced when it lands.
  for (const item of items.slice().reverse()) {
    if (!item.seq || item.state === 'pending' || announced.has(item.id)) continue;
    announced.add(item.id);
    if (!journalPrimed) continue;
    if (item.state === 'ok') toast('✓ ' + item.name + (item.msg && !/^Applied /.test(item.msg) ? ' — ' + item.msg : ''), 'ok');
    else toast(item.name + ' ' + item.state + (item.msg ? ': ' + item.msg : ''), 'bad');
  }
  journalPrimed = true;
  renderMiniFeed();
  if (view === 'activity') renderActivity();
}

// MARK: Commands

let typeFilter = 'all';
let assignFilter = 'all';
let selectedKey = '';
let visible = [];

function allCommands() {
  const seen = new Set();
  const list = [];
  const add = c => { const k = commandKey(c); if (seen.has(k)) return; seen.add(k); list.push(c); };
  for (const c of catalog) {
    if (!c || !c.name || /\(legacy\)/i.test(c.name)) continue;
    if (!settings.showSystemCommands && /^\[System\]/.test(c.name)) continue;
    add(c);
  }
  // A binding whose command left the catalog still deserves a row, so it can be removed.
  for (const b of settings.bindings || []) if (b.command && b.command.name) add({ ...b.command, orphan: !seen.has(commandKey(b.command)) });
  return list;
}

const bindingFor = c => (settings.bindings || []).find(b => b.command && commandKey(b.command) === commandKey(c));

function renderChips(holder, options, current, set) {
  holder.textContent = '';
  for (const [id, label] of options) {
    const b = el('button', 'chip' + (current === id ? ' on' : ''), label);
    b.addEventListener('click', () => { set(id); renderCommands(); });
    holder.append(b);
  }
}

function renderCommands() {
  renderChips($('typeChips'), TYPE_FILTERS, typeFilter, v => { typeFilter = v; });
  renderChips($('assignChips'), [['all', 'Any'], ['bound', 'Has shortcut'], ['unbound', 'No shortcut']], assignFilter, v => { assignFilter = v; });
  const q = $('search').value.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  visible = allCommands().filter(c => {
    if (typeFilter === 'audio' ? !/^audio-/.test(c.type) : typeFilter !== 'all' && c.type !== typeFilter) return false;
    const bound = !!bindingFor(c);
    if (assignFilter === 'bound' && !bound) return false;
    if (assignFilter === 'unbound' && bound) return false;
    const hay = (c.name + ' ' + (TYPE_LABELS[c.type] || '')).toLowerCase();
    return words.every(w => hay.includes(w));
  });
  // Bound first when browsing everything, then alphabetical within type order.
  const order = ['ai-function', 'custom', 'preset', 'effect', 'transition', 'audio-effect', 'audio-transition'];
  visible.sort((a, b) => (q ? 0 : (!!bindingFor(b) - !!bindingFor(a))) || order.indexOf(a.type) - order.indexOf(b.type) || a.name.localeCompare(b.name));

  const list = $('cmdList');
  list.textContent = '';
  const frag = document.createDocumentFragment();
  for (const c of visible) {
    const li = el('li', commandKey(c) === selectedKey ? 'sel' : '');
    li.dataset.key = commandKey(c);
    li.append(el('span', 'n', c.name));
    const b = bindingFor(c);
    if (b) li.append(el('kbd', '', shortcutText(b.shortcut)));
    else li.append(el('span', 't', TYPE_LABELS[c.type] || c.type));
    li.addEventListener('click', () => select(c));
    li.addEventListener('dblclick', () => runCommand(c));
    frag.append(li);
  }
  list.append(frag);
  $('listCount').textContent = `${visible.length} command${visible.length === 1 ? '' : 's'} · ${(settings.bindings || []).length} with shortcuts`;
  if (!visible.find(c => commandKey(c) === selectedKey)) {
    if (visible.length && view === 'commands') select(visible[0], false); else renderDetail(null);
  } else renderDetail(visible.find(c => commandKey(c) === selectedKey));
}

function select(c, scroll = true) {
  selectedKey = commandKey(c);
  document.querySelectorAll('#cmdList li').forEach(li => li.classList.toggle('sel', li.dataset.key === selectedKey));
  if (scroll) { const li = document.querySelector(`#cmdList li.sel`); if (li) li.scrollIntoView({ block: 'nearest' }); }
  renderDetail(c);
}

let pendingShortcut = null;
let placement = 'both';

function conflictFor(shortcut, c) {
  if (!shortcut) return '';
  if (sameShortcut(shortcut, settings.shortcut)) return 'This is the palette shortcut. Saving moves it to this command and leaves the palette without one.';
  const other = (settings.bindings || []).find(b => sameShortcut(b.shortcut, shortcut) && (!c || commandKey(b.command) !== commandKey(c)));
  if (other) return `Already used by “${other.command.name}”. Saving moves it here.`;
  if (!shortcut.ctrl && !shortcut.alt && !shortcut.meta) return 'Plain keys only fire while the Timeline is armed, and pause in text fields and Export mode.';
  return '';
}

function renderDetail(c) {
  const pane = $('detail');
  pane.textContent = '';
  if (!c) { pane.append(el('div', 'empty muted', 'Choose a command on the left.')); return; }
  pane.append(el('h1', '', c.name));
  pane.append(el('div', 'type', (TYPE_LABELS[c.type] || c.type) + (c.orphan ? ' · no longer in Premiere’s list' : '')));

  const needsMedia = c.type === 'ai-function' && /audio \+ text|auto captions|optimized subtitles|full process|transcrib/i.test(c.name);
  const mediaReady = !needsMedia || !!(media && media.ffmpeg && media.ffmpeg.ready && media.whisper && media.whisper.ready);
  if (needsMedia) {
    const req = el('div', 'requirement ' + (mediaReady ? 'ready' : 'missing'));
    req.append(el('strong', '', mediaReady ? 'Whisper and ffmpeg ready' : 'Whisper or ffmpeg needs setup'));
    req.append(el('span', '', mediaReady ? 'This function can transcribe audio.' : 'Configure shared Media tools in Edie setup before running this function.'));
    if (!mediaReady) {
      const setup = el('button', 'link', 'Open Edie setup');
      setup.addEventListener('click', () => window.parent.postMessage({ type: 'creative-assist:media-tools' }, window.location.origin));
      req.append(setup);
    }
    pane.append(req);
  }

  const binding = bindingFor(c);
  const current = pendingShortcut && pendingShortcut.key === commandKey(c) ? pendingShortcut.shortcut : binding && binding.shortcut;
  const block = el('div', 'block');
  block.append(el('h2', '', 'Shortcut'));
  const cap = el('button', 'capture' + (current ? ' has' : ''), current ? shortcutText(current) : 'Click to record');
  cap.id = 'cmdCapture';
  cap.addEventListener('click', () => startCapture(cap, shortcut => {
    pendingShortcut = { key: commandKey(c), shortcut };
    renderDetail(c);
    $('saveBinding') && $('saveBinding').focus();
  }));
  block.append(cap);
  const conflict = pendingShortcut && pendingShortcut.key === commandKey(c) ? conflictFor(pendingShortcut.shortcut, c) : '';
  if (conflict) block.append(el('div', 'conflict', conflict));
  const actions = el('div', 'detail-actions');
  const dirty = pendingShortcut && pendingShortcut.key === commandKey(c) && !sameShortcut(pendingShortcut.shortcut, binding && binding.shortcut);
  if (dirty) {
    const save = el('button', 'primary', 'Save shortcut');
    save.id = 'saveBinding';
    save.addEventListener('click', () => saveBinding(c, pendingShortcut.shortcut));
    const cancel = el('button', 'ghost', 'Cancel');
    cancel.addEventListener('click', () => { pendingShortcut = null; renderDetail(c); });
    actions.append(save, cancel);
  }
  if (binding && !dirty) {
    const remove = el('button', 'ghost danger', 'Remove shortcut');
    remove.addEventListener('click', () => removeBinding(c));
    actions.append(remove);
  }
  if (actions.childNodes.length) block.append(actions);
  block.append(el('p', 'hint', 'Shortcuts fire while Premiere’s Timeline is armed. Chords with ' + (isMac() ? '⌃ ⌥ ⌘' : 'Ctrl or Alt') + ' also work elsewhere in Premiere.'));
  pane.append(block);

  if (c.orphan) return;
  const run = el('div', 'block');
  run.append(el('h2', '', 'Run now'));
  if (c.type === 'transition' || c.type === 'audio-transition') {
    const sel = el('select');
    for (const [id, label] of PLACEMENTS) { const o = el('option', '', label); o.value = id; sel.append(o); }
    sel.value = placement;
    sel.addEventListener('change', () => { placement = sel.value; });
    run.append(sel);
  }
  const runRow = el('div', 'detail-actions');
  const go = el('button', 'primary', 'Run on selected clips');
  go.disabled = !mediaReady;
  go.addEventListener('click', () => runCommand(c, go));
  runRow.append(go);
  run.append(runRow);
  run.append(el('p', 'hint', 'Runs in Premiere on whatever is selected now, same as the palette. Double-click a command, or press ' + (isMac() ? '⌘↩' : 'Ctrl+Enter') + '.'));
  pane.append(run);
}

async function saveBinding(c, shortcut) {
  const command = { type: c.type, name: c.name };
  for (const k of ['id', 'moveMode', 'presetUid']) if (c[k]) command[k] = c[k];
  const patch = {};
  if (sameShortcut(shortcut, settings.shortcut)) patch.shortcut = { code: '', ctrl: false, alt: false, shift: false, meta: false };
  patch.bindings = (settings.bindings || []).filter(b => commandKey(b.command) !== commandKey(c) && !sameShortcut(b.shortcut, shortcut)).concat([{ command, shortcut }]);
  pendingShortcut = null;
  await saveSettings(patch, { label: 'shortcut for ' + c.name });
  toast(`${shortcutText(shortcut)} → ${c.name}`, 'ok', { label: 'Undo', run: undo });
}

async function removeBinding(c) {
  await saveSettings({ bindings: (settings.bindings || []).filter(b => commandKey(b.command) !== commandKey(c)) }, { label: 'removing ' + c.name });
  toast('Removed shortcut for ' + c.name, 'ok', { label: 'Undo', run: undo });
}

async function runCommand(c, button) {
  if (c.orphan) return;
  const num = (v, d, min, max) => { const n = Number(v); return isFinite(n) && n >= min && n <= max ? n : d; };
  const payload = {
    type: c.type, id: c.id, name: c.name, presetUid: c.presetUid || '',
    transitionFrames: Number(c.transitionFrames) || Number(settings.transitionFrames) || 30,
    transitionPlacement: placement, moveMode: c.moveMode || 'group',
    staggerFrames: num(settings.staggerFrames, 5, 0, 9999), staggerGroup: num(settings.staggerGroup, 1, 1, 999),
    exportNamePattern: settings.exportNamePattern || '{sequence} - {index}', mergeTouchingSameSource: settings.mergeTouchingSameSource === true,
    nameTolerance: settings.nameTolerance || 'normalized', failurePolicy: settings.failurePolicy || 'rollback', syntheticSeconds: settings.syntheticSeconds || 5,
  };
  if (button) { button.disabled = true; setTimeout(() => { button.disabled = false; }, 700); }
  const result = await api.run(payload);
  if (!result.ok) toast('Could not send: ' + result.message, 'bad');
  else toast('Sent ' + c.name + ' to Premiere…');
  setTimeout(refreshJournal, 400);
}

$('search').addEventListener('input', renderCommands);
$('search').addEventListener('keydown', e => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); moveSelection(e.key === 'ArrowDown' ? 1 : -1); }
  else if (e.key === 'Enter') {
    const c = visible.find(x => commandKey(x) === selectedKey);
    if (!c) return;
    if (e.metaKey || e.ctrlKey) runCommand(c); else { const cap = $('cmdCapture'); if (cap) cap.click(); }
  } else if (e.key === 'Escape' && $('search').value) { $('search').value = ''; renderCommands(); }
});
function moveSelection(step) {
  const i = visible.findIndex(c => commandKey(c) === selectedKey);
  const next = visible[Math.max(0, Math.min(visible.length - 1, i + step))];
  if (next) select(next);
}

// MARK: Shortcut capture

let capturing = null;
function startCapture(button, done) {
  stopCapture();
  capturing = { button, done, before: button.textContent };
  button.classList.add('listening');
  button.textContent = 'Press keys… (Esc cancels)';
}
function stopCapture(restore = true) {
  if (!capturing) return;
  capturing.button.classList.remove('listening');
  if (restore) capturing.button.textContent = capturing.before;
  capturing = null;
}
window.addEventListener('keydown', e => {
  if (capturing) {
    e.preventDefault(); e.stopPropagation();
    if (e.key === 'Escape') { stopCapture(); return; }
    if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Fn'].includes(e.key)) return;
    if (!validCode(e.code)) { capturing.button.textContent = 'Letters, digits or Space only'; return; }
    const shortcut = { code: e.code, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey };
    const done = capturing.done;
    stopCapture(false);
    done(shortcut);
    return;
  }
  const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement && document.activeElement.tagName) && document.activeElement.type !== 'checkbox';
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey && !typing) { e.preventDefault(); undo(); return; }
  if ((e.metaKey || e.ctrlKey) && e.key === 'f') { e.preventDefault(); show('commands'); return; }
  if ((e.metaKey || e.ctrlKey) && /^[1-4]$/.test(e.key)) { e.preventDefault(); show(['status', 'commands', 'activity', 'settings'][Number(e.key) - 1]); return; }
  if (view === 'commands' && !typing && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); moveSelection(e.key === 'ArrowDown' ? 1 : -1); }
  if (view === 'commands' && e.key === 'Escape' && pendingShortcut) { pendingShortcut = null; renderCommands(); }
}, true);

// MARK: Settings form

function renderSettings() {
  document.querySelectorAll('.segmented').forEach(seg => {
    const value = settings[seg.dataset.key] || (['announceScope', 'edieNudges'].includes(seg.dataset.key) ? 'on' : 'problems');
    seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.value === value));
  });
  document.querySelectorAll('[data-key]').forEach(input => {
    if (input.classList.contains('segmented') || document.activeElement === input) return;
    const value = settings[input.dataset.key];
    if (input.type === 'checkbox') input.checked = value === true;
    else input.value = value == null ? '' : value;
  });
  const p = $('paletteShortcut');
  if (!p.classList.contains('listening')) { p.textContent = settings.shortcut && settings.shortcut.code ? shortcutText(settings.shortcut) : 'Not set'; p.classList.toggle('has', !!(settings.shortcut && settings.shortcut.code)); }
  const state = $('listenerState');
  state.textContent = health ? `Running · ${health.deliveryMode === 'event-tap' ? 'event tap' : health.deliveryMode || ''} · ${health.bindings || 0} shortcuts loaded` : 'Not running';
  $('accessBtn').hidden = !isMac();
}

document.querySelectorAll('.segmented').forEach(seg => seg.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
  const key = seg.dataset.key;
  if (settings[key] === b.dataset.value) return;
  saveSettings({ [key]: b.dataset.value }, { label: seg.previousElementSibling ? seg.previousElementSibling.textContent.toLowerCase() : key });
})));
document.querySelectorAll('input[data-key], select[data-key]').forEach(input => {
  const commit = () => {
    const key = input.dataset.key;
    let value = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value;
    if (input.type === 'number') {
      const min = Number(input.min), max = Number(input.max);
      if (!isFinite(value) || value < min || value > max) { toast(`Use a number from ${min} to ${max}.`, 'bad'); input.value = settings[key]; return; }
    }
    if (settings[key] === value) return;
    const label = (document.querySelector(`label[for=${input.id}]`) || {}).textContent || key;
    saveSettings({ [key]: value }, { label: label.toLowerCase() });
  };
  input.addEventListener('change', commit);
  if (input.type !== 'checkbox' && input.tagName !== 'SELECT') input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') { input.value = settings[input.dataset.key]; input.blur(); } });
});
$('paletteShortcut').addEventListener('click', () => startCapture($('paletteShortcut'), shortcut => {
  const clash = (settings.bindings || []).find(b => sameShortcut(b.shortcut, shortcut));
  const patch = { shortcut };
  if (clash) patch.bindings = settings.bindings.filter(b => b !== clash);
  saveSettings(patch, { label: 'palette shortcut' }).then(() => {
    toast('Palette: ' + shortcutText(shortcut) + (clash ? ` (taken from ${clash.command.name})` : ''), 'ok', { label: 'Undo', run: undo });
  });
}));
$('restartListener').addEventListener('click', async () => {
  const b = $('restartListener');
  b.disabled = true; b.textContent = 'Restarting…';
  const result = await api.restartListener();
  b.disabled = false; b.textContent = 'Restart listener';
  toast(result.ok ? 'Listener restarted' : (result.message || 'Restart failed'), result.ok ? 'ok' : 'bad');
});
$('accessBtn').addEventListener('click', () => api.accessibility());
$('paletteBtn').addEventListener('click', async () => {
  const result = await api.openPalette();
  if (!result.ok) toast(result.message, 'bad');
  else if (!(health && health.geometry && health.geometry.premiereFrontmost)) toast('The palette opens over Premiere — switch to it.');
});

// MARK: Overlay

$('overlayToggle').addEventListener('change', e => api.setOverlay(e.target.checked));
api.onOverlayState(on => { $('overlayToggle').checked = on; });

// MARK: Boot

function renderAll() {
  renderHero();
  renderMap();
  renderFacts();
  renderConnectors();
  renderSettings();
  if (view === 'commands') renderCommands();
}

let lastStats = '';
api.onHealth(payload => {
  health = payload.health;
  renderHero();
  renderMap();
  renderFacts();
  if (view === 'settings') renderSettings();
  // keyStats moves whenever a command fires or finishes: refresh the feed then.
  const stats = health ? JSON.stringify(health.keyStats || {}) : '';
  if (stats !== lastStats) { lastStats = stats; refreshJournal(); }
});
api.onFilesChanged(async ({ settings: s, catalog: c }) => {
  settings = s;
  catalog = c || catalog;
  // A path entered here can change tool readiness without a Detect/Test click.
  // Re-read service state so the badge and dependent command buttons stay honest.
  try { media = (await api.state()).media || media; } catch (_) {}
  renderAll();
});
api.onDisplays(d => { displays = d; renderMap(); });
api.onJournalChanged(() => refreshJournal());
api.onConnectors(report => { connectors = report; renderConnectors(); });

(async () => {
  const state = await api.state();
  platform = state.platform;
  settings = state.settings;
  media = state.media;
  catalog = state.catalog || [];
  displays = state.displays || [];
  connectors = state.connectors || null;
  if (!connectors) api.connectors().then(report => { connectors = report; renderConnectors(); }).catch(() => {});
  document.body.classList.add(isMac() ? 'mac' : 'win');
  $('undoKey').textContent = isMac() ? '⌘Z' : 'Ctrl+Z';
  $('overlayToggle').checked = state.overlay;
  renderAll();
  refreshJournal();
  setInterval(refreshJournal, 5000);
})();
