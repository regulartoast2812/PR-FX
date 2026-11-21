// WhisperX and ffmpeg setup with real progress, the same on macOS and Windows (2026-11-21).
//
// The user: "ffm, whisper doesn't work in the first place. no progress bar. nothing to indicate." The old install ran
// one pip command with a single "Installing…" label for minutes and, on Windows, failed outright: WhisperX needs
// Python 3.10-3.13 and the PC had only 3.14. Now:
//   - WhisperX always goes in its own environment in the support folder (whisperx-env), made with a Python it supports
//     (found, else installed: Python's install manager or winget on Windows, Homebrew on the Mac), so the user's own
//     Python is never touched and a newer one can't break it.
//   - Every install is a job of named steps. The page polls `state()`: which step, how far overall, and while pip or
//     winget downloads, which file and how many MB of how many. pip's own numbers ("--progress-bar raw"), and the
//     package count from a dry run first, so the bar is never guessed.
//   - Stop ends the job (its process tree).
//
// Pure pieces (parseLine, stepFraction) are checked in tools/check.js.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';

export const WHISPER_PYTHONS = ['3.12', '3.11', '3.13', '3.10'];

/** What one output line says about progress. Lines may hold several \r-separated updates; pass each part. */
/** Git for Windows' bash.exe, where the panel's shell layer (client/prai/js/platform-shell.js) looks for it, or ''. */
export function findBash(env = process.env) {
  if (process.platform !== 'win32') return '/bin/zsh'; // mac-only: the Mac's shell, never reached on Windows
  const places = [env.ProgramFiles && path.join(env.ProgramFiles, 'Git', 'bin', 'bash.exe'),
    env['ProgramFiles(x86)'] && path.join(env['ProgramFiles(x86)'], 'Git', 'bin', 'bash.exe'),
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe'),
    ...String(env.PATH || env.Path || '').split(';').filter(d => /[\\/]Git[\\/]cmd[\\/]?$/i.test(d)).map(d => path.join(d, '..', 'bin', 'bash.exe'))];
  return places.find(p => p && fs.existsSync(p)) || '';
}

export function parseLine(line) {
  const text = String(line || '').trim();
  if (!text) return null;
  // pip --progress-bar raw
  let m = /^Progress (\d+) of (\d+)$/.exec(text);
  if (m) return { kind: 'bytes', done: +m[1], total: +m[2] };
  // pip: a package being fetched (from the index or its cache)
  m = /^Collecting ([A-Za-z0-9_.\-\[\]]+)/.exec(text);
  if (m) return { kind: 'package', name: m[1].replace(/\[.*$/, '') };
  m = /^Downloading (\S+?)(?:-\d[^\s]*)? \(([\d.]+) ([kMG]?B)\)/.exec(text);
  if (m) return { kind: 'file', name: m[1].replace(/^.*\//, ''), total: size(m[2], m[3]) };
  if (/^Installing collected packages/.test(text)) return { kind: 'installing' };
  if (/^Successfully installed/.test(text)) return { kind: 'installed' };
  // winget: "██████▒▒▒  10.0 MB / 85.3 MB"
  m = /([\d.]+)\s*([KMG]B)\s*\/\s*([\d.]+)\s*([KMG]B)/.exec(text);
  if (m) return { kind: 'bytes', done: size(m[1], m[2]), total: size(m[3], m[4]) };
  // Homebrew: "==> Fetching dependencies for ffmpeg: a, b and c", "==> Pouring x--1.2.bottle.tar.gz"
  m = /^==> Fetching dependencies for \S+: (.+)$/.exec(text);
  if (m) return { kind: 'brew-total', count: m[1].split(/,\s*|\s+and\s+/).filter(Boolean).length + 1 };
  m = /^==> Pouring (\S+?)--/.exec(text);
  if (m) return { kind: 'brew-poured', name: m[1] };
  if (/error/i.test(text)) return { kind: 'error', text };
  return null;
}

function size(n, unit) {
  const k = { B: 1, kB: 1e3, KB: 1e3, MB: 1e6, GB: 1e9 }[unit] ?? 1;
  return Math.round(parseFloat(n) * k);
}

/** Overall 0..1 from the steps' weights: the steps before the current one in full, and the current one's share. */
export function stepFraction(steps, index, within) {
  const total = steps.reduce((a, s) => a + s.weight, 0) || 1;
  let done = 0;
  for (let i = 0; i < index && i < steps.length; i++) done += steps[i].weight;
  const here = steps[index] ? steps[index].weight * Math.max(0, Math.min(1, within || 0)) : 0;
  return Math.max(0, Math.min(1, (done + here) / total));
}

export function createMediaSetup({ supportDir, writeSettings, readSettings, pkg = 'whisperx' }) {
  // `pkg` is only ever changed by the check, to run every step with a small package instead of WhisperX.
  const isWin = process.platform === 'win32';
  const envDir = path.join(supportDir, 'whisperx-env');
  const envPython = isWin ? path.join(envDir, 'Scripts', 'python.exe') : path.join(envDir, 'bin', 'python');
  const envWhisper = isWin ? path.join(envDir, 'Scripts', pkg + '.exe') : path.join(envDir, 'bin', pkg);
  let job = null;     // the one running or last finished install
  let child = null;   // its current process

  const quoted = p => `"${p}"`;

  // One command, its output read line by line (pip and winget redraw with \r) into `onLine`.
  function runStep(cmd, args, onLine, timeout = 30 * 60_000) {
    return new Promise(resolve => {
      let tail = [], settled = false;
      const p = spawn(cmd, args, { windowsHide: true, env: { ...process.env, PYTHONUNBUFFERED: '1', PIP_DISABLE_PIP_VERSION_CHECK: '1' } });
      child = p;
      const timer = setTimeout(() => { try { p.kill(); } catch (_) {} }, timeout);
      const feed = chunk => {
        for (const part of String(chunk).split(/[\r\n]+/)) {
          const line = part.trim();
          if (!line) continue;
          tail.push(line); if (tail.length > 40) tail.shift();
          try { onLine && onLine(line); } catch (_) {}
        }
      };
      p.stdout.on('data', feed); p.stderr.on('data', feed);
      const done = (code, error) => {
        if (settled) return; settled = true; clearTimeout(timer); if (child === p) child = null;
        const why = [...tail].reverse().find(l => /error/i.test(l)) || tail[tail.length - 1] || '';
        resolve({ ok: code === 0 && !error, code, why: error ? error.message : why, tail });
      };
      p.on('error', e => done(-1, e));
      p.on('close', code => done(code));
    });
  }
  const quick = (cmd, args, timeout = 30_000) => new Promise(resolve => execFile(cmd, args, { windowsHide: true, timeout },
    (error, stdout) => resolve(error ? '' : String(stdout || '').trim())));

  // A Python WhisperX supports, or ''.
  async function findPython() {
    for (const v of WHISPER_PYTHONS) {
      const exe = isWin
        ? await quick('py.exe', [`-V:${v}`, '-c', 'import sys; print(sys.executable)'])
        : await macPython(v);
      if (exe && fs.existsSync(exe)) return { exe, version: v };
    }
    return null;
  }
  async function macPython(v) {
    const names = [`python${v}`, `/opt/homebrew/bin/python${v}`, `/usr/local/bin/python${v}`,
      `/Library/Frameworks/Python.framework/Versions/${v}/bin/python${v}`, `/opt/homebrew/opt/python@${v}/bin/python${v}`];
    for (const n of names) {
      const exe = await quick(n, ['-c', 'import sys; print(sys.executable)']);
      if (exe) return exe;
    }
    return '';
  }

  function begin(kind, steps) {
    job = { kind, steps: steps.map(s => ({ ...s, state: 'waiting' })), step: 0, within: 0, fraction: 0, now: '', file: null,
      startedAt: Date.now(), finishedAt: null, ok: null, detail: '', stopped: false };
    return job;
  }
  function enter(j, id, now = '') {
    const i = j.steps.findIndex(s => s.id === id);
    for (let k = 0; k < j.steps.length; k++) if (k < i && j.steps[k].state !== 'skipped') j.steps[k].state = 'done';
    j.step = i; j.within = 0; j.file = null; j.now = now || j.steps[i].label;
    j.steps[i].state = 'running';
    j.fraction = stepFraction(j.steps, i, 0);
  }
  function skip(j, id) { const s = j.steps.find(x => x.id === id); if (s) s.state = 'skipped'; }
  function advance(j, within) { j.within = Math.max(j.within, Math.min(0.99, within)); j.fraction = stepFraction(j.steps, j.step, j.within); }
  function finish(j, ok, detail) {
    if (ok) { for (const s of j.steps) if (s.state !== 'skipped') s.state = 'done'; }
    else if (j.steps[j.step]) j.steps[j.step].state = j.stopped ? 'stopped' : 'failed';
    j.ok = ok; j.detail = detail; j.finishedAt = Date.now(); j.now = ''; j.file = null;
    if (ok) j.fraction = 1;
  }

  // pip's output into the job: packages counted against the dry run's total, the current file's bytes for the bar.
  function pipReader(j, totalPackages) {
    let seen = 0;
    return line => {
      const p = parseLine(line);
      if (!p) return;
      if (p.kind === 'package') { seen++; j.now = `${p.name}`; }
      if (p.kind === 'file') j.file = { name: p.name, done: 0, total: p.total };
      if (p.kind === 'bytes' && j.file) { j.file.done = p.done; j.file.total = p.total || j.file.total; }
      if (p.kind === 'installing') { j.now = 'Putting the packages in place'; j.file = null; }
      const fileShare = j.file && j.file.total ? j.file.done / j.file.total : 0;
      const n = Math.max(totalPackages, seen, 1);
      // Fetching is 85% of this step, putting in place the rest.
      advance(j, p.kind === 'installing' || p.kind === 'installed' ? 0.9 : ((Math.max(0, seen - 1) + fileShare) / n) * 0.85);
    };
  }

  async function installWhisper() {
    const j = begin('whisper', [
      { id: 'python', label: 'Find a Python WhisperX supports', weight: 2 },
      { id: 'get-python', label: 'Install Python 3.12', weight: 14 },
      { id: 'env', label: "Make WhisperX's own environment", weight: 4 },
      { id: 'plan', label: 'Work out what to download', weight: 6 },
      { id: 'packages', label: 'Download and install WhisperX', weight: 70 },
      { id: 'check', label: 'Check WhisperX runs', weight: 4 },
    ]);
    enter(j, 'python');
    let py = fs.existsSync(envPython) ? { exe: envPython, version: 'env' } : await findPython();
    if (j.stopped) return finish(j, false, 'Stopped.');
    if (py) skip(j, 'get-python');
    else {
      enter(j, 'get-python');
      let r;
      if (isWin) {
        r = await runStep('py.exe', ['install', '3.12'], line => { const p = parseLine(line); if (p && p.kind === 'bytes' && p.total) advance(j, p.done / p.total); });
        if (!r.ok && !j.stopped) r = await runStep('winget.exe', ['install', '--id', 'Python.Python.3.12', '-e', '--accept-package-agreements', '--accept-source-agreements'],
          line => { const p = parseLine(line); if (p && p.kind === 'bytes' && p.total) advance(j, p.done / p.total); });
      } else {
        const brew = ['/opt/homebrew/bin/brew', '/usr/local/bin/brew'].find(f => fs.existsSync(f));
        if (!brew) return finish(j, false, 'WhisperX needs Python 3.10 to 3.13. Install Python 3.12 from python.org, then press Install again.');
        r = await runStep(brew, ['install', 'python@3.12'], () => advance(j, j.within + 0.02));
      }
      if (j.stopped) return finish(j, false, 'Stopped.');
      py = await findPython();
      if (!py) return finish(j, false, 'WhisperX needs Python 3.10 to 3.13, and Python 3.12 could not be installed' + (r && r.why ? `: ${r.why}` : '.') + ' Install it from python.org, then press Install again.');
    }
    if (!fs.existsSync(envPython)) {
      enter(j, 'env', `Python ${py.version}`);
      const r = await runStep(py.exe, ['-m', 'venv', envDir], null, 5 * 60_000);
      if (!r.ok) return finish(j, false, j.stopped ? 'Stopped.' : `Couldn't make the environment: ${r.why}`);
      await runStep(envPython, ['-m', 'pip', 'install', '--upgrade', 'pip'], null, 5 * 60_000);
    } else skip(j, 'env');
    if (j.stopped) return finish(j, false, 'Stopped.');

    // How many packages this install brings in: pip's own plan, so the bar counts real packages.
    enter(j, 'plan');
    const report = path.join(supportDir, 'whisperx-plan.json');
    let total = 0;
    const plan = await runStep(envPython, ['-m', 'pip', 'install', '--upgrade', '--dry-run', '--quiet', '--report', report, pkg],
      line => { const p = parseLine(line); if (p && p.kind === 'package') { j.now = p.name; advance(j, j.within + 0.03); } }, 10 * 60_000);
    try { total = (JSON.parse(fs.readFileSync(report, 'utf8')).install || []).length; fs.rmSync(report, { force: true }); } catch (_) {}
    if (j.stopped) return finish(j, false, 'Stopped.');
    if (!plan.ok) return finish(j, false, `pip couldn't plan the install: ${plan.why}`);

    enter(j, 'packages', total ? `0 of ${total} packages` : '');
    j.packages = total;
    const read = pipReader(j, total);
    const r = await runStep(envPython, ['-m', 'pip', 'install', '--upgrade', '--progress-bar', 'raw', pkg], read, 60 * 60_000);
    if (!r.ok) return finish(j, false, j.stopped ? 'Stopped.' : `pip stopped: ${r.why}`);

    enter(j, 'check');
    const check = await runStep(envWhisper, ['--help'], null, 120_000);
    if (!check.ok || !fs.existsSync(envWhisper)) return finish(j, false, `WhisperX installed but doesn't run: ${check.why}`);
    writeSettings({ whisperCommand: quoted(envWhisper) });
    finish(j, true, `WhisperX is ready (its own Python ${py.version === 'env' ? '' : py.version + ' '}environment).`.replace('  ', ' '));
  }

  async function installFfmpeg(find) {
    const j = begin('ffmpeg', [
      { id: 'download', label: isWin ? 'Download ffmpeg (winget)' : 'Download ffmpeg (Homebrew)', weight: 80 },
      { id: 'check', label: 'Check ffmpeg runs', weight: 20 },
    ]);
    enter(j, 'download');
    let r;
    if (isWin) {
      r = await runStep('winget.exe', ['install', '--id', 'Gyan.FFmpeg', '-e', '--accept-package-agreements', '--accept-source-agreements'], line => {
        const p = parseLine(line);
        if (p && p.kind === 'bytes' && p.total) { j.file = { name: 'ffmpeg', done: p.done, total: p.total }; advance(j, p.done / p.total); }
        else if (/Installing/i.test(line)) { j.now = 'Installing'; j.file = null; advance(j, 0.95); }
      }, 20 * 60_000);
    } else {
      const brew = ['/opt/homebrew/bin/brew', '/usr/local/bin/brew'].find(f => fs.existsSync(f));
      if (!brew) return finish(j, false, 'Homebrew is not installed. Install it from brew.sh, then press Install again.');
      let count = 1, poured = 0;
      r = await runStep(brew, ['install', 'ffmpeg'], line => {
        const p = parseLine(line);
        if (p && p.kind === 'brew-total') count = p.count;
        if (p && p.kind === 'brew-poured') { poured++; j.now = p.name; advance(j, poured / count); }
      }, 30 * 60_000);
    }
    if (j.stopped) return finish(j, false, 'Stopped.');
    // winget answers "already installed" with a non-zero code: what counts is whether ffmpeg is there now.
    enter(j, 'check');
    const found = find();
    if (!found) return finish(j, false, r.ok ? 'ffmpeg installed but wasn\'t found. Press Detect, or set its path.' : `The install stopped: ${r.why}`);
    const v = await quick(found, ['-version'], 20_000);
    if (!v) return finish(j, false, `ffmpeg was found at ${found} but doesn't run.`);
    writeSettings({ ffmpegPath: found });
    finish(j, true, 'ffmpeg is ready.');
  }

  // Windows only: AI functions run their shell steps in Git Bash (the panel's shell layer).
  async function installGit() {
    const j = begin('git', [
      { id: 'download', label: 'Download Git for Windows (winget)', weight: 85 },
      { id: 'check', label: 'Check Git Bash runs', weight: 15 },
    ]);
    enter(j, 'download');
    const r = await runStep('winget.exe', ['install', '--id', 'Git.Git', '-e', '--accept-package-agreements', '--accept-source-agreements'], line => {
      const p = parseLine(line);
      if (p && p.kind === 'bytes' && p.total) { j.file = { name: 'Git for Windows', done: p.done, total: p.total }; advance(j, p.done / p.total); }
      else if (/Installing/i.test(line)) { j.now = 'Installing'; j.file = null; advance(j, 0.95); }
    }, 20 * 60_000);
    if (j.stopped) return finish(j, false, 'Stopped.');
    enter(j, 'check');
    const bash = findBash();
    if (!bash) return finish(j, false, r.ok ? "Git installed but its bash wasn't found." : `The install stopped: ${r.why}`);
    const ok = await quick(bash, ['-lc', 'echo ok'], 30_000);
    if (ok !== 'ok') return finish(j, false, `Git Bash was found at ${bash} but doesn't run.`);
    finish(j, true, 'Git Bash is ready: AI functions can run on Windows.');
  }

  return {
    envWhisper,
    /** Starts an install unless one runs; answers at once. */
    start(kind, { findFfmpeg } = {}) {
      if (job && job.ok === null) return { ok: false, detail: 'An install is already running.' , job };
      const run = kind === 'whisper' ? installWhisper() : kind === 'ffmpeg' ? installFfmpeg(findFfmpeg) : kind === 'git' && isWin ? installGit() : null;
      if (!run) return { ok: false, detail: 'Choose ffmpeg, WhisperX or Git Bash.' };
      run.catch(e => { if (job) finish(job, false, e.message); });
      return { ok: true, job };
    },
    stop() {
      if (!job || job.ok !== null) return { ok: false };
      job.stopped = true;
      const p = child;
      if (p) {
        if (isWin) execFile('taskkill.exe', ['/pid', String(p.pid), '/T', '/F'], { windowsHide: true }, () => {});
        else try { p.kill('SIGTERM'); } catch (_) {}
      }
      return { ok: true };
    },
    state() { return job; },
  };
}
