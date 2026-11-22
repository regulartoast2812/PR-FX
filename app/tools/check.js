// Checks for the PR FX app. Run: npm run check
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const repoRoot = path.join(root, '..');
const readRepo = f => fs.readFileSync(path.join(repoRoot, f), 'utf8');
let failures = 0;
const check = (ok, label) => { console.log((ok ? 'ok   ' : 'FAIL ') + label); if (!ok) failures++; };

for (const f of ['ui/app.js', 'ui/overlay.js', 'ui/web-bridge.js']) {
  try { execFileSync(process.execPath, ['--check', path.join(root, f)]); check(true, 'parses: ' + f); }
  catch (e) { check(false, 'parses: ' + f + '\n' + e.stderr); }
}
for (const f of ['src/core.mjs', 'src/service.mjs', 'src/mcp.mjs', 'src/connectors.mjs', 'src/media-setup.mjs']) {
  try { execFileSync(process.execPath, ['--check', path.join(root, f)]); check(true, 'parses: ' + f); }
  catch (e) { check(false, 'parses: ' + f + '\n' + e.stderr); }
}

for (const f of ['uxp/premiere.js', 'uxp/bridge.js', 'tools/install-uxp.mjs']) {
  try { execFileSync(process.execPath, ['--check', path.join(repoRoot, f)]); check(true, 'parses: ' + f); }
  catch (e) { check(false, 'parses: ' + f + '\n' + e.stderr); }
}

// The pages only use what the web bridge defines.
const bridge = read('ui/web-bridge.js');
const exposed = [...bridge.matchAll(/^\s{4}(\w+):/gm)].map(m => m[1]);
for (const f of ['ui/app.js', 'ui/overlay.js']) {
  const used = new Set([...read(f).matchAll(/(?:api|window\.prfx|prfx)\.(\w+)/g)].map(m => m[1]));
  for (const u of used) check(exposed.includes(u), `${f} uses bridge prfx.${u}`);
}

// No remote content.
for (const f of ['ui/index.html', 'ui/overlay.html']) {
  const html = read(f);
  check(/Content-Security-Policy/.test(html), f + ' has a CSP');
  check(!/(src|href)="https?:/.test(html), f + ' loads nothing remote');
}

// Every advertised AI function has the setup it depends on in the visible
// Creative Assist tool page, and the legacy Premiere runtime reads the same
// atomic settings file rather than a private localStorage copy.
const toolPage = read('ui/index.html');
const toolUi = read('ui/app.js');
const toolService = read('src/service.mjs');
const toolCore = read('src/core.mjs');
const legacyRuntime = readRepo('client/prai/js/main.js');
check(!/id="ffmpegPath"|id="whisperCommand"|id="whisperModel"/.test(toolPage), 'reusable media setup is not duplicated in Premiere settings');
check(['captionMaxWords', 'captionMaxChars', 'captionSplitMode', 'captionTrimEndPunctuation'].every(id => toolPage.includes(`id="${id}"`)), 'visible Settings includes optimized-caption controls');
check(/'ai-function': 'AI function'/.test(toolUi) && /Whisper or ffmpeg needs setup/.test(toolUi) && /creative-assist:media-tools/.test(toolUi), 'AI functions are categorized and open central media setup');
check(/'media:detect'/.test(toolService) && /'media:test'/.test(toolService) && /'media:install'/.test(toolService), 'media tools can be detected, tested and installed');
check(/ensureUxpInstalled\(\)/.test(toolService) && /export function ensureUxpInstalled/.test(toolCore), 'Creative Assist installs the UXP companion with the PR FX tool');
check(/whisperCommand: ''/.test(toolCore) && /captionMaxWords: 6/.test(toolCore), 'shared settings have media and caption defaults');
check(/function readSharedMediaSettings/.test(legacyRuntime) && /function writeSharedMediaSettings/.test(legacyRuntime) && /getWhisperSettings\(\)[\s\S]*readSharedMediaSettings/.test(legacyRuntime), 'Premiere runtime and Creative Assist share live media settings');

// Every colour token exists in both themes.
const css = read('ui/app.css');
const block = s => new Set([...(s || '').matchAll(/--([\w-]+):/g)].map(m => m[1]));
const light = block(css.split('@media (prefers-color-scheme: dark)')[0]);
const dark = block((css.split('@media (prefers-color-scheme: dark)')[1] || '').split('}\n}')[0]);
for (const t of light) check(dark.has(t), 'dark theme defines --' + t);

// Edie belongs in every Ctrl+Space palette, not only the settings header.
const swiftPalette = readRepo('native/PRFXShortcutListener.swift');
const swiftSprite = readRepo('native/PRFXTimelineHighlight.swift');
const swiftFeedback = readRepo('native/PRFXKeyFeedback.swift');
const windowsToast = readRepo('native/windows/Win/Toast.cs');
const windowsBridge = readRepo('native/windows/Core/CommandBridge.cs');
const windowsPending = readRepo('native/windows/Core/PendingCommands.cs');
check(/backgroundColor = NSColor\(srgbRed: 0\.075/.test(swiftFeedback) && /iconLabel\.textColor/.test(swiftFeedback) && /text\.textColor = \.white/.test(swiftFeedback), 'macOS result pill is neutral with colour only on its icon');
check(/BackColor = Color\.FromArgb\(19, 19, 22\)/.test(windowsToast) && /icon\.ForeColor/.test(windowsToast) && /label\.ForeColor = Color\.White/.test(windowsToast), 'Windows result pill is neutral with colour only on its icon');
check(!/[✓✕●] /.test(swiftPalette) && !/[✓✕●] /.test(readRepo('native/windows/Win/ShortcutListener.cs')), 'status glyphs are not duplicated inside notification text');
const windowsPalette = readRepo('native/windows/Win/PaletteForm.cs');
const cepPalette = readRepo('client/index.html');
const cepApp = readRepo('client/app.js');
const engine = readRepo('client/engine.js');
const engineHtml = readRepo('client/engine.html');
const uxpManifest = JSON.parse(readRepo('uxp/manifest.json'));
const uxpPage = readRepo('uxp/index.html');
const uxpPremiere = readRepo('uxp/premiere.js');
const uxpBridge = readRepo('uxp/bridge.js');
const pendingCommands = readRepo('native/PRFXPendingCommands.swift');
const agentTools = readRepo('client/prai/agent/tools.js');
const agentMain = readRepo('client/prai/js/main.js');
check(/EdiePaletteIconView/.test(swiftPalette) && /final class EdiePaletteIconView/.test(swiftSprite), 'macOS palette shows the Edie character');
check(/CreateEdieBitmap\(\)/.test(windowsPalette) && /header\.Controls\.Add\(character\)/.test(windowsPalette), 'Windows palette shows the Edie character');
check(/id="palette-character"/.test(cepPalette) && /brandFace\.cloneNode\(true\)/.test(cepApp), 'CEP fallback palette shows the Edie character');
check(/type: 'ai-function'.*ai-create-optimized-subtitles/.test(cepApp) && /AI function/.test(cepApp), 'Edie catalog includes categorized AI functions');
check(/command\.type === 'ai-function'/.test(engine) && /prai-engine-backend/.test(engineHtml), 'background engine dispatches Ctrl+Space AI functions');
check(/name: "create_optimized_subtitles"/.test(agentTools) && /handlers\.transcribe_audio_to_srt[\s\S]*handlers\.optimize_srt[\s\S]*handlers\.save_srt/.test(agentTools), 'optimized subtitle function chains Whisper, Optimized Text and save');
check(/srtPath = optimizedSrtPath;/.test(agentMain), 'optimized subtitle workflow returns the optimized SRT path');
check(/startWorking\(command\.name\)/.test(swiftPalette) && /Working on/.test(swiftSprite), 'macOS Edie timeline character shows timed AI work');
check(/StartWorking\(name/.test(readRepo('native/windows/Win/ShortcutListener.cs')) && /Working on/.test(readRepo('native/windows/Win/Toast.cs')), 'Windows shows timed AI work without taking focus');
check(/paletteTitle\.textContent = 'EDIE'/.test(cepApp), 'palette reset keeps the Edie title');
check(uxpManifest.manifestVersion === 5 && uxpManifest.host.app === 'premierepro' && uxpManifest.host.minVersion === '26.3.0', 'Edie UXP manifest targets the synchronous selection API it uses');
check(uxpManifest.requiredPermissions.network.domains.length === 2 && uxpManifest.requiredPermissions.localFileSystem === 'request', 'Edie UXP requests its local bridge plus user-approved folder access');
check(/Project\.getActiveProject/.test(uxpPremiere) && /TrackItemSelection\.createEmptySelection/.test(uxpPremiere) && /setSelection/.test(uxpPremiere), 'first command uses Premiere UXP DOM instead of ExtendScript');
check(/POST \/runtime/.test(swiftPalette) && /client == "uxp"/.test(swiftPalette) && /uxpFreshFor/.test(swiftPalette), 'native bridge negotiates UXP capability and falls back when stale');
check(/take\(at now: Date = Date\(\), where accepts:/.test(pendingCommands), 'shared command queue supports selective UXP routing');
check(/supportedIds:keys/.test(uxpBridge) && /EdiePremiere\.routeKeys\(catalog\)/.test(uxpBridge) && /mode!=='uxp'\)\{routeKeys=\[\]/.test(uxpBridge) && /\/next\?client=uxp/.test(uxpBridge) && /uxpRouteKey/.test(swiftPalette), 'UXP runtime advertises only commands it can execute, and none until switched to UXP');
check(/POST \/settings-write/.test(swiftPalette) && /writeSettingsPatch/.test(swiftPalette) && /\/settings-write/.test(uxpBridge), 'UXP edits the shared settings atomically through the native bridge');
check(/data-view="general"/.test(uxpPage) && /data-view="sync"/.test(uxpPage) && /id="shortcut-capture"/.test(uxpPage), 'UXP carries the CEP General, Sync, and shortcut-management surfaces');
check(/id="command-search"/.test(uxpPage) && /id="command-list"/.test(uxpPage) && /id="run-command"/.test(uxpPage), 'UXP panel has the usable command browser and Run action from CEP');
check(/\/catalog-current/.test(uxpBridge) && /\/settings-current/.test(uxpBridge) && /\/uxp-run/.test(uxpBridge), 'UXP panel reads the shared catalog and settings and can queue commands');
check(/GET \/catalog-current/.test(swiftPalette) && /POST \/uxp-run/.test(swiftPalette), 'macOS bridge serves and runs commands for the UXP UI');
check(/path == "\/runtime"/.test(windowsBridge) && /client == "uxp"/.test(windowsBridge) && /UxpFreshFor/.test(windowsBridge), 'Windows bridge has the same UXP negotiation and fallback');
check(/path == "\/catalog-current"/.test(windowsBridge) && /path == "\/uxp-run"/.test(windowsBridge), 'Windows bridge serves and runs commands for the UXP UI');
check(/Predicate<T> accepts/.test(windowsPending), 'Windows queue supports selective UXP routing');

// Edie is the one user-facing assistant. PR AI remains an internal tool
// runtime until its Premiere implementation is split out of the legacy file.
for (const f of ['client/app.js', 'client/edie-agent.js', 'client/prai/agent/tools.js', 'client/prai/agent/server.js', 'client/prai/agent/chat.js', 'client/prai/agent/chat-ui.js']) {
  try { execFileSync(process.execPath, ['--check', path.join(repoRoot, f)]); check(true, 'parses: ' + f); }
  catch (e) { check(false, 'parses: ' + f + '\n' + e.stderr); }
}
const ediePage = readRepo('client/index.html');
const edieAgent = readRepo('client/edie-agent.js');
const chatUi = readRepo('client/prai/agent/chat-ui.js');
check(!/data-view="chat"/.test(ediePage) && /id="commands-view" class="settings-view"/.test(ediePage), 'the extension opens on its Premiere command settings');
check(!/data-view="prai"/.test(ediePage) && !/id="prai-view"/.test(ediePage), 'standalone PR AI UI is removed');
check(/id="prai-backend"[^>]*class="runtime-frame"/.test(ediePage), 'legacy Premiere runtime is shared by Edie');
check(!/data-view="ai-setup"/.test(ediePage) && !/id="ai-setup-view"/.test(ediePage), 'reusable agent setup is not duplicated inside the Premiere extension');
check(!/data-view="chat"/.test(ediePage) && /id="chat-view"[^>]*is-hidden/.test(ediePage), 'Creative Assist is Edie’s main UI; the extension opens on Premiere commands');
check((ediePage.match(/id="prai-backend"/g) || []).length === 1 && /aria-hidden="true"/.test(ediePage), 'one hidden Premiere runtime powers Edie');
check(/PRAIChatUI\.attach\(host\)/.test(edieAgent), 'the hidden compatibility runtime can still execute existing AI functions');
check(/backend=1/.test(edieAgent) && /backend=1/.test(chatUi), 'hidden runtime cannot start a second chat server');
check(/__edieExternalScript/.test(edieAgent) && /edie-script-input/.test(ediePage), 'Edie can pass an attached script to Premiere workflows');
check(/event\.key === "Escape"/.test(edieAgent) && /PRAIChatUI\.stop\(\)/.test(edieAgent), 'Escape stops Edie safely');

// Journal grouping survives a listener restart (sequence numbers start again).
const src = read('ui/app.js');
const fn = src.slice(src.indexOf('function groupJournal'), src.indexOf('const VIA'));
const ctx = {}; vm.runInNewContext(fn + ';this.groupJournal = groupJournal;', ctx);
const rows = [
  ['2026-11-19T01:00:00Z', 'fired', 1, 'Shift + G', 'Grow', ''],
  ['2026-11-19T01:00:01Z', 'ok', 1, 'Shift + G', 'Grow', '200ms Applied Grow to 1 selected clip.'],
  ['2026-11-19T02:00:00Z', 'passed', '', 'Shift + G', '', 'not timeline'],
  ['2026-11-19T03:00:00Z', 'fired', 1, 'app', 'Dump', ''],
  ['2026-11-19T03:00:01Z', 'delivered', 1, 'app', 'Dump', 'engine'],
].map(([time, event, seq, key, command, detail]) => ({ time, event, seq: seq ? Number(seq) : null, key, command, detail }));
const items = ctx.groupJournal(rows);
check(items.length === 3, 'restarted sequence opens a new item');
check(items[0].name === 'Dump' && items[0].state === 'pending', 'newest item first and still pending');
check(items[2].state === 'ok' && items[2].ms === 200 && items[2].msg === 'Applied Grow to 1 selected clip.', 'result parsed with timing');
check(items[0].id !== items[2].id, 'ids differ across restarts');

// Connectors: one table (connectors.json) per OS, which every side follows.
const conn = JSON.parse(readRepo('connectors.json'));
const connKeys = ['label', 'support', 'logs', 'cepExtensions', 'uxpExternal', 'premiere', 'listener', 'autostart', 'cepDebug', 'overlay'];
for (const os of ['darwin', 'win32']) for (const k of connKeys) check(conn[os] && conn[os][k] != null, `connectors.json ${os} has ${k}`);
check(conn.premiere.minYear === 2025 && conn.premiere.cepVersions.includes(12), 'connectors target Premiere 2025+ on CEP 12');
check(conn.darwin.overlay === 'listener' && conn.win32.overlay === 'listener', 'overlay: the listener draws it on both OSes');
check(conn.win32.listener.install && conn.win32.listener.paths[0].startsWith(conn.win32.listener.install.to), 'Windows runs the installed copy first');
const appJs = readRepo('client/app.js');
check(appJs.includes(`WINDOWS_RUN_VALUE = '${conn.win32.autostart.value}'`) && appJs.includes(conn.win32.autostart.key.replace(/\\/g, '\\\\')), 'panel Run key matches connectors.json');
check(appJs.includes(conn.darwin.autostart.path.replace('~/', '/')), 'panel LaunchAgent matches connectors.json');
check(appJs.includes(`'${conn.win32.listener.process}'`), 'panel listener exe matches connectors.json');
check(readRepo('native/windows/Core/Support.cs').includes('"PR FX Palette"') && conn.win32.support.endsWith('\\PR FX Palette'), 'Windows listener support folder matches connectors.json');
// The Windows table expands to Windows paths, run from any OS.
const winOut = execFileSync(process.execPath, ['--input-type=module', '-e', `
  import { expand, platform } from ${JSON.stringify('file://' + path.join(root, 'src', 'connectors.mjs'))};
  const w = platform('win32');
  console.log(JSON.stringify({ support: expand(w.support, {}, 'win32'), exe: expand(w.listener.paths[1], { ext: 'C:\\\\X' }, 'win32'),
    pr: expand(w.premiere[0], { year: 2025 }, 'win32'), csxs: expand(w.cepDebug.key, { v: 12 }, 'win32'), none: platform('linux') }));
`], { env: { ...process.env, APPDATA: 'C:\\Users\\u\\AppData\\Roaming', ProgramFiles: 'C:\\Program Files' } }).toString();
const win = JSON.parse(winOut);
check(win.support === 'C:\\Users\\u\\AppData\\Roaming\\PR FX Palette', 'win32 support folder expands');
check(win.exe === 'C:\\X\\native\\windows\\build\\PRFXShortcutListener.exe', 'win32 listener path expands with backslashes');
check(win.pr === 'C:\\Program Files\\Adobe\\Adobe Premiere Pro 2025\\Adobe Premiere Pro.exe', 'win32 Premiere 2025 path expands');
check(win.csxs === 'HKCU\\Software\\Adobe\\CSXS.12', 'win32 CEP debug key expands');
check(win.none === null, 'unsupported OS has no connectors');

// Mac and Windows from one code (2026-11-21, the user: "i don't want to have to request every single function to be
// fixed for windows"). Shells start only in client/prai/js/platform-shell.js (zsh on the Mac, Git Bash on Windows); a
// Mac-only command anywhere else must sit in a branch Windows never takes and say so with a "mac-only:" note on its line.
{
  const macOnly = /\/bin\/zsh|osascript|\bopen -a |\bstat -f|\bpbcopy\b|\blaunchctl\b|\bdefaults (write|read)\b/;
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory()
    ? (['node_modules', 'templates', 'scripts'].includes(e.name) ? [] : walk(path.join(dir, e.name)))
    : /\.(m?js)$/.test(e.name) ? [path.join(dir, e.name)] : []);
  const files = [...walk(path.join(repoRoot, 'client')), ...walk(path.join(root, 'src'))];
  const loose = [];
  for (const f of files) {
    if (path.basename(f) === 'platform-shell.js') continue;
    fs.readFileSync(f, 'utf8').split(/\r?\n/).forEach((line, i) => {
      if (macOnly.test(line) && !/mac-only:/.test(line)) loose.push(`${path.relative(repoRoot, f)}:${i + 1}`);
    });
  }
  check(loose.length === 0, 'no Mac-only command outside the shell layer or a marked Mac branch' + (loose.length ? ': ' + loose.join(', ') : ''));
  const shellLayer = readRepo('client/prai/js/platform-shell.js');
  check(/Git[\\/\[\]\\]*bin|"Git", "bin", "bash\.exe"/.test(shellLayer) && shellLayer.includes('"/bin/zsh", ["-lc", command]') && shellLayer.includes('taskkill.exe'), 'the shell layer runs zsh on the Mac, Git Bash on Windows, and ends whole trees on both');
  for (const page of ['client/index.html', 'client/prai/index.html']) {
    const html = readRepo(page);
    const layer = html.indexOf('platform-shell.js'), first = Math.min(...['agent/tools.js', 'js/main.js'].map(s => html.indexOf(s)).filter(i => i >= 0));
    check(layer > 0 && layer < first, `${page} loads the shell layer before anything that runs a shell`);
  }
  const main = readRepo('client/prai/js/main.js');
  check(!/spawn\(\s*["']\/bin\/zsh/.test(main) && main.includes('window.prfxShell.spawn(nodeRequire, command, extra)'), 'AI functions start their steps through the shell layer');
}

// WhisperX / ffmpeg setup (media-setup.mjs): progress is read from the tools' own output, never guessed.
const mediaOut = execFileSync(process.execPath, ['--input-type=module', '-e', `
  import { parseLine, stepFraction } from ${JSON.stringify('file:///' + path.join(root, 'src', 'media-setup.mjs').replace(/\\/g, '/').replace(/^\//, ''))};
  const lines = ['Progress 1048576 of 204800000', 'Collecting torch>=2 (from whisperx)', 'Collecting whisperx',
    'Downloading torch-2.11.0-cp312-cp312-win_amd64.whl (204.8 MB)', '  Using cached faster_whisper-1.0.0-py3-none-any.whl.metadata (14 kB)',
    'Installing collected packages: tqdm, torch', 'Successfully installed torch-2.11.0', '  ██████████▒▒▒▒  10.0 MB / 85.3 MB',
    '==> Fetching dependencies for ffmpeg: aom, dav1d and x264', '==> Pouring dav1d--1.4.3.arm64_sonoma.bottle.tar.gz',
    'ERROR: No matching distribution found for ctranslate2==4.4.0', 'Requirement already satisfied: pip'];
  const steps = [{ weight: 2 }, { weight: 8 }, { weight: 90 }];
  console.log(JSON.stringify({ parsed: lines.map(parseLine), f0: stepFraction(steps, 0, 0), f2half: stepFraction(steps, 2, 0.5), fover: stepFraction(steps, 2, 3) }));
`]).toString();
const media = JSON.parse(mediaOut);
const [bytes, pkgFrom, pkg, file, cached, installing, installed, winget, brewTotal, brewPour, err, nothing] = media.parsed;
check(bytes.kind === 'bytes' && bytes.done === 1048576 && bytes.total === 204800000, "media setup: pip's raw progress is read as bytes of a total");
check(pkgFrom.kind === 'package' && pkgFrom.name === 'torch' && pkg.name === 'whisperx', 'media setup: each package pip collects is counted by name');
check(file.kind === 'file' && file.name === 'torch' && file.total === 204800000, 'media setup: a download names its package and size');
check(cached === null && nothing === null, 'media setup: cached metadata and other chatter move nothing');
check(installing.kind === 'installing' && installed.kind === 'installed', "media setup: pip's install phase and its end are seen");
check(winget.kind === 'bytes' && winget.done === 10000000 && winget.total === 85300000, "media setup: winget's MB of MB is read");
check(brewTotal.kind === 'brew-total' && brewTotal.count === 4 && brewPour.kind === 'brew-poured' && brewPour.name === 'dav1d', "media setup: Homebrew's dependency count and each pour are read");
check(err.kind === 'error', 'media setup: an error line is kept for the message');
check(media.f0 === 0 && Math.abs(media.f2half - 0.55) < 1e-9 && media.fover === 1, 'media setup: the overall bar adds whole steps and the current share, never past 100%');

// Whisper captions (2026-11-22, the user's first Windows run: "the timing failed miserably… it made shih up"). The
// fixtures are lines from that run: WhisperX's Vietnamese alignment squeezed a 9 s sentence into 2 s, and Whisper wrote
// a channel's closing line over silence. js/whisper-clean.js drops what was made up and ignores noise word timing.
{
  const clean = require(path.join(repoRoot, 'client/prai/js/whisper-clean.js'));
  const w = (word, start, end, extra) => Object.assign({ word, start, end }, extra);
  const p = probability => ({ probability });
  const real = { start: 23.32, end: 25.06, text: 'Ê, người chồng ơi', avg_logprob: -0.51, compression_ratio: 1.03, no_speech_prob: 0,
    words: [w('Ê,', 23.32, 24.12, p(0.74)), w('người', 24.24, 24.54, p(0.92)), w('chồng', 24.54, 24.78, p(0.99)), w('ơi', 24.78, 25.06, p(0.99))] };
  const ghien = { start: 432.26, end: 433.24, text: 'Hãy subscribe cho kênh Ghiền Mì Gõ Để không bỏ lỡ', avg_logprob: -0.40 };
  const lala = { start: 200.14, end: 201.54, text: 'Các bạn hãy subscribe cho kênh La La School Để không bỏ lỡ những video hấp dẫn' };
  const tail = { start: 236.84, end: 242.02, text: 'Để không bỏ lỡ những video hấp dẫn' };
  const english = { start: 10, end: 12, text: 'Thank you for watching!' };
  const meant = { start: 5, end: 9, text: 'Mình nói thật là các bạn nên subscribe kênh của chị ấy vì video rất hay' };
  const digits = { start: 118.9, end: 119, text: ' 11', words: [w('11', 118.9, 119, p(0.49))] };
  const collapsed = { start: 152.42, end: 156.66, text: 'Mình sẽ làm một cái video mới nhất cho mọi người xem',
    words: ['Mình', 'sẽ', 'làm', 'một', 'cái', 'video', 'mới', 'nhất', 'cho', 'mọi', 'người', 'xem'].map((t, i) => i < 2 ? w(t, 152.42 + i, 153.4 + i, p(0.9)) : w(t, 153.84, 153.84, p(0.95))) };
  const unsure = { start: 327.12, end: 327.52, text: 'ok', words: [w('ok', 327.12, 327.52, p(0.2))] };
  // WhisperX's wav2vec2 alignment for Vietnamese: ~0.01 a word, 0.02 s a letter.
  const squeezed = { start: 23.938, end: 26.062, text: 'Ê, người chồng ơi, camera nó hiện là', avg_logprob: -0.27,
    words: [w('Ê,', 23.938, 23.978, { score: 0.015 }), w('người', 23.998, 24.098, { score: 0.01 }), w('chồng', 24.118, 24.218, { score: 0.01 }),
      w('ơi,', 24.239, 24.299, { score: 0.017 }), w('camera', 24.319, 24.439, { score: 0.009 })] };
  const aligned = { start: 1, end: 2, text: 'hello there friend', words: [w('hello', 1, 1.3, { score: 0.8 }), w('there', 1.35, 1.6, { score: 0.7 }), w('friend', 1.6, 2, { score: 0.9 })] };
  check(clean.madeUpReason(real) === '', 'whisper captions: a real line is kept');
  check(/closing line/.test(clean.madeUpReason(ghien)) && /closing line/.test(clean.madeUpReason(lala)) && /closing line/.test(clean.madeUpReason(tail)),
    'whisper captions: "Hãy subscribe cho kênh Ghiền Mì Gõ…" and its kin, never said, are dropped');
  check(/closing line/.test(clean.madeUpReason(english)), 'whisper captions: "Thank you for watching" over silence is dropped');
  check(clean.madeUpReason(meant) === '', 'whisper captions: a real sentence that mentions subscribing is kept');
  check(/numbers/.test(clean.madeUpReason(digits)), 'whisper captions: a line of bare numbers over noise is dropped');
  check(/collapsed/.test(clean.madeUpReason(collapsed)), 'whisper captions: a line whose words got no time in the audio is dropped');
  check(/unsure/.test(clean.madeUpReason(unsure)), "whisper captions: a word Whisper itself doubts (p 0.2) is dropped");
  check(/unsure/.test(clean.madeUpReason({ start: 0, end: 1, text: 'xin chào', avg_logprob: -1.3 })) && /repeats/.test(clean.madeUpReason({ start: 0, end: 1, text: 'a a a', compression_ratio: 2.8 })),
    "whisper captions: Whisper's own failed-decode marks (log-prob, compression ratio) drop a line");
  check(clean.alignmentLooksBroken(squeezed) && !clean.alignmentLooksBroken(aligned) && !clean.alignmentLooksBroken(real), 'whisper captions: noise wav2vec2 alignment is told from real alignment and from Whisper word times');
  const result = clean.cleanTranscript({ segments: [real, squeezed, ghien, aligned] });
  const keptReal = result.segments[0], keptSqueezed = result.segments[1];
  check(result.segments.length === 3 && result.dropped.length === 1 && result.dropped[0].start === 432.26, 'whisper captions: the transcript keeps 3 lines and drops the made-up one');
  check(keptSqueezed.words.length === 0 && keptSqueezed.start === 23.938 && keptSqueezed.end === 26.062 && result.wordTiming === 'broken-alignment',
    'whisper captions: noise word timing is thrown away, the line keeps its own times');
  check(Math.abs(keptReal.start - 23.72) < 1e-9 && keptReal.end === 25.06 && keptReal.words[0].end === 24.12,
    "whisper captions: a first word stretched over the silence before it is held to what its letters fill (23.32 s -> 23.72 s)");
  check(result.segments.every(s => s.text && s.end > s.start) && result.segments.map(s => s.text).join('|') === [real, squeezed, aligned].map(s => s.text).join('|'),
    'whisper captions: kept text is exactly what Whisper wrote');

  const main = readRepo('client/prai/js/main.js');
  const script = readRepo('client/prai/scripts/prfx_transcribe.py');
  check(/function whisperxPythonPath/.test(main) && /"python\.exe"\] : \["python3", "python"\]/.test(main) && /prfx_transcribe\.py/.test(main),
    "whisper captions: the panel runs PR FX's transcription with WhisperX's own Python on both OSes");
  check(/whisperxBrokenAlignLanguages = \{ vi: true \}/.test(main) && /"--no_align"/.test(main), 'whisper captions: WhisperX on its own skips its broken Vietnamese alignment');
  check((main.match(/\? cleanWhisperOutputFiles\(nodeRequire, outputDir/g) || []).length === 2, 'whisper captions: both Whisper caption paths (Subtitles and Full Process) read the cleaned transcript');
  check(/vad_filter=False/.test(script) && /word_timestamps=True/.test(script) && /condition_on_previous_text=False/.test(script) && !/align/.test(script.replace(/#.*|"""[\s\S]*?"""/g, '')),
    'whisper captions: the script listens to the whole file, with Whisper word times and no alignment model');
  const praiPage = readRepo('client/prai/index.html');
  check(praiPage.indexOf('js/whisper-clean.js') > 0 && praiPage.indexOf('js/whisper-clean.js') < praiPage.indexOf('js/main.js'), 'whisper captions: the cleaner loads before main.js');
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll app checks passed');
process.exit(failures ? 1 : 0);
