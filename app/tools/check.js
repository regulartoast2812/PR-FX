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
for (const f of ['src/core.mjs', 'src/service.mjs', 'src/mcp.mjs']) {
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

console.log(failures ? `\n${failures} check(s) failed` : '\nAll app checks passed');
process.exit(failures ? 1 : 0);
