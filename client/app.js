(function () {
  'use strict';

  var STORAGE_KEY = 'prfx.palette.settings.v1';
  var DEFAULTS = { shortcut: { code: 'Space', ctrl: true, alt: false, shift: false, meta: false }, transitionFrames: 30 };
  var commands = [
    { type: 'custom', id: 'remove-transitions', name: 'Remove Transitions on Selected Tracks' },
    { type: 'effect', name: 'Gaussian Blur' }, { type: 'effect', name: 'Lumetri Color' },
    { type: 'effect', name: 'Crop' }, { type: 'effect', name: 'Transform' },
    { type: 'effect', name: 'Warp Stabilizer' }, { type: 'effect', name: 'Sharpen' },
    { type: 'effect', name: 'VR Digital Glitch' }, { type: 'effect', name: 'Tint' },
    { type: 'transition', name: 'Cross Dissolve' }, { type: 'transition', name: 'Dip To Black' },
    { type: 'transition', name: 'Dip To White' }, { type: 'transition', name: 'Film Dissolve' },
    { type: 'audio-transition', name: 'Constant Power' }, { type: 'audio-transition', name: 'Exponential Fade' }
  ];
  var cs = new CSInterface();
  var settings = loadSettings();
  var activeIndex = 0;
  var palette = document.getElementById('palette');
  var search = document.getElementById('command-search');
  var list = document.getElementById('command-list');
  var shortcutInput = document.getElementById('shortcut');
  var durationInput = document.getElementById('default-duration');

  function loadSettings() {
    try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}); }
    catch (_) { return Object.assign({}, DEFAULTS); }
  }
  function saveSettings() { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); syncListenerSettings(); updateShortcutUI(); }
  function displayShortcut(s) {
    var parts = [];
    if (s.ctrl) parts.push('Ctrl'); if (s.alt) parts.push('Alt'); if (s.shift) parts.push('Shift'); if (s.meta) parts.push('Cmd');
    parts.push(s.code === 'Space' ? 'Space' : s.code.replace(/^Key|^Digit/, ''));
    return parts.join(' + ');
  }
  function updateShortcutUI() {
    shortcutInput.value = displayShortcut(settings.shortcut);
    document.getElementById('shortcut-badge').textContent = displayShortcut(settings.shortcut);
    durationInput.value = settings.transitionFrames;
  }
  function syncListenerSettings() {
    // The native listener reads this file so it can receive a shortcut while the Timeline owns focus.
    try {
      if (typeof require !== 'function') return;
      var fs = require('fs');
      var path = require('path');
      var os = require('os');
      var dir = process.platform === 'win32'
        ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'PR FX Palette')
        : path.join(os.homedir(), 'Library', 'Application Support', 'PR FX Palette');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(settings), 'utf8');
    } catch (_) {}
  }
  function startCommandPolling() {
    // The native listener owns localhost. Poll it from CEP instead of requiring Node in Premiere.
    if (window.__prfxCommandPolling) return;
    window.__prfxCommandPolling = true;
    window.setInterval(function () {
      if (window.__prfxApplying) return;
      var request = new XMLHttpRequest();
      request.open('GET', 'http://127.0.0.1:27389/next', true);
      request.onreadystatechange = function () {
        if (request.readyState !== 4 || request.status !== 200) return;
        try {
          var command = JSON.parse(request.responseText);
          if (!command) return;
          window.__prfxApplying = true;
          var payload = JSON.stringify({ type: command.type, id: command.id, name: command.name, transitionFrames: Number(command.transitionFrames) || Number(settings.transitionFrames) || 30 });
          cs.evalScript('prfx.apply(' + JSON.stringify(payload) + ')', function (result) {
            window.__prfxApplying = false;
            setStatus(result || ('Applied ' + command.name + '.'), result && result.indexOf('ERROR:') === 0);
          });
        } catch (_) {}
      };
      try { request.send(); } catch (_) {}
    }, 180);
  }
  function syncPremiereCatalog() {
    cs.evalScript('prfx.getCatalog()', function (result) {
      if (!result || result.indexOf('ERROR:') === 0) { setStatus(result || 'Could not read Premiere’s Effects catalog.', true); return; }
      try {
        var request = new XMLHttpRequest();
        request.open('POST', 'http://127.0.0.1:27389/catalog', true);
        request.setRequestHeader('Content-Type', 'text/plain;charset=UTF-8');
        request.send(result);
      } catch (_) { setStatus('PR FX listener is not running.', true); }
    });
  }
  function matchesShortcut(event) {
    var s = settings.shortcut;
    return event.code === s.code && event.ctrlKey === s.ctrl && event.altKey === s.alt && event.shiftKey === s.shift && event.metaKey === s.meta;
  }
  function filteredCommands() {
    var query = search.value.toLowerCase().trim();
    return commands.filter(function (command) { return !query || (command.name + ' ' + command.type).toLowerCase().indexOf(query) !== -1; });
  }
  function renderCommands() {
    var available = filteredCommands();
    activeIndex = Math.max(0, Math.min(activeIndex, available.length - 1));
    list.innerHTML = available.length ? available.map(function (command, i) {
      var kind = command.type === 'custom' ? 'function' : command.type;
      return '<button class="command' + (i === activeIndex ? ' is-active' : '') + '" role="option" aria-selected="' + (i === activeIndex) + '" data-name="' + escapeHtml(command.name) + '" data-type="' + command.type + '"><span class="command-name">' + escapeHtml(command.name) + '</span><span class="command-kind">' + kind + '</span></button>';
    }).join('') : '<p class="muted">No matching command.</p>';
  }
  function escapeHtml(value) { return value.replace(/[&<>'"]/g, function (char) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]; }); }
  function openPalette() { palette.classList.remove('is-hidden'); search.value = ''; activeIndex = 0; renderCommands(); window.setTimeout(function () { search.focus(); }, 0); }
  function closePalette() { palette.classList.add('is-hidden'); }
  function apply(command) {
    if (!command) return;
    setStatus('Applying ' + command.name + '…');
    var payload = JSON.stringify({ type: command.type, id: command.id, name: command.name, transitionFrames: Number(settings.transitionFrames) || 30 });
    cs.evalScript('prfx.apply(' + JSON.stringify(payload) + ')', function (result) {
      if (result && result.indexOf('ERROR:') === 0) { setStatus(result.replace('ERROR: ', ''), true); return; }
      setStatus(result || 'Applied ' + command.name + '.');
      closePalette();
    });
  }
  function setStatus(message, error) { var status = document.getElementById('status'); status.textContent = message; status.style.color = error ? '#ff9f9f' : '#a8d7a8'; }

  document.getElementById('open-palette').addEventListener('click', openPalette);
  document.getElementById('reset-shortcut').addEventListener('click', function () { settings.shortcut = Object.assign({}, DEFAULTS.shortcut); saveSettings(); });
  shortcutInput.addEventListener('keydown', function (event) {
    event.preventDefault(); event.stopPropagation();
    if (!/^(Space|Key[A-Z]|Digit[0-9])$/.test(event.code)) { setStatus('Use Space, a letter, or a number with modifiers.', true); return; }
    settings.shortcut = { code: event.code, ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey, meta: event.metaKey };
    saveSettings(); setStatus('Shortcut saved.'); shortcutInput.blur();
  });
  durationInput.addEventListener('change', function () { settings.transitionFrames = Math.max(1, Math.min(300, Number(durationInput.value) || 30)); saveSettings(); });
  search.addEventListener('input', function () { activeIndex = 0; renderCommands(); });
  list.addEventListener('click', function (event) { var target = event.target.closest('.command'); if (target) apply({ type: target.dataset.type, name: target.dataset.name }); });
  document.addEventListener('click', function (event) { if (event.target.hasAttribute('data-close-palette')) closePalette(); });
  document.addEventListener('keydown', function (event) {
    if (matchesShortcut(event) && document.activeElement !== shortcutInput) { event.preventDefault(); openPalette(); return; }
    if (palette.classList.contains('is-hidden')) return;
    if (event.key === 'Escape') { closePalette(); return; }
    var available = filteredCommands();
    if (event.key === 'ArrowDown') { event.preventDefault(); activeIndex = Math.min(activeIndex + 1, available.length - 1); renderCommands(); }
    if (event.key === 'ArrowUp') { event.preventDefault(); activeIndex = Math.max(activeIndex - 1, 0); renderCommands(); }
    if (event.key === 'Enter' && document.activeElement === search) { event.preventDefault(); apply(available[activeIndex]); }
  });

  updateShortcutUI();
  syncListenerSettings();
  startCommandPolling();
  syncPremiereCatalog();
  window.setInterval(syncPremiereCatalog, 30000);
}());
