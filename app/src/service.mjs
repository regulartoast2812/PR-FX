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
  IS_MAC, supportDir, logsDir, files, readJSON, readSettings, readCatalog, writeSettings, lastOwnWrite, control, health as getHealth,
  readJournal, startListener, restartListener, reveal, openAccessibility, extensionDir, statusLine,
  ensureUxpInstalled,
} from './core.mjs';

export function createService(ctx) {
  const uxp = ensureUxpInstalled();
  const stateFile = path.join(ctx.dataDir, 'state.json');
  const saved = readJSON(stateFile, {}) || {};
  // On macOS the listener draws the box itself (PRFXTimelineHighlight.swift):
  // native, at screen-saver level, from the very state each keystroke is judged
  // by. The switch is the `timelineHighlight` setting. Elsewhere the host's
  // overlay window draws it from health.
  let overlayOn = IS_MAC ? readSettings().timelineHighlight === 'on' : saved.overlay === true;
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
    pushOverlay();
    clearTimeout(timer);
    timer = setTimeout(poll, overlayOn ? 200 : ctx.watching() > 0 ? 400 : 2000);
  }

  function pushOverlay() {
    const g = health && health.geometry;
    // Only over Premiere: a box drawn over another app would be a lie.
    if (IS_MAC || !overlayOn || !g || !g.premiereFrontmost) return ctx.overlay(null);
    // Rectangles stay in the listener's coordinates ([x, y, w, h]; points on
    // macOS, physical pixels on Windows); the host's window converts them.
    ctx.overlay({ live: g.live || null, saved: g.saved || null, window: g.window || null, click: g.click || null,
      panelsHidden: !!g.panelsHidden, scopeKind: health.scopeKind, keyScope: health.keyScope });
  }

  function setOverlay(on) {
    overlayOn = !!on;
    if (IS_MAC) writeSettings({ timelineHighlight: overlayOn ? 'on' : 'off' });
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
  const media = () => {
    const s = readSettings(), home = os.homedir();
    const ffmpeg = executable([s.ffmpegPath, 'ffmpeg', '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg']);
    const pythonBins = ['3.13', '3.12', '3.11', '3.10', '3.9'].flatMap(version => [
      path.join(home, 'Library', 'Python', version, 'bin', 'whisperx'),
      path.join(home, 'Library', 'Python', version, 'bin', 'whisper'),
    ]);
    const whisper = s.whisperCommand || executable(['whisperx', 'whisper', path.join(home, '.local', 'bin', 'whisperx'),
      path.join(home, '.local', 'bin', 'whisper'), ...pythonBins, '/opt/homebrew/bin/whisperx', '/opt/homebrew/bin/whisper',
      '/usr/local/bin/whisperx', '/usr/local/bin/whisper']);
    const python = executable([process.platform === 'win32' ? 'python.exe' : 'python3', 'python']);
    return { ffmpeg: { ready: !!ffmpeg, path: ffmpeg }, whisper: { ready: !!whisper, command: whisper }, python,
      configured: { ffmpegPath: s.ffmpegPath, whisperCommand: s.whisperCommand, whisperModel: s.whisperModel, whisperDevice: s.whisperDevice } };
  };
  const run = (cmd, args, timeout = 60_000) => new Promise(resolve => execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 1 << 20 },
    (error, stdout) => resolve({ ok: !error, detail: error ? `Stopped with exit code ${error.code ?? '?'}. Check the command in a terminal.` : String(stdout || '').split(/\r?\n/).find(Boolean) || 'Ready.' })));
  const shellTest = command => process.platform === 'win32'
    ? run('cmd.exe', ['/d', '/s', '/c', `${command} --help`])
    : run('/bin/zsh', ['-lc', `${command} --help`]);

  const routes = {
    state: () => ({
      platform: process.platform, supportDir, logsDir,
      settings: readSettings(), catalog: readCatalog(), overlay: overlayOn,
      extensionDir: extensionDir(), displays: ctx.displays ? ctx.displays() : [], media: media(), uxp,
    }),
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
        ok: !!health, kind: s.kind, label: s.label, error: healthError,
        installed: !!extensionDir(), overlay: overlayOn, commands: readCatalog().length, uxp,
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
