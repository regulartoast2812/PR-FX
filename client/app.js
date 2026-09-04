(function () {
  'use strict';

  var STORAGE_KEY = 'prfx.palette.settings.v1';
  var CATALOG_STORAGE_KEY = 'prfx.palette.catalog.v1';
  var PANEL_ERROR_STORAGE_KEY = 'prfx.palette.panel-errors.v1';
  var AUTO_FOLDER_SYNC_INTERVAL_MS = 30000;
  var MINIMUM_COMPLETE_CATALOG = 25;
  var PRFX_HOST_BUILD = '20260903-place-make-room-1';
  var RETIRED_COMMAND_IDS = { 'stretch-speed-to-playhead': true };
  var DEFAULTS = { shortcut: { code: 'Space', ctrl: true, alt: false, shift: false, meta: false }, transitionFrames: 30, staggerFrames: 5, staggerGroup: 1, exportNamePattern: '{sequence} - {index}', mergeTouchingSameSource: false, nameTolerance: 'normalized', failurePolicy: 'rollback', bindings: [], folderSyncsByProject: {} };
  var commands = [
    { type: 'custom', id: 'dump-qe-api', name: '[System] Dump QE + DOM API' },
    { type: 'custom', id: 'inspect-selected-clip', name: '[System] Inspect Selected Clip' },
    { type: 'custom', id: 'failure-report', name: '[System] Failure Report' },
    { type: 'custom', id: 'clear-failure-ledger', name: '[System] Clear Failure Ledger' },
    { type: 'custom', id: 'undo-last-palette-action', name: 'Undo Last PR FX Effect Apply' },
    { type: 'custom', id: 'remove-transitions', name: 'Remove Transitions on Selected Clips' },
    { type: 'custom', id: 'move-selected-clips-up', name: 'Move Selected Clips Up as Group', moveMode: 'group' },
    { type: 'custom', id: 'move-selected-clips-up', name: 'Move Selected Clips Up Individually', moveMode: 'individual' },
    { type: 'custom', id: 'move-selected-clips-down', name: 'Move Selected Clips Down as Group', moveMode: 'group' },
    { type: 'custom', id: 'move-selected-clips-down', name: 'Move Selected Clips Down Individually', moveMode: 'individual' },
    { type: 'custom', id: 'pull-group-in', name: 'Pull Group In to Playhead' },
    { type: 'custom', id: 'pull-group-out', name: 'Pull Group Out to Playhead' },
    { type: 'custom', id: 'retract-speed-in-to-playhead', name: 'Retract Speed In to Playhead' },
    { type: 'custom', id: 'retract-speed-out-to-playhead', name: 'Retract Speed Out to Playhead' },
    { type: 'custom', id: 'undo-last-prfx-action', name: 'Undo Last PR FX Action (Any)' },
    { type: 'custom', id: 'undo-last-arrange', name: 'Undo Last PR FX Arrange Action' },
    { type: 'custom', id: 'redo-last-arrange', name: 'Redo Last PR FX Arrange Action' },
    { type: 'custom', id: 'adjustment-layer-over-selection', name: 'Adjustment Layer Over Selection' },
    { type: 'custom', id: 'perfect-pitch', name: 'Perfect Pitch (Correct Speed Transposition)' },
    { type: 'custom', id: 'place-source-clip', name: 'Place Source Monitor Clip at Playhead' },
    { type: 'custom', id: 'place-bin-clips', name: 'Place Bin Clips at Playhead in Row' },
    { type: 'custom', id: 'place-bin-clips-column', name: 'Place Bin Clips at Playhead in Column' },
    { type: 'custom', id: 'replace-from-bin', name: 'Replace Selected Clips from Bin' },
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
    'bulk-replace-by-name': true, 'bulk-replace-preview': true, 'replace-from-bin': true,
    'place-bin-clips': true, 'place-bin-clips-column': true, 'place-source-clip': true, 'queue-cuts-to-ame': true, 'adjustment-layer-over-selection': true,
    'dump-qe-api': true, 'inspect-selected-clip': true
  };
  var functionCommands = commands.filter(function (command) { return command.type === 'custom'; });
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
  var activeIndex = 0;
  var palette = document.getElementById('palette');
  var search = document.getElementById('command-search');
  var list = document.getElementById('command-list');
  var paletteTitle = document.getElementById('palette-title');
  var shortcutBadge = document.getElementById('shortcut-badge');
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
  var managerSearch = document.getElementById('command-manager-search');
  var managerTypeFilter = document.getElementById('command-type-filter');
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

  window.addEventListener('error', function (event) {
    rememberPanelError('error', (event && (event.error || event.message)) || 'Unknown error');
    return true;
  });
  window.addEventListener('unhandledrejection', function (event) {
    rememberPanelError('promise rejection', event && event.reason);
  });

  function loadSettings() {
    try {
      var loaded = Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(STORAGE_KEY)) || {});
      if (!loaded.folderSyncsByProject || typeof loaded.folderSyncsByProject !== 'object') loaded.folderSyncsByProject = {};
      loaded.staggerFrames = Math.max(0, Math.min(9999, Math.round(Number(loaded.staggerFrames) || 0)));
      loaded.staggerGroup = Math.max(1, Math.min(999, Math.round(Number(loaded.staggerGroup) || 1)));
      if (Array.isArray(loaded.folderSyncs) && loaded.folderSyncs.length && !loaded.folderSyncsByProject.__legacy__) loaded.folderSyncsByProject.__legacy__ = loaded.folderSyncs;
      delete loaded.folderSyncs;
      loaded.bindings = (loaded.bindings || []).filter(function (binding) { return !(binding.command && RETIRED_COMMAND_IDS[binding.command.id]); });
      loaded.bindings.forEach(function (binding) {
        if (binding.command.id === 'undo-last-palette-action') binding.command.name = 'Undo Last PR FX Effect Apply';
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
    if (s.ctrl) parts.push('Ctrl'); if (s.alt) parts.push('Alt'); if (s.shift) parts.push('Shift'); if (s.meta) parts.push('Cmd');
    parts.push(s.code === 'Space' ? 'Space' : s.code.replace(/^Key|^Digit/, ''));
    return parts.join(' + ');
  }
  function updateShortcutUI() {
    shortcutInput.value = displayShortcut(settings.shortcut);
    shortcutBadge.textContent = displayShortcut(settings.shortcut);
    durationInput.value = settings.transitionFrames;
    staggerFramesInput.value = settings.staggerFrames;
    staggerGroupInput.value = settings.staggerGroup;
    if (exportNameInput) exportNameInput.value = settings.exportNamePattern || '{sequence} - {index}';
    if (mergeTouchingInput) mergeTouchingInput.checked = settings.mergeTouchingSameSource === true;
    if (nameToleranceInput) nameToleranceInput.value = settings.nameTolerance || 'normalized';
    if (failurePolicyInput) failurePolicyInput.value = settings.failurePolicy || 'rollback';
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
  function renderManager() {
    var query = (managerSearch.value || '').toLowerCase().trim();
    var typeFilter = managerTypeFilter.value;
    var available = commands.filter(function (command) {
      var binding = bindingFor(command);
      if (query && (command.name + ' ' + command.type).toLowerCase().indexOf(query) === -1) return false;
      if (typeFilter !== 'all' && command.type !== typeFilter) return false;
      if (managerAssignmentFilter === 'assigned' && !binding) return false;
      if (managerAssignmentFilter === 'unassigned' && binding) return false;
      return true;
    });
    if (!available.length) selectedManagerCommand = null;
    else if (!selectedManagerCommand || !available.some(function (command) { return commandKey(command) === commandKey(selectedManagerCommand); })) selectedManagerCommand = available[0];
    document.getElementById('command-count').textContent = available.length + ' command' + (available.length === 1 ? '' : 's');
    managerList.innerHTML = available.map(function (command) {
      var binding = bindingFor(command);
      var type = command.type === 'custom' ? 'function' : command.type;
      return '<div class="manager-row' + (selectedManagerCommand && commandKey(command) === commandKey(selectedManagerCommand) ? ' is-active' : '') + '" data-command="' + escapeHtml(commandKey(command)) + '"><span class="manager-name">' + escapeHtml(command.name) + '</span><span class="manager-kind ' + escapeHtml(command.type) + '">' + escapeHtml(type) + '</span><span class="manager-shortcut">' + escapeHtml(binding ? displayShortcut(binding.shortcut) : '—') + '</span></div>';
    }).join('');
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
    // The native listener reads this file so it can receive shortcuts while Premiere is frontmost.
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
      var temp = path.join(dir, 'settings.' + process.pid + '.' + Date.now() + '.tmp');
      fs.writeFileSync(temp, JSON.stringify(settings), 'utf8');
      fs.renameSync(temp, target);
    } catch (_) {}
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
    failureLogStatus.style.color = error ? '#ff9f9f' : '#8f8f8f';
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
    syncStatus.style.color = error ? '#ff9f9f' : '#a8d7a8';
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
  function addSyncFolder(sourcePath) {
    var modules = nodeModules();
    if (!modules || !sourcePath) { setSyncStatus('Folder access is unavailable in this CEP panel.', true); return; }
    try {
      sourcePath = modules.path.resolve(sourcePath);
      if (!modules.fs.statSync(sourcePath).isDirectory()) { setSyncStatus('Choose a folder, not an individual file.', true); return; }
      if (!projectSyncKey) { setSyncStatus('Open a project before adding a synced folder.', true); return; }
      if (activeFolderSyncs().some(function (folder) { return folder.sourcePath === sourcePath; })) { setSyncStatus('That folder is already being synced for this project.'); return; }
      var sourceName = modules.path.basename(sourcePath) || 'Media';
      activeFolderSyncs().push({ sourcePath: sourcePath, binName: uniqueSyncBinName(sourceName) });
      saveSettings(); renderFolderSyncs(); setSyncStatus('Watching ' + sourceName + ' in ' + projectSyncName + '…'); syncFolderMapping(activeFolderSyncs()[activeFolderSyncs().length - 1], true);
    } catch (error) { setSyncStatus('Could not add folder: ' + error.message, true); }
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
  function folderFromFileList(fileList) {
    var modules = nodeModules();
    if (!modules || !fileList || !fileList.length) return '';
    var first = fileList[0], rawPath = first.path || '';
    if (!rawPath) return '';
    try {
      if (modules.fs.statSync(rawPath).isDirectory()) return rawPath;
      var relative = first.webkitRelativePath || '';
      if (!relative) return modules.path.dirname(rawPath);
      return rawPath.slice(0, rawPath.length - relative.length).replace(/[\\/]$/, '');
    } catch (_) { return ''; }
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
    if (!root) { callback('ERROR: Could not locate the PR FX extension folder.'); return; }
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
    evalPremiere("typeof prfx !== 'undefined' && prfx.HOST_BUILD===" + JSON.stringify(PRFX_HOST_BUILD) + " && typeof prfx.apply === 'function' ? 'PR FX host loaded.' : 'ERROR: PR FX host did not load.'", function (status) {
      hostResponsive = status !== 'EvalScript error.' && !(status && status.indexOf('ERROR:') === 0);
      if (status === 'EvalScript error.') setStatus('PR FX host did not respond after reload. Use Force reconnect.', true);
      else if (status && status.indexOf('ERROR:') === 0) setStatus(status.replace('ERROR: ', ''), true);
      else { setStatus('PR FX host loaded.'); checkHostFreshness(); }
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
    return root ? root + '/native/build/PR FX Shortcut Listener.app' : '';
  }
  function listenerBuildMarkerPath() {
    var root = extensionFilesystemPath();
    return root ? root + '/native/build/listener-build.txt' : '';
  }
  function launchAgentPath() {
    var os = nodeOs();
    return os ? os.homedir() + '/Library/LaunchAgents/com.prfx.shortcut-listener.plist' : '';
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
    var app = listenerAppPath();
    var agent = launchAgentPath();
    setSetupCheck('listener', !!(app && node.fs.existsSync(app)));
    setSetupCheck('autostart', !!(agent && node.fs.existsSync(agent)));
    setSetupCheck('running', bridgeOnline === true);
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
      setStatus('Could not locate the PR FX extension folder.', true);
      if (done) done('Could not locate the PR FX extension folder.');
      return;
    }
    setupInstallButton.disabled = true;
    setSetupDetail('Installing…');

    var steps = [];
    if (node.fs.existsSync(root + '/native/build-macos.sh')) {
      // On soft-launch machines this validates and uses the bundled app. On a
      // dev machine it can still rebuild when the bundled app is missing/stale.
      steps.push({ label: 'checking the bundled listener', command: '/bin/zsh', args: [root + '/native/build-macos.sh'], timeout: 120000 });
    }
    // The app arrives inside the extension rather than as a download, but
    // clear any quarantine flag anyway or Gatekeeper blocks the first launch.
    steps.push({ label: 'clearing quarantine', command: '/usr/bin/xattr', args: ['-dr', 'com.apple.quarantine', app], optional: true });
    steps.push({ label: 'installing autostart', command: '/bin/zsh', args: [root + '/native/install-autostart-macos.sh'] });
    steps.push({ label: 'quitting stale listener', command: '/bin/zsh', args: [root + '/native/stop-listener-macos.sh'], optional: true, timeout: 6000 });
    steps.push({ label: 'starting the listener', command: '/bin/zsh', args: [root + '/native/start-listener-macos.sh'] });

    var index = 0;
    function next() {
      if (index >= steps.length) {
        setupInstallButton.disabled = false;
        setSetupDetail('Installed. Shortcuts arm when Premiere is frontmost; restart Premiere if the running listener is stale.');
        window.setTimeout(refreshSetupStatus, 1200);
        if (done) done('');
        return;
      }
      var step = steps[index++];
      setSetupDetail('Installing — ' + step.label + '…');
      runSetupStep(step.command, step.args, function (error) {
        if (error && !step.optional) {
          setupInstallButton.disabled = false;
          setSetupDetail('Install stopped while ' + step.label + ': ' + error);
          refreshSetupStatus();
          if (done) done('Install stopped while ' + step.label + ': ' + error);
          return;
        }
        next();
      }, step.timeout);
    }
    next();
  }

  function setSetupDetail(text) { if (setupDetail) setupDetail.textContent = text; }

  if (setupInstallButton) setupInstallButton.addEventListener('click', installListener);
  if (setupAccessibilityButton) setupAccessibilityButton.addEventListener('click', function () {
    runSetupStep('/usr/bin/open', ['x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'], function (error) {
      if (error) setSetupDetail('Could not open System Settings: ' + error);
      else setSetupDetail('Accessibility is optional now. Shortcuts use Premiere-frontmost mode even if macOS reports the listener as untrusted.');
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
      if (payload.accessibilityTrusted === false && payload.accessibilityBypassed !== true && savedBindings > 0 && payload.mode !== 'active') {
        bridgeState.className = 'bridge-state is-checking'; bridgeState.innerHTML = '<i></i>Needs Accessibility';
        bridgeDetail.textContent = 'Ctrl+Space can open the palette, but ' + savedBindings + ' saved command ' + shortcutWord + ' are paused until macOS Accessibility is enabled for PR FX Shortcut Listener.';
      } else if (payload.mode === 'active') {
        if (hostResponsive) {
          bridgeState.className = 'bridge-state is-active'; bridgeState.innerHTML = '<i></i>Active';
          bridgeDetail.textContent = (payload.accessibilityBypassed === true
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
        bridgeDetail.textContent = 'Listener is healthy. Ctrl/Option/Cmd command shortcuts are armed: ' + armedBindings + '/' + savedBindings + ' command ' + shortcutWord + '. Shift-only and plain-key shortcuts stay paused until the Timeline/Sequence panel is clicked, so typing in bins is safe. Repair will not change this state.';
      } else if (payload.mode === 'palette-only') {
        bridgeState.className = 'bridge-state is-checking'; bridgeState.innerHTML = '<i></i>Palette only';
        bridgeDetail.textContent = payload.accessibilityBypassed === true ? 'Ctrl+Space can open the palette while Premiere is frontmost.' : 'Ctrl+Space can open the palette while Premiere is frontmost. Command shortcuts are paused until Accessibility is enabled.';
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
      if (expectedBuild || payload.listenerBuild) {
        catalogHealth.textContent = (catalogReady ? commands.length + ' live/cached commands ready' : commands.length + ' fallback commands only') +
          ' · listener ' + shortBuild(payload.listenerBuild || expectedBuild || 'unknown') +
          (savedBindings ? ' · ' + armedBindings + '/' + savedBindings + ' shortcuts armed' : '');
      }
      if (catalogReady && Number(payload.catalogCount) !== commands.length && Date.now() - lastBridgeCatalogSync > 900) syncBridgeCatalog();
    };
    request.ontimeout = request.onerror = function () { bridgeOnline = false; lastBridgePayload = null; bridgeState.className = 'bridge-state is-offline'; bridgeState.innerHTML = '<i></i>Offline'; bridgeDetail.textContent = 'The native listener is not responding.'; };
    try { request.send(); } catch (_) {}
  }
  function startCommandPolling() {
    // The native listener owns localhost. Poll it from CEP instead of requiring Node in Premiere.
    if (window.__prfxCommandPolling) return;
    window.__prfxCommandPolling = true;
    window.__prfxCommandPollInFlight = false;
    safeInterval('command polling', function () {
      if (window.__prfxApplying || window.__prfxCommandPollInFlight) return;
      var request = new XMLHttpRequest();
      request.open('GET', 'http://127.0.0.1:27389/next', true);
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
          window.__prfxApplying = true;
          var completed = false;
          var hostWatchdog = window.setTimeout(function () {
            if (completed) return;
            completed = true;
            window.__prfxApplying = false;
            setStatus('Premiere did not answer the palette command in time. It may still be running — check the Timeline before retrying.', true);
          }, LONG_RUNNING_COMMANDS[command && command.id] ? 600000 : 12000);
          var payload = JSON.stringify({ type: command.type, id: command.id, name: command.name, presetUid: command.presetUid || '', transitionFrames: Number(command.transitionFrames) || Number(settings.transitionFrames) || 30, transitionPlacement: command.transitionPlacement || 'both', moveMode: command.moveMode || 'group', staggerFrames: commandNumber(command.staggerFrames, settings.staggerFrames, 5, 0, 9999), staggerGroup: commandNumber(command.staggerGroup, settings.staggerGroup, 1, 1, 999), exportNamePattern: settings.exportNamePattern || '{sequence} - {index}', mergeTouchingSameSource: settings.mergeTouchingSameSource === true, nameTolerance: settings.nameTolerance || 'normalized', failurePolicy: settings.failurePolicy || 'rollback' });
          dispatchPremiereApply(payload, function (result) {
            if (completed) return;
            completed = true;
            window.clearTimeout(hostWatchdog);
            window.__prfxApplying = false;
            if (result === 'EvalScript error.') {
              hostResponsive = false;
              setStatus('Premiere host script did not respond. Use Force reconnect in General.', true);
              return;
            }
            hostResponsive = true;
            setStatus(result || ('Applied ' + command.name + '.'), result && result.indexOf('ERROR:') === 0);
          });
        } catch (error) { window.__prfxApplying = false; rememberPanelError('palette command dispatch', error); }
      };
      request.ontimeout = request.onerror = finishPoll;
      try { request.send(); } catch (error) { finishPoll(); rememberPanelError('command polling send', error); }
    }, 250);
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
          var incomplete = 'Premiere returned only ' + (catalog ? catalog.length : 0) + ' catalog items; PR FX kept the last complete catalog.';
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
    try {
      var request = new XMLHttpRequest();
      request.open('POST', 'http://127.0.0.1:27389/catalog', true);
      request.setRequestHeader('Content-Type', 'text/plain;charset=UTF-8');
      request.send(JSON.stringify(commands));
      lastBridgeCatalogSync = Date.now();
    } catch (_) {}
  }
  function restartNativeListener(complete) {
    var node = nodeModules();
    var root = extensionFilesystemPath();
    var app = listenerAppPath();
    if (!node || !root || !app) { complete('Could not locate the native listener app.'); return; }
    if (!node.fs.existsSync(app)) { complete('Native listener is not built yet. Use Install / Repair first.'); return; }
    var steps = [
      { label: 'clearing quarantine', command: '/usr/bin/xattr', args: ['-dr', 'com.apple.quarantine', app], optional: true },
      { label: 'quitting stale listener', command: '/bin/zsh', args: [root + '/native/stop-listener-macos.sh'], optional: true, timeout: 6000 },
      { label: 'starting current listener', command: '/bin/zsh', args: [root + '/native/start-listener-macos.sh'], timeout: 10000 }
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
      runSetupStep(step.command, step.args, function (error) {
        if (error && !step.optional) { complete('Listener restart stopped while ' + step.label + ': ' + error); return; }
        next();
      }, step.timeout);
    }
    next();
  }
  function forceReconnectHost() {
    var root = extensionFilesystemPath();
    if (!root) { setStatus('Could not locate the PR FX extension folder.', true); return; }
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
    if (!root) { setStatus('Could not locate the PR FX extension folder.', true); return; }
    if (lastBridgePayload && lastBridgePayload.mode === 'modifier-only' && !listenerBuildIsStale(lastBridgePayload)) {
      setStatus('Listener is healthy. Click the Timeline/Sequence panel once to arm Shift-only and plain-key shortcuts; Repair will not change this safe mode.');
      checkBridge();
      return;
    }
    setReconnectButtonsDisabled(true);
    setStatus('Kickstarting PR FX — repairing listener, then reloading Premiere host…');
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
    // Modifier-less keys are allowed in the Accessibility-free mode. They can
    // fire anywhere Premiere is frontmost, so the UI needs to be honest about
    // that instead of promising Timeline-only protection.
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
        ? 'Shortcut captured. Click Save shortcut. Plain/Shift-only keys fire while Premiere is frontmost.'
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
    return commands.filter(function (command) { return !query || (command.name + ' ' + command.type).toLowerCase().indexOf(query) !== -1; });
  }
  function renderCommands() {
    var available = filteredCommands();
    activeIndex = Math.max(0, Math.min(activeIndex, available.length - 1));
    list.innerHTML = available.length ? available.map(function (command, i) {
      var kind = command.type === 'custom' || command.type === 'move-mode' || command.type === 'stagger-frames' ? 'function' : command.type === 'transition-placement' ? 'transition' : command.type;
      return '<button class="command' + (i === activeIndex ? ' is-active' : '') + '" role="option" aria-selected="' + (i === activeIndex) + '" data-name="' + escapeHtml(command.name) + '" data-id="' + escapeHtml(command.id || '') + '" data-move-mode="' + escapeHtml(command.moveMode || '') + '" data-type="' + command.type + '"><span class="command-name">' + escapeHtml(command.name) + '</span><span class="command-kind ' + escapeHtml(kind) + '">' + kind + '</span></button>';
    }).join('') : '<p class="muted">No matching command.</p>';
  }
  function escapeHtml(value) {
    value = value === undefined || value === null ? '' : String(value);
    return value.replace(/[&<>'"]/g, function (char) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]; });
  }
  function openPalette() { palette.classList.remove('is-hidden'); hideApplyMenu(); search.value = ''; activeIndex = 0; renderCommands(); window.setTimeout(function () { search.focus(); }, 0); }
  function closePalette() { hideApplyMenu(); palette.classList.add('is-hidden'); }
  function isTransition(command) { return command && (command.type === 'transition' || command.type === 'audio-transition'); }
  function isMoveCommand(command) { return command && command.type === 'custom' && (command.id === 'move-selected-clips-up' || command.id === 'move-selected-clips-down'); }
  function isStaggerCommand(command) { return command && command.type === 'custom' && (command.id === 'stagger-ascending' || command.id === 'stagger-descending'); }
  function openTransitionMenu(command) {
    pendingTransitionCommand = command;
    catalogSearchValue = search.value;
    paletteTitle.textContent = command.name.toUpperCase();
    shortcutBadge.textContent = 'TRANSITION';
    search.value = '';
    search.placeholder = 'Length in frames • CEP default ' + (Number(settings.transitionFrames) || 30);
    activeIndex = 0;
    renderCommands();
    window.setTimeout(function () { search.focus(); }, 0);
  }
  function openMoveMenu(command) {
    pendingMoveCommand = command;
    catalogSearchValue = search.value;
    paletteTitle.textContent = command.name.toUpperCase();
    shortcutBadge.textContent = 'FUNCTION';
    search.value = '';
    search.placeholder = 'Choose move behavior';
    activeIndex = 0;
    renderCommands();
    window.setTimeout(function () { search.focus(); }, 0);
  }
  function openStaggerMenu(command) {
    pendingStaggerCommand = command;
    catalogSearchValue = search.value;
    paletteTitle.textContent = command.name.toUpperCase();
    shortcutBadge.textContent = 'FUNCTION';
    search.value = '';
    search.placeholder = 'Frames per step • default ' + (Number(settings.staggerFrames) || 5);
    activeIndex = 0;
    renderCommands();
    window.setTimeout(function () { search.focus(); }, 0);
  }
  function hideApplyMenu() {
    pendingTransitionCommand = null;
    pendingMoveCommand = null;
    pendingStaggerCommand = null;
    paletteTitle.textContent = 'FX PALETTE';
    shortcutBadge.textContent = displayShortcut(settings.shortcut);
    search.value = catalogSearchValue;
    search.placeholder = 'Search effects and transitions…';
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
      if (result === 'EvalScript error.') { setStatus('Premiere host script did not respond. Reopen the PR FX panel to reload it.', true); return; }
      if (result && result.indexOf('ERROR:') === 0) { setStatus(result.replace('ERROR: ', ''), true); refreshFailureLogStatus(); return; }
      setStatus(result || 'Applied ' + command.name + '.');
      if (keepPaletteOpen) {
        if (pendingTransitionCommand || pendingMoveCommand || pendingStaggerCommand) { hideApplyMenu(); renderCommands(); }
        window.setTimeout(function () { search.focus(); }, 0);
      } else closePalette();
    }
    setStatus('Applying ' + command.name + '…');
    var payload = JSON.stringify({ type: command.type, id: command.id, name: command.name, presetUid: command.presetUid || '', transitionFrames: Number(command.transitionFrames) || Number(settings.transitionFrames) || 30, transitionPlacement: command.transitionPlacement || 'both', moveMode: command.moveMode || 'group', staggerFrames: commandNumber(command.staggerFrames, settings.staggerFrames, 5, 0, 9999), staggerGroup: commandNumber(command.staggerGroup, settings.staggerGroup, 1, 1, 999), exportNamePattern: settings.exportNamePattern || '{sequence} - {index}', mergeTouchingSameSource: settings.mergeTouchingSameSource === true, nameTolerance: settings.nameTolerance || 'normalized', failurePolicy: settings.failurePolicy || 'rollback' });
    // Bulk replace and the place functions work clip by clip and legitimately
    // run for minutes. Timing them out at 12s reports failure for work that is
    // still running and will complete.
    var timeoutMs = LONG_RUNNING_COMMANDS[command.id] ? 600000 : 12000;
    watchdog = window.setTimeout(function () {
      finish('ERROR: Premiere did not finish ' + command.name + ' within ' + Math.round(timeoutMs / 1000) +
        ' seconds. It may still be running — check the Timeline before retrying.');
    }, timeoutMs);
    dispatchPremiereApply(payload, finish);
  }
  function setStatus(message, error) {
    var color = error ? '#ff9f9f' : '#a8d7a8';
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
  managerTypeFilter.addEventListener('change', renderManager);
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
    document.getElementById('commands-view').classList.toggle('is-hidden', tab.dataset.view !== 'commands');
    document.getElementById('general-view').classList.toggle('is-hidden', tab.dataset.view !== 'general');
    document.getElementById('sync-view').classList.toggle('is-hidden', tab.dataset.view !== 'sync');
  }); });
  document.getElementById('choose-sync-folder').addEventListener('click', function () {
    try {
      if (window.cep && window.cep.fs && window.cep.fs.showOpenDialog) {
        var result = window.cep.fs.showOpenDialog(false, true, 'Choose a media folder');
        if (result && !result.err && result.data && result.data[0]) { addSyncFolder(result.data[0]); return; }
      }
    } catch (_) {}
    folderInput.click();
  });
  folderInput.addEventListener('change', function () { var sourcePath = folderFromFileList(folderInput.files); if (sourcePath) addSyncFolder(sourcePath); else setSyncStatus('Choose a folder containing supported media.', true); folderInput.value = ''; });
  ['dragenter', 'dragover'].forEach(function (eventName) { folderDropZone.addEventListener(eventName, function (event) { event.preventDefault(); folderDropZone.classList.add('is-dragging'); }); });
  ['dragleave', 'drop'].forEach(function (eventName) { folderDropZone.addEventListener(eventName, function (event) { event.preventDefault(); folderDropZone.classList.remove('is-dragging'); }); });
  folderDropZone.addEventListener('drop', function (event) { var sourcePath = folderFromFileList(event.dataTransfer && event.dataTransfer.files); if (sourcePath) addSyncFolder(sourcePath); else setSyncStatus('Drop a folder, not individual files.', true); });
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
  search.addEventListener('input', function () { if (!pendingTransitionCommand && !pendingMoveCommand) activeIndex = 0; renderCommands(); });
  list.addEventListener('click', function (event) {
    var target = event.target.closest('.command'); if (!target) return;
    if (pendingTransitionCommand && target.dataset.type === 'transition-placement') {
      apply(Object.assign({}, pendingTransitionCommand, { transitionPlacement: target.dataset.id || 'both', transitionFrames: transitionFramesValue() }));
      return;
    }
    if (pendingStaggerCommand && target.dataset.type === 'stagger-frames') {
      apply(Object.assign({}, pendingStaggerCommand, { staggerFrames: Number(target.dataset.id) }));
      return;
    }
    if (pendingMoveCommand && target.dataset.type === 'move-mode') {
      apply(Object.assign({}, pendingMoveCommand, { moveMode: target.dataset.id || 'group' }));
      return;
    }
    apply({ type: target.dataset.type, id: target.dataset.id || undefined, name: target.dataset.name, moveMode: target.dataset.moveMode || undefined });
  });
  document.addEventListener('click', function (event) { if (event.target.hasAttribute('data-close-palette')) closePalette(); });
  document.addEventListener('keydown', function (event) {
    if (matchesShortcut(event) && document.activeElement !== shortcutInput) { event.preventDefault(); openPalette(); return; }
    if (palette.classList.contains('is-hidden')) return;
    if (event.key === 'Escape') { if (pendingTransitionCommand || pendingMoveCommand || pendingStaggerCommand) { hideApplyMenu(); renderCommands(); search.focus(); } else closePalette(); return; }
    var available = filteredCommands();
    if (event.key === 'ArrowDown') { event.preventDefault(); activeIndex = Math.min(activeIndex + 1, available.length - 1); renderCommands(); }
    if (event.key === 'ArrowUp') { event.preventDefault(); activeIndex = Math.max(activeIndex - 1, 0); renderCommands(); }
    if (event.key === 'Enter' && document.activeElement === search) {
      event.preventDefault();
      if (pendingTransitionCommand) apply(Object.assign({}, pendingTransitionCommand, { transitionPlacement: available[activeIndex] && available[activeIndex].id || 'both', transitionFrames: transitionFramesValue() }), event.shiftKey);
      else if (pendingMoveCommand) apply(Object.assign({}, pendingMoveCommand, { moveMode: available[activeIndex] && available[activeIndex].id || 'group' }), event.shiftKey);
      else if (pendingStaggerCommand) apply(Object.assign({}, pendingStaggerCommand, { staggerFrames: Number(available[activeIndex] && available[activeIndex].id) }), event.shiftKey);
      else apply(available[activeIndex], event.shiftKey);
    }
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
