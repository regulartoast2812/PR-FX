// PR FX as a Creative Assist tool: the backend its page (app/ui) talks to
// through the host.
//
// Contract (see tool.json): createService(ctx) → { handle, summary, stop }.
//   ctx.emit(event, data)   push to the tool's page (SSE /api/tools/prfx/events)
//   ctx.overlay(state|null) draw / hide the click-through box over Premiere
//   ctx.watching()          how many pages are open (poll faster while > 0)
//   ctx.displays()          the screens, for the detection mini-map
//   ctx.dataDir             a folder of the tool's own in the host's data
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import {
  supportDir, logsDir, files, readJSON, readSettings, readCatalog, writeSettings, lastOwnWrite, control, health as getHealth,
  readJournal, startListener, restartListener, reveal, openAccessibility, extensionDir, statusLine,
  ensureUxpInstalled,
} from './core.mjs';
import { detect, platform, connectListener } from './connectors.mjs';

const CONNECTOR_GAP = { premiere: 'not found', panel: 'not installed', cepDebug: 'off', listener: 'not installed', autostart: 'off', accessibility: 'not granted' };

export function createService(ctx) {
  const uxp = ensureUxpInstalled();
  const stateFile = path.join(ctx.dataDir, 'state.json');
  const saved = readJSON(stateFile, {}) || {};
  // Who draws the Timeline box comes from connectors.json. "listener": the
  // macOS listener draws it itself (PRFXTimelineHighlight.swift), native, at
  // screen-saver level, from the very state each keystroke is judged by; the
  // switch is the `timelineHighlight` setting. "host": Creative Assist's
  // overlay window draws it from health (Windows).
  const nativeOverlay = (platform() || {}).overlay === 'listener';
  let overlayOn = nativeOverlay ? readSettings().timelineHighlight === 'on' : saved.overlay === true;
  // What this OS connects to and whether each piece is there; refreshed in
  // the background so summary() stays synchronous.
  let connectors = null, detecting = null, detectedAt = 0;
  const redetect = () => detecting || (detecting = detect({ health }).then(report => {
    connectors = report; detectedAt = Date.now(); ctx.emit('connectors', report); return report;
  }).catch(() => connectors).finally(() => { detecting = null; }));
  let health = null, healthError = '', timer = null, stopped = false;
  const watchers = [];

  function save(patch) {
    try {
      fs.mkdirSync(ctx.dataDir, { recursive: true });
      fs.writeFileSync(stateFile + '.tmp', JSON.stringify({ ...(readJSON(stateFile, {}) || {}), ...patch }));
      fs.renameSync(stateFile + '.tmp', stateFile);
    } catch (_) {}
  }

  // One poller. Fast while the box is drawn over Premiere, so it follows the
  // panels; slower while a page shows the status; idle otherwise.
  async function poll() {
    if (stopped) return;
    try { health = await getHealth(); healthError = ''; }
    catch (error) { health = null; healthError = error.message; }
    ctx.emit('health', { health, error: healthError, at: Date.now() });
    if (!connectors || Date.now() - detectedAt > 30_000 || !!health !== connectors.connectors.some(c => c.id === 'bridge' && c.ok)) redetect();
    pushOverlay();
    clearTimeout(timer);
    timer = setTimeout(poll, overlayOn ? 200 : ctx.watching() > 0 ? 400 : 2000);
  }

  function pushOverlay() {
    const g = health && health.geometry;
    // Only over Premiere: a box drawn over another app would be a lie.
    if (nativeOverlay || !overlayOn || !g || !g.premiereFrontmost) return ctx.overlay(null);
    // Rectangles stay in the listener's coordinates ([x, y, w, h]; points on
    // macOS, physical pixels on Windows); the host's window converts them.
    ctx.overlay({ live: g.live || null, saved: g.saved || null, window: g.window || null, click: g.click || null,
      panelsHidden: !!g.panelsHidden, scopeKind: health.scopeKind, keyScope: health.keyScope });
  }

  function setOverlay(on) {
    overlayOn = !!on;
    if (nativeOverlay) writeSettings({ timelineHighlight: overlayOn ? 'on' : 'off' });
    else save({ overlay: overlayOn });
    ctx.emit('overlay-state', overlayOn);
    pushOverlay();
    clearTimeout(timer);
    timer = setTimeout(poll, 50);
    return overlayOn;
  }

  // The CEP panel and this page both edit settings.json; whoever did not
  // write it reloads. Journal lines nudge the feed and its result toasts.
  function watch() {
    let debounce = null, journalDebounce = null;
    try {
      fs.mkdirSync(supportDir, { recursive: true });
      watchers.push(fs.watch(supportDir, (_e, name) => {
        if (name !== 'settings.json' && name !== 'catalog.json') return;
        clearTimeout(debounce);
        debounce = setTimeout(() => {
          if (name === 'settings.json' && Date.now() - lastOwnWrite < 600) return;
          ctx.emit('files-changed', { settings: readSettings(), catalog: readCatalog() });
        }, 150);
      }));
    } catch (_) {}
    try {
      fs.mkdirSync(logsDir, { recursive: true });
      watchers.push(fs.watch(logsDir, (_e, name) => {
        if (name !== path.basename(files.journal)) return;
        clearTimeout(journalDebounce);
        journalDebounce = setTimeout(() => ctx.emit('journal-changed', null), 80);
      }));
    } catch (_) {}
  }

  const result = p => p.then(() => ({ ok: true }), error => ({ ok: false, message: error.message }));

  const executable = candidates => {
    const pathDirs = (process.env.PATH || '').split(path.delimiter);
    for (const item of candidates.filter(Boolean)) {
      const paths = path.isAbsolute(item) ? [item] : pathDirs.map(dir => path.join(dir, item));
      for (const file of paths) try { fs.accessSync(file, fs.constants.X_OK); return file; } catch (_) {}
    }
    return '';
  };
  // WhisperX on Windows (2026-11-21): it needs Python 3.13 or older (3.14 was the only one on the user's PC, and
  // pip found no version for it), so it gets its own environment in the support folder, made with a Python it
  // supports: one already installed, else 3.12 from Python's install manager (py install), else from winget.
  const whisperVenv = path.join(supportDir, 'whisperx-env');
  const whisperVenvExe = process.platform === 'win32' ? path.join(whisperVenv, 'Scripts', 'whisperx.exe') : '';
  const WHISPER_PYTHONS = ['3.12', '3.11', '3.13', '3.10'];
  async function whisperPython() {
    for (const v of WHISPER_PYTHONS) {
      const found = await run('py.exe', [`-V:${v}`, '-c', 'import sys; print(sys.executable)'], 30_000);
      if (found.ok && found.detail && fs.existsSync(found.detail.trim())) return found.detail.trim();
    }
    return '';
  }
  async function installWhisperWindows() {
    let python = await whisperPython();
    if (!python) {
      const manager = await run('py.exe', ['install', '3.12'], 15 * 60_000);
      if (!manager.ok) await run('winget.exe', ['install', '--id', 'Python.Python.3.12', '-e', '--accept-package-agreements', '--accept-source-agreements'], 15 * 60_000);
      python = await whisperPython();
    }
    if (!python) return { ok: false, detail: 'WhisperX needs Python 3.10 to 3.13, and one could not be installed. Install Python 3.12 (python.org), then press Install again.' };
    const venvPython = path.join(whisperVenv, 'Scripts', 'python.exe');
    if (!fs.existsSync(venvPython)) {
      const made = await run(python, ['-m', 'venv', whisperVenv], 5 * 60_000);
      if (!made.ok) return made;
    }
    await run(venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip'], 5 * 60_000);
    const installed = await run(venvPython, ['-m', 'pip', 'install', '--upgrade', 'whisperx'], 40 * 60_000);
    if (!installed.ok) return installed;
    if (!fs.existsSync(whisperVenvExe)) return { ok: false, detail: 'WhisperX installed, but whisperx.exe is missing from ' + path.dirname(whisperVenvExe) };
    writeSettings({ whisperCommand: `"${whisperVenvExe}"` });
    return { ok: true, detail: 'WhisperX installed (Python ' + path.basename(path.dirname(python)) + ').' };
  }

  const media = () => {
    const s = readSettings(), home = os.homedir();
    // On Windows also winget's links folder: an ffmpeg installed with winget isn't on a running app's PATH yet.
    const wingetLinks = process.platform === 'win32' && process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe') : '';
    const ffmpeg = executable([s.ffmpegPath, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg', wingetLinks, '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg']);
    const pythonBins = ['3.13', '3.12', '3.11', '3.10', '3.9'].flatMap(version => [
      path.join(home, 'Library', 'Python', version, 'bin', 'whisperx'),
      path.join(home, 'Library', 'Python', version, 'bin', 'whisper'),
    ]);
    const whisper = s.whisperCommand || executable([whisperVenvExe, 'whisperx', 'whisper', path.join(home, '.local', 'bin', 'whisperx'),
      path.join(home, '.local', 'bin', 'whisper'), ...pythonBins, '/opt/homebrew/bin/whisperx', '/opt/homebrew/bin/whisper',
      '/usr/local/bin/whisperx', '/usr/local/bin/whisper']);
    const python = executable([process.platform === 'win32' ? 'python.exe' : 'python3', 'python']);
    return { ffmpeg: { ready: !!ffmpeg, path: ffmpeg }, whisper: { ready: !!whisper, command: whisper }, python,
      configured: { ffmpegPath: s.ffmpegPath, whisperCommand: s.whisperCommand, whisperModel: s.whisperModel, whisperDevice: s.whisperDevice } };
  };
  // A failure says why: the last error line the command printed (pip's "No matching distribution…"), not only
  // its exit code (2026-11-21: "Stopped with exit code 2316632107" told the user nothing).
  const run = (cmd, args, timeout = 60_000, verbatim = false) => new Promise(resolve => execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 1 << 24, windowsVerbatimArguments: verbatim },
    (error, stdout, stderr) => {
      if (!error) return resolve({ ok: true, detail: String(stdout || '').split(/\r?\n/).find(Boolean) || 'Ready.' });
      const lines = String(stderr || stdout || '').split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('[notice]'));
      const why = [...lines].reverse().find(l => /error/i.test(l)) || lines[lines.length - 1] || '';
      const code = typeof error.code === 'number' && error.code > 0xffff ? '0x' + (error.code >>> 0).toString(16).toUpperCase() : (error.code ?? '?');
      resolve({ ok: false, detail: `Stopped with exit code ${code}${why ? ': ' + why.slice(0, 300) : '. Check the command in a terminal.'}` });
    }));
  // cmd /s /c drops the first and last quote of what follows, so the whole line is wrapped in one more pair and
  // passed as is: a quoted command path with spaces ("…\PR FX Palette\whisperx-env\Scripts\whisperx.exe") stays whole.
  const shellTest = command => process.platform === 'win32'
    ? run('cmd.exe', ['/d', '/s', '/c', `"${command} --help"`], 120_000, true)
    : run('/bin/zsh', ['-lc', `${command} --help`]);

  const routes = {
    state: () => ({
      platform: process.platform, supportDir, logsDir,
      settings: readSettings(), catalog: readCatalog(), overlay: overlayOn,
      extensionDir: extensionDir(), displays: ctx.displays ? ctx.displays() : [], media: media(), uxp, connectors,
    }),
    connectors: () => redetect(),
    'connectors:connect': async () => { const out = await connectListener(); clearTimeout(timer); timer = setTimeout(poll, 50); return { ...out, connectors: await redetect() }; },
    'settings:write': patch => writeSettings(patch && typeof patch === 'object' ? patch : {}),
    'media:detect': () => {
      const found = media(), patch = {};
      if (found.ffmpeg.path) patch.ffmpegPath = found.ffmpeg.path;
      if (found.whisper.command) patch.whisperCommand = found.whisper.command;
      if (Object.keys(patch).length) writeSettings(patch);
      return { ...media(), changed: Object.keys(patch) };
    },
    'media:test': async () => {
      const found = media();
      const ffmpeg = found.ffmpeg.path ? await run(found.ffmpeg.path, ['-version'], 15_000) : { ok: false, detail: 'ffmpeg was not found.' };
      const whisper = found.whisper.command ? await shellTest(found.whisper.command) : { ok: false, detail: 'WhisperX was not found.' };
      return { ffmpeg, whisper, media: media() };
    },
    'media:install': async body => {
      const kind = body && body.kind;
      if (kind === 'ffmpeg') {
        if (process.platform === 'darwin') {
          const brew = executable(['brew', '/opt/homebrew/bin/brew', '/usr/local/bin/brew']);
          if (!brew) return { ok: false, message: 'Homebrew is not installed. Install ffmpeg in Terminal, then press Detect.' };
          const installed = await run(brew, ['install', 'ffmpeg'], 15 * 60_000);
          if (installed.ok) { const found = media(); if (found.ffmpeg.path) writeSettings({ ffmpegPath: found.ffmpeg.path }); }
          return { ...installed, media: media() };
        }
        const installed = await run('winget.exe', ['install', '--id', 'Gyan.FFmpeg', '--accept-package-agreements', '--accept-source-agreements'], 15 * 60_000);
        return { ...installed, media: media() };
      }
      if (kind === 'whisper' && process.platform === 'win32') return { ...(await installWhisperWindows()), media: media() };
      if (kind === 'whisper') {
        const python = media().python;
        if (!python) return { ok: false, message: 'Python 3 was not found. Install Python, then press Detect.' };
        const installed = await run(python, ['-m', 'pip', 'install', '--user', '--upgrade', 'whisperx'], 20 * 60_000);
        if (installed.ok) writeSettings({ whisperCommand: `${JSON.stringify(python)} -m whisperx` });
        return { ...installed, media: media() };
      }
      return { ok: false, message: 'Choose ffmpeg or WhisperX.' };
    },
    journal: body => readJournal(Math.max(1, Math.min(500, Number(body && body.limit) || 80))),
    run: command => result(control('/run', command)),
    palette: () => result(control('/open-palette', '')),
    overlay: body => setOverlay(body && body.on),
    'listener:start': () => startListener(),
    'listener:restart': () => restartListener(),
    open: body => {
      const which = body && body.which;
      const targets = { failures: files.failures, journal: files.journal, listenerLog: files.listenerLog, support: supportDir, logs: logsDir };
      const target = targets[which];
      if (!target) return { ok: false };
      if (!fs.existsSync(target)) return { ok: false, message: 'Nothing there yet.' };
      reveal(target, which === 'support' || which === 'logs');
      return { ok: true };
    },
    accessibility: () => { openAccessibility(); return true; },
  };

  // Offline, the card says which connector is missing first (Premiere, the
  // listener itself…) rather than only "Listener offline".
  function offlineLabel(label) {
    if (health || !connectors) return label;
    const gap = connectors.connectors.find(c => !c.ok && !c.optional && c.id !== 'bridge');
    return gap ? `${label} · ${gap.label}: ${CONNECTOR_GAP[gap.id] || 'missing'}` : label;
  }

  watch();
  poll();

  return {
    async handle(route, body) {
      const fn = routes[route];
      if (!fn) throw new Error('No such PR FX route: ' + route);
      return fn(body);
    },
    /** What Edie's tool card shows without opening the page. */
    summary() {
      const s = statusLine(health);
      const today = new Date().toISOString().slice(0, 10);
      const lines = readJournal(400).filter(l => l.time && l.time.startsWith(today));
      const count = e => lines.filter(l => l.event === e).length;
      const recent = readJournal(80).filter(l => /^(ok|failed|expired)$/.test(l.event)).slice(-5).reverse()
        .map(l => ({ time: l.time, outcome: l.event, command: l.command, detail: l.detail.replace(/^\d+ms\s*/, '') }));
      const g = health && health.geometry;
      return {
        ok: !!health, kind: s.kind, label: offlineLabel(s.label), error: healthError,
        installed: !!extensionDir(), overlay: overlayOn, commands: readCatalog().length, uxp,
        connectors: connectors && { platform: connectors.platform, label: connectors.label, ready: connectors.ready,
          missing: connectors.connectors.filter(c => !c.ok && !c.optional).map(c => c.label) },
        today: { ok: count('ok'), failed: count('failed') + count('expired'), fired: count('fired') },
        geometry: g ? { live: g.live || null, saved: g.saved || null, window: g.window || null, click: g.click || null, premiereFrontmost: !!g.premiereFrontmost, panelsHidden: !!g.panelsHidden } : null,
        recent,
      };
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      for (const w of watchers) try { w.close(); } catch (_) {}
      ctx.overlay(null);
    },
  };
}
