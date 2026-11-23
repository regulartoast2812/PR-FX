(function () {
  'use strict';

  var STORAGE_KEY = 'prfx.palette.settings.v1';
  var CATALOG_STORAGE_KEY = 'prfx.palette.catalog.v1';
  var PANEL_ERROR_STORAGE_KEY = 'prfx.palette.panel-errors.v1';
  var AUTO_FOLDER_SYNC_INTERVAL_MS = 30000;
  var MINIMUM_COMPLETE_CATALOG = 25;
  var PRFX_HOST_BUILD = '20261123-media-search-4';
  // The listener differs per OS (Swift app vs .NET exe); the panel, engine,
  // host and bridge protocol are shared. Keep platform branches to setup only.
  var IS_WINDOWS = typeof process !== 'undefined' && process && process.platform === 'win32';
  var MODIFIER_WORDS = IS_WINDOWS ? 'Ctrl/Alt/Win' : 'Ctrl/Option/Cmd';
  var WINDOWS_LISTENER_EXE = 'PRFXShortcutListener.exe';
  var WINDOWS_RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
  var WINDOWS_RUN_VALUE = 'PR FX Shortcut Listener';
  var RETIRED_COMMAND_IDS = { 'stretch-speed-to-playhead': true };
  var DEFAULTS = { announceScope: 'on', timelineHighlight: 'off', edieNudges: 'on', edieNudgeMinutes: 2, shortcut: { code: 'Space', ctrl: true, alt: false, shift: false, meta: false }, transitionFrames: 30, staggerFrames: 5, staggerGroup: 1, exportNamePattern: '{sequence} - {index}', mergeTouchingSameSource: false, nameTolerance: 'normalized', failurePolicy: 'rollback', showSystemCommands: false, syntheticSeconds: 5, shortcutFeedback: 'problems', bindings: [], folderSyncsByProject: {} };
  var commands = [
    { type: 'ai-function', id: 'ai-create-optimized-subtitles', name: 'Create Optimized Subtitles (Whisper → SRT)' },
    { type: 'ai-function', id: 'ai-transcribe-optimized-srt', name: 'Transcribe + Save Optimized SRT' },
    { type: 'ai-function', id: 'ai-auto-captions', name: 'Auto Captions' },
    { type: 'ai-function', id: 'ai-full-processing', name: 'Full Process' },
    { type: 'ai-function', id: 'ai-layout', name: 'Layout from Script' },
    { type: 'ai-function', id: 'ai-audio-text', name: 'Audio + Text (Script Cut Workflow)' },
    { type: 'ai-function', id: 'ai-add-text', name: 'Add Script Text as Captions' },
    { type: 'ai-function', id: 'ai-new-sequence', name: 'Create New Sequence' },
    { type: 'custom', id: 'dump-qe-api', name: '[System] Dump QE + DOM API' },
    { type: 'custom', id: 'inspect-selected-clip', name: '[System] Inspect Selected Clip' },
    { type: 'custom', id: 'failure-report', name: '[System] Failure Report' },
    { type: 'custom', id: 'preset-report', name: '[System] Preset Report' },
    { type: 'custom', id: 'probe-preset-routes', name: '[System] Probe Lumetri Preset Apply' },
    { type: 'custom', id: 'clear-failure-ledger', name: '[System] Clear Failure Ledger' },
    { type: 'custom', id: 'undo-last-palette-action', name: 'Undo Last Edie Effect Apply' },
    { type: 'custom', id: 'remove-transitions', name: 'Remove Transitions on Selected Clips' },
    { type: 'custom', id: 'move-selected-clips-up', name: 'Move Selected Clips Up as Group', moveMode: 'group' },
    { type: 'custom', id: 'move-selected-clips-up', name: 'Move Selected Clips Up Individually', moveMode: 'individual' },
    { type: 'custom', id: 'move-selected-clips-down', name: 'Move Selected Clips Down as Group', moveMode: 'group' },
    { type: 'custom', id: 'move-selected-clips-down', name: 'Move Selected Clips Down Individually', moveMode: 'individual' },
    { type: 'custom', id: 'pull-group-in', name: 'Pull Group In to Playhead' },
    { type: 'custom', id: 'pull-group-out', name: 'Pull Group Out to Playhead' },
    { type: 'custom', id: 'retract-speed-in-to-playhead', name: 'Retract Speed In to Playhead' },
    { type: 'custom', id: 'retract-speed-out-to-playhead', name: 'Retract Speed Out to Playhead' },
    { type: 'custom', id: 'undo-last-prfx-action', name: 'Undo Last Edie Action (Any)' },
    { type: 'custom', id: 'undo-last-arrange', name: 'Undo Last Edie Arrange Action' },
    { type: 'custom', id: 'redo-last-arrange', name: 'Redo Last Edie Arrange Action' },
    { type: 'custom', id: 'select-before-playhead', name: 'Select Everything Starting Before Playhead' },
    { type: 'custom', id: 'adjustment-layer-over-selection', name: 'Adjustment Layer Over Selection' },
    { type: 'custom', id: 'perfect-pitch', name: 'Perfect Pitch (Correct Speed Transposition)' },
    { type: 'custom', id: 'place-source-clip', name: 'Place Source Monitor Clip at Playhead' },
    { type: 'custom', id: 'place-bin-clips', name: 'Place Bin Clips at Playhead in Row' },
    { type: 'custom', id: 'place-bin-clips-column', name: 'Place Bin Clips at Playhead in Column' },
    { type: 'custom', id: 'replace-from-bin', name: 'Replace Selected Clips from Bin' },
    { type: 'custom', id: 'replace-fit-from-bin', name: 'Replace & Fit to Slot from Bin' },
    { type: 'custom', id: 'bulk-replace-preview', name: 'Bulk Replace — Dry Run (no changes)' },
    { type: 'custom', id: 'bulk-replace-by-name', name: 'Bulk Replace from Bin by Name' },
    { type: 'custom', id: 'queue-cuts-to-ame', name: 'Queue Cuts to Media Encoder' },
    { type: 'custom', id: 'trim-in-to-playhead', name: 'Trim In to Playhead' },
    { type: 'custom', id: 'trim-out-to-playhead', name: 'Trim Out to Playhead' },
    { type: 'custom', id: 'close-selected-gaps', name: 'Close Gaps Between Selected Clips' },
    { type: 'custom', id: 'clean-up-track-rows', name: 'Clean Up by Selected' },
    { type: 'custom', id: 'fill-track-rows-down', name: 'Clean Up by Timeline' },
    { type: 'custom', id: 'snap-tracks-in', name: 'Snap Track Blocks In to Playhead' },
    { type: 'custom', id: 'snap-tracks-out', name: 'Snap Track Blocks Out to Playhead' },
    { type: 'custom', id: 'stagger-ascending', name: 'Stagger Ascending' },
    { type: 'custom', id: 'stagger-descending', name: 'Stagger Descending' },
    { type: 'effect', name: 'Gaussian Blur' }, { type: 'effect', name: 'Lumetri Color' },
    { type: 'effect', name: 'Crop' }, { type: 'effect', name: 'Transform' },
    { type: 'effect', name: 'Warp Stabilizer' }, { type: 'effect', name: 'Sharpen' },
    { type: 'effect', name: 'VR Digital Glitch' }, { type: 'effect', name: 'Tint' },
    { type: 'transition', name: 'Cross Dissolve' }, { type: 'transition', name: 'Dip To Black' },
    { type: 'transition', name: 'Dip To White' }, { type: 'transition', name: 'Film Dissolve' },
    { type: 'audio-transition', name: 'Constant Power' }, { type: 'audio-transition', name: 'Exponential Fade' }
  ];
  // These iterate over clips and can legitimately take minutes.
  var LONG_RUNNING_COMMANDS = {
    'bulk-replace-by-name': true, 'bulk-replace-preview': true, 'replace-from-bin': true, 'replace-fit-from-bin': true,
    'place-bin-clips': true, 'place-bin-clips-column': true, 'place-source-clip': true, 'queue-cuts-to-ame': true, 'adjustment-layer-over-selection': true,
    'dump-qe-api': true, 'inspect-selected-clip': true, 'preset-report': true, 'probe-preset-routes': true
  };
  var functionCommands = commands.filter(function (command) { return command.type === 'custom' || command.type === 'ai-function'; });
  var catalogReady = false;
  var hostResponsive = false;
  try {
    var cachedCatalog = JSON.parse(localStorage.getItem(CATALOG_STORAGE_KEY) || 'null');
    if (Array.isArray(cachedCatalog) && cachedCatalog.length >= MINIMUM_COMPLETE_CATALOG) {
      commands = functionCommands.concat(cachedCatalog);
      catalogReady = true;
    }
  } catch (_) {}
  var cs = new CSInterface();
  var settings = loadSettings();
  setTimeout(function () { watchSettingsFile(); }, 0);
  var activeIndex = 0;
  var palette = document.getElementById('palette');
  var search = document.getElementById('command-search');
  var list = document.getElementById('command-list');
  var paletteCharacter = document.getElementById('palette-character');
  var brandFace = document.querySelector('.brand-face');
  // The palette has its own Edie, flipped to face right toward the commands (2026-11-21); the
  // header's copy is only a fallback.
  if (paletteCharacter && brandFace && !paletteCharacter.firstElementChild) {
    paletteCharacter.appendChild(brandFace.cloneNode(true));
  }
  var shortcutBadge = document.getElementById('shortcut-badge');
  // The palette, laid out like Sage's search (2026-11-23): Commands and Media, Tab between them. palette-search.js
  // builds the rows exactly as the native palette does (native/PRFXPaletteSearch.swift).
  var PS = window.PRFXPaletteSearch;
  var paletteTabs = document.getElementById('palette-tabs');
  var paletteFooter = document.getElementById('palette-footer');
  var PALETTE_RECENT_KEY = 'prfx.palette.recent.v1';
  // Small glyphs standing in for the native palette's SF Symbols.
  var PALETTE_ICONS = {
    'custom': '<path d="M9.5 1L3 9.2h4.2L6.3 15 13 6.8H8.8z"/>',
    'ai-function': '<path d="M6 1l1.3 3.7L11 6 7.3 7.3 6 11 4.7 7.3 1 6l3.7-1.3zM12 9l.8 2.2L15 12l-2.2.8L12 15l-.8-2.2L9 12l2.2-.8z"/>',
    'effect': '<path d="M2 13.3l8-8 1.2 1.2-8 8zM11 1l.6 1.4L13 3l-1.4.6L11 5l-.6-1.4L9 3l1.4-.6zM14 6.5l.4 1 1 .4-1 .4-.4 1-.4-1-1-.4 1-.4z"/>',
    'audio-effect': '<path d="M1.5 6H4l4-3.2v10.4L4 10H1.5zM10.5 4.6a4.6 4.6 0 010 6.8l-.9-.9a3.3 3.3 0 000-5z"/>',
    'transition': '<path fill-rule="evenodd" d="M1.5 3h13v10h-13zM2.8 4.3v7.4H8V4.3z"/>',
    'audio-transition': '<path d="M1 7h2v2H1zM4 5h2v6H4zM7 2h2v12H7zM10 4h2v8h-2zM13 6h2v4h-2z"/>',
    'preset': '<path d="M8 1l2.2 4.5 4.8.7-3.5 3.4.8 4.9L8 12.2l-4.3 2.3.8-4.9L1 6.2l4.8-.7z"/>',
    'transition-placement': '<path d="M1 8l4-4v3h6V4l4 4-4 4V9H5v3z"/>',
    'move-mode': '<path d="M5 1l4 4H6v6H4V5H1zM11 15l-4-4h3V5h2v6h3z"/>',
    'stagger-frames': '<path d="M1 14v-3h4V7.5h4V4h6v2.2h-3.8v3.5H7.2v3.5H3.2V14z"/>',
    'video': '<path fill-rule="evenodd" d="M2 2h12v12H2zM3.6 3.8v2h1.6v-2zm0 3.2v2h1.6V7zm0 3.2v2h1.6v-2zm7.2-6.4v2h1.6v-2zm0 3.2v2h1.6V7zm0 3.2v2h1.6v-2z"/>',
    'audio': '<path d="M1 7h2v2H1zM4 5h2v6H4zM7 2h2v12H7zM10 4h2v8h-2zM13 6h2v4h-2z"/>',
    'image': '<path fill-rule="evenodd" d="M1 2.5h14v11H1zm1.4 1.4v6.8l3.6-3.6 3 3 2-2 2.6 2.6V3.9zM11 5.3a1.1 1.1 0 110 2.2 1.1 1.1 0 010-2.2z"/>',
    'speaker': '<path d="M1.5 5.5h3L8.5 2v12l-4-3.5h-3zM10.4 5.2a3.6 3.6 0 010 5.6l-.9-1.1a2.2 2.2 0 000-3.4zM12.3 3a6.4 6.4 0 010 10l-.9-1.1a5 5 0 000-7.8z"/>',
    'bgm': '<path d="M7 1.5h1.5c.3 1.6 1.6 2.6 3.5 3v1.8c-1.4-.2-2.6-.7-3.5-1.5V12a2.5 2.5 0 11-1.5-2.3z"/>',
    'other': '<path d="M8 1l7 3.5L8 8 1 4.5zM2.6 7.2L8 9.9l5.4-2.7L15 8l-7 3.5L1 8zm0 3.5L8 13.4l5.4-2.7 1.6.8L8 15l-7-3.5z"/>',
    'dot': '<circle cx="8" cy="8" r="4"/>'
  };
  var managerType = 'all';
  var paletteCategory = 'commands';
  var paletteRows = [];
  var paletteVisible = [];
  var paletteMedia = [];
  var mediaLoading = false, mediaError = '', mediaLoadedAt = 0, mediaRequestId = 0;
  var pendingTransitionCommand = null;
  var pendingMoveCommand = null;
  var pendingStaggerCommand = null;
  var catalogSearchValue = '';
  var TRANSITION_PLACEMENTS = [
    { type: 'transition-placement', id: 'both', name: 'Both In + Out on each selected clip' },
    { type: 'transition-placement', id: 'in', name: 'In points only' },
    { type: 'transition-placement', id: 'out', name: 'Out points only' },
    { type: 'transition-placement', id: 'selected-cuts', name: 'Cuts between adjacent selected clips' },
    { type: 'transition-placement', id: 'group-ends', name: 'Start + end of each selected group' },
    { type: 'transition-placement', id: 'centered', name: 'Centered at every selected boundary' }
  ];
  var MOVE_MODES = [
    { type: 'move-mode', id: 'group', name: 'Move selection as a group' },
    { type: 'move-mode', id: 'individual', name: 'Move clips individually' }
  ];
  var shortcutInput = document.getElementById('shortcut');
  var durationInput = document.getElementById('default-duration');
  var staggerFramesInput = document.getElementById('stagger-frames');
  var staggerGroupInput = document.getElementById('stagger-group');
  var exportNameInput = document.getElementById('export-name-pattern');
  var mergeTouchingInput = document.getElementById('merge-touching-source');
  var nameToleranceInput = document.getElementById('name-tolerance');
  var failurePolicyInput = document.getElementById('failure-policy');
  var showSystemInput = document.getElementById('show-system-commands');
  var syntheticDurationInput = document.getElementById('synthetic-duration');
  var shortcutFeedbackInput = document.getElementById('shortcut-feedback');
  var managerSearch = document.getElementById('command-manager-search');
  var managerTypeTabs = document.getElementById('manager-type-tabs');
  var managerList = document.getElementById('command-manager-list');
  var managerShortcut = document.getElementById('manager-shortcut');
  var failureLogButton = document.getElementById('open-failure-log');
  var failureLogStatus = document.getElementById('failure-log-status');
  var selectedManagerCommand = null;
  var managerAssignmentFilter = 'all';
  var bridgeState = document.getElementById('bridge-state');
  var bridgeDetail = document.getElementById('bridge-detail');
  var catalogHealth = document.getElementById('catalog-health');
  var kickstartListenerButton = document.getElementById('kickstart-listener');
  var forceReconnectButton = document.getElementById('force-reconnect');
  var commandStatus = document.getElementById('command-status');
  var folderDropZone = document.getElementById('folder-drop-zone');
  var folderInput = document.getElementById('sync-folder-input');
  var folderList = document.getElementById('sync-folder-list');
  var syncStatus = document.getElementById('sync-status');
  var syncProjectNote = document.getElementById('sync-project-note');
  var lastBridgeCatalogSync = 0;
  var bridgeCatalogSyncInFlight = false;
  var lastSentBridgeCatalogFingerprint = '';
  var bridgeOnline = false;
  var lastBridgePayload = null;
  var expectedListenerBuild = '';
  var heldCaptureModifiers = { ctrl: false, alt: false, shift: false, meta: false };
  var folderSnapshots = {};
  var syncRunning = false;
  var projectSyncKey = '';
  var projectSyncName = '';
  var lastPanelErrorMessage = '';
  var extensionPathCache = '';

  function errorMessage(error) {
    if (!error) return 'Unknown error';
    if (error.stack) return String(error.stack);
    if (error.message) return String(error.message);
    return String(error);
  }
  function rememberPanelError(label, error) {
    var detail = errorMessage(error);
    var message = 'Panel ' + label + ': ' + detail;
    try {
      var errors = JSON.parse(localStorage.getItem(PANEL_ERROR_STORAGE_KEY) || '[]');
      errors.push({ at: new Date().toISOString(), label: label, message: detail });
      while (errors.length > 20) errors.shift();
      localStorage.setItem(PANEL_ERROR_STORAGE_KEY, JSON.stringify(errors));
    } catch (_) {}
    if (message !== lastPanelErrorMessage) {
      lastPanelErrorMessage = message;
      try { setStatus(message, true); } catch (_) {}
    }
  }
  function safeInterval(label, task, delay) {
    return window.setInterval(function () {
      try { task(); } catch (error) { rememberPanelError(label, error); }
    }, delay);
  }
  function safeRun(label, task) {
    try { task(); } catch (error) { rememberPanelError(label, error); }
  }

  function textFingerprint(text) {
    var hash = 2166136261;
    for (var i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return 'fnv1a32-' + ('00000000' + (hash >>> 0).toString(16)).slice(-8) + '-' + text.length;
  }

  // [System] entries are diagnostics — dumps, ledgers, clip inspection. They are
  // useless to an editor and destructive-looking in a palette, so they are
  // hidden unless the toggle in General is on. One predicate feeds the CEP
  // palette, the command manager AND the catalog synced to the native palette,
  // so the setting cannot apply to one surface and not another.
  function isSystemCommand(command) {
    return String(command && command.name || '').indexOf('[System]') === 0;
  }
  // Filtered here as well as in the host: a catalog cached before the host
  // filter existed would otherwise keep showing legacy entries until something
  // forced a refresh.
  function isLegacyCommand(command) {
    return String(command && command.name || '').toLowerCase().indexOf('(legacy)') !== -1;
  }
  function commandIsVisible(command) {
    if (isLegacyCommand(command)) return false;
    return settings.showSystemCommands === true || !isSystemCommand(command);
  }
  function visibleCommands() {
    return commands.filter(commandIsVisible);
  }

  function currentCatalogBody() {
    return JSON.stringify(visibleCommands());
  }

  function currentCatalogFingerprint() {
    return textFingerprint(currentCatalogBody());
  }

  window.addEventListener('error', function (event) {
    rememberPanelError('error', (event && (event.error || event.message)) || 'Unknown error');
    return true;
  });
  window.addEventListener('unhandledrejection', function (event) {
    rememberPanelError('promise rejection', event && event.reason);
  });

  // settings.json is the source of truth, localStorage only a fallback. CEP's
  // localStorage is not durable: if the previous Premiere's helper still holds
  // its database lock at launch, Chromium silently hands the panel an empty
  // in-memory store. The panel then wrote those defaults over settings.json and
  // every saved shortcut vanished (2026-10-28).
  function readSettingsFile() {
    var modules = nodeModules();
    var dir = appSupportDir();
    if (!modules || !dir) return null;
    try {
      var parsed = JSON.parse(modules.fs.readFileSync(modules.path.join(dir, 'settings.json'), 'utf8'));
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_) { return null; }
  }
  function loadSettings() {
    try {
      var stored = readSettingsFile();
      if (!stored) stored = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
      var loaded = Object.assign({}, DEFAULTS, stored);
      if (!loaded.folderSyncsByProject || typeof loaded.folderSyncsByProject !== 'object') loaded.folderSyncsByProject = {};
      loaded.staggerFrames = Math.max(0, Math.min(9999, Math.round(Number(loaded.staggerFrames) || 0)));
      loaded.staggerGroup = Math.max(1, Math.min(999, Math.round(Number(loaded.staggerGroup) || 1)));
      if (Array.isArray(loaded.folderSyncs) && loaded.folderSyncs.length && !loaded.folderSyncsByProject.__legacy__) loaded.folderSyncsByProject.__legacy__ = loaded.folderSyncs;
      delete loaded.folderSyncs;
      loaded.bindings = (loaded.bindings || []).filter(function (binding) { return !(binding.command && RETIRED_COMMAND_IDS[binding.command.id]); });
      loaded.bindings.forEach(function (binding) {
        if (binding.command.id === 'undo-last-palette-action') binding.command.name = 'Undo Last Edie Effect Apply';
        if (binding.command.id === 'undo-last-prfx-action') binding.command.name = 'Undo Last Edie Action (Any)';
        if (binding.command.id === 'undo-last-arrange') binding.command.name = 'Undo Last Edie Arrange Action';
        if (binding.command.id === 'redo-last-arrange') binding.command.name = 'Redo Last Edie Arrange Action';
        if (binding.command.id === 'remove-transitions') binding.command.name = 'Remove Transitions on Selected Clips';
        if (binding.command.id === 'dump-qe-api') binding.command.name = '[System] Dump QE + DOM API';
        if (binding.command.id === 'clean-up-track-rows') binding.command.name = 'Clean Up by Selected';
        if (binding.command.id === 'fill-track-rows-down') binding.command.name = 'Clean Up by Timeline';
        if (binding.command.id === 'place-bin-clips') binding.command.name = 'Place Bin Clips at Playhead in Row';
        // The former single move command executed in group mode when invoked
        // through a saved shortcut. Preserve that exact behavior while moving
        // the binding onto the new explicit CEP command.
        if (binding.command.id === 'move-selected-clips-up' && !binding.command.moveMode) {
          binding.command.name = 'Move Selected Clips Up as Group';
          binding.command.moveMode = 'group';
        }
      });
      return loaded;
    }
    catch (_) { return Object.assign({}, DEFAULTS); }
  }
  function saveSettings() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); syncListenerSettings(); updateShortcutUI();
    try { var request = new XMLHttpRequest(); request.open('POST', 'http://127.0.0.1:27389/reload-settings', true); request.send(''); } catch (_) {}
  }
  function displayShortcut(s) {
    var parts = [];
    if (s.ctrl) parts.push('Ctrl'); if (s.alt) parts.push('Alt'); if (s.shift) parts.push('Shift'); if (s.meta) parts.push(IS_WINDOWS ? 'Win' : 'Cmd');
    parts.push(s.code === 'Space' ? 'Space' : s.code.replace(/^Key|^Digit/, ''));
    return parts.join(' + ');
  }
  function updateShortcutUI() {
    shortcutInput.value = displayShortcut(settings.shortcut);
    if (shortcutBadge) shortcutBadge.textContent = displayShortcut(settings.shortcut);
    durationInput.value = settings.transitionFrames;
    staggerFramesInput.value = settings.staggerFrames;
    staggerGroupInput.value = settings.staggerGroup;
    if (exportNameInput) exportNameInput.value = settings.exportNamePattern || '{sequence} - {index}';
    if (mergeTouchingInput) mergeTouchingInput.checked = settings.mergeTouchingSameSource === true;
    if (nameToleranceInput) nameToleranceInput.value = settings.nameTolerance || 'normalized';
    if (failurePolicyInput) failurePolicyInput.value = settings.failurePolicy || 'rollback';
    if (shortcutFeedbackInput) shortcutFeedbackInput.value = settings.shortcutFeedback || 'problems';
    if (showSystemInput) showSystemInput.checked = settings.showSystemCommands === true;
    if (syntheticDurationInput) syntheticDurationInput.value = settings.syntheticSeconds || 5;
    renderManager();
    renderFolderSyncs();
  }
  function commandKey(command) { return [command.type, command.id || '', command.moveMode || '', command.name].join('|'); }
  function commandNumber(commandValue, settingValue, fallback, minimum, maximum) {
    var value = commandValue;
    if (value === undefined || value === null || value === '') value = settingValue;
    value = Number(value);
    if (isNaN(value)) value = fallback;
    value = Math.round(value);
    return Math.max(minimum, Math.min(maximum, value));
  }
  function bindingFor(command) { return (settings.bindings || []).filter(function (binding) { return commandKey(binding.command) === commandKey(command); })[0]; }
  // The Commands list, laid out like the palette and Sage's search (2026-11-23): type tabs with counts, then each
  // kind's commands under its coloured name, the matched part of each name picked out, and its shortcut.
  function renderManager() {
    var query = managerSearch.value || '';
    var base = commands.filter(function (command) {
      if (!commandIsVisible(command)) return false;
      var binding = bindingFor(command);
      if (managerAssignmentFilter === 'assigned' && !binding) return false;
      if (managerAssignmentFilter === 'unassigned' && binding) return false;
      return true;
    });
    var entries = base.map(function (command, i) { return { type: command.type, name: command.name, index: i }; });
    var allRows = PS.commandRows(entries, query);
    var typeCounts = {}, total = 0;
    allRows.forEach(function (row) { if (row.kind === 'command') { typeCounts[base[row.index].type] = (typeCounts[base[row.index].type] || 0) + 1; total++; } });
    var types = PS.kinds.map(function (k) { return k[0]; });
    base.forEach(function (command) { if (types.indexOf(command.type) === -1) types.push(command.type); });
    types = types.filter(function (type) { return base.some(function (command) { return command.type === type; }); });
    if (managerType !== 'all' && types.indexOf(managerType) === -1) managerType = 'all';
    function typeTab(type, label, count) {
      var active = managerType === type;
      return '<button type="button" class="palette-tab' + (active ? ' is-active' : '') + (count ? '' : ' is-empty') + '" role="tab" aria-selected="' + active + '" data-manager-type="' + escapeHtml(type) + '">' +
        (type === 'all' ? '' : '<span style="display:inline-flex;color:' + paletteColour(type) + '">' + paletteIcon(type) + '</span>') + '<span>' + escapeHtml(label) + '</span><span class="count">' + count + '</span></button>';
    }
    managerTypeTabs.innerHTML = typeTab('all', 'All', total) + types.map(function (type) { return typeTab(type, PS.title(type), typeCounts[type] || 0); }).join('');
    var rows = managerType === 'all' ? allRows : allRows.filter(function (row, i) {
      if (row.kind === 'command') return base[row.index].type === managerType;
      if (row.kind === 'section') { var next = allRows[i + 1]; return next && next.kind === 'command' && base[next.index].type === managerType; }
      return false;
    });
    var available = rows.filter(function (row) { return row.kind === 'command'; }).map(function (row) { return base[row.index]; });
    if (!available.length) selectedManagerCommand = null;
    else if (!selectedManagerCommand || !available.some(function (command) { return commandKey(command) === commandKey(selectedManagerCommand); })) selectedManagerCommand = available[0];
    document.getElementById('command-count').textContent = available.length + ' command' + (available.length === 1 ? '' : 's');
    managerList.innerHTML = available.length ? rows.map(function (row) {
      if (row.kind === 'section') return '<div class="palette-section" style="color:' + paletteColour(row.colour) + '">' + escapeHtml(row.title) + '<span class="count">' + row.count + '</span></div>';
      if (row.kind !== 'command') return '';
      var command = base[row.index];
      var binding = bindingFor(command);
      var colour = paletteColour(command.type);
      var active = selectedManagerCommand && commandKey(command) === commandKey(selectedManagerCommand);
      return '<div class="manager-row' + (active ? ' is-active' : '') + '" role="option" aria-selected="' + !!active + '" data-command="' + escapeHtml(commandKey(command)) + '">' +
        '<span class="icon" style="color:' + colour + '">' + paletteIcon(command.type) + '</span>' +
        '<span class="manager-name" title="' + escapeHtml(command.name) + '">' + highlightName(command.name, row.at, colour) + '</span>' +
        (binding ? '<span class="tag key">' + escapeHtml(displayShortcut(binding.shortcut)) + '</span>' : '') + '</div>';
    }).join('') : '<p class="palette-note">' + (String(query).trim() ? 'No command is called that.' : managerAssignmentFilter === 'assigned' ? 'No command has a shortcut yet.' : 'No commands here.') + '</p>';
    var binding = selectedManagerCommand && bindingFor(selectedManagerCommand);
    document.getElementById('manager-command-name').textContent = selectedManagerCommand ? selectedManagerCommand.name : 'Select a command';
    var selectedType = selectedManagerCommand && (selectedManagerCommand.type === 'custom' ? 'Function' : selectedManagerCommand.type.replace(/-/g, ' '));
    document.getElementById('manager-command-type').textContent = selectedManagerCommand ? 'Apply this ' + selectedType + ' directly to the current Premiere selection.' : 'Choose an item from the list to assign a Premiere shortcut.';
    var typeBadge = document.getElementById('manager-type-badge');
    typeBadge.textContent = selectedType || '—';
    typeBadge.className = 'type-badge' + (selectedManagerCommand ? ' is-visible ' + selectedManagerCommand.type : '');
    managerShortcut.disabled = !selectedManagerCommand;
    managerShortcut.value = binding ? displayShortcut(binding.shortcut) : '';
    managerShortcut.dataset.shortcut = binding ? JSON.stringify(binding.shortcut) : '';
    document.getElementById('perform-manager-command').disabled = !selectedManagerCommand;
    document.getElementById('save-manager-shortcut').disabled = !selectedManagerCommand;
    document.getElementById('remove-manager-shortcut').disabled = !binding;
    var listenerLabel = (lastBridgePayload && lastBridgePayload.listenerBuild) || readExpectedListenerBuild();
    catalogHealth.textContent = (catalogReady ? commands.length + ' live/cached commands ready' : commands.length + ' fallback commands only') +
      (listenerLabel ? ' · listener ' + shortBuild(listenerLabel) : '');
  }
  function syncListenerSettings() {
    // The native listener reads this file so saved shortcuts keep working even
    // when the CEP settings panel is not focused.
    try {
      if (typeof require !== 'function') return;
      var fs = require('fs');
      var path = require('path');
      var os = require('os');
      var dir = process.platform === 'win32'
        ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'PR FX Palette')
        : path.join(os.homedir(), 'Library', 'Application Support', 'PR FX Palette');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      var target = path.join(dir, 'settings.json');
      // Losing shortcuts must always be recoverable: keep the last file that
      // had more of them before overwriting it with fewer.
      try {
        var previous = JSON.parse(fs.readFileSync(target, 'utf8')) || {};
        if ((previous.bindings || []).length > (settings.bindings || []).length) {
          fs.writeFileSync(path.join(dir, 'settings.backup.json'), JSON.stringify(previous), 'utf8');
        }
      } catch (_) {}
      var temp = path.join(dir, 'settings.' + process.pid + '.' + Date.now() + '.tmp');
      fs.writeFileSync(temp, JSON.stringify(settings), 'utf8');
      fs.renameSync(temp, target);
      settingsFileMtime = settingsFileStamp();
    } catch (_) {}
  }
  // The PR FX app edits settings.json too. Without this the panel would keep
  // its stale copy and write it back over the app's change on its next save.
  var settingsFileMtime = 0;
  function settingsFileStamp() {
    var modules = nodeModules();
    var dir = appSupportDir();
    if (!modules || !dir) return 0;
    try { return modules.fs.statSync(modules.path.join(dir, 'settings.json')).mtimeMs; } catch (_) { return 0; }
  }
  function watchSettingsFile() {
    settingsFileMtime = settingsFileStamp();
    setInterval(function () {
      var stamp = settingsFileStamp();
      if (!stamp || stamp === settingsFileMtime) return;
      settingsFileMtime = stamp;
      if (!readSettingsFile()) return;
      settings = loadSettings();
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch (_) {}
      updateShortcutUI();
    }, 1500);
  }
  function nodeModules() {
    if (typeof require !== 'function') return null;
    try { return { fs: require('fs'), path: require('path') }; } catch (_) { return null; }
  }
  function appSupportDir() {
    if (typeof require !== 'function') return '';
    try {
      var path = require('path');
      var os = require('os');
      return process.platform === 'win32'
        ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'PR FX Palette')
        : path.join(os.homedir(), 'Library', 'Application Support', 'PR FX Palette');
    } catch (_) { return ''; }
  }
  function failureLogPath() {
    var dir = appSupportDir();
    if (!dir || typeof require !== 'function') return '';
    try { return require('path').join(dir, 'failure-log.jsonl'); } catch (_) { return ''; }
  }
  function setFailureLogStatus(message, error) {
    if (!failureLogStatus) return;
    failureLogStatus.textContent = message || '';
    failureLogStatus.style.color = error ? 'var(--danger)' : 'var(--muted)';
  }
  function refreshFailureLogStatus() {
    var logPath = failureLogPath(), fs, text, lines, lastLine, last;
    if (!logPath || typeof require !== 'function') { setFailureLogStatus('Failure log unavailable in this CEP runtime.', true); return; }
    try {
      fs = require('fs');
      if (!fs.existsSync(logPath)) { setFailureLogStatus('No failures logged yet.'); return; }
      text = fs.readFileSync(logPath, 'utf8');
      lines = text.split(/\r?\n/).filter(function (line) { return line.replace(/^\s+|\s+$/g, '').length; });
      if (!lines.length) { setFailureLogStatus('No failures logged yet.'); return; }
      lastLine = lines[lines.length - 1];
      try { last = JSON.parse(lastLine); } catch (_) { last = null; }
      setFailureLogStatus(lines.length + ' logged failure' + (lines.length === 1 ? '' : 's') + (last && last.at ? ' · last ' + last.at : '') + '.');
    } catch (error) {
      setFailureLogStatus('Could not read failure log: ' + (error && error.message ? error.message : error), true);
    }
  }
  function openFailureLog() {
    var logPath = failureLogPath(), fs, child;
    if (!logPath || typeof require !== 'function') { setFailureLogStatus('Failure log unavailable in this CEP runtime.', true); return; }
    try {
      fs = require('fs');
      if (!fs.existsSync(logPath)) { setFailureLogStatus('No failures logged yet. Try the failing replace once, then open the log.'); return; }
      child = require('child_process');
      if (process.platform === 'darwin') child.execFile('/usr/bin/open', [logPath]);
      else if (process.platform === 'win32') child.execFile('cmd.exe', ['/c', 'start', '', logPath]);
      else child.execFile('xdg-open', [logPath]);
      setFailureLogStatus('Opened ' + logPath + '.');
    } catch (error) {
      setFailureLogStatus('Could not open failure log: ' + (error && error.message ? error.message : error), true);
    }
  }
  function setSyncStatus(message, error) {
    if (!syncStatus) return;
    syncStatus.textContent = message || '';
    syncStatus.style.color = error ? 'var(--danger)' : 'var(--good)';
  }
  function activeFolderSyncs() {
    if (!projectSyncKey) return [];
    if (!Array.isArray(settings.folderSyncsByProject[projectSyncKey])) settings.folderSyncsByProject[projectSyncKey] = [];
    return settings.folderSyncsByProject[projectSyncKey];
  }
  function loadProjectSyncContext() {
    evalPremiere('prfx.getProjectSyncIdentity()', function (result) {
      var identity;
      try { identity = JSON.parse(result); } catch (_) { identity = null; }
      if (!identity || !identity.key) { projectSyncKey = ''; projectSyncName = ''; renderFolderSyncs(); return; }
      var changed = projectSyncKey !== identity.key;
      projectSyncKey = identity.key; projectSyncName = identity.name || 'this project';
      if (settings.folderSyncsByProject.__legacy__ && !settings.folderSyncsByProject[projectSyncKey]) {
        settings.folderSyncsByProject[projectSyncKey] = settings.folderSyncsByProject.__legacy__;
        delete settings.folderSyncsByProject.__legacy__;
        saveSettings();
      }
      if (changed) { folderSnapshots = {}; setSyncStatus('Folder sync is scoped to ' + projectSyncName + '.'); }
      if (syncProjectNote) syncProjectNote.textContent = 'Sync settings for ' + projectSyncName + ' only. Each source folder becomes a same-named top-level Project bin; deleted source files remain offline in the project.';
      renderFolderSyncs();
    });
  }
  function renderFolderSyncs() {
    if (!folderList) return;
    var folders = activeFolderSyncs();
    folderList.innerHTML = folders.length ? folders.map(function (folder) {
      return '<div class="sync-folder-row" data-sync-path="' + escapeHtml(folder.sourcePath) + '"><div><strong>' + escapeHtml(folder.binName) + '</strong><span>' + escapeHtml(folder.sourcePath) + '</span><small>Top-level Project bin: ' + escapeHtml(folder.binName) + '</small></div><button class="secondary remove-sync-folder" type="button">Stop sync</button></div>';
    }).join('') : '<p class="sync-empty">No folders are being watched for this project.</p>';
  }
  function uniqueSyncBinName(baseName) {
    return baseName || 'Media';
  }
  // Several folders can arrive at once (drop, multi-select). Add them all,
  // then sync them one after another so Premiere sees one import at a time.
  function addSyncFolders(sourcePaths) {
    var modules = nodeModules();
    if (!modules || !sourcePaths || !sourcePaths.length) { setSyncStatus('Folder access is unavailable in this CEP panel.', true); return; }
    if (!projectSyncKey) { setSyncStatus('Open a project before adding a synced folder.', true); return; }
    var added = [], skipped = [];
    sourcePaths.forEach(function (sourcePath) {
      try {
        sourcePath = modules.path.resolve(sourcePath);
        var sourceName = modules.path.basename(sourcePath) || 'Media';
        if (!modules.fs.statSync(sourcePath).isDirectory()) { skipped.push(sourceName + ' (not a folder)'); return; }
        if (activeFolderSyncs().some(function (folder) { return folder.sourcePath === sourcePath; })) { skipped.push(sourceName + ' (already synced)'); return; }
        var mapping = { sourcePath: sourcePath, binName: uniqueSyncBinName(sourceName) };
        activeFolderSyncs().push(mapping); added.push(mapping);
      } catch (error) { skipped.push((sourcePath || 'folder') + ' (' + error.message + ')'); }
    });
    var skippedNote = skipped.length ? ' Skipped: ' + skipped.join(', ') + '.' : '';
    if (!added.length) { setSyncStatus((sourcePaths.length > 1 ? 'No new folders added.' : 'Nothing added.') + skippedNote, true); return; }
    saveSettings(); renderFolderSyncs();
    setSyncStatus('Watching ' + added.map(function (folder) { return folder.binName; }).join(', ') + ' in ' + projectSyncName + '…' + skippedNote);
    var index = 0;
    function next() { if (index >= added.length) return; syncFolderMapping(added[index++], true, next); }
    next();
  }
  function supportedMediaFile(filePath) {
    return /\.(3g2|3gp|aac|aif|aiff|avi|bwf|cr2|dng|gif|heic|jpeg|jpg|m4a|m4v|mkv|mov|mp3|mp4|mpeg|mpg|mxf|png|psd|r3d|tga|tif|tiff|wav|webm)$/i.test(filePath);
  }
  function scanSyncFolder(sourcePath) {
    var modules = nodeModules();
    if (!modules) throw new Error('Folder access is unavailable.');
    var fs = modules.fs, path = modules.path, snapshot = {}, files = [], pending = [sourcePath];
    while (pending.length) {
      var directory = pending.pop(), entries;
      try { entries = fs.readdirSync(directory); } catch (_) { continue; }
      entries.forEach(function (name) {
        if (name.charAt(0) === '.') return;
        var fullPath = path.join(directory, name), stat;
        try { stat = fs.lstatSync(fullPath); } catch (_) { return; }
        if (stat.isSymbolicLink()) return;
        if (stat.isDirectory()) { pending.push(fullPath); return; }
        if (!stat.isFile() || !supportedMediaFile(fullPath)) return;
        var relativePath = path.relative(sourcePath, fullPath).replace(/\\/g, '/');
        snapshot[fullPath] = String(stat.size) + ':' + String(Math.floor(stat.mtimeMs));
        files.push({ path: fullPath, relativePath: relativePath });
      });
    }
    return { files: files, snapshot: snapshot };
  }
  function changedSyncFiles(sourcePath, scan, force) {
    var previous = folderSnapshots[sourcePath] || {}, files = [];
    scan.files.forEach(function (file) { if (force || previous[file.path] !== scan.snapshot[file.path]) files.push(file); });
    return files;
  }
  function syncFolderMapping(folder, force, finished) {
    if (!folder || syncRunning) { if (finished) finished(); return; }
    var scan;
    try { scan = scanSyncFolder(folder.sourcePath); } catch (error) { setSyncStatus('Could not scan ' + folder.binName + ': ' + error.message, true); if (finished) finished(); return; }
    var files = changedSyncFiles(folder.sourcePath, scan, force);
    if (!files.length) { folderSnapshots[folder.sourcePath] = scan.snapshot; if (finished) finished(); return; }
    syncRunning = true;
    var cursor = 0, imported = 0, refreshed = 0, failed = false;
    function next() {
      if (cursor >= files.length) {
        syncRunning = false;
        if (!failed) {
          folderSnapshots[folder.sourcePath] = scan.snapshot;
          setSyncStatus(folder.binName + ': ' + imported + ' imported, ' + refreshed + ' refreshed.');
        }
        if (finished) finished();
        return;
      }
      var chunk = files.slice(cursor, cursor + 60); cursor += chunk.length;
      var payload = JSON.stringify({ sourcePath: folder.sourcePath, binName: folder.binName, files: chunk });
      evalPremiere('prfx.syncFolder(' + JSON.stringify(payload) + ')', function (result) {
        if (!result || result === 'EvalScript error.' || result.indexOf('ERROR:') === 0) {
          failed = true; syncRunning = false;
          setSyncStatus((result || 'Premiere did not respond.').replace(/^ERROR: /, ''), true);
          if (finished) finished();
          return;
        }
        try { var report = JSON.parse(result); imported += Number(report.imported) || 0; refreshed += Number(report.refreshed) || 0; } catch (_) {}
        next();
      });
    }
    next();
  }
  function syncAllFolders(force, silent) {
    var folders = activeFolderSyncs().slice(), index = 0;
    if (!folders.length) { if (!silent) setSyncStatus('Add a folder first.', true); return; }
    function next() { if (index >= folders.length) return; syncFolderMapping(folders[index++], force, next); }
    if (!silent) setSyncStatus('Scanning folders…');
    next();
  }
  // Every dropped folder, not just the first. Plain files are left out; a
  // folder chosen through the file input arrives as its files, so those
  // collapse to their one root.
  function foldersFromFileList(fileList) {
    var modules = nodeModules(), folders = [];
    if (!modules || !fileList || !fileList.length) return folders;
    for (var i = 0; i < fileList.length; i++) {
      var file = fileList[i], rawPath = file.path || '', folder = '';
      if (!rawPath) continue;
      try {
        if (modules.fs.statSync(rawPath).isDirectory()) folder = rawPath;
        else if (file.webkitRelativePath) folder = rawPath.slice(0, rawPath.length - file.webkitRelativePath.length).replace(/[\\/]$/, '') + modules.path.sep + file.webkitRelativePath.split('/')[0];
      } catch (_) {}
      if (folder && folders.indexOf(folder) < 0) folders.push(folder);
    }
    return folders;
  }
  function extensionFilesystemPath() {
    // CSInterface can return a file:// URL. ExtendScript's $.evalFile only
    // accepts an operating-system path, so normalize it before every reload.
    var value = extensionPathCache || '';
    try {
      value = cs.getSystemPath('extension') || extensionPathCache || '';
    } catch (error) {
      if (!extensionPathCache) rememberPanelError('extension path lookup', error);
      return extensionPathCache || '';
    }
    try { value = decodeURI(value); } catch (_) {}
    value = value.replace(/^file:\/\//, '');
    if (/^\/[A-Za-z]:\//.test(value)) value = value.slice(1);
    if (value) extensionPathCache = value;
    return value;
  }
  function evalHostFile(path, callback) {
    var expression = "(function(){try{$.evalFile(" + JSON.stringify(path) + ");return '__PRFX_HOST_OK__';}" +
      "catch(error){return '__PRFX_HOST_ERROR__' + error.toString() + ' (line ' + (error.line || '?') + ')';}})()";
    try {
      cs.evalScript(expression, function (result) {
        var message = String(result || '');
        if (message.indexOf('__PRFX_HOST_ERROR__') === 0) {
          callback(message.replace('__PRFX_HOST_ERROR__', ''), true);
          return;
        }
        if (message === 'EvalScript error.') {
          callback('Premiere could not evaluate ' + path + '.', true);
          return;
        }
        callback('', false);
      });
    } catch (error) {
      rememberPanelError('host file evaluation', error);
      callback('Premiere could not evaluate ' + path + '.', true);
    }
  }
  function evalPremiere(expression, callback) {
    // A CEP panel's ScriptPath can be discarded by Premiere while the native
    // palette is still alive. Reload only PR FX's own host on demand.
    var root = extensionFilesystemPath();
    if (!root) { callback('ERROR: Could not locate the Edie extension folder.'); return; }
    var hostPath = root + '/jsx/host.jsx';
    var wrapped = "(function(){try{" +
      "if(typeof prfx==='undefined'||prfx.HOST_BUILD!==" + JSON.stringify(PRFX_HOST_BUILD) + "||typeof prfx.apply!=='function'){$.evalFile(" + JSON.stringify(hostPath) + ");}" +
      "return (" + expression + ");" +
      "}catch(error){return 'ERROR: PR FX host load failed: ' + error.toString() + ' (line ' + (error.line || '?') + ')';}})()";
    try {
      cs.evalScript(wrapped, callback);
    } catch (error) {
      rememberPanelError('Premiere evalScript', error);
      callback('EvalScript error.');
    }
  }
  function dispatchPremiereApply(payload, callback) {
    evalPremiere('prfx.apply(' + JSON.stringify(payload) + ')', callback);
  }
  // A stale host is invisible from inside the panel, so ask the host to compare
  // itself against host.jsx on disk. This is what a whole afternoon of phantom
  // bugs turned out to be.
  function checkHostFreshness() {
    var root = extensionFilesystemPath() || '';
    evalPremiere('prfx.buildStatus(' + JSON.stringify(root) + ')', function (result) {
      var info;
      try { info = JSON.parse(result); } catch (_) { return; }
      if (!info || !info.onDisk || info.onDisk === info.loaded) return;
      setStatus('STALE HOST: running ' + info.loaded + ' but host.jsx on disk is ' + info.onDisk +
        '. Quit Premiere completely and relaunch — reopening the panel is not enough.', true);
    });
  }
  function reloadHostScript(complete) {
    evalPremiere("typeof prfx !== 'undefined' && prfx.HOST_BUILD===" + JSON.stringify(PRFX_HOST_BUILD) + " && typeof prfx.apply === 'function' ? 'Edie host loaded.' : 'ERROR: Edie host did not load.'", function (status) {
      hostResponsive = status !== 'EvalScript error.' && !(status && status.indexOf('ERROR:') === 0);
      if (status === 'EvalScript error.') setStatus('Edie host did not respond after reload. Use Force reconnect.', true);
      else if (status && status.indexOf('ERROR:') === 0) setStatus(status.replace('ERROR: ', ''), true);
      else { setStatus('Edie host loaded.'); checkHostFreshness(); }
      if (complete) complete();
    });
  }
  // ---------------------------------------------------------------------
  // Setup
  //
  // Installing by hand meant a terminal, a compiler and two shell scripts. The
  // panel is already open and already has Node, so it can do all of it except
  // the Accessibility grant -- macOS requires a human for that one, and no
  // amount of scripting changes it.
  // ---------------------------------------------------------------------
  var setupStatusList = document.getElementById('setup-status');
  var setupInstallButton = document.getElementById('setup-install');
  var setupAccessibilityButton = document.getElementById('setup-accessibility');
  var setupDetail = document.getElementById('setup-detail');

  function nodeChild() { try { return require('child_process'); } catch (_) { return null; } }
  function nodeOs() { try { return require('os'); } catch (_) { return null; } }

  function listenerAppPath() {
    var root = extensionFilesystemPath();
    if (!root) return '';
    return IS_WINDOWS ? root + '/native/windows/build/' + WINDOWS_LISTENER_EXE : root + '/native/build/PR FX Shortcut Listener.app';
  }
  function listenerBuildMarkerPath() {
    var root = extensionFilesystemPath();
    if (!root) return '';
    return IS_WINDOWS ? root + '/native/windows/build/listener-build.txt' : root + '/native/build/listener-build.txt';
  }
  function launchAgentPath() {
    var os = nodeOs();
    return os ? os.homedir() + '/Library/LaunchAgents/com.prfx.shortcut-listener.plist' : '';
  }
  // Windows runs a copy outside the extension folder, so the exe CEP ships is
  // never the one holding a file lock when the extension is updated.
  function windowsInstalledListenerPath() {
    if (!IS_WINDOWS || typeof require !== 'function') return '';
    try {
      var path = require('path');
      var os = require('os');
      var base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
      return path.join(base, 'PR FX Palette', 'bin', WINDOWS_LISTENER_EXE);
    } catch (_) { return ''; }
  }
  function windowsCopyListener(done) {
    var node = nodeModules();
    var source = listenerAppPath();
    var target = windowsInstalledListenerPath();
    if (!node || !source || !target) { done('Could not resolve the listener paths'); return; }
    if (!node.fs.existsSync(source)) { done('The bundled listener is missing: ' + source); return; }
    try { node.fs.mkdirSync(node.path.dirname(target), { recursive: true }); } catch (_) {}
    var attempts = 0;
    // taskkill returns before Windows releases the image file; retry briefly.
    (function attempt() {
      try {
        node.fs.copyFileSync(source, target);
        // The engine compares this with the shipped stamp to know the copy is current.
        try {
          var stamp = node.path.join(node.path.dirname(source), 'listener-build.txt');
          if (node.fs.existsSync(stamp)) node.fs.copyFileSync(stamp, node.path.join(node.path.dirname(target), 'listener-build.txt'));
        } catch (_) {}
        done('');
      } catch (error) {
        if (++attempts >= 10) { done('Could not replace ' + target + ': ' + (error.message || error)); return; }
        window.setTimeout(attempt, 300);
      }
    })();
  }
  function windowsStartListener(done) {
    var child = nodeChild();
    var target = windowsInstalledListenerPath();
    if (!child || !target) { done('Node is not available in this panel'); return; }
    try {
      var started = child.spawn(target, [], { detached: true, stdio: 'ignore', windowsHide: false });
      started.on('error', function () {});
      started.unref();
      done('');
    } catch (error) { done(error.message || String(error)); }
  }
  function windowsListenerSteps() {
    return [
      { label: 'quitting the running listener', command: 'taskkill.exe', args: ['/IM', WINDOWS_LISTENER_EXE, '/F'], optional: true, timeout: 6000 },
      { label: 'copying the listener', run: windowsCopyListener },
      { label: 'installing autostart', command: 'reg.exe', args: ['add', WINDOWS_RUN_KEY, '/v', WINDOWS_RUN_VALUE, '/t', 'REG_SZ', '/d', '"' + windowsInstalledListenerPath() + '"', '/f'] },
      { label: 'starting the listener', run: windowsStartListener }
    ];
  }
  function runStep(step, done) {
    if (step.run) { step.run(done); return; }
    runSetupStep(step.command, step.args, done, step.timeout);
  }
  function readExpectedListenerBuild() {
    var node = nodeModules();
    var marker = listenerBuildMarkerPath();
    if (!node || !marker) return '';
    try {
      expectedListenerBuild = String(node.fs.readFileSync(marker, 'utf8') || '').replace(/^\s+|\s+$/g, '');
    } catch (_) {
      expectedListenerBuild = '';
    }
    return expectedListenerBuild;
  }
  function shortBuild(value) {
    value = String(value || '');
    return value.length > 18 ? value.slice(0, 18) : value;
  }
  function listenerBuildIsStale(payload) {
    var expected = readExpectedListenerBuild();
    if (!expected) return false;
    return !payload || payload.listenerBuild !== expected;
  }

  function setSetupCheck(name, ok) {
    if (!setupStatusList) return;
    var row = setupStatusList.querySelector('[data-check="' + name + '"]');
    if (!row) return;
    row.className = ok ? 'is-ok' : 'is-bad';
  }

  function refreshSetupStatus() {
    var node = nodeModules();
    if (!node) return;
    setSetupCheck('running', bridgeOnline === true);
    if (IS_WINDOWS) {
      var installed = windowsInstalledListenerPath();
      setSetupCheck('listener', !!(installed && node.fs.existsSync(installed)));
      runSetupStep('reg.exe', ['query', WINDOWS_RUN_KEY, '/v', WINDOWS_RUN_VALUE], function (error) {
        setSetupCheck('autostart', !error);
      }, 5000);
      return;
    }
    var app = listenerAppPath();
    var agent = launchAgentPath();
    setSetupCheck('listener', !!(app && node.fs.existsSync(app)));
    setSetupCheck('autostart', !!(agent && node.fs.existsSync(agent)));
  }

  // Each step reports for itself. A silent installer that half-works is worse
  // than one that says which part failed.
  function runSetupStep(command, args, done, timeoutMs) {
    var child = nodeChild();
    if (!child) { done('Node is not available in this panel'); return; }
    try {
      child.execFile(command, args, { timeout: timeoutMs || 60000 }, function (error) {
        done(error ? (error.message || String(error)) : '');
      });
    } catch (thrown) { done(thrown.message || String(thrown)); }
  }

  function installListener(complete) {
    var done = typeof complete === 'function' ? complete : null;
    var node = nodeModules();
    var root = extensionFilesystemPath();
    var app = listenerAppPath();
    if (!node || !root) {
      setStatus('Could not locate the Edie extension folder.', true);
      if (done) done('Could not locate the Edie extension folder.');
      return;
    }
    setupInstallButton.disabled = true;
    setSetupDetail('Installing…');

    var steps = [];
    if (IS_WINDOWS) steps = windowsListenerSteps();
    else if (node.fs.existsSync(root + '/native/build-macos.sh')) {
      // On soft-launch machines this validates and uses the bundled app. On a
      // dev machine it can still rebuild when the bundled app is missing.
      steps.push({ label: 'checking the bundled listener', command: '/bin/zsh', args: [root + '/native/build-macos.sh'], timeout: 120000 }); // mac-only: the else of IS_WINDOWS
    }
    // The app arrives inside the extension rather than as a download, but
    // clear any quarantine flag anyway or Gatekeeper blocks the first launch.
    if (!IS_WINDOWS) {
      steps.push({ label: 'clearing quarantine', command: '/usr/bin/xattr', args: ['-dr', 'com.apple.quarantine', app], optional: true });
      steps.push({ label: 'installing autostart', command: '/bin/zsh', args: [root + '/native/install-autostart-macos.sh'] }); // mac-only: the else of IS_WINDOWS
      steps.push({ label: 'quitting stale listener', command: '/bin/zsh', args: [root + '/native/stop-listener-macos.sh'], optional: true, timeout: 6000 }); // mac-only: the else of IS_WINDOWS
      steps.push({ label: 'starting the listener', command: '/bin/zsh', args: [root + '/native/start-listener-macos.sh'] }); // mac-only: the else of IS_WINDOWS
    }

    var index = 0;
    function next() {
      if (index >= steps.length) {
        setupInstallButton.disabled = false;
        setSetupDetail(IS_WINDOWS
          ? 'Installed. Ctrl/Alt/Win shortcuts arm while Premiere is frontmost; Shift-only and plain-key shortcuts arm once Edie has seen a Premiere text field (click into the Project panel search box once), and pause while you type in one.'
          : 'Installed. Ctrl/Option/Cmd shortcuts arm while Premiere is frontmost; Shift-only and plain-key shortcuts arm after the Timeline/Sequence panel is clicked.');
        window.setTimeout(refreshSetupStatus, 1200);
        if (done) done('');
        return;
      }
      var step = steps[index++];
      setSetupDetail('Installing — ' + step.label + '…');
      runStep(step, function (error) {
        if (error && !step.optional) {
          setupInstallButton.disabled = false;
          setSetupDetail('Install stopped while ' + step.label + ': ' + error);
          refreshSetupStatus();
          if (done) done('Install stopped while ' + step.label + ': ' + error);
          return;
        }
        next();
      });
    }
    next();
  }

  function setSetupDetail(text) { if (setupDetail) setupDetail.textContent = text; }

  if (setupInstallButton) setupInstallButton.addEventListener('click', installListener);
  // Windows has no Accessibility grant; low-level keyboard hooks need none.
  if (setupAccessibilityButton && IS_WINDOWS) setupAccessibilityButton.style.display = 'none';
  if (setupAccessibilityButton && !IS_WINDOWS) setupAccessibilityButton.addEventListener('click', function () {
    runSetupStep('/usr/bin/open', ['x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'], function (error) {
      if (error) setSetupDetail('Could not open System Settings: ' + error);
      else setSetupDetail('Accessibility lets Edie confirm Timeline focus. Without it, ' + MODIFIER_WORDS + ' shortcuts can still work from Premiere, but Shift-only/plain-key shortcuts need a saved Timeline click region.');
    });
  });

  function checkBridge() {
    var request = new XMLHttpRequest();
    request.open('GET', 'http://127.0.0.1:27389/health', true);
    request.timeout = 1200;
    request.onreadystatechange = function () {
      if (request.readyState !== 4) return;
      var payload;
      try { payload = request.status === 200 ? JSON.parse(request.responseText) : null; } catch (_) { payload = null; }
      if (!payload) {
        bridgeOnline = false;
        lastBridgePayload = null;
        setSetupCheck('running', false);
        bridgeState.className = 'bridge-state is-offline'; bridgeState.innerHTML = '<i></i>Offline';
        bridgeDetail.textContent = 'The native listener is not running. Use Install / Repair in Setup above.';
        return;
      }
      bridgeOnline = true;
      lastBridgePayload = payload;
      setSetupCheck('running', true);
      var expectedBuild = readExpectedListenerBuild();
      if (listenerBuildIsStale(payload)) {
        bridgeState.className = 'bridge-state is-offline'; bridgeState.innerHTML = '<i></i>Stale listener';
        bridgeDetail.textContent = payload.listenerBuild
          ? 'Running listener build ' + shortBuild(payload.listenerBuild) + ' does not match installed build ' + shortBuild(expectedBuild) + '. Use Force reconnect.'
          : 'The running listener is from an older build and cannot report its version. Use Force reconnect.';
        catalogHealth.textContent = (Number(payload.catalogCount) || 0) + ' commands in stale listener';
        return;
      }
      var savedBindings = Number(payload.bindings) || 0;
      var armedBindings = Number(payload.armedBindings);
      if (isNaN(armedBindings)) armedBindings = savedBindings;
      var withheldBindings = Number(payload.withheldBindings);
      if (isNaN(withheldBindings)) withheldBindings = Math.max(0, savedBindings - armedBindings);
      var shortcutWord = savedBindings === 1 ? 'shortcut' : 'shortcuts';
      if (payload.accessibilityTrusted === false && payload.accessibilityBypassed !== true && savedBindings > 0 && payload.mode !== 'active' && payload.mode !== 'modifier-only') {
        bridgeState.className = 'bridge-state is-checking'; bridgeState.innerHTML = '<i></i>Needs Timeline';
        bridgeDetail.textContent = 'Ctrl+Space can open the palette, but saved command shortcuts are paused until Edie can confirm the Timeline/Sequence panel. Grant Accessibility or click the Timeline once after it has been detected.';
      } else if (payload.mode === 'active') {
        if (hostResponsive) {
          bridgeState.className = 'bridge-state is-active'; bridgeState.innerHTML = '<i></i>Active';
          bridgeDetail.textContent = IS_WINDOWS
            ? 'Shortcuts are active while Premiere is frontmost and no text field is focused: ' + armedBindings + '/' + savedBindings + ' command ' + shortcutWord + ' armed.'
            : (payload.accessibilityBypassed === true
            ? 'Premiere-frontmost shortcut mode is active with '
            : 'Timeline/Sequence shortcuts are active with ') + armedBindings + '/' + savedBindings + ' command ' + shortcutWord + ' armed.'
            + (payload.accessibilityBypassed === true ? ' Accessibility focus detection is bypassed.' : (payload.accessibilityTrusted === false ? ' Using the saved Timeline position because Accessibility is currently unavailable.' : ''))
            + (withheldBindings > 0 ? ' ' + withheldBindings + ' shortcut' + (withheldBindings === 1 ? ' is' : 's are') + ' waiting for a confirmed Timeline click.' : '');
        } else {
          bridgeState.className = 'bridge-state is-offline'; bridgeState.innerHTML = '<i></i>Host offline';
          bridgeDetail.textContent = 'The native Timeline listener is active, but Premiere’s host script is not responding. Use Force reconnect.';
        }
      } else if (payload.mode === 'modifier-only') {
        bridgeState.className = 'bridge-state is-checking'; bridgeState.innerHTML = '<i></i>Waiting for Timeline';
        bridgeDetail.textContent = IS_WINDOWS
          ? 'Listener is healthy. Ctrl/Alt/Win command shortcuts are armed: ' + armedBindings + '/' + savedBindings + ' command ' + shortcutWord + '. Shift-only and plain-key shortcuts are paused — ' + (payload.focus || 'a text field is focused') + '. Repair will not change this state.'
          : 'Listener is healthy. Ctrl/Option/Cmd command shortcuts are armed: ' + armedBindings + '/' + savedBindings + ' command ' + shortcutWord + '. Shift-only and plain-key shortcuts stay paused until the Timeline/Sequence panel is clicked, so typing in bins is safe. Repair will not change this state.';
      } else if (payload.mode === 'palette-only') {
        bridgeState.className = 'bridge-state is-checking'; bridgeState.innerHTML = '<i></i>Palette only';
        bridgeDetail.textContent = payload.accessibilityBypassed === true ? 'Ctrl+Space can open the palette while Premiere is frontmost.' : 'Ctrl+Space can open the palette while Premiere is frontmost. Command shortcuts are waiting for Timeline/Sequence focus.';
      } else if (payload.mode === 'paused') {
        bridgeState.className = 'bridge-state is-checking'; bridgeState.innerHTML = '<i></i>Paused';
        bridgeDetail.textContent = payload.focus || 'Shortcuts activate only while the Timeline/Sequence panel is focused.';
      } else {
        bridgeState.className = 'bridge-state is-offline'; bridgeState.innerHTML = '<i></i>Unavailable';
        bridgeDetail.textContent = 'The shortcut bridge is not ready. Restart PR FX Shortcut Listener.';
      }
      if (payload.pendingCommand) {
        bridgeDetail.textContent = 'Waiting for CEP to run “' + payload.pendingCommand + '”.';
      }
      if (Number(payload.failedRegistrations) > 0) {
        bridgeState.className = 'bridge-state is-checking'; bridgeState.innerHTML = '<i></i>Shortcut conflict';
        bridgeDetail.textContent += ' ' + payload.failedRegistrations + ' shortcut registration(s) failed; the listener is retrying. Another app or binding may be using those keys.';
      }
      if (Number(payload.droppedCommands) > 0) {
        bridgeDetail.textContent += ' ' + payload.droppedCommands + ' command(s) expired or exceeded the queue limit during this listener session.';
      }
      bridgeDetail.textContent += ' ' + deliverySummary(payload);
      if (expectedBuild || payload.listenerBuild) {
        catalogHealth.textContent = (catalogReady ? commands.length + ' live/cached commands ready' : commands.length + ' fallback commands only') +
          ' · listener ' + shortBuild(payload.listenerBuild || expectedBuild || 'unknown') +
          (savedBindings ? ' · ' + armedBindings + '/' + savedBindings + ' shortcuts armed' : '');
      }
      if (catalogReady && payload.catalogFingerprint !== currentCatalogFingerprint() && Date.now() - lastBridgeCatalogSync > 5000) syncBridgeCatalog();
    };
    request.ontimeout = request.onerror = function () { bridgeOnline = false; lastBridgePayload = null; bridgeState.className = 'bridge-state is-offline'; bridgeState.innerHTML = '<i></i>Offline'; bridgeDetail.textContent = 'The native listener is not responding.'; };
    try { request.send(); } catch (_) {}
  }
  // One sentence on how shortcuts reach Premiere and how they have fared this
  // listener session. tools/key-report.sh gives the full breakdown.
  function deliverySummary(payload) {
    var mode = payload.deliveryMode === 'keyboard-hook' ? 'Keys: Windows keyboard hook'
      : payload.deliveryMode === 'event-tap' ? 'Keys: event tap'
      : payload.deliveryMode === 'carbon-secure-input' ? 'Keys: Carbon (another app has secure keyboard entry on)'
      : payload.deliveryMode === 'carbon' ? 'Keys: Carbon fallback (grant Accessibility for the event tap)'
      : 'Keys: older listener';
    var runner = engineIsActive() ? 'commands run by the background engine' : 'commands run by this panel (engine not running — restart Premiere after updating)';
    var stats = payload.keyStats;
    var counts = '';
    if (stats && typeof stats === 'object') {
      var fired = Number(stats.fired) || 0;
      var ok = Number(stats.ok) || 0;
      counts = ' This session: ' + fired + ' fired, ' + ok + ' succeeded, ' + (Number(stats.failed) || 0) + ' failed, ' +
        (Number(stats.expired) || 0) + ' expired, ' + (Number(stats.passed) || 0) + ' passed to Premiere.';
    }
    return mode + '; ' + runner + '.' + counts;
  }
  function engineIsActive() {
    var age = lastBridgePayload ? Number(lastBridgePayload.enginePollAgeMs) : -1;
    return isFinite(age) && age >= 0 && age < 3000;
  }
  function postCommandResult(command, ok, message, startedAt) {
    if (!command || command.seq === undefined || command.seq === null) return;
    try {
      var request = new XMLHttpRequest();
      request.open('POST', 'http://127.0.0.1:27389/result', true);
      request.setRequestHeader('Content-Type', 'application/json');
      request.send(JSON.stringify({ seq: Number(command.seq), ok: ok === true, message: String(message || '').slice(0, 2000), ms: Date.now() - startedAt }));
    } catch (_) {}
  }
  function formatAIFunctionResult(command, result) {
    if (result && result.saved_path) {
      return (result.imported ? 'Created and imported ' : 'Created ') + (result.subtitle_count || '') +
        (result.subtitle_count ? ' optimized subtitles. ' : 'optimized subtitles. ') + 'Saved ' + result.saved_path;
    }
    return 'Finished ' + command.name + '.';
  }
  function dispatchAIFunction(command, callback) {
    var frame = document.getElementById('prai-backend');
    var host = null;
    try { host = frame && frame.contentWindow && frame.contentWindow.prAIAgentHost; } catch (_) {}
    if (!host || typeof host.runAIFunction !== 'function') {
      callback('ERROR: Edie AI functions are still starting. Reopen the Edie panel if this continues.');
      return;
    }
    Promise.resolve(host.runAIFunction(command.id, {})).then(function (result) {
      callback(formatAIFunctionResult(command, result));
    }, function (error) {
      callback('ERROR: ' + String(error && error.message ? error.message : error));
    });
  }
  function dispatchCommand(command, payload, callback) {
    if (command && command.type === 'ai-function') { dispatchAIFunction(command, callback); return; }
    dispatchPremiereApply(payload, callback);
  }
  function startCommandPolling() {
    // The native listener owns localhost. Poll it from CEP instead of requiring Node in Premiere.
    if (window.__prfxCommandPolling) return;
    window.__prfxCommandPolling = true;
    window.__prfxCommandPollInFlight = false;
    safeInterval('command polling', function () {
      if (window.__prfxApplying || window.__prfxCommandPollInFlight) return;
      // The hidden engine extension (engine.js) runs shortcut commands while
      // it is alive. The panel only takes over if it stops polling, so the two
      // never race for the same queue.
      if (engineIsActive()) return;
      var request = new XMLHttpRequest();
      request.open('GET', 'http://127.0.0.1:27389/next?client=panel', true);
      request.timeout = 1500;
      window.__prfxCommandPollInFlight = true;
      function finishPoll() { window.__prfxCommandPollInFlight = false; }
      request.onreadystatechange = function () {
        if (request.readyState !== 4) return;
        finishPoll();
        if (request.status !== 200) return;
        try {
          var command = JSON.parse(request.responseText);
          if (!command) return;
          if (command.type === 'media-list') { sendMediaListToListener(); return; }
          window.__prfxApplying = true;
          var completed = false;
          var startedAt = Date.now();
          var hostWatchdog = window.setTimeout(function () {
            if (completed) return;
            completed = true;
            window.__prfxApplying = false;
            var late = 'Premiere did not answer the palette command in time. It may still be running — check the Timeline before retrying.';
            setStatus(late, true);
            postCommandResult(command, false, late, startedAt);
          }, (LONG_RUNNING_COMMANDS[command && command.id] || (command && (command.type === 'preset' || command.type === 'ai-function'))) ? 600000 : 12000);
          var payload = JSON.stringify({ type: command.type, id: command.id, name: command.name, presetUid: command.presetUid || '', mediaId: command.mediaId || '', transitionFrames: Number(command.transitionFrames) || Number(settings.transitionFrames) || 30, transitionPlacement: command.transitionPlacement || 'both', moveMode: command.moveMode || 'group', staggerFrames: commandNumber(command.staggerFrames, settings.staggerFrames, 5, 0, 9999), staggerGroup: commandNumber(command.staggerGroup, settings.staggerGroup, 1, 1, 999), exportNamePattern: settings.exportNamePattern || '{sequence} - {index}', mergeTouchingSameSource: settings.mergeTouchingSameSource === true, nameTolerance: settings.nameTolerance || 'normalized', failurePolicy: settings.failurePolicy || 'rollback', syntheticSeconds: settings.syntheticSeconds || 5 });
          dispatchCommand(command, payload, function (result) {
            if (completed) return;
            completed = true;
            window.clearTimeout(hostWatchdog);
            window.__prfxApplying = false;
            if (result === 'EvalScript error.') {
              hostResponsive = false;
              setStatus('Premiere host script did not respond. Use Force reconnect in General.', true);
              postCommandResult(command, false, 'Premiere host script did not respond.', startedAt);
              return;
            }
            hostResponsive = true;
            setStatus(result || ('Applied ' + command.name + '.'), result && result.indexOf('ERROR:') === 0);
            postCommandResult(command, !(result && result.indexOf('ERROR:') === 0), result, startedAt);
          });
        } catch (error) { window.__prfxApplying = false; rememberPanelError('palette command dispatch', error); }
      };
      request.ontimeout = request.onerror = finishPoll;
      try { request.send(); } catch (error) { finishPoll(); rememberPanelError('command polling send', error); }
    }, 250);
  }
  // The palette's Media search, when the engine isn't running: same as engine.js sendMediaList.
  function sendMediaListToListener() {
    window.__prfxApplying = true;
    evalPremiere('prfx.listProjectMedia()', function (result) {
      window.__prfxApplying = false;
      var text = String(result || '');
      if (text === 'EvalScript error.' || text.indexOf('ERROR:') === 0 || text.charAt(0) !== '{') {
        text = JSON.stringify({ error: text === 'EvalScript error.' || !text ? 'Premiere did not answer.' : text.replace(/^ERROR:\s*/, ''), items: [], total: 0 });
      }
      try {
        var request = new XMLHttpRequest();
        request.open('POST', 'http://127.0.0.1:27389/media', true);
        request.setRequestHeader('Content-Type', 'text/plain;charset=UTF-8');
        request.timeout = 5000;
        request.send(text);
      } catch (_) {}
    });
  }
  function syncPremiereCatalog(complete) {
    var extensionRoot = extensionFilesystemPath() || '';
    evalPremiere('prfx.getCatalog(' + JSON.stringify(extensionRoot) + ')', function (result) {
      if (result === 'EvalScript error.') {
        hostResponsive = false;
        var noResponse = 'Premiere host script did not respond.';
        setStatus(noResponse + (catalogReady ? ' Keeping the last complete catalog.' : ' Use Force reconnect.'), true);
        if (complete) complete(false, noResponse);
        return;
      }
      if (!result || result.indexOf('ERROR:') === 0) {
        hostResponsive = true;
        var hostError = result || 'Could not read Premiere’s Effects catalog.';
        setStatus(hostError + (catalogReady ? ' Keeping the last complete catalog.' : ''), true);
        if (complete) complete(false, hostError);
        return;
      }
      hostResponsive = true;
      try {
        var catalog = JSON.parse(result);
        if (!catalog || catalog.length < MINIMUM_COMPLETE_CATALOG) {
          var incomplete = 'Premiere returned only ' + (catalog ? catalog.length : 0) + ' catalog items; Edie kept the last complete catalog.';
          setStatus(incomplete, true);
          if (complete) complete(false, incomplete);
          return;
        }
        commands = functionCommands.concat(catalog);
        catalogReady = true;
        hostResponsive = true;
        try { localStorage.setItem(CATALOG_STORAGE_KEY, JSON.stringify(catalog)); } catch (_) {}
        renderManager();
        syncBridgeCatalog();
        if (complete) complete(true, commands.length + ' commands loaded.');
      } catch (_) {
        var unreadable = 'Premiere returned an unreadable Effects catalog.';
        setStatus(unreadable, true);
        if (complete) complete(false, unreadable);
      }
    });
  }
  function syncBridgeCatalog() {
    // CEP owns the complete registry: functions plus Premiere's live FX catalog.
    // The native palette receives this exact list and never builds its own subset.
    if (!catalogReady) return;
    if (bridgeCatalogSyncInFlight) return;
    try {
      var body = currentCatalogBody();
      var fingerprint = textFingerprint(body);
      if (lastBridgePayload && lastBridgePayload.catalogFingerprint === fingerprint && lastSentBridgeCatalogFingerprint === fingerprint) return;
      bridgeCatalogSyncInFlight = true;
      var request = new XMLHttpRequest();
      request.open('POST', 'http://127.0.0.1:27389/catalog', true);
      request.timeout = 5000;
      request.setRequestHeader('Content-Type', 'text/plain;charset=UTF-8');
      request.setRequestHeader('X-PRFX-Catalog-Fingerprint', fingerprint);
      request.onreadystatechange = function () {
        if (request.readyState !== 4) return;
        bridgeCatalogSyncInFlight = false;
        if (request.status >= 200 && request.status < 300) lastSentBridgeCatalogFingerprint = fingerprint;
      };
      request.ontimeout = request.onerror = function () { bridgeCatalogSyncInFlight = false; };
      request.send(body);
      lastBridgeCatalogSync = Date.now();
    } catch (_) { bridgeCatalogSyncInFlight = false; }
  }
  function restartNativeListener(complete) {
    var node = nodeModules();
    var root = extensionFilesystemPath();
    var app = listenerAppPath();
    if (!node || !root || !app) { complete('Could not locate the native listener app.'); return; }
    if (!node.fs.existsSync(app)) { complete('Native listener is not built yet. Use Install / Repair first.'); return; }
    var steps = IS_WINDOWS ? windowsListenerSteps() : [
      { label: 'clearing quarantine', command: '/usr/bin/xattr', args: ['-dr', 'com.apple.quarantine', app], optional: true },
      { label: 'quitting stale listener', command: '/bin/zsh', args: [root + '/native/stop-listener-macos.sh'], optional: true, timeout: 6000 }, // mac-only: IS_WINDOWS takes the other side
      { label: 'starting current listener', command: '/bin/zsh', args: [root + '/native/start-listener-macos.sh'], timeout: 10000 } // mac-only: IS_WINDOWS takes the other side
    ];
    var index = 0;
    function next() {
      if (index >= steps.length) {
        window.setTimeout(function () {
          readExpectedListenerBuild();
          checkBridge();
          complete('');
        }, 1200);
        return;
      }
      var step = steps[index++];
      setStatus('Restarting listener — ' + step.label + '…');
      runStep(step, function (error) {
        if (error && !step.optional) { complete('Listener restart stopped while ' + step.label + ': ' + error); return; }
        next();
      });
    }
    next();
  }
  function forceReconnectHost() {
    var root = extensionFilesystemPath();
    if (!root) { setStatus('Could not locate the Edie extension folder.', true); return; }
    var staleListener = listenerBuildIsStale(lastBridgePayload);
    var restartFirst = staleListener || !bridgeOnline;
    var finished = false;
    forceReconnectButton.disabled = true;
    function reconnectHost() {
      setStatus('Forcing Premiere host reload and catalog scan…');
      var watchdog = window.setTimeout(function () {
        if (finished) return;
        finished = true;
        hostResponsive = false;
        forceReconnectButton.disabled = false;
        setStatus('Premiere’s scripting engine is not responding. Save the project and restart Premiere once; the last complete catalog will be preserved.', true);
      }, 8000);
      evalHostFile(root + '/jsx/host.jsx', function (message, failed) {
        if (finished) return;
        if (failed) {
          finished = true;
          hostResponsive = false;
          window.clearTimeout(watchdog);
          forceReconnectButton.disabled = false;
          setStatus('Host reload failed: ' + message, true);
          return;
        }
        syncPremiereCatalog(function (ok, detail) {
          if (finished) return;
          finished = true;
          window.clearTimeout(watchdog);
          forceReconnectButton.disabled = false;
          if (ok) {
            hostResponsive = true;
            setStatus('Host reconnected. ' + detail);
            checkBridge();
          } else setStatus(detail + ' If Force reconnect cannot recover it, save and restart Premiere once.', true);
        });
      });
    }
    if (restartFirst) {
      setStatus(staleListener ? 'Running listener is stale. Restarting it…' : 'Listener is offline. Starting it…');
      restartNativeListener(function (error) {
        if (finished) return;
        if (error) {
          finished = true;
          forceReconnectButton.disabled = false;
          setStatus(error, true);
          return;
        }
        reconnectHost();
      });
    } else {
      reconnectHost();
    }
  }
  function setReconnectButtonsDisabled(disabled) {
    if (kickstartListenerButton) kickstartListenerButton.disabled = disabled;
    if (forceReconnectButton) forceReconnectButton.disabled = disabled;
  }
  function kickstartBridge() {
    var root = extensionFilesystemPath();
    if (!root) { setStatus('Could not locate the Edie extension folder.', true); return; }
    if (lastBridgePayload && lastBridgePayload.mode === 'modifier-only' && !listenerBuildIsStale(lastBridgePayload)) {
      setStatus(IS_WINDOWS
        ? 'Listener is healthy. ' + (lastBridgePayload.focus || 'Shift-only and plain-key shortcuts are paused') + '. Repair will not change this safe mode.'
        : 'Listener is healthy. Click the Timeline/Sequence panel once to arm Shift-only and plain-key shortcuts; Repair will not change this safe mode.');
      checkBridge();
      return;
    }
    setReconnectButtonsDisabled(true);
    setStatus('Kickstarting Edie — repairing listener, then reloading Premiere host…');
    setSetupDetail('Kickstart: repairing the native listener…');
    installListener(function (installError) {
      if (installError) {
        setReconnectButtonsDisabled(false);
        setStatus('Kickstart stopped: ' + installError, true);
        refreshSetupStatus();
        return;
      }
      var finished = false;
      setSetupDetail('Kickstart: reloading Premiere host and rebuilding the command catalog…');
      function finish(message, failed) {
        if (finished) return;
        finished = true;
        setReconnectButtonsDisabled(false);
        setStatus(message, failed);
        refreshSetupStatus();
        checkBridge();
      }
      var watchdog = window.setTimeout(function () {
        finish('Kickstart started the listener, but Premiere did not finish the host/catalog reload. Save and restart Premiere if the catalog still looks wrong.', true);
      }, 15000);
      evalHostFile(root + '/jsx/host.jsx', function (message, failed) {
        if (finished) return;
        if (failed) {
          window.clearTimeout(watchdog);
          hostResponsive = false;
          finish('Kickstart could not reload Premiere host: ' + message, true);
          return;
        }
        syncPremiereCatalog(function (ok, detail) {
          if (finished) return;
          window.clearTimeout(watchdog);
          syncListenerSettings();
          syncBridgeCatalog();
          hostResponsive = ok;
          finish(ok ? 'Kickstart complete. ' + detail : 'Kickstart started the listener, but catalog reload failed: ' + detail, !ok);
        });
      });
    });
  }
  function matchesShortcut(event) {
    var s = settings.shortcut;
    return shortcutCodeFromEvent(event) === s.code && event.ctrlKey === s.ctrl && event.altKey === s.alt && event.shiftKey === s.shift && event.metaKey === s.meta;
  }
  function shortcutCodeFromEvent(event) {
    var code = event.code || '';
    if (/^(Space|Key[A-Z]|Digit[0-9])$/.test(code)) return code;
    var keyCode = Number(event.keyCode || event.which || 0);
    if (keyCode === 32) return 'Space';
    if (keyCode >= 65 && keyCode <= 90) return 'Key' + String.fromCharCode(keyCode);
    if (keyCode >= 48 && keyCode <= 57) return 'Digit' + String(keyCode - 48);
    return '';
  }
  function shortcutFromEvent(event) {
    var code = shortcutCodeFromEvent(event);
    if (!code) return null;
    return {
      code: code,
      ctrl: !!event.ctrlKey || heldCaptureModifiers.ctrl,
      alt: !!event.altKey || !!(event.getModifierState && event.getModifierState('Alt')) || heldCaptureModifiers.alt,
      shift: !!event.shiftKey || heldCaptureModifiers.shift,
      meta: !!event.metaKey || heldCaptureModifiers.meta
    };
  }
  function captureModifier(event) {
    var key = event.key || '';
    var keyCode = Number(event.keyCode || event.which || 0);
    if (key === 'Control' || keyCode === 17) return 'ctrl';
    if (key === 'Alt' || key === 'AltGraph' || keyCode === 18) return 'alt';
    if (key === 'Shift' || keyCode === 16) return 'shift';
    if (key === 'Meta' || key === 'OS' || keyCode === 91 || keyCode === 93 || keyCode === 224) return 'meta';
    return '';
  }
  function captureShortcut(event, target) {
    event.preventDefault(); event.stopPropagation();
    var shortcut = shortcutFromEvent(event);
    if (!shortcut) return null;
    target.dataset.shortcut = JSON.stringify(shortcut);
    target.value = displayShortcut(shortcut);
    return shortcut;
  }
  function captureTarget() {
    var target = document.activeElement;
    return target === shortcutInput || target === managerShortcut ? target : null;
  }
  function handleShortcutCapture(event) {
    var target = captureTarget();
    if (!target) return;
    var modifier = captureModifier(event);
    if (modifier) {
      heldCaptureModifiers[modifier] = event.type !== 'keyup';
      event.preventDefault(); event.stopPropagation();
      return;
    }
    if (event.type !== 'keydown') return;
    var candidate = shortcutFromEvent(event);
    if (!candidate) {
      setStatus('Use Space, a letter, or a number with modifiers.', true);
      return;
    }
    // Shift-only/plain keys are allowed as bindings, but the native listener
    // only arms them after it can confirm the Timeline/Sequence panel.
    var bareKey = !candidate.ctrl && !candidate.alt && !candidate.meta;
    var shortcut = captureShortcut(event, target);
    if (!shortcut) {
      setStatus('Use Space, a letter, or a number with modifiers.', true);
      return;
    }
    if (target === shortcutInput) {
      settings.shortcut = shortcut;
      saveSettings();
      setStatus('Palette shortcut saved.');
      shortcutInput.blur();
    } else {
      setStatus(bareKey
        ? 'Shortcut captured. Click Save shortcut. Plain/Shift-only keys arm only after the Timeline/Sequence panel is clicked.'
        : 'Shortcut captured. Click Save shortcut.');
    }
    heldCaptureModifiers = { ctrl: false, alt: false, shift: false, meta: false };
  }
  // Offers the typed frame count first, then common steps, so the prompt works
  // whether you type an exact number or just pick one.
  function staggerFrameOptions() {
    var typed = Math.round(Number(search.value));
    var options = [], seen = {};
    function push(frames, label) {
      if (!(frames >= 0) || frames > 9999 || seen[frames]) return;
      seen[frames] = true;
      options.push({ type: 'stagger-frames', id: String(frames), name: label || (frames + ' frame' + (frames === 1 ? '' : 's') + ' per step') });
    }
    if (search.value !== '' && typed >= 0) push(typed);
    push(Math.max(0, Math.round(Number(settings.staggerFrames) || 5)), null);
    [2, 3, 5, 10, 15, 20, 30].forEach(function (frames) { push(frames); });
    return options;
  }
  function filteredCommands() {
    if (pendingTransitionCommand) return TRANSITION_PLACEMENTS;
    if (pendingMoveCommand) return MOVE_MODES;
    if (pendingStaggerCommand) return staggerFrameOptions();
    var query = search.value.toLowerCase().trim();
    return visibleCommands().filter(function (command) { return !query || (command.name + ' ' + command.type).toLowerCase().indexOf(query) !== -1; });
  }
  function inApplyMenu() { return !!(pendingTransitionCommand || pendingMoveCommand || pendingStaggerCommand); }
  function paletteColour(type) {
    if (type === 'transition' || type === 'transition-placement') return 'var(--hue-blue)';
    if (type === 'audio-transition') return 'var(--hue-cyan)';
    if (type === 'custom' || type === 'move-mode' || type === 'stagger-frames') return 'var(--accent)';
    if (type === 'preset' || type === 'ai-function') return 'var(--hue-purple)';
    if (type === 'recent') return 'var(--muted)';
    if (type === 'media') return 'var(--hue-pink)';
    return 'var(--hue-orange)';
  }
  function paletteIcon(name) { return '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">' + (PALETTE_ICONS[name] || PALETTE_ICONS.dot) + '</svg>'; }
  function highlightName(name, at, colour) {
    name = String(name || '');
    if (!at) return escapeHtml(name);
    return escapeHtml(name.slice(0, at[0])) + '<mark style="color:' + colour + '">' + escapeHtml(name.slice(at[0], at[1])) + '</mark>' + escapeHtml(name.slice(at[1]));
  }
  function loadPaletteRecent() {
    try { var saved = JSON.parse(localStorage.getItem(PALETTE_RECENT_KEY) || '{}'); return { commands: Array.isArray(saved.commands) ? saved.commands : [], media: Array.isArray(saved.media) ? saved.media : [] }; }
    catch (_) { return { commands: [], media: [] }; }
  }
  function rememberPalette(commandKeyValue, mediaId) {
    var recent = loadPaletteRecent();
    function bump(list, key) { if (!key) return list; return [key].concat(list.filter(function (k) { return k !== key; })).slice(0, 5); }
    recent.commands = bump(recent.commands, commandKeyValue);
    recent.media = bump(recent.media, mediaId);
    try { localStorage.setItem(PALETTE_RECENT_KEY, JSON.stringify(recent)); } catch (_) {}
  }
  function paletteRowKey(row) {
    if (!row) return '';
    if (row.kind === 'media') return paletteMedia[row.index] ? 'm:' + paletteMedia[row.index].id : '';
    if (row.kind === 'command') return paletteVisible[row.index] ? (inApplyMenu() ? 'a:' : 'c:') + commandKey(paletteVisible[row.index]) : '';
    return '';
  }
  function buildPaletteRows() {
    var query = search.value;
    if (inApplyMenu()) {
      paletteVisible = filteredCommands();
      paletteRows = paletteVisible.length ? paletteVisible.map(function (command, i) { return { kind: 'command', index: i, at: null }; }) : [{ kind: 'note', text: 'Nothing to choose.' }];
      return;
    }
    paletteVisible = visibleCommands();
    var recent = loadPaletteRecent();
    if (PS.isMediaCategory(paletteCategory)) { paletteRows = PS.mediaRows(paletteMedia, query, mediaLoading, mediaError, recent.media, paletteCategory); return; }
    var keys = {};
    var entries = paletteVisible.map(function (command, i) { keys[commandKey(command)] = i; return { type: command.type, name: command.name, index: i }; });
    var recentIndexes = recent.commands.map(function (key) { return keys[key]; }).filter(function (i) { return i !== undefined; });
    paletteRows = PS.commandRows(entries, query, recentIndexes);
  }
  // reset: pick the first row (the query changed); otherwise keep the chosen one where it can be found.
  function renderCommands(reset) {
    var keep = reset ? '' : paletteRowKey(paletteRows[activeIndex]);
    buildPaletteRows();
    var found = -1;
    if (keep) for (var k = 0; k < paletteRows.length; k++) if (paletteRowKey(paletteRows[k]) === keep) { found = k; break; }
    activeIndex = found !== -1 ? found : PS.firstSelectable(paletteRows, 0, 1);
    var menu = inApplyMenu();
    list.innerHTML = paletteRows.map(function (row, i) {
      if (row.kind === 'section') {
        var c = paletteColour(row.colour);
        return '<div class="palette-section" style="color:' + c + '">' + escapeHtml(row.title) + '<span class="count">' + row.count + '</span></div>';
      }
      if (row.kind === 'note') return '<p class="palette-note">' + escapeHtml(row.text) + '</p>';
      var active = i === activeIndex;
      var head = '<button type="button" class="palette-row' + (row.kind === 'media' ? ' media' : '') + (active ? ' is-active' : '') + '" role="option" id="palette-row-' + i + '" aria-selected="' + active + '" data-row="' + i + '">';
      if (row.kind === 'media') {
        var m = paletteMedia[row.index];
        return head + '<span class="icon" style="color:var(--hue-pink)">' + paletteIcon(PS.categoryOf(m) === 'bgm' ? 'bgm' : m.kind === 'video' || m.kind === 'audio' || m.kind === 'image' ? m.kind : 'other') + '</span>' +
          '<span class="text"><span class="name" title="' + escapeHtml(m.name) + '">' + highlightName(m.name, row.at, 'var(--hue-pink)') + '</span><span class="where">' + escapeHtml(PS.whereText(m)) + '</span></span>' +
          (m.ext ? '<span class="tag ext">' + escapeHtml(String(m.ext).toLowerCase()) + '</span>' : '') + '</button>';
      }
      var command = paletteVisible[row.index];
      var colour = paletteColour(command.type);
      var binding = menu ? null : bindingFor(command);
      return head + '<span class="icon" style="color:' + colour + '">' + paletteIcon(command.type) + '</span>' +
        '<span class="text"><span class="name" title="' + escapeHtml(command.name) + '">' + highlightName(command.name, row.at, colour) + '</span></span>' +
        (binding ? '<span class="tag key">' + escapeHtml(displayShortcut(binding.shortcut)) + '</span>' : '') + '</button>';
    }).join('');
    list.setAttribute('aria-activedescendant', activeIndex >= 0 ? 'palette-row-' + activeIndex : '');
    renderPaletteChrome();
    scrollActiveRowIntoView();
  }
  function scrollActiveRowIntoView() {
    var row = activeIndex >= 0 && document.getElementById('palette-row-' + activeIndex);
    if (!row) { if (PS.firstSelectable(paletteRows, 0, 1) === activeIndex) list.scrollTop = 0; return; }
    // The first item also shows the section name above it.
    if (activeIndex === PS.firstSelectable(paletteRows, 0, 1)) { list.scrollTop = 0; return; }
    var top = row.offsetTop, bottom = top + row.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top - 4;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight + 4;
  }
  function setActivePaletteRow(index) {
    if (index < 0 || index === activeIndex || !PS.selectable(paletteRows[index])) return;
    var old = document.getElementById('palette-row-' + activeIndex);
    if (old) { old.classList.remove('is-active'); old.setAttribute('aria-selected', 'false'); }
    activeIndex = index;
    var now = document.getElementById('palette-row-' + index);
    if (now) { now.classList.add('is-active'); now.setAttribute('aria-selected', 'true'); }
    list.setAttribute('aria-activedescendant', 'palette-row-' + index);
  }
  function renderPaletteChrome() {
    var menu = pendingTransitionCommand || pendingMoveCommand || pendingStaggerCommand;
    if (menu) {
      paletteTabs.innerHTML = '<span class="palette-menu-title" style="color:' + paletteColour(menu.type) + '">' + paletteIcon(menu.type) + '<span style="color:var(--text)">' + escapeHtml(menu.name) + '</span></span>' +
        '<span class="palette-tabs-hint">' + (pendingTransitionCommand ? 'Where it goes' : pendingMoveCommand ? 'How they move' : 'Frames per step') + '</span>';
      paletteFooter.textContent = '↑↓ choose · ↵ apply · ⇧↵ apply, keep open · esc back';
      return;
    }
    var query = search.value;
    var entries = paletteVisible.map(function (command, i) { return { type: command.type, name: command.name, index: i }; });
    var commandCount = PS.count(PS.commandRows(entries, query));
    var typed = !!query.replace(/^\s+|\s+$/g, '');
    function mediaCount(category) {
      if (mediaLoading && !paletteMedia.length) return '…';
      if (!mediaLoadedAt && !paletteMedia.length) return '';
      return String(typed ? PS.mediaHits(paletteMedia, query, category).length : PS.mediaCount(paletteMedia, category));
    }
    var TAB_ICONS = { commands: 'custom', media: 'image', video: 'video', audio: 'speaker', sfx: 'audio', bgm: 'bgm' };
    function tab(category, label, icon, count) {
      var active = paletteCategory === category;
      return '<button type="button" class="palette-tab ' + category + (category !== 'commands' ? ' media' : '') + (active ? ' is-active' : '') + (count === '0' || count === 0 ? ' is-empty' : '') + '" role="tab" aria-selected="' + active + '" data-category="' + category + '">' +
        paletteIcon(icon) + '<span>' + label + '</span>' + (count === '' ? '' : '<span class="count">' + count + '</span>') + '</button>';
    }
    paletteTabs.innerHTML = PS.categories.map(function (category) {
      return tab(category, PS.labels[category], TAB_ICONS[category], category === 'commands' ? commandCount : mediaCount(category));
    }).join('');
    var activeTab = paletteTabs.querySelector('.palette-tab.is-active');
    if (activeTab && activeTab.scrollIntoView) activeTab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    paletteFooter.textContent = PS.isMediaCategory(paletteCategory)
      ? '↑↓ choose · ↵ place at playhead · ⇧↵ place, keep open · Tab next · esc close'
      : '↑↓ choose · ↵ apply · ⇧↵ apply, keep open · Tab media · esc close';
    search.placeholder = palettePlaceholder();
    search.setAttribute('aria-label', search.placeholder.replace('…', ''));
  }
  function palettePlaceholder() {
    return { commands: 'Search commands…', media: 'Search media by name…', video: 'Search video…', audio: 'Search every sound…', sfx: 'Search sound effects, under 45 s…', bgm: 'Search ambience and music, 45 s or longer…' }[paletteCategory] || 'Search commands…';
  }
  // Tab goes to the next tab, Shift+Tab (back) to the one before; a click names the tab.
  function switchPaletteCategory(category, back) {
    if (inApplyMenu()) return;
    paletteCategory = category || (back ? PS.previous(paletteCategory) : PS.next(paletteCategory));
    if (PS.isMediaCategory(paletteCategory)) refreshMediaIfStale();
    renderCommands(true);
    search.focus();
  }
  // Same list the native palette gets through the engine (prfx.listProjectMedia), read straight from the host.
  function refreshMediaIfStale() {
    if (mediaLoading) return;
    if (mediaLoadedAt && Date.now() - mediaLoadedAt < 10000) return;
    mediaLoading = true;
    var requestId = ++mediaRequestId;
    var timer = window.setTimeout(function () {
      if (requestId !== mediaRequestId || !mediaLoading) return;
      mediaLoading = false; mediaRequestId++; window.__prfxApplying = false;
      paletteMedia = []; mediaLoadedAt = 0;
      mediaError = 'Premiere hasn’t answered. Close and reopen the Edie panel, then Tab here again.';
      if (!palette.classList.contains('is-hidden')) renderCommands();
    }, 15000);
    window.__prfxApplying = true;
    evalPremiere('prfx.listProjectMedia()', function (result) {
      if (requestId !== mediaRequestId) return;
      window.clearTimeout(timer);
      window.__prfxApplying = false;
      mediaLoading = false;
      var text = String(result || '');
      var data = null;
      if (text && text !== 'EvalScript error.' && text.indexOf('ERROR:') !== 0) { try { data = JSON.parse(text); } catch (_) { data = null; } }
      if (data && Array.isArray(data.items)) {
        paletteMedia = data.items;
        mediaError = data.error ? String(data.error).replace(/^ERROR:\s*/, '') : '';
        mediaLoadedAt = Date.now();
      } else {
        paletteMedia = [];
        mediaLoadedAt = 0;
        mediaError = text.indexOf('ERROR:') === 0 ? text.replace(/^ERROR:\s*/, '')
          : text === 'EvalScript error.' || !text ? 'Premiere did not answer. Close and reopen the Edie panel to reload it.'
          : 'Premiere sent a media list Edie couldn’t read.';
      }
      if (!palette.classList.contains('is-hidden')) renderCommands();
    });
  }
  function placeMedia(media, keepOpen) {
    if (!media) return;
    rememberPalette(null, media.id);
    apply({ type: 'custom', id: 'place-project-item', name: 'Place “' + media.name + '”', mediaId: media.id }, keepOpen);
  }
  // Enter, Shift+Enter or a click on row `index`.
  function choosePaletteRow(index, keepOpen) {
    var row = paletteRows[index];
    if (!PS.selectable(row)) return;
    if (row.kind === 'media') { placeMedia(paletteMedia[row.index], keepOpen); return; }
    var chosen = paletteVisible[row.index];
    if (pendingTransitionCommand) apply(Object.assign({}, pendingTransitionCommand, { transitionPlacement: chosen.id || 'both', transitionFrames: transitionFramesValue() }), keepOpen);
    else if (pendingMoveCommand) apply(Object.assign({}, pendingMoveCommand, { moveMode: chosen.id || 'group' }), keepOpen);
    else if (pendingStaggerCommand) apply(Object.assign({}, pendingStaggerCommand, { staggerFrames: Number(chosen.id) }), keepOpen);
    else { rememberPalette(commandKey(chosen), null); apply(chosen, keepOpen); }
  }
  function escapeHtml(value) {
    value = value === undefined || value === null ? '' : String(value);
    return value.replace(/[&<>'"]/g, function (char) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]; });
  }
  function openPalette() { palette.classList.remove('is-hidden'); hideApplyMenu(); paletteCategory = 'commands'; search.value = ''; activeIndex = -1; renderCommands(true); window.setTimeout(function () { search.focus(); }, 0); }
  function closePalette() { hideApplyMenu(); palette.classList.add('is-hidden'); }
  function isTransition(command) { return command && (command.type === 'transition' || command.type === 'audio-transition'); }
  function isMoveCommand(command) { return command && command.type === 'custom' && (command.id === 'move-selected-clips-up' || command.id === 'move-selected-clips-down'); }
  function isStaggerCommand(command) { return command && command.type === 'custom' && (command.id === 'stagger-ascending' || command.id === 'stagger-descending'); }
  function openTransitionMenu(command) {
    pendingTransitionCommand = command;
    catalogSearchValue = search.value;
    search.value = '';
    search.placeholder = 'Length in frames • CEP default ' + (Number(settings.transitionFrames) || 30);
    activeIndex = -1;
    renderCommands(true);
    window.setTimeout(function () { search.focus(); }, 0);
  }
  function openMoveMenu(command) {
    pendingMoveCommand = command;
    catalogSearchValue = search.value;
    search.value = '';
    search.placeholder = 'Choose move behavior';
    activeIndex = -1;
    renderCommands(true);
    window.setTimeout(function () { search.focus(); }, 0);
  }
  function openStaggerMenu(command) {
    pendingStaggerCommand = command;
    catalogSearchValue = search.value;
    search.value = '';
    search.placeholder = 'Frames per step • default ' + (Number(settings.staggerFrames) || 5);
    activeIndex = -1;
    renderCommands(true);
    window.setTimeout(function () { search.focus(); }, 0);
  }
  function hideApplyMenu() {
    pendingTransitionCommand = null;
    pendingMoveCommand = null;
    pendingStaggerCommand = null;
    search.value = catalogSearchValue;
    search.placeholder = palettePlaceholder();
  }
  function transitionFramesValue() {
    var value = Number(search.value);
    return value > 0 ? Math.min(300, Math.round(value)) : Number(settings.transitionFrames) || 30;
  }
  function apply(command, keepPaletteOpen) {
    if (!command) return;
    if (isTransition(command) && !command.transitionPlacement) { openTransitionMenu(command); return; }
    if (isMoveCommand(command) && !command.moveMode) { openMoveMenu(command); return; }
    if (isStaggerCommand(command) && command.staggerFrames === undefined) { openStaggerMenu(command); return; }
    var settled = false;
    var watchdog;
    function finish(result) {
      if (settled) return;
      settled = true;
      if (watchdog) window.clearTimeout(watchdog);
      if (result === 'EvalScript error.') { setStatus('Premiere host script did not respond. Reopen the Edie panel to reload it.', true); return; }
      if (result && result.indexOf('ERROR:') === 0) { setStatus(result.replace('ERROR: ', ''), true); refreshFailureLogStatus(); return; }
      setStatus(result || 'Applied ' + command.name + '.');
      if (keepPaletteOpen) {
        if (inApplyMenu()) { hideApplyMenu(); renderCommands(true); }
        window.setTimeout(function () { search.focus(); }, 0);
      } else closePalette();
    }
    setStatus('Applying ' + command.name + '…');
    var payload = JSON.stringify({ type: command.type, id: command.id, name: command.name, presetUid: command.presetUid || '', mediaId: command.mediaId || '', transitionFrames: Number(command.transitionFrames) || Number(settings.transitionFrames) || 30, transitionPlacement: command.transitionPlacement || 'both', moveMode: command.moveMode || 'group', staggerFrames: commandNumber(command.staggerFrames, settings.staggerFrames, 5, 0, 9999), staggerGroup: commandNumber(command.staggerGroup, settings.staggerGroup, 1, 1, 999), exportNamePattern: settings.exportNamePattern || '{sequence} - {index}', mergeTouchingSameSource: settings.mergeTouchingSameSource === true, nameTolerance: settings.nameTolerance || 'normalized', failurePolicy: settings.failurePolicy || 'rollback', syntheticSeconds: settings.syntheticSeconds || 5 });
    // Bulk replace and the place functions work clip by clip and legitimately
    // run for minutes. Timing them out at 12s reports failure for work that is
    // still running and will complete.
    var timeoutMs = (LONG_RUNNING_COMMANDS[command.id] || command.type === 'preset' || command.type === 'ai-function') ? 600000 : 12000;
    watchdog = window.setTimeout(function () {
      finish('ERROR: Premiere did not finish ' + command.name + ' within ' + Math.round(timeoutMs / 1000) +
        ' seconds. It may still be running — check the Timeline before retrying.');
    }, timeoutMs);
    dispatchCommand(command, payload, finish);
  }
  function setStatus(message, error) {
    var color = error ? 'var(--danger)' : 'var(--good)';
    var status = document.getElementById('status');
    if (status) { status.textContent = message; status.style.color = color; }
    if (commandStatus) { commandStatus.textContent = message; commandStatus.style.color = color; }
  }

  document.getElementById('open-palette').addEventListener('click', openPalette);
  if (failureLogButton) failureLogButton.addEventListener('click', openFailureLog);
  if (kickstartListenerButton) kickstartListenerButton.addEventListener('click', kickstartBridge);
  forceReconnectButton.addEventListener('click', forceReconnectHost);
  document.getElementById('reset-shortcut').addEventListener('click', function () { settings.shortcut = Object.assign({}, DEFAULTS.shortcut); saveSettings(); });
  managerSearch.addEventListener('input', renderManager);
  managerTypeTabs.addEventListener('click', function (event) { var tab = event.target.closest('[data-manager-type]'); if (!tab) return; managerType = tab.dataset.managerType; renderManager(); });
  document.querySelectorAll('[data-assignment-filter]').forEach(function (button) {
    button.addEventListener('click', function () {
      managerAssignmentFilter = button.dataset.assignmentFilter;
      document.querySelectorAll('[data-assignment-filter]').forEach(function (item) {
        var isActive = item === button;
        item.classList.toggle('is-active', isActive);
        item.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      });
      renderManager();
    });
  });
  managerList.addEventListener('click', function (event) {
    var row = event.target.closest('.manager-row'); if (!row) return;
    selectedManagerCommand = commands.filter(function (command) { return commandKey(command) === row.dataset.command; })[0] || null; renderManager();
  });
  [shortcutInput, managerShortcut].forEach(function (input) { input.readOnly = true; input.style.cursor = 'default'; });
  window.addEventListener('keydown', handleShortcutCapture, true);
  window.addEventListener('keyup', handleShortcutCapture, true);
  document.getElementById('perform-manager-command').addEventListener('click', function () {
    if (!selectedManagerCommand) return;
    apply(selectedManagerCommand);
  });
  document.getElementById('save-manager-shortcut').addEventListener('click', function () {
    var match = selectedManagerCommand;
    var shortcut;
    try { shortcut = JSON.parse(managerShortcut.dataset.shortcut || ''); } catch (_) {}
    if (!match || !shortcut) { setStatus('Choose a command and press a shortcut.', true); return; }
    settings.bindings = (settings.bindings || []).filter(function (binding) { return commandKey(binding.command) !== commandKey(match) && displayShortcut(binding.shortcut) !== displayShortcut(shortcut); });
    settings.bindings.push({ command: { type: match.type, id: match.id, name: match.name, moveMode: match.moveMode }, shortcut: shortcut });
    saveSettings(); setStatus('Command shortcut saved.');
  });
  document.getElementById('remove-manager-shortcut').addEventListener('click', function () {
    if (!selectedManagerCommand) return;
    settings.bindings = (settings.bindings || []).filter(function (binding) { return commandKey(binding.command) !== commandKey(selectedManagerCommand); }); saveSettings(); setStatus('Command shortcut removed.');
  });
  document.querySelectorAll('.settings-tab').forEach(function (tab) { tab.addEventListener('click', function () {
    document.querySelectorAll('.settings-tab').forEach(function (item) { item.classList.toggle('is-active', item === tab); });
    document.getElementById('chat-view').classList.toggle('is-hidden', tab.dataset.view !== 'chat');
    document.getElementById('commands-view').classList.toggle('is-hidden', tab.dataset.view !== 'commands');
    document.getElementById('general-view').classList.toggle('is-hidden', tab.dataset.view !== 'general');
    document.getElementById('sync-view').classList.toggle('is-hidden', tab.dataset.view !== 'sync');
  }); });
  document.getElementById('choose-sync-folder').addEventListener('click', function () {
    try {
      if (window.cep && window.cep.fs && window.cep.fs.showOpenDialog) {
        var result = window.cep.fs.showOpenDialog(true, true, 'Choose media folders');
        if (result && !result.err && result.data && result.data.length) { addSyncFolders(result.data); return; }
      }
    } catch (_) {}
    folderInput.click();
  });
  folderInput.addEventListener('change', function () { var sourcePaths = foldersFromFileList(folderInput.files); if (sourcePaths.length) addSyncFolders(sourcePaths); else setSyncStatus('Choose a folder containing supported media.', true); folderInput.value = ''; });
  ['dragenter', 'dragover'].forEach(function (eventName) { folderDropZone.addEventListener(eventName, function (event) { event.preventDefault(); folderDropZone.classList.add('is-dragging'); }); });
  ['dragleave', 'drop'].forEach(function (eventName) { folderDropZone.addEventListener(eventName, function (event) { event.preventDefault(); folderDropZone.classList.remove('is-dragging'); }); });
  folderDropZone.addEventListener('drop', function (event) { var sourcePaths = foldersFromFileList(event.dataTransfer && event.dataTransfer.files); if (sourcePaths.length) addSyncFolders(sourcePaths); else setSyncStatus('Drop folders, not individual files.', true); });
  folderDropZone.addEventListener('click', function (event) { if (event.target.id !== 'choose-sync-folder') document.getElementById('choose-sync-folder').click(); });
  folderDropZone.addEventListener('keydown', function (event) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); document.getElementById('choose-sync-folder').click(); } });
  folderList.addEventListener('click', function (event) {
    var button = event.target.closest('.remove-sync-folder'); if (!button) return;
    var row = button.closest('.sync-folder-row'); if (!row) return;
    settings.folderSyncsByProject[projectSyncKey] = activeFolderSyncs().filter(function (folder) { return folder.sourcePath !== row.dataset.syncPath; });
    delete folderSnapshots[row.dataset.syncPath]; saveSettings(); renderFolderSyncs(); setSyncStatus('Folder sync stopped. Existing Premiere items were kept.');
  });
  document.getElementById('sync-all-folders').addEventListener('click', function () { syncAllFolders(true); });
  durationInput.addEventListener('change', function () { settings.transitionFrames = Math.max(1, Math.min(300, Number(durationInput.value) || 30)); saveSettings(); });
  staggerFramesInput.addEventListener('change', function () { settings.staggerFrames = Math.max(0, Math.min(9999, Math.round(Number(staggerFramesInput.value) || 0))); saveSettings(); });
  staggerGroupInput.addEventListener('change', function () { settings.staggerGroup = Math.max(1, Math.min(999, Math.round(Number(staggerGroupInput.value) || 1))); saveSettings(); });
  if (syntheticDurationInput) syntheticDurationInput.addEventListener('change', function () {
    var value = Number(syntheticDurationInput.value);
    settings.syntheticSeconds = value > 0 ? Math.min(600, value) : 5;
    syntheticDurationInput.value = settings.syntheticSeconds;
    saveSettings();
  });
  if (showSystemInput) showSystemInput.addEventListener('change', function () {
    settings.showSystemCommands = showSystemInput.checked === true;
    saveSettings();
    renderManager();
    // Force a re-send: the native palette caches by fingerprint, so without
    // clearing it the change would not reach the standalone palette until some
    // other catalog change happened to occur.
    lastSentBridgeCatalogFingerprint = '';
    syncBridgeCatalog();
  });
  if (shortcutFeedbackInput) shortcutFeedbackInput.addEventListener('change', function () {
    var value = shortcutFeedbackInput.value;
    settings.shortcutFeedback = value === 'all' || value === 'off' ? value : 'problems';
    saveSettings();
  });
  if (failurePolicyInput) failurePolicyInput.addEventListener('change', function () {
    settings.failurePolicy = failurePolicyInput.value === 'keep' ? 'keep' : 'rollback';
    saveSettings();
  });
  if (nameToleranceInput) nameToleranceInput.addEventListener('change', function () {
    settings.nameTolerance = nameToleranceInput.value || 'normalized';
    saveSettings();
  });
  if (mergeTouchingInput) mergeTouchingInput.addEventListener('change', function () {
    settings.mergeTouchingSameSource = mergeTouchingInput.checked === true;
    saveSettings();
  });
  if (exportNameInput) exportNameInput.addEventListener('change', function () {
    settings.exportNamePattern = String(exportNameInput.value || '').replace(/^\s+|\s+$/g, '') || '{sequence} - {index}';
    exportNameInput.value = settings.exportNamePattern;
    saveSettings();
  });
  search.addEventListener('input', function () { renderCommands(!inApplyMenu()); });
  paletteTabs.addEventListener('mousedown', function (event) { var tab = event.target.closest('[data-category]'); if (!tab) return; event.preventDefault(); switchPaletteCategory(tab.dataset.category); });
  list.addEventListener('mousemove', function (event) { var row = event.target.closest('[data-row]'); if (row) setActivePaletteRow(Number(row.dataset.row)); });
  list.addEventListener('click', function (event) {
    var target = event.target.closest('[data-row]'); if (!target) return;
    choosePaletteRow(Number(target.dataset.row), event.shiftKey);
  });
  document.addEventListener('click', function (event) { if (event.target.hasAttribute('data-close-palette')) closePalette(); });
  document.addEventListener('keydown', function (event) {
    if (matchesShortcut(event) && document.activeElement !== shortcutInput) { event.preventDefault(); openPalette(); return; }
    if (palette.classList.contains('is-hidden')) return;
    if (event.key === 'Escape') { event.preventDefault(); if (inApplyMenu()) { hideApplyMenu(); renderCommands(true); search.focus(); } else closePalette(); return; }
    if (event.key === 'Tab') { event.preventDefault(); switchPaletteCategory(null, event.shiftKey); return; }
    var step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : event.key === 'PageDown' ? 8 : event.key === 'PageUp' ? -8 : 0;
    if (step) { event.preventDefault(); var next = PS.move(paletteRows, activeIndex, step); if (next >= 0) { setActivePaletteRow(next); scrollActiveRowIntoView(); } return; }
    if (event.key === 'Enter' && document.activeElement === search) { event.preventDefault(); choosePaletteRow(activeIndex, event.shiftKey); }
  });

  safeRun('initial UI render', updateShortcutUI);
  safeRun('listener settings sync', syncListenerSettings);
  safeRun('failure log status', refreshFailureLogStatus);
  safeRun('command polling startup', startCommandPolling);
  safeRun('setup status refresh', refreshSetupStatus);
  safeRun('initial bridge check', checkBridge);
  safeInterval('bridge check', checkBridge, 2000);
  safeRun('host reload', function () {
    reloadHostScript(function () {
      safeRun('initial catalog sync', syncPremiereCatalog);
      safeRun('initial project sync context', loadProjectSyncContext);
    });
  });
  safeInterval('catalog sync', syncPremiereCatalog, 30000);
  safeInterval('project sync context', loadProjectSyncContext, 7500);
  safeInterval('folder sync', function () { syncAllFolders(false, true); }, AUTO_FOLDER_SYNC_INTERVAL_MS);
}());
