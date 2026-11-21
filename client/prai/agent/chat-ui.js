/* PR AI agent chat UI.
 *
 * Draws the multi-turn agent chat into PR AI's existing #chatLog and composer.
 * main.js exposes window.prAIAgentHost (els, Markdown, run status, Premiere
 * bridge) and routes plain requests here through window.PRAIChatUI.send().
 * Quick-action buttons and image-to-script imports keep main.js's one-shot
 * path, and the "Classic" engine choice sends everything there.
 *
 * Saved chats: <support>/chats.json. CLI working dir: <support>/work.
 * Log (raw CLI stderr, tool calls): ~/Library/Logs/PR AI Agent.log.
 */
(function () {
  "use strict";

  // The hidden compatibility frame supplies Premiere operations only. Edie's
  // visible page owns the one chat server and conversation UI.
  if (/[?&]backend=1(?:&|$)/.test(window.location.search || "")) {
    return;
  }

  var Chat = window.PRAIAgentChat;
  var Server = window.PRAIAgentServer;
  var Tools = window.PRAIAgentTools;
  var ENGINE_KEY = "prai.chat.engine";
  var ASK_KEY = "prai.chat.askFirst";

  var host = null;
  var nodeRequire = null;
  var fs = null;
  var path = null;
  var supportDir = "";
  var workDir = "";
  var storeFile = "";
  var logFile = "";
  var mcpScript = "";
  var mcpConfigPath = "";
  var nodePath = "";
  var server = null;
  var serverProblem = "";
  var store = null;
  var running = null;
  var pendingConfirms = [];
  var ui = {};
  var saveTimer = null;

  function lsGet(key, fallback) {
    try {
      var v = window.localStorage.getItem(key);
      return v === null || v === undefined ? fallback : v;
    } catch (err) {
      return fallback;
    }
  }
  function lsSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (err) {
    }
  }

  function log(text) {
    if (!fs || !logFile) {
      return;
    }
    try {
      try {
        if (fs.statSync(logFile).size > 2 * 1024 * 1024) {
          fs.renameSync(logFile, logFile + ".1");
        }
      } catch (e1) {
      }
      fs.appendFileSync(logFile, new Date().toISOString() + " " + text + "\n");
    } catch (err) {
    }
  }

  function engine() {
    return "agent";
  }
  function askFirst() {
    return lsGet(ASK_KEY, "on") !== "off";
  }

  /* ---------- store ---------- */

  function current() {
    if (!store) {
      return null;
    }
    for (var i = 0; i < store.conversations.length; i++) {
      if (store.conversations[i].id === store.current) {
        return store.conversations[i];
      }
    }
    return null;
  }

  function ensureCurrent() {
    var conv = current();
    if (!conv) {
      conv = Chat.newConversation(nodeRequire);
      store.conversations.unshift(conv);
      store.current = conv.id;
    }
    return conv;
  }

  function saveNow() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (!store) {
      return;
    }
    try {
      /* Empty chats are not worth keeping. */
      var keep = store.conversations.filter(function (c) {
        return c.messages.length || c.id === store.current;
      });
      var copy = { version: store.version || 1, current: store.current, conversations: keep };
      Chat.saveStore(fs, path, storeFile, copy);
    } catch (err) {
      log("could not save chats: " + (err && err.message));
    }
  }
  function saveSoon() {
    if (!saveTimer) {
      saveTimer = setTimeout(saveNow, 800);
    }
  }

  /* ---------- bar ---------- */

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) {
      node.className = cls;
    }
    if (text !== undefined) {
      node.textContent = text;
    }
    return node;
  }

  function buildBar() {
    var panel = document.getElementById("agentPanel");
    var log = host.els.chatLog;
    if (!panel || !log) {
      return;
    }
    var bar = el("div", "prai-chatbar");
    bar.setAttribute("aria-label", "Edie chat controls");

    ui.engine = el("select", "prai-chatbar-select prai-chatbar-engine");
    ui.engine.title = "Edie runs multi-step jobs with Premiere tools.";
    [["agent", "Edie"]].forEach(function (o) {
      var opt = el("option", "", o[1]);
      opt.value = o[0];
      ui.engine.appendChild(opt);
    });
    ui.engine.value = engine();
    ui.engine.addEventListener("change", function () {
      lsSet(ENGINE_KEY, ui.engine.value);
      refreshBar();
      if (ui.engine.value === "agent") {
        renderConversation();
      }
    });

    ui.chats = el("select", "prai-chatbar-select prai-chatbar-chats");
    ui.chats.title = "Saved chats";
    ui.chats.addEventListener("change", function () {
      if (running) {
        ui.chats.value = store.current;
        host.setStatus("Stop the running reply before switching chats.", true);
        return;
      }
      store.current = ui.chats.value;
      saveSoon();
      renderConversation();
    });

    ui.newBtn = el("button", "prai-chatbar-btn", "New chat");
    ui.newBtn.type = "button";
    ui.newBtn.addEventListener("click", function () {
      if (running) {
        host.setStatus("Stop the running reply before starting a new chat.", true);
        return;
      }
      var conv = current();
      if (!conv || conv.messages.length) {
        conv = Chat.newConversation(nodeRequire);
        store.conversations.unshift(conv);
      }
      store.current = conv.id;
      saveSoon();
      renderConversation();
      host.els.prompt.focus();
    });

    ui.delBtn = el("button", "prai-chatbar-btn prai-chatbar-del", "Delete");
    ui.delBtn.type = "button";
    ui.delBtn.title = "Delete this chat";
    ui.delBtn.addEventListener("click", function () {
      var conv = current();
      if (running || !conv || !conv.messages.length) {
        return;
      }
      if (!window.confirm("Delete the chat \"" + conv.title + "\"? Files it saved stay on disk.")) {
        return;
      }
      store.conversations = store.conversations.filter(function (c) { return c.id !== conv.id; });
      store.current = store.conversations.length ? store.conversations[0].id : "";
      ensureCurrent();
      saveNow();
      renderConversation();
    });

    var askLabel = el("label", "prai-chatbar-ask");
    ui.ask = el("input");
    ui.ask.type = "checkbox";
    ui.ask.checked = askFirst();
    ui.ask.addEventListener("change", function () {
      lsSet(ASK_KEY, ui.ask.checked ? "on" : "off");
    });
    askLabel.title = "Show Allow / Deny before any tool changes the Premiere project";
    askLabel.appendChild(ui.ask);
    askLabel.appendChild(document.createTextNode(" Ask before changing the project"));

    ui.badge = el("span", "prai-chatbar-badge", "Starting");

    bar.appendChild(ui.engine);
    bar.appendChild(ui.chats);
    bar.appendChild(ui.newBtn);
    bar.appendChild(ui.delBtn);
    bar.appendChild(askLabel);
    bar.appendChild(ui.badge);
    panel.insertBefore(bar, log);
    ui.bar = bar;
    refreshBar();
  }

  function refreshBar() {
    if (!ui.bar) {
      return;
    }
    var agent = engine() === "agent";
    ui.bar.className = "prai-chatbar" + (agent ? "" : " is-classic");
    ui.chats.innerHTML = "";
    if (store) {
      store.conversations.forEach(function (c) {
        if (!c.messages.length && c.id !== store.current) {
          return;
        }
        var opt = el("option", "", c.title || "New chat");
        opt.value = c.id;
        ui.chats.appendChild(opt);
      });
      ui.chats.value = store.current;
    }
    var state;
    var text;
    if (serverProblem) {
      state = "bad";
      text = "Unavailable";
      ui.badge.title = serverProblem + " Requests use the Classic path.";
    } else if (!server || !nodePath) {
      state = "wait";
      text = "Starting";
      ui.badge.title = "Starting Edie's Premiere tool server";
    } else if (running) {
      state = "busy";
      text = "Working";
      ui.badge.title = "A reply is running. Press the stop button to end it.";
    } else {
      state = "ok";
      text = "Agent ready";
      ui.badge.title = "Tool server on 127.0.0.1:" + server.port + ", node " + nodePath;
    }
    ui.badge.className = "prai-chatbar-badge is-" + state;
    ui.badge.textContent = agent ? text : "Classic";
  }

  /* ---------- rendering ---------- */

  function stepLabel(step) {
    var labels = {
      get_project_context: "Read the project",
      get_active_script: "Read the active script",
      transcribe_audio_to_srt: "Transcribe audio",
      optimize_srt: "Optimise subtitles",
      read_srt: "Read SRT",
      write_srt: "Write SRT",
      save_srt: "Save SRT",
      list_presets: "List workflows",
      list_legacy_actions: "List edit actions",
      import_srt_as_captions: "Import captions",
      apply_preset: "Run workflow",
      run_legacy_action: "Apply edit actions",
      undo_last: "Undo last apply",
      Read: "Look at image"
    };
    return labels[step.name] || step.name;
  }

  function runInfo(msg) {
    var run = msg.run;
    if (!run) {
      return "";
    }
    var parts = [Chat.PROVIDER_NAMES[run.provider] || run.provider];
    if (run.model) {
      parts.push(run.model);
    }
    if (run.effort) {
      parts.push(run.effort + " effort");
    }
    if (run.ended && run.started) {
      var secs = Math.max(0, Math.round((run.ended - run.started) / 1000));
      parts.push(secs >= 60 ? Math.floor(secs / 60) + "m " + (secs % 60) + "s" : secs + "s");
    }
    if (run.stopped) {
      parts.push("stopped");
    } else if (run.cut) {
      parts.push("cut off");
    }
    return parts.join(" · ");
  }

  function messageNode(conv, msg) {
    var article = el("article", "message " + msg.role + " prai-agent-message");
    article.setAttribute("data-message-id", msg.id);
    var avatar = el("div", "message-avatar");
    avatar.setAttribute("aria-hidden", "true");
    if (msg.role === "assistant") {
      var face = document.querySelector(".brand-face");
      if (face) {
        avatar.appendChild(face.cloneNode(true));
      } else {
        avatar.textContent = "E";
      }
    } else {
      avatar.textContent = "U";
    }
    var content = el("div", "message-content");
    var header = el("div", "message-header");
    header.appendChild(el("span", "role", msg.role === "assistant" ? "Edie" : "You"));
    var copy = el("button", "copy-reply");
    copy.type = "button";
    copy.title = "Copy message";
    copy.setAttribute("aria-label", "Copy message");
    if (host.setCopyIcon) {
      host.setCopyIcon(copy, false);
    } else {
      copy.textContent = "Copy";
    }
    copy.addEventListener("click", function () {
      host.copyText(msg.text || "", copy);
    });
    header.appendChild(copy);
    content.appendChild(header);

    var body = el("div", "message-body");
    if (msg.steps && msg.steps.length) {
      var list = el("ul", "prai-steps");
      msg.steps.forEach(function (step) {
        var li = el("li", "prai-step is-" + (step.state || "running") + (step.mutates ? " is-mutating" : ""));
        li.appendChild(el("span", "prai-step-dot"));
        li.appendChild(el("span", "prai-step-name", stepLabel(step)));
        if (step.target) {
          li.appendChild(el("span", "prai-step-target", step.target));
        }
        if (step.mutates) {
          li.appendChild(el("span", "prai-step-tag", "changes project"));
        }
        if (step.detail && step.state === "failed") {
          li.title = step.detail;
        }
        list.appendChild(li);
      });
      body.appendChild(list);
    }
    var textNode = el("div", "message-text");
    if (msg.role === "assistant") {
      if (msg.text) {
        host.renderMarkdown(textNode, msg.text);
      } else if (msg.run && !msg.run.ended) {
        textNode.appendChild(el("span", "prai-thinking", "Working"));
      }
    } else {
      textNode.textContent = msg.text || "";
    }
    body.appendChild(textNode);
    if (msg.images && msg.images.length) {
      body.appendChild(el("div", "prai-images", "Images: " + msg.images.map(function (p) { return p.replace(/^.*[\/\\]/, ""); }).join(", ")));
    }
    if (msg.role === "assistant" && msg.run && msg.run.ended && (msg.run.failure || msg.run.cut || msg.run.stopped)) {
      var note = el("div", "prai-failure" + (msg.run.failure ? "" : " is-soft"));
      note.appendChild(el("span", "", msg.run.failure || (msg.run.stopped ? "Stopped." : "This reply was cut off (the panel closed or Premiere quit).")));
      var again = el("button", "prai-chatbar-btn prai-retry", "Try again");
      again.type = "button";
      again.addEventListener("click", function () {
        retry(conv, msg);
      });
      note.appendChild(again);
      body.appendChild(note);
    }
    content.appendChild(body);
    var info = runInfo(msg);
    if (info) {
      content.appendChild(el("div", "message-credit", info));
    }
    article.appendChild(avatar);
    article.appendChild(content);
    return article;
  }

  function scrollDown() {
    var log = host.els.chatLog;
    log.scrollTop = log.scrollHeight;
  }

  function renderConversation() {
    refreshBar();
    if (engine() !== "agent") {
      return;
    }
    var log = host.els.chatLog;
    var conv = ensureCurrent();
    log.innerHTML = "";
    if (!conv.messages.length) {
      var hello = el("div", "prai-chat-empty");
      hello.appendChild(el("strong", "", "Edie is ready"));
      hello.appendChild(el("p", "", "Ask for a whole job, such as \"create subtitles from this sequence, optimise the text, and keep the SRT file\". Edie chains Premiere tools and asks before changing the project."));
      log.appendChild(hello);
    }
    conv.messages.forEach(function (msg) {
      log.appendChild(messageNode(conv, msg));
    });
    pendingConfirms.forEach(function (p) {
      log.appendChild(p.node);
    });
    scrollDown();
  }

  var renderTimer = null;
  function rerenderMessage(conv, msg, now) {
    function go() {
      renderTimer = null;
      if (engine() !== "agent" || current() !== conv) {
        return;
      }
      var log = host.els.chatLog;
      var old = log.querySelector('[data-message-id="' + msg.id + '"]');
      var stick = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
      var node = messageNode(conv, msg);
      if (old) {
        log.replaceChild(node, old);
      } else {
        var empty = log.querySelector(".prai-chat-empty");
        if (empty) {
          log.removeChild(empty);
        }
        log.appendChild(node);
      }
      pendingConfirms.forEach(function (p) {
        log.appendChild(p.node);
      });
      if (stick) {
        scrollDown();
      }
    }
    if (now) {
      if (renderTimer) {
        clearTimeout(renderTimer);
      }
      go();
    } else if (!renderTimer) {
      renderTimer = setTimeout(go, 120);
    }
  }

  /* ---------- confirmations ---------- */

  function confirmTool(name, summary) {
    if (!running) {
      log("refused " + name + ": no chat turn running");
      return Promise.resolve(false);
    }
    if (!askFirst()) {
      return Promise.resolve(true);
    }
    return new Promise(function (resolve) {
      var node = el("div", "prai-confirm");
      node.appendChild(el("strong", "", "Edie wants to change the project"));
      node.appendChild(el("p", "", summary + "."));
      var row = el("div", "prai-confirm-row");
      var allow = el("button", "prai-chatbar-btn prai-allow", "Allow");
      var deny = el("button", "prai-chatbar-btn", "Deny");
      allow.type = "button";
      deny.type = "button";
      row.appendChild(allow);
      row.appendChild(deny);
      node.appendChild(row);
      var entry = { node: node, resolve: null };
      function finish(ok) {
        pendingConfirms = pendingConfirms.filter(function (p) { return p !== entry; });
        if (node.parentNode) {
          node.parentNode.removeChild(node);
        }
        log((ok ? "allowed " : "denied ") + name);
        if (running) {
          host.runPhase(ok ? "Changing the project" : "Working");
        }
        resolve(ok);
      }
      entry.resolve = finish;
      allow.addEventListener("click", function () { finish(true); });
      deny.addEventListener("click", function () { finish(false); });
      pendingConfirms.push(entry);
      if (engine() === "agent") {
        host.els.chatLog.appendChild(node);
        scrollDown();
      }
      host.runPhase("Waiting for your OK");
      host.setStatus("Edie is waiting for you to allow or deny a project change.");
    });
  }

  function denyAllPending() {
    pendingConfirms.slice(0).forEach(function (p) {
      p.resolve(false);
    });
  }

  /* ---------- turns ---------- */

  function now() {
    return Date.now();
  }

  function startTurn(conv, userMsg, assistant, retryCount) {
    var provider = host.provider();
    var model = host.aiModel(provider) || "";
    var effort = host.aiEffort(provider) || "";
    var sessionEntry = conv.sessions && conv.sessions[provider];
    var previous = sessionEntry && sessionEntry.id ? sessionEntry.id : "";
    var session = previous ? "" : Chat.uuid(nodeRequire);
    var userIndex = conv.messages.indexOf(userMsg);
    var text = userMsg.text;
    /* A new CLI session (first use of this provider in the chat, or a lost
       session) gets a recap of what was said so far. */
    if (!previous && userIndex > 0) {
      text = Chat.recap(conv, userIndex) + text;
    }
    var images = userMsg.images || [];
    assistant.text = "";
    assistant.steps = [];
    assistant.run = { provider: provider, model: model, effort: provider === "claude" ? effort : "", started: now(), ended: 0 };
    var args = Chat.turnArgs({
      provider: provider,
      previous: previous,
      session: session,
      model: model,
      effort: provider === "claude" ? effort : "",
      images: images,
      mcpConfigPath: mcpConfigPath,
      nodePath: nodePath,
      mcpScript: mcpScript,
      toolsFile: server.infoPath,
      workDir: workDir
    });
    var input = Chat.turnPrompt(provider, !previous, text, images);
    var command = host.chatCommand(provider, args, workDir);
    var finished = { seen: false, reason: null, reply: "" };
    var lastProblem = "";
    log("turn " + provider + (model ? " " + model : "") + (previous ? " resume " + previous : " new " + (session || "")) + " chat " + conv.id);

    var turn = { conv: conv, assistant: assistant, handle: null };
    running = turn;
    refreshBar();
    rerenderMessage(conv, assistant, true);
    host.runStarted(previous ? "Waiting for reply" : "Starting " + (Chat.PROVIDER_NAMES[provider] || provider));

    turn.handle = Chat.runTurn({
      nodeRequire: nodeRequire,
      provider: provider,
      command: command,
      input: input,
      cwd: workDir,
      log: log,
      onEvent: function (ev) {
        if (ev.session) {
          conv.sessions = conv.sessions || {};
          conv.sessions[provider] = { id: ev.session };
          saveSoon();
          return;
        }
        if (ev.text !== undefined) {
          if (ev.block && assistant.text && !/\n\n$/.test(assistant.text)) {
            assistant.text += "\n\n";
          }
          assistant.text += ev.text;
          host.runPhase("Writing");
          rerenderMessage(conv, assistant);
          return;
        }
        if (ev.step) {
          var found = null;
          for (var i = 0; i < assistant.steps.length; i++) {
            if (assistant.steps[i].id === ev.step.id) {
              found = assistant.steps[i];
            }
          }
          if (!found) {
            found = { id: ev.step.id, name: ev.step.name, target: ev.step.target, mutates: ev.step.mutates, state: "running" };
            assistant.steps.push(found);
            host.runPhase(stepLabel(found));
          }
          rerenderMessage(conv, assistant);
          saveSoon();
          return;
        }
        if (ev.result !== undefined) {
          for (var k = 0; k < assistant.steps.length; k++) {
            if (assistant.steps[k].id === ev.result) {
              assistant.steps[k].state = ev.failed ? "failed" : "ok";
              if (ev.failed && ev.detail) {
                assistant.steps[k].detail = String(ev.detail).slice(0, 300);
              }
            }
          }
          rerenderMessage(conv, assistant);
          saveSoon();
          return;
        }
        if (ev.finished !== undefined) {
          finished.seen = true;
          finished.reason = ev.finished;
          finished.reply = ev.reply || "";
          return;
        }
        if (ev.problem) {
          lastProblem = ev.problem;
          log("problem: " + ev.problem);
        }
      },
      onExit: function (exit) {
        running = null;
        denyAllPending();
        var run = assistant.run;
        run.ended = now();
        if (!assistant.text && finished.reply) {
          assistant.text = finished.reply;
        }
        var ok = finished.seen && finished.reason === null;
        assistant.steps.forEach(function (s) {
          if (s.state === "running") {
            s.state = ok ? "ok" : "unknown";
          }
        });
        if (exit.cancelled) {
          run.stopped = true;
        } else if (!ok) {
          var all = String(exit.errors || "") + "\n" + String(finished.reason || "") + "\n" + lastProblem;
          if (previous && !retryCount && Chat.sessionLost(all)) {
            log("session " + previous + " lost; starting a new one with a recap");
            delete conv.sessions[provider];
            startTurn(conv, userMsg, assistant, 1);
            return;
          }
          run.failure = Chat.plainFailure(provider, exit.code, String(exit.errors || "") + "\n" + lastProblem, finished.reason || "");
          log("turn failed (exit " + exit.code + "): " + String(finished.reason || lastProblem || "").slice(0, 2000));
        }
        conv.updated = now();
        saveNow();
        refreshBar();
        rerenderMessage(conv, assistant, true);
        host.runEnded();
        if (run.failure) {
          host.setStatus(run.failure, true);
        } else if (run.stopped) {
          host.setStatus("Stopped.");
        } else {
          host.setStatus("Reply finished.");
        }
      }
    });
  }

  function retry(conv, assistant) {
    if (running) {
      return;
    }
    var idx = conv.messages.indexOf(assistant);
    var userMsg = null;
    for (var i = idx - 1; i >= 0; i--) {
      if (conv.messages[i].role === "user") {
        userMsg = conv.messages[i];
        break;
      }
    }
    if (!userMsg || !ready()) {
      return;
    }
    /* Anything after the failed reply is dropped; the retry replaces it. */
    conv.messages = conv.messages.slice(0, idx + 1);
    startTurn(conv, userMsg, assistant, 0);
  }

  function ready() {
    return !!(host && server && nodePath && !serverProblem && Chat && Tools);
  }

  /* ---------- public ---------- */

  function send(text, images) {
    if (!ready() || running) {
      return false;
    }
    var conv = ensureCurrent();
    var userMsg = { id: Chat.uuid(nodeRequire), role: "user", text: String(text), date: now(), images: images || [] };
    var assistant = { id: Chat.uuid(nodeRequire), role: "assistant", text: "", date: now(), steps: [] };
    if (!conv.messages.length) {
      conv.title = Chat.titleFrom(text);
    }
    conv.messages.push(userMsg);
    conv.messages.push(assistant);
    conv.updated = now();
    if (current() !== conv || host.els.chatLog.querySelector(".prai-chat-empty") || !host.els.chatLog.querySelector(".prai-agent-message")) {
      renderConversation();
    } else {
      rerenderMessage(conv, userMsg, true);
    }
    saveNow();
    startTurn(conv, userMsg, assistant, 0);
    return true;
  }

  function stop() {
    denyAllPending();
    if (running && running.handle) {
      running.handle.stop();
    }
  }

  function findNode(nodeRequire, cb) {
    var cp = nodeRequire("child_process");
    var candidates = ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"];
    if (window.prfxShell.isWindows(nodeRequire)) {
      // Windows: where.exe finds node.exe on PATH (a Git Bash path like /c/... couldn't be started from here).
      cp.execFile("where.exe", ["node"], { timeout: 15000, windowsHide: true }, function (err, stdout) {
        cb(String(stdout || "").split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean)[0] || "");
      });
      return;
    }
    window.prfxShell.execFile(nodeRequire, "export PATH=\"$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH\"; command -v node", { timeout: 15000 }, function (err, stdout) {
      var found = String(stdout || "").split("\n").map(function (l) { return l.replace(/^\s+|\s+$/g, ""); }).filter(function (l) { return l.charAt(0) === "/"; })[0];
      if (found) {
        cb(found);
        return;
      }
      for (var i = 0; i < candidates.length; i++) {
        try {
          fs.accessSync(candidates[i], fs.constants ? fs.constants.X_OK : 1);
          cb(candidates[i]);
          return;
        } catch (e) {
        }
      }
      cb("");
    });
  }

  function panelDir() {
    var p = decodeURIComponent(window.location.pathname || "");
    p = p.replace(/^\/([A-Za-z]:\/)/, "$1");
    return p.replace(/\/[^\/]*$/, "");
  }

  function attach(h) {
    if (host || !h) {
      return;
    }
    host = h;
    if (!Chat || !Server || !Tools) {
      return;
    }
    nodeRequire = host.nodeRequire();
    if (!nodeRequire) {
      serverProblem = "Node is not available inside the panel.";
      return;
    }
    try {
      fs = nodeRequire("fs");
      path = nodeRequire("path");
      var os = nodeRequire("os");
      var proc = nodeRequire("process");
      supportDir = Tools.supportDir(os, path, proc.env);
      workDir = path.join(supportDir, "work");
      storeFile = path.join(supportDir, "chats.json");
      logFile = os.platform() === "win32" ? path.join(supportDir, "Edie Agent.log") : path.join(os.homedir(), "Library", "Logs", "Edie Agent.log");
      Tools.ensureDir(fs, supportDir, 448);
      Tools.ensureDir(fs, workDir, 448);
      mcpScript = path.join(panelDir(), "agent", "mcp.js");
      if (!fs.existsSync(mcpScript)) {
        mcpScript = path.join(panelDir(), "prai", "agent", "mcp.js");
      }
      mcpConfigPath = path.join(workDir, "mcp-config.json");
      store = Chat.loadStore(fs, storeFile);
    } catch (err) {
      serverProblem = "Could not prepare the agent folder: " + (err && err.message);
      log(serverProblem);
      return;
    }
    buildBar();
    renderConversation();

    var deps = {
      srt: host.srt,
      projectContext: host.projectContext,
      selectedClips: host.selectedClips,
      activeScript: host.activeScript,
      transcribe: host.transcribe,
      importSrt: host.importSrt,
      runPreset: host.runPreset,
      legacyActions: host.legacyActions,
      applyActions: host.applyActions,
      undoLast: host.undoLast,
      confirm: confirmTool
    };
    Server.start({
      nodeRequire: nodeRequire,
      deps: deps,
      supportDir: supportDir,
      log: log,
      onCall: function (name, args, phase) {
        if (running && phase === "start") {
          host.runPhase(stepLabel({ name: name }));
        }
      }
    }).then(function (s) {
      server = s;
      findNode(nodeRequire, function (found) {
        nodePath = found;
        if (!found) {
          serverProblem = "Node.js was not found on this Mac (the agent's tool bridge needs it). Install Node, then reopen the panel.";
          log(serverProblem);
        } else {
          try {
            Tools.writeFileAtomic(fs, path, mcpConfigPath, JSON.stringify(Chat.mcpConfig(nodePath, mcpScript, server.infoPath), null, 2), 384);
          } catch (err) {
            serverProblem = "Could not write the MCP config: " + (err && err.message);
            log(serverProblem);
          }
        }
        refreshBar();
      });
      refreshBar();
    }, function (err) {
      serverProblem = "Edie's Premiere tool server did not start: " + (err && err.message);
      log(serverProblem);
      refreshBar();
    });

    window.addEventListener("unload", function () {
      stop();
      saveNow();
      if (server) {
        server.close();
      }
    });
  }

  window.PRAIChatUI = {
    attach: attach,
    wants: function () {
      return engine() === "agent" && ready();
    },
    send: send,
    isRunning: function () {
      return !!running;
    },
    stop: stop
  };

  if (window.prAIAgentHost) {
    attach(window.prAIAgentHost);
  }
}());
