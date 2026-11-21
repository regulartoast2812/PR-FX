/*
 * PR FX command engine.
 *
 * A hidden CEP extension (manifest type Custom) that starts with Premiere and
 * runs commands the native listener queues. Before this, commands only ran
 * while the settings panel's page was alive: close the panel and every
 * shortcut queued, waited five seconds, and expired with no visible error.
 * Excalibur works the same way -- a background extension that never depends
 * on a visible panel.
 *
 * Deliberately small and self-contained. It shares nothing with app.js except
 * the host contract (prfx.apply) and settings.json, which app.js writes.
 *
 * Every command it runs is reported back with POST /result, so the listener
 * can show a banner on failure and journal the outcome.
 */
(function () {
  'use strict';

  var BRIDGE = 'http://127.0.0.1:27389';
  var IDLE_POLL_MS = 120;
  var OFFLINE_POLL_MS = 1500;
  // Mirrors LONG_RUNNING_COMMANDS in app.js. Anything else gets two minutes,
  // which only matters if Premiere never answers at all.
  var LONG_RUNNING = {
    'bulk-replace-by-name': true, 'bulk-replace-preview': true, 'replace-from-bin': true, 'replace-fit-from-bin': true,
    'place-bin-clips': true, 'place-bin-clips-column': true, 'place-source-clip': true,
    'queue-cuts-to-ame': true, 'adjustment-layer-over-selection': true,
    'dump-qe-api': true, 'inspect-selected-clip': true, 'preset-report': true, 'probe-preset-routes': true
  };

  var cs = new CSInterface();
  var fs = null;
  var path = null;
  var os = null;
  try { fs = require('fs'); path = require('path'); os = require('os'); } catch (_) {}

  var busy = false;
  var hostBuildCache = { mtime: 0, build: '' };
  var IS_WINDOWS = typeof process !== 'undefined' && process && process.platform === 'win32';

  // Same folders the listener and app.js use on each OS.
  function supportDir() {
    return IS_WINDOWS
      ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'PR FX Palette')
      : path.join(os.homedir(), 'Library', 'Application Support', 'PR FX Palette');
  }
  function logsDir() {
    return IS_WINDOWS ? path.join(supportDir(), 'Logs') : path.join(os.homedir(), 'Library', 'Logs');
  }

  function logLine(message) {
    if (!fs) return;
    try {
      var dir = logsDir();
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      var file = path.join(dir, 'PR FX Engine.log');
      try {
        if (fs.statSync(file).size > 2000000) fs.renameSync(file, file + '.1');
      } catch (_) {}
      fs.appendFileSync(file, new Date().toISOString() + ' ' + message + '\n');
    } catch (_) {}
  }

  function extensionRoot() {
    var value = '';
    try { value = cs.getSystemPath('extension') || ''; } catch (_) { return ''; }
    try { value = decodeURI(value); } catch (_) {}
    value = value.replace(/^file:\/\//, '');
    if (/^\/[A-Za-z]:\//.test(value)) value = value.slice(1);
    return value;
  }

  // The build stamp is read from host.jsx on disk rather than hard-coded, so
  // this file never needs bumping and can never disagree with the host.
  function diskHostBuild(hostPath) {
    if (!fs) return '';
    try {
      var stat = fs.statSync(hostPath);
      var mtime = stat.mtime.getTime();
      if (mtime === hostBuildCache.mtime) return hostBuildCache.build;
      var head = fs.readFileSync(hostPath, 'utf8').slice(0, 4000);
      var marker = "prfx.HOST_BUILD = '";
      var start = head.indexOf(marker);
      var build = '';
      if (start >= 0) {
        var end = head.indexOf("'", start + marker.length);
        if (end > start) build = head.substring(start + marker.length, end);
      }
      hostBuildCache = { mtime: mtime, build: build };
      return build;
    } catch (_) { return ''; }
  }

  function readSettings() {
    var fallback = { transitionFrames: 30, staggerFrames: 5, staggerGroup: 1, exportNamePattern: '{sequence} - {index}', mergeTouchingSameSource: false, nameTolerance: 'normalized', failurePolicy: 'rollback', syntheticSeconds: 5 };
    if (!fs) return fallback;
    try {
      var file = path.join(supportDir(), 'settings.json');
      var loaded = JSON.parse(fs.readFileSync(file, 'utf8')) || {};
      for (var key in fallback) {
        if (Object.prototype.hasOwnProperty.call(fallback, key) && loaded[key] === undefined) loaded[key] = fallback[key];
      }
      return loaded;
    } catch (_) { return fallback; }
  }

  function boundedNumber(value, fallback, minimum, maximum) {
    var number = Math.round(Number(value));
    if (!isFinite(number)) number = fallback;
    return Math.max(minimum, Math.min(maximum, number));
  }

  function evalPremiere(expression, callback) {
    var root = extensionRoot();
    if (!root) { callback('ERROR: PR FX engine could not locate its extension folder.'); return; }
    var hostPath = root + '/jsx/host.jsx';
    var build = diskHostBuild(hostPath);
    var stale = build
      ? "prfx.HOST_BUILD!==" + JSON.stringify(build)
      : 'false';
    var wrapped = "(function(){try{" +
      "if(typeof prfx==='undefined'||typeof prfx.apply!=='function'||" + stale + "){$.evalFile(" + JSON.stringify(hostPath) + ");}" +
      "return (" + expression + ");" +
      "}catch(error){return 'ERROR: PR FX host load failed: ' + error.toString() + ' (line ' + (error.line || '?') + ')';}})()";
    try { cs.evalScript(wrapped, callback); }
    catch (error) { callback('EvalScript error.'); }
  }

  function postResult(seq, ok, message, startedAt) {
    if (seq === undefined || seq === null) return;
    try {
      var request = new XMLHttpRequest();
      request.open('POST', BRIDGE + '/result', true);
      request.setRequestHeader('Content-Type', 'application/json');
      request.timeout = 2000;
      request.send(JSON.stringify({ seq: Number(seq), ok: ok, message: String(message || '').slice(0, 2000), ms: Date.now() - startedAt }));
    } catch (_) {}
  }

  function formatAIResult(command, result) {
    if (result && result.saved_path) {
      return (result.imported ? 'Created and imported ' : 'Created ') + (result.subtitle_count || '') +
        (result.subtitle_count ? ' optimized subtitles. ' : 'optimized subtitles. ') + 'Saved ' + result.saved_path;
    }
    return 'Finished ' + command.name + '.';
  }

  function runAIFunction(command, callback) {
    var frame = document.getElementById('prai-engine-backend');
    var host = null;
    try { host = frame && frame.contentWindow && frame.contentWindow.prAIAgentHost; } catch (_) {}
    if (!host || typeof host.runAIFunction !== 'function') {
      callback('ERROR: Edie AI functions are still starting. Open the Edie panel once, then try again.');
      return;
    }
    Promise.resolve(host.runAIFunction(command.id, {})).then(function (result) {
      callback(formatAIResult(command, result));
    }, function (error) {
      callback('ERROR: ' + String(error && error.message ? error.message : error));
    });
  }

  function run(command) {
    var settings = readSettings();
    var startedAt = Date.now();
    var finished = false;
    busy = true;
    logLine('run #' + command.seq + ' ' + command.name + ' [' + (command.key || '') + ']');
    var watchdog = window.setTimeout(function () {
      if (finished) return;
      finished = true;
      busy = false;
      logLine('timeout #' + command.seq + ' ' + command.name);
      postResult(command.seq, false, 'Premiere did not answer in time. It may still be running — check the Timeline before retrying.', startedAt);
      schedule(IDLE_POLL_MS);
    }, (LONG_RUNNING[command.id] || command.type === 'preset' || command.type === 'ai-function') ? 600000 : 120000);
    var payload = JSON.stringify({
      type: command.type, id: command.id, name: command.name, presetUid: command.presetUid || '',
      transitionFrames: Number(command.transitionFrames) || Number(settings.transitionFrames) || 30,
      transitionPlacement: command.transitionPlacement || 'both',
      moveMode: command.moveMode || 'group',
      staggerFrames: boundedNumber(command.staggerFrames !== undefined && command.staggerFrames !== null ? command.staggerFrames : settings.staggerFrames, 5, 0, 9999),
      staggerGroup: boundedNumber(command.staggerGroup !== undefined && command.staggerGroup !== null ? command.staggerGroup : settings.staggerGroup, 1, 1, 999),
      exportNamePattern: settings.exportNamePattern || '{sequence} - {index}',
      mergeTouchingSameSource: settings.mergeTouchingSameSource === true,
      nameTolerance: settings.nameTolerance || 'normalized',
      failurePolicy: settings.failurePolicy || 'rollback',
      syntheticSeconds: settings.syntheticSeconds || 5
    });
    var dispatch = command.type === 'ai-function'
      ? function (done) { runAIFunction(command, done); }
      : function (done) { evalPremiere('prfx.apply(' + JSON.stringify(payload) + ')', done); };
    dispatch(function (result) {
      if (finished) return;
      finished = true;
      window.clearTimeout(watchdog);
      busy = false;
      var text = String(result || '');
      var ok = text !== 'EvalScript error.' && text.indexOf('ERROR:') !== 0;
      if (text === 'EvalScript error.') text = 'ERROR: Premiere host script did not respond.';
      logLine((ok ? 'ok #' : 'failed #') + command.seq + ' ' + command.name + ' ' + (Date.now() - startedAt) + 'ms ' + text.slice(0, 300));
      postResult(command.seq, ok, text, startedAt);
      schedule(0);
    });
  }

  var timer = null;
  function schedule(delay) {
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(poll, delay);
  }

  function poll() {
    timer = null;
    if (busy) return;
    var request = new XMLHttpRequest();
    request.open('GET', BRIDGE + '/next?client=engine', true);
    request.timeout = 1500;
    var done = false;
    function next(delay) { if (done) return; done = true; schedule(delay); }
    request.onreadystatechange = function () {
      if (request.readyState !== 4) return;
      if (request.status !== 200) { bridgeOffline(); next(OFFLINE_POLL_MS); return; }
      var command = null;
      try { command = JSON.parse(request.responseText); } catch (_) { command = null; }
      if (!command) { next(IDLE_POLL_MS); return; }
      done = true;
      try { run(command); }
      catch (error) {
        busy = false;
        logLine('dispatch error ' + (error && error.message));
        postResult(command.seq, false, 'ERROR: PR FX engine could not dispatch: ' + (error && error.message), Date.now());
        schedule(IDLE_POLL_MS);
      }
    };
    request.ontimeout = request.onerror = function () { bridgeOffline(); next(OFFLINE_POLL_MS); };
    try { request.send(); } catch (_) { next(OFFLINE_POLL_MS); }
  }

  // macOS keeps the listener alive with a LaunchAgent. Windows only has the
  // Run key, which fires at sign-in, so a listener that crashed or was never
  // started since install stays down. Start the copy Install / Repair put in
  // place -- never install from here -- at most once a minute.
  var lastListenerStart = 0;
  function bridgeOffline() {
    if (!IS_WINDOWS || !fs || Date.now() - lastListenerStart < 60000) return;
    lastListenerStart = Date.now();
    try {
      var base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
      var exe = path.join(base, 'PR FX Palette', 'bin', 'PRFXShortcutListener.exe');
      if (!fs.existsSync(exe)) return;
      var started = require('child_process').spawn(exe, [], { detached: true, stdio: 'ignore' });
      started.on('error', function () {});
      started.unref();
      logLine('bridge offline; started ' + exe);
    } catch (error) { logLine('could not start listener: ' + (error && error.message)); }
  }

  logLine('engine started; host build on disk ' + (diskHostBuild(extensionRoot() + '/jsx/host.jsx') || 'unknown'));
  schedule(500);
}());
