// Which pieces PR FX connects to on this OS, and whether each is there.
//
// The table is ../../connectors.json, shared with the Windows side: one entry
// per OS (darwin, win32) naming the listener, its autostart, the support and
// log folders, where CEP and UXP panels go, how CEP debug mode is turned on,
// who draws the Timeline overlay and where Accessibility is granted. Code
// asks this module rather than branching on process.platform itself, so a
// new OS or a moved path is one edit to the JSON.
//
// detect() looks at every connector without changing anything and returns a
// report for Creative Assist's PR FX card and page; connectListener() starts
// whichever listener this OS has, if the bridge isn't answering already.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
export const table = JSON.parse(fs.readFileSync(path.join(repo, 'connectors.json'), 'utf8'));

/** This OS's entry, or null where PR FX doesn't run. */
export function platform(name = process.platform) {
  const entry = table[name];
  return entry && typeof entry === 'object' && entry.label ? { name, ...entry } : null;
}

/** The extension folder when this file sits in an installed PR FX. */
export function extensionDir() {
  return fs.existsSync(path.join(repo, 'jsx', 'host.jsx')) ? repo : '';
}

const ENV_FALLBACK = {
  APPDATA: () => path.join(os.homedir(), 'AppData', 'Roaming'),
  LOCALAPPDATA: () => path.join(os.homedir(), 'AppData', 'Local'),
  ProgramFiles: () => 'C:\\Program Files',
};

/** ~, %VAR%, {ext}, {year} and {v} filled in; the separators made native. */
export function expand(template, vars = {}, name = process.platform) {
  if (!template) return '';
  let out = String(template)
    .replace(/^~(?=$|[\\/])/, os.homedir())
    .replace(/%([A-Za-z_]+)%/g, (_, v) => process.env[v] || (ENV_FALLBACK[v] ? ENV_FALLBACK[v]() : ''))
    .replace(/\{(\w+)\}/g, (m, k) => k === 'ext' ? (vars.ext ?? extensionDir()) : vars[k] != null ? String(vars[k]) : m);
  if (name === 'win32') out = out.replace(/\//g, '\\');
  else if (!/^[a-z-]+:/.test(out)) out = out.replace(/\\/g, '/');
  return out;
}

const p = platform();
const ex = (t, vars) => expand(t, vars);

export const paths = {
  support: p ? ex(p.support) : path.join(os.homedir(), '.prfx'),
  logs: p ? ex(p.logs) : path.join(os.homedir(), '.prfx', 'Logs'),
  cepExtensions: p ? ex(p.cepExtensions) : '',
  uxpExternal: p ? ex(p.uxpExternal) : '',
};

/** Listener files in the order this OS prefers them; the first one there wins. */
export function listenerCandidates() {
  return p ? p.listener.paths.map(t => ex(t)).filter(Boolean) : [];
}
export function listenerPath() {
  return listenerCandidates().find(f => fs.existsSync(f)) || '';
}

/** Premiere Pro releases from table.premiere.minYear on, as installed. */
export function premiereInstalls() {
  if (!p) return [];
  const last = new Date().getFullYear() + 1, found = [];
  for (let year = table.premiere.minYear; year <= last; year++)
    for (const t of p.premiere) { const f = ex(t, { year }); if (fs.existsSync(f)) found.push({ year, path: f }); }
  return found;
}

const run = (cmd, args, timeout = 4000) => new Promise(resolve =>
  execFile(cmd, args, { timeout, windowsHide: true }, (error, stdout) => resolve(error ? null : String(stdout || ''))));

/** CSXS versions with PlayerDebugMode on (needed for an unsigned CEP panel). */
export async function cepDebugVersions() {
  if (!p) return [];
  const on = [];
  for (const v of table.premiere.cepVersions) {
    const d = p.cepDebug;
    const out = d.kind === 'defaults' ? await run('defaults', ['read', ex(d.domain, { v }), d.key])
      : d.kind === 'reg' ? await run('reg.exe', ['query', ex(d.key, { v }), '/v', d.value]) : null;
    if (out && (d.kind === 'defaults' ? /^\s*1\s*$/.test(out) : /\b1\s*$/m.test(out))) on.push(v);
  }
  return on;
}

/** Whether the listener starts with the computer. */
export async function autostartOn() {
  if (!p) return false;
  const a = p.autostart;
  if (a.kind === 'launchagent') return fs.existsSync(ex(a.path));
  if (a.kind === 'run-key') return !!(await run('reg.exe', ['query', a.key, '/v', a.value]));
  return false;
}

export function bridgeHealth(timeout = 700) {
  return new Promise(resolve => {
    const req = http.get({ host: '127.0.0.1', port: table.bridge.port, path: table.bridge.health, timeout }, res => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => { try { resolve(res.statusCode === 200 ? JSON.parse(body) : null); } catch (_) { resolve(null); } });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

const item = (id, label, ok, detail, extra = {}) => ({ id, label, ok, detail, ...extra });

/** Every connector on this OS, looked at and not touched. `health` may be
 *  passed in when the caller just fetched it. */
export async function detect({ health } = {}) {
  if (!p) return { platform: process.platform, label: process.platform, supported: false, ready: false,
    connectors: [item('os', 'Operating system', false, 'PR FX runs on macOS and Windows only.')] };
  const h = health !== undefined ? health : await bridgeHealth();
  const listener = listenerPath();
  const premiere = premiereInstalls();
  const [debug, autostart] = await Promise.all([cepDebugVersions(), autostartOn()]);
  const ext = extensionDir();
  const cepInstalled = !!ext || fs.existsSync(path.join(paths.cepExtensions, 'PR FX'));
  let uxp = '';
  try { uxp = fs.readdirSync(paths.uxpExternal).find(n => n.startsWith('com.prfx.edie_')) || ''; } catch (_) {}
  const minYear = table.premiere.minYear;

  const connectors = [
    item('premiere', 'Premiere Pro', premiere.length > 0,
      premiere.length ? premiere.map(i => i.year).join(', ') : `No Premiere Pro ${minYear} or later found.`,
      { installs: premiere }),
    item('panel', 'CEP panel', cepInstalled, cepInstalled ? (ext || path.join(paths.cepExtensions, 'PR FX')) : 'Not in ' + paths.cepExtensions),
    item('cepDebug', 'CEP debug mode', debug.includes(12),
      debug.length ? 'On for CSXS ' + debug.join(', ') : 'Off. Creative Assist turns it on when it installs PR FX.',
      { versions: debug, method: p.cepDebug.kind }),
    item('uxp', 'Edie UXP demo', !!uxp, uxp || 'Not installed (optional, Premiere 26.3 and later).', { optional: true }),
    item('listener', p.listener.kind === 'app' ? 'Shortcut listener app' : 'Shortcut listener exe', !!listener,
      listener || 'Not built or installed. Use Install in the Premiere panel once.', { path: listener }),
    item('bridge', 'Listener bridge', !!h, h ? `Answering on port ${table.bridge.port}` : 'Not answering. Start the listener.'),
    item('autostart', p.autostart.kind === 'launchagent' ? 'Starts at login (LaunchAgent)' : 'Starts with Windows (Run key)',
      autostart, autostart ? 'On' : 'Off'),
    item('overlay', 'Timeline highlight', true,
      p.overlay === 'listener' ? 'Drawn by the listener, with Edie on it.' : 'Drawn by Creative Assist over Premiere.', { provider: p.overlay }),
  ];
  if (p.accessibility) connectors.push(item('accessibility', 'Accessibility', !!(h && h.accessibilityTrusted),
    !h ? 'Unknown until the listener answers.' : h.accessibilityTrusted ? 'Granted' : 'Not granted. Open System Settings ▸ Privacy ▸ Accessibility.'));
  const needed = connectors.filter(c => !c.optional && c.id !== 'overlay');
  return { platform: p.name, label: p.label, supported: true, ready: needed.every(c => c.ok),
    overlay: p.overlay, paths, connectors };
}

const stampOf = dir => { try { return fs.readFileSync(path.join(dir, 'listener-build.txt'), 'utf8').replace(/^\uFEFF/, '').trim(); } catch { return ''; } };

/** Puts the shipped listener in its installed place when the copy there is
 *  missing or from another build (listener.install; Windows today), as the
 *  panel's Install and the hidden engine do. A running copy holds the file:
 *  then what's there is started. */
export function installListener() {
  const i = p && p.listener.install;
  if (!i) return false;
  const from = ex(i.from), to = ex(i.to);
  const shipped = path.join(from, i.file), installed = path.join(to, i.file);
  const build = i.stamp ? stampOf(from) : '';
  if (!fs.existsSync(shipped) || (fs.existsSync(installed) && (!build || build === stampOf(to)))) return false;
  try {
    fs.mkdirSync(to, { recursive: true });
    fs.copyFileSync(shipped, installed);
    if (build) fs.writeFileSync(path.join(to, i.stamp), build);
    return true;
  } catch { return false; }
}

/** Starts this OS's listener unless the bridge already answers. */
export async function connectListener() {
  if (!p) return { ok: false, message: 'PR FX runs on macOS and Windows only.' };
  if (await bridgeHealth()) return { ok: true, already: true };
  if (p.listener.start) {
    const [cmd, ...args] = p.listener.start.map(t => ex(t));
    if (args.some(a => a && !fs.existsSync(a) && path.isAbsolute(a))) return { ok: false, message: 'Could not find the PR FX extension folder.' };
    const out = await run(cmd, args, 20000);
    return out == null ? { ok: false, message: 'The listener did not start. Open the listener log for details.' } : { ok: true };
  }
  installListener();
  const exe = listenerPath();
  if (!exe) return { ok: false, message: 'The listener is not installed. Use Install in the Premiere panel once.' };
  spawn(exe, [], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  await new Promise(r => setTimeout(r, 1200));
  return { ok: true };
}

/** Stops this OS's listener (for a restart). */
export async function stopListener() {
  if (!p) return;
  if (p.listener.stop) { const [cmd, ...args] = p.listener.stop.map(t => ex(t)); if (args.every(a => fs.existsSync(a))) await run(cmd, args, 10000); }
  else if (p.listener.process) await run('taskkill', ['/IM', p.listener.process, '/F']);
}
