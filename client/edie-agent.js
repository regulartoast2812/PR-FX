/* Edie's primary chat UI.
 *
 * The old PR AI screen is no longer shown. Its proven Premiere runtime stays
 * in a hidden same-origin frame for now, while this file presents one clean
 * Edie host to the shared agent/chat modules. That keeps the tool boundary
 * explicit and lets the runtime be extracted later without changing the UI.
 */
(function () {
  "use strict";

  var frame = document.getElementById("prai-backend");
  var prompt = document.getElementById("prompt");
  var sendButton = document.getElementById("edie-send");
  var stopButton = document.getElementById("edie-stop");
  var status = document.getElementById("edie-chat-status");
  var state = document.getElementById("edie-agent-state");
  var provider = document.getElementById("edie-provider");
  var model = document.getElementById("edie-model");
  var effort = document.getElementById("edie-effort");
  var scriptInput = document.getElementById("edie-script-input");
  var imageInput = document.getElementById("edie-image-input");
  var context = document.getElementById("edie-context");
  var scriptContext = null;
  var imagePaths = [];
  var attached = false;
  var STORAGE = "edie.agent.";

  function getNodeRequire() {
    if (window.cep_node && window.cep_node.require) return window.cep_node.require;
    if (typeof window.require === "function") return window.require;
    return null;
  }

  function stored(key, fallback) {
    try { return window.localStorage.getItem(STORAGE + key) || fallback; } catch (_) { return fallback; }
  }

  function save(key, value) {
    try { window.localStorage.setItem(STORAGE + key, value); } catch (_) {}
  }

  function setState(kind, text, detail) {
    state.className = "edie-agent-state is-" + kind;
    state.innerHTML = "<i></i>" + text;
    state.title = detail || "";
  }

  function setStatus(text, bad) {
    status.textContent = text || "";
    status.classList.toggle("is-error", !!bad);
  }

  function syncModels() {
    var chosen = provider.value;
    var previous = stored(chosen + ".model", "");
    model.innerHTML = "";
    var options = chosen === "claude"
      ? [["claude-opus-5", "Opus 5"], ["claude-sonnet-5", "Sonnet 5"], ["claude-haiku-4-5", "Haiku 4.5"]]
      : [["", "Default from Codex"]];
    options.forEach(function (entry) {
      var option = document.createElement("option");
      option.value = entry[0];
      option.textContent = entry[1];
      model.appendChild(option);
    });
    model.value = previous;
    if (model.selectedIndex < 0) model.selectedIndex = 0;
    effort.hidden = chosen !== "claude";
  }

  function baseName(path) {
    return String(path || "").replace(/^.*[\\/]/, "");
  }

  function renderContext() {
    try { if (frame.contentWindow) frame.contentWindow.__edieExternalScript = scriptContext; } catch (_) {}
    context.innerHTML = "";
    function chip(label, title, remove) {
      var item = document.createElement("span");
      item.className = "edie-context-chip";
      item.title = title || label;
      var text = document.createElement("span");
      text.textContent = label;
      var close = document.createElement("button");
      close.type = "button";
      close.setAttribute("aria-label", "Remove " + label);
      close.textContent = "×";
      close.addEventListener("click", remove);
      item.appendChild(text);
      item.appendChild(close);
      context.appendChild(item);
    }
    if (scriptContext) {
      chip("Script: " + scriptContext.name, scriptContext.name, function () { scriptContext = null; renderContext(); });
    }
    imagePaths.forEach(function (path, index) {
      chip("Image: " + baseName(path), path, function () { imagePaths.splice(index, 1); renderContext(); });
    });
    context.hidden = !context.children.length;
  }

  function readScript(file) {
    var nodeRequire = getNodeRequire();
    var path = file && (file.path || file.name);
    if (nodeRequire && file && file.path) {
      try {
        scriptContext = { name: file.name || baseName(file.path), text: nodeRequire("fs").readFileSync(file.path, "utf8") };
        renderContext();
        return;
      } catch (_) {}
    }
    var reader = new FileReader();
    reader.onload = function () {
      scriptContext = { name: file.name || baseName(path), text: String(reader.result || "") };
      renderContext();
    };
    reader.onerror = function () { setStatus("Edie could not read that script.", true); };
    reader.readAsText(file);
  }

  function delegate(child, name) {
    return function () { return child[name].apply(child, arguments); };
  }

  function attachBackend() {
    if (attached) return;
    var child;
    try { child = frame.contentWindow && frame.contentWindow.prAIAgentHost; } catch (err) {
      setState("bad", "Unavailable", "The Premiere tool runtime is blocked: " + err.message);
      setStatus("Edie could not reach the Premiere tool runtime.", true);
      return;
    }
    if (!child) {
      setState("bad", "Unavailable", "The Premiere tool runtime did not start.");
      setStatus("Edie's Premiere tools did not start. Reopen the panel to try again.", true);
      return;
    }
    frame.contentWindow.__edieExternalScript = scriptContext;
    var host = {
      els: { chatLog: document.getElementById("chatLog"), prompt: prompt },
      nodeRequire: getNodeRequire,
      renderMarkdown: delegate(child, "renderMarkdown"),
      copyText: delegate(child, "copyText"),
      setCopyIcon: delegate(child, "setCopyIcon"),
      setStatus: setStatus,
      provider: function () { return provider.value === "codex" ? "codex" : "claude"; },
      aiModel: function () { return model.value || ""; },
      aiEffort: function (which) { return which === "claude" ? effort.value : ""; },
      chatCommand: delegate(child, "chatCommand"),
      runStarted: function (label) {
        setState("busy", "Working", label || "Edie is working");
        sendButton.hidden = true;
        stopButton.hidden = false;
        prompt.disabled = true;
      },
      runPhase: function (label) { setState("busy", "Working", label || "Edie is working"); },
      runEnded: function () {
        setState("ready", "Ready", "Edie's Premiere tools are connected.");
        sendButton.hidden = false;
        stopButton.hidden = true;
        prompt.disabled = false;
        prompt.focus();
      },
      srt: child.srt,
      projectContext: delegate(child, "projectContext"),
      selectedClips: delegate(child, "selectedClips"),
      activeScript: function () { return scriptContext || child.activeScript(); },
      transcribe: delegate(child, "transcribe"),
      importSrt: delegate(child, "importSrt"),
      runPreset: delegate(child, "runPreset"),
      legacyActions: delegate(child, "legacyActions"),
      applyActions: delegate(child, "applyActions"),
      undoLast: delegate(child, "undoLast")
    };
    window.PRAIChatUI.attach(host);
    attached = true;
    setState("ready", "Ready", "Edie's Premiere tools are connected.");
    setStatus("Edie is connected to the active Premiere project.");
  }

  function send() {
    var text = prompt.value.trim();
    if (!text && !imagePaths.length) return;
    if (!attached || !window.PRAIChatUI.send(text || "Look at the attached image(s).", imagePaths.slice())) {
      setStatus("Edie is still connecting or already working.", true);
      return;
    }
    prompt.value = "";
    imagePaths = [];
    renderContext();
  }

  provider.value = stored("provider", "claude");
  effort.value = stored("effort", "");
  syncModels();
  provider.addEventListener("change", function () { save("provider", provider.value); syncModels(); });
  model.addEventListener("change", function () { save(provider.value + ".model", model.value); });
  effort.addEventListener("change", function () { save("effort", effort.value); });
  sendButton.addEventListener("click", send);
  stopButton.addEventListener("click", function () { window.PRAIChatUI.stop(); });
  prompt.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && window.PRAIChatUI.isRunning()) {
      event.preventDefault();
      window.PRAIChatUI.stop();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); send(); }
  });
  document.getElementById("edie-add-script").addEventListener("click", function () { scriptInput.click(); });
  document.getElementById("edie-add-images").addEventListener("click", function () { imageInput.click(); });
  scriptInput.addEventListener("change", function () { if (scriptInput.files && scriptInput.files[0]) readScript(scriptInput.files[0]); scriptInput.value = ""; });
  imageInput.addEventListener("change", function () {
    imagePaths = Array.prototype.map.call(imageInput.files || [], function (file) { return file.path || ""; }).filter(Boolean);
    imageInput.value = "";
    renderContext();
  });
  frame.addEventListener("load", attachBackend);
  frame.setAttribute("src", "prai/index.html?backend=1");
}());
