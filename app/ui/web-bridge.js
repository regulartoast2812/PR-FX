// The page's window.prfx inside Creative Assist, served at
// /tools/<id>/ui/… and talking to the tool's service through the host.
//   calls   POST /api/tools/<id>/call/<route>   (JSON body, JSON back)
//   events  GET  /api/tools/<id>/events         (server-sent events)
// The overlay window gets its state pushed by the host instead
// (window.__toolOverlay), so it opens no event stream.
'use strict';
(function () {
  if (window.prfx) return;
  var match = /^\/tools\/([a-z0-9-]+)\//.exec(location.pathname);
  var id = match ? match[1] : 'prfx';
  var base = '/api/tools/' + id + '/';
  var root = document.documentElement;
  root.classList.add('embedded');

  // The host's look (Dark / Light / System) wins over the computer's.
  function followTheme() {
    try {
      var host = window.parent && window.parent !== window ? window.parent.document.documentElement : null;
      var theme = host && host.dataset.theme;
      if (theme) root.dataset.theme = theme;
      if (host && !followTheme.watching) {
        followTheme.watching = true;
        new MutationObserver(followTheme).observe(host, { attributes: true, attributeFilter: ['data-theme'] });
      }
    } catch (_) { /* not same-origin: the computer's look */ }
  }
  var asked = /[?&]theme=(light|dark)/.exec(location.search);
  if (asked) root.dataset.theme = asked[1]; else followTheme();

  function call(route, body) {
    return fetch(base + 'call/' + route, {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body === undefined ? {} : body),
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (json) {
        if (!res.ok) throw new Error((json && json.error) || 'Creative Assist answered ' + res.status);
        return json;
      });
    });
  }

  var handlers = {};
  var source = null;
  function on(event, handler) {
    (handlers[event] = handlers[event] || []).push(handler);
    if (location.pathname.indexOf('/overlay.html') >= 0) return;
    if (!source) {
      source = new EventSource(base + 'events', { withCredentials: true });
      ['health', 'overlay-state', 'files-changed', 'displays', 'journal-changed'].forEach(function (name) {
        source.addEventListener(name, function (e) {
          var data = null;
          try { data = JSON.parse(e.data); } catch (_) {}
          (handlers[name] || []).forEach(function (h) { try { h(data); } catch (err) { console.error(err); } });
        });
      });
    }
  }

  window.prfx = {
    embedded: true,
    state: function () { return call('state'); },
    writeSettings: function (patch) { return call('settings:write', patch || {}); },
    detectMedia: function () { return call('media:detect'); },
    testMedia: function () { return call('media:test'); },
    installMedia: function (kind) { return call('media:install', { kind: kind }); },
    journal: function (limit) { return call('journal', { limit: limit }); },
    run: function (command) { return call('run', command).catch(function (e) { return { ok: false, message: e.message }; }); },
    openPalette: function () { return call('palette').catch(function (e) { return { ok: false, message: e.message }; }); },
    setOverlay: function (on) { return call('overlay', { on: !!on }); },
    startListener: function () { return call('listener:start'); },
    restartListener: function () { return call('listener:restart'); },
    open: function (which) { return call('open', { which: which }); },
    accessibility: function () { return call('accessibility'); },
    onHealth: function (h) { on('health', h); },
    onOverlay: function (h) { window.__toolOverlay = function (state) { try { h(state); } catch (err) { console.error(err); } }; },
    onOverlayState: function (h) { on('overlay-state', h); },
    onFilesChanged: function (h) { on('files-changed', h); },
    onDisplays: function (h) { on('displays', h); },
    onJournalChanged: function (h) { on('journal-changed', h); },
  };
})();
