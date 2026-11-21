// PR FX's plain-Node core, shared by the service (the tool's backend inside
// Creative Assist), the MCP server (the tools Edie calls) and, later, anything
// else. No Electron here: paths, settings, the listener's bridge, the journal.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { paths, extensionDir, platform, connectListener, stopListener, table } from './connectors.mjs';

export const IS_WIN = process.platform === 'win32';
export const IS_MAC = process.platform === 'darwin';
export const PORT = table.bridge.port;

// MARK: Paths (the same ones client/app.js and the listeners use)

// Per-OS paths come from connectors.json (see connectors.mjs), shared with
// the Windows listener and the CEP panel.
export const supportDir = paths.support;
export const logsDir = paths.logs;
export const files = {
  settings: path.join(supportDir, 'settings.json'),
  backup: path.join(supportDir, 'settings.backup.json'),
  catalog: path.join(supportDir, 'catalog.json'),
  token: path.join(supportDir, 'bridge-token'),
  failures: path.join(supportDir, 'failure-log.jsonl'),
  journal: path.join(logsDir, 'PR FX Key Journal.tsv'),
  listenerLog: path.join(logsDir, 'PR FX Shortcut Listener.log'),
};

export { extensionDir };

/** Install/update the unpacked UXP companion without restarting Premiere.
 * Creative Assist calls this when the PR FX tool starts, so installing the
 * tool from a folder brings both the CEP rollback engine and UXP runtime. */
export function ensureUxpInstalled() {
  const root = extensionDir();
  if (!root) return { ok: false, message: 'The PR FX folder is unavailable.' };
  const source = path.join(root, 'uxp');
  const manifestFile = path.join(source, 'manifest.json');
  if (!fs.existsSync(manifestFile)) return { ok: false, message: 'This PR FX build has no UXP runtime.' };
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    const folderName = `${manifest.id}_${manifest.version}`;
    const external = paths.uxpExternal;
    const destination = path.join(external, folderName);
    const infoDir = path.join(external, '..', '..', 'PluginsInfo', 'v1');
    const infoFile = path.join(infoDir, 'premierepro.json');
    fs.mkdirSync(external, { recursive: true });
    fs.mkdirSync(infoDir, { recursive: true });

    let currentVersion = '';
    try { currentVersion = JSON.parse(fs.readFileSync(path.join(destination, 'manifest.json'), 'utf8')).version || ''; } catch (_) {}
    if (currentVersion !== manifest.version) {
      const staging = `${destination}.staging-${process.pid}`;
      fs.rmSync(staging, { recursive: true, force: true });
      fs.cpSync(source, staging, { recursive: true });
      fs.rmSync(destination, { recursive: true, force: true });
      fs.renameSync(staging, destination);
    } else {
      // Same version: still refresh any file that changed, in place, so a
      // rebuild reaches the folder Premiere actually loads.
      const refresh = (from, to) => {
        fs.mkdirSync(to, { recursive: true });
        for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
          if (entry.name.startsWith('.')) continue;
          const a = path.join(from, entry.name), b = path.join(to, entry.name);
          if (entry.isDirectory()) { refresh(a, b); continue; }
          let same = false;
          try { same = fs.readFileSync(a).equals(fs.readFileSync(b)); } catch (_) {}
          if (!same) fs.copyFileSync(a, b);
        }
      };
      refresh(source, destination);
    }
    // Media Encoder presets for Queue Cuts to AME live beside CEP's copy.
    const presets = path.join(root, 'epr');
    if (fs.existsSync(presets)) {
      const target = path.join(destination, 'epr');
      fs.mkdirSync(target, { recursive: true });
      for (const name of fs.readdirSync(presets)) {
        if (!/\.epr$/i.test(name)) continue;
        const a = path.join(presets, name), b = path.join(target, name);
        let same = false;
        try { same = fs.readFileSync(a).equals(fs.readFileSync(b)); } catch (_) {}
        if (!same) fs.copyFileSync(a, b);
      }
    }

    let registry = readJSON(infoFile, { plugins: [] });
    if (!registry || !Array.isArray(registry.plugins)) registry = { plugins: [] };
    const existing = registry.plugins.find(item => item && item.pluginId === manifest.id);
    const expectedPath = `$localPlugins/External/${folderName}`;
    if (!existing || existing.versionString !== manifest.version || existing.path !== expectedPath || existing.status !== 'enabled') {
      registry.plugins = registry.plugins.filter(item => item && item.pluginId !== manifest.id);
      registry.plugins.push({ hostMinVersion: manifest.host.minVersion, name: manifest.name, path: expectedPath,
        pluginId: manifest.id, status: 'enabled', type: 'uxp', versionString: manifest.version });
      const temp = `${infoFile}.tmp-${process.pid}`;
      fs.writeFileSync(temp, JSON.stringify(registry), 'utf8');
      fs.renameSync(temp, infoFile);
    }
    return { ok: true, id: manifest.id, version: manifest.version, path: destination };
  } catch (error) {
    return { ok: false, message: `UXP install failed: ${error.message}` };
  }
}

// MARK: Settings — read-merge-write, never a blind overwrite

export const DEFAULTS = {
  shortcut: { code: 'Space', ctrl: true, alt: false, shift: false, meta: false },
  transitionFrames: 30, staggerFrames: 5, staggerGroup: 1, exportNamePattern: '{sequence} - {index}',
  mergeTouchingSameSource: false, nameTolerance: 'normalized', failurePolicy: 'rollback', showSystemCommands: false,
  syntheticSeconds: 5, shortcutFeedback: 'problems', announceScope: 'on', timelineHighlight: 'off', edieNudges: 'on', edieNudgeMinutes: 2, bindings: [], folderSyncsByProject: {},
  // Reusable media tools. These used to live only in the hidden PR AI panel's
  // localStorage, so the functions were visible in Creative Assist without a
  // place to make them work.
  ffmpegPath: '', whisperCommand: '', whisperModel: 'large-v3-turbo', whisperDevice: 'auto',
  defaultAudioTrack: 'A1', audioHeadPad: 0.25, audioTailPad: 0.25,
  captionMaxWords: 6, captionMaxChars: 34, captionSplitMode: 'readability', captionTrimEndPunctuation: true,
};

export function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}

export function readSettings() {
  const stored = readJSON(files.settings, null);
  return { ...DEFAULTS, ...(stored && typeof stored === 'object' ? stored : {}) };
}

export const readCatalog = () => { const c = readJSON(files.catalog, []); return Array.isArray(c) ? c : []; };

export let lastOwnWrite = 0;
/** Only the keys the editor changed; everything else is taken from the file
 *  as it is right now, so this and the CEP panel cannot erase each other. */
export function writeSettings(patch) {
  fs.mkdirSync(supportDir, { recursive: true });
  const current = readJSON(files.settings, {}) || {};
  const next = { ...DEFAULTS, ...current, ...patch };
  if ((current.bindings || []).length > (next.bindings || []).length) {
    try { fs.writeFileSync(files.backup, JSON.stringify(current), 'utf8'); } catch (_) {}
  }
  const temp = path.join(supportDir, `settings.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(temp, JSON.stringify(next), 'utf8');
  fs.renameSync(temp, files.settings);
  lastOwnWrite = Date.now();
  request('POST', '/reload-settings', '').catch(() => {});
  return next;
}

// MARK: Bridge

export function request(method, route, body, headers = {}, timeout = 900) {
  return new Promise((resolve, reject) => {
    const data = body == null ? '' : typeof body === 'string' ? body : JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port: PORT, method, path: route, timeout,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers } }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(text); } catch (_) {}
        if (res.statusCode >= 400) reject(new Error((json && json.error) || `HTTP ${res.statusCode}`));
        else resolve(json);
      });
    });
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', reject);
    req.end(data);
  });
}

export function control(route, body) {
  let token = '';
  try { token = fs.readFileSync(files.token, 'utf8').trim(); } catch (_) {}
  if (!token) return Promise.reject(new Error('The listener has not written its bridge token yet. Restart the listener.'));
  return request('POST', route, body, { 'X-PRFX-Token': token }, 1500);
}

export const health = () => request('GET', '/health', null, {}, 700);

// MARK: Commands

const num = (v, d, min, max) => { const n = Number(v); return isFinite(n) && n >= min && n <= max ? n : d; };

/** The payload a command runs with: the catalog entry plus the editing defaults
 *  from settings (the same fields the app and the panel send). */
export function runPayload(c, settings = readSettings(), placement = 'center') {
  return {
    type: c.type, id: c.id, name: c.name, presetUid: c.presetUid || '',
    transitionFrames: Number(c.transitionFrames) || Number(settings.transitionFrames) || 30,
    transitionPlacement: placement, moveMode: c.moveMode || 'group',
    staggerFrames: num(settings.staggerFrames, 5, 0, 9999), staggerGroup: num(settings.staggerGroup, 1, 1, 999),
    exportNamePattern: settings.exportNamePattern || '{sequence} - {index}', mergeTouchingSameSource: settings.mergeTouchingSameSource === true,
    nameTolerance: settings.nameTolerance || 'normalized', failurePolicy: settings.failurePolicy || 'rollback', syntheticSeconds: settings.syntheticSeconds || 5,
  };
}

const fold = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9.]+/g, ' ').trim();

/** Commands matching every word of the query, best first: whole-name and
 *  word-start matches above substrings, shorter names above longer. */
export function findCommands(query, { type = '', limit = 20, catalog = readCatalog(), includeSystem = false } = {}) {
  const words = fold(query).split(' ').filter(Boolean);
  const out = [];
  for (const c of catalog) {
    if (!c || !c.name) continue;
    if (type && c.type !== type) continue;
    if (!includeSystem && /^\[System\]/.test(c.name) && !/system/.test(fold(query))) continue;
    const name = fold(c.name);
    let score = 0;
    let ok = true;
    for (const w of words) {
      const at = name.indexOf(w);
      if (at < 0) { ok = false; break; }
      score += at === 0 ? 6 : name[at - 1] === ' ' ? 4 : 1;
    }
    if (!ok) continue;
    if (name === words.join(' ')) score += 20;
    score -= name.length / 40;
    out.push({ c, score });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit).map(x => x.c);
}

/** One catalog entry by exact name (case-insensitive), or by id + moveMode. */
export function commandByName(name, catalog = readCatalog()) {
  const n = fold(name);
  return catalog.find(c => fold(c.name) === n) || null;
}

// MARK: Journal — tail of the TSV the listener writes

export function readJournal(limit) {
  let text = '';
  try {
    const stat = fs.statSync(files.journal);
    const size = Math.min(stat.size, 256 * 1024);
    const fd = fs.openSync(files.journal, 'r');
    const buffer = Buffer.alloc(size);
    fs.readSync(fd, buffer, 0, size, stat.size - size);
    fs.closeSync(fd);
    text = buffer.toString('utf8');
  } catch (_) { return []; }
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length && !/^\d{4}-/.test(lines[0])) lines.shift();
  return lines.slice(-limit).map(line => {
    const [time, event, seq, key, command, ...detail] = line.split('\t');
    return { time, event, seq: seq ? Number(seq) : null, key, command, detail: detail.join('\t') };
  });
}

/** Sends a command and waits for its outcome in the journal: the listener
 *  journals "fired" with a fresh seq, then ok / failed / expired for it.
 *  /run does not return the seq, so it is matched by name and time. */
export async function runAndWait(command, { timeoutMs = 20000 } = {}) {
  const sentAt = Date.now() - 1500;
  await control('/run', command);
  let seq = null;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await new Promise(r => setTimeout(r, 250));
    const lines = readJournal(60).filter(l => Date.parse(l.time) >= sentAt && l.key === 'app' && l.command === command.name);
    if (seq == null) { const fired = lines.find(l => l.event === 'fired'); if (fired) seq = fired.seq; }
    if (seq == null) continue;
    const done = lines.find(l => l.seq === seq && /^(ok|failed|expired)$/.test(l.event));
    if (done) {
      const ms = /^(\d+)ms\s*/.exec(done.detail);
      return { outcome: done.event, message: ms ? done.detail.slice(ms[0].length) : done.detail, ms: ms ? Number(ms[1]) : null, seq };
    }
  }
  return { outcome: 'pending', message: seq == null ? 'The listener did not take the command.' : 'Still running after ' + Math.round(timeoutMs / 1000) + 's — check Premiere.', seq };
}

// MARK: Listener launch

// Whichever listener this OS has (connectors.json): the Swift app through its
// start script on macOS, the exe on Windows.
export function startListener() { return connectListener(); }

export async function restartListener() {
  await stopListener();
  await new Promise(r => setTimeout(r, 500));
  return connectListener();
}

// MARK: Showing files

export function reveal(target, folder) {
  if (IS_MAC) spawn('open', folder ? [target] : ['-R', target], { detached: true, stdio: 'ignore' }).unref();
  else if (IS_WIN) spawn('explorer.exe', folder ? [target] : ['/select,', target], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

export function openAccessibility() {
  const pane = platform() && platform().accessibility;
  if (pane && IS_MAC) spawn('open', [pane], { detached: true, stdio: 'ignore' }).unref();
}

/** One line for a person: is it working right now. */
export function statusLine(h) {
  if (!h) return { kind: 'offline', label: 'Listener offline' };
  if (h.scopeKind === 'full') return { kind: 'full', label: 'Timeline armed' };
  if (h.geometry && h.geometry.panelsHidden) return { kind: 'modifier-only', label: 'Export/Import mode — chords only' };
  if (h.scopeKind === 'modifier-only') return { kind: 'modifier-only', label: 'Chords only — ' + (h.keyScope || '') };
  return { kind: 'none', label: h.keyScope || 'Paused' };
}
