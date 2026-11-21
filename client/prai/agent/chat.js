/* PR AI agent chat engine: CLI turns, stream parsing, saved conversations.
 *
 * No DOM here, so it runs under node for tests. chat-ui.js draws it.
 * Patterns follow Creative Assist's Sage (agents.ts / chat.ts): one CLI
 * process per turn, resumed by the CLI's own session id, streamed events,
 * plain-language failures with the raw output going to a log instead.
 *
 * UMD: window.PRAIAgentChat in the panel, require()-able under node.
 */
(function (root, factory) {
  /* CEP's browser context also defines module/exports. */
  if (typeof window === "undefined" && typeof module === "object" && module.exports) {
    module.exports = factory(require("./tools.js"));
  } else {
    root.PRAIAgentChat = factory(root.PRAIAgentTools);
  }
}(typeof self !== "undefined" ? self : this, function (Tools) {
  "use strict";

  var PROVIDER_NAMES = { claude: "Claude", codex: "Codex" };
  var MAX_CONVERSATIONS = 60;
  var MAX_MESSAGES = 300;

  /* ---------- prompt ---------- */

  function systemPrompt() {
    return [
      "You are Edie, the user's editing assistant running inside Adobe Premiere Pro.",
      "You work on the user's open Premiere project ONLY through the `prai` MCP tools. You have no shell and no file editor; use the tools.",
      "",
      "Chain tools to finish multi-step requests in one go. Pass the paths one tool returns into the next. Never invent paths.",
      "For any request to create subtitles/captions from sequence audio and save an SRT, call create_optimized_subtitles. It always runs Whisper -> Optimized Text -> save, and imports those same optimized rows when captions were requested in the timeline.",
      "Never use the Audio + Text preset for ordinary subtitle/caption requests. Audio + Text razors audio against an attached script and is only correct when the user explicitly asks for that script-driven cut workflow.",
      "Example - \"create subtitles from this sequence, optimise the text and keep the srt file\":",
      "  Call create_optimized_subtitles (whole sequence unless the user names a track, range or selection).",
      "  It performs Whisper -> Optimized Text -> durable SRT save as one deterministic operation.",
      "",
      "Tools whose description starts with CHANGES THE PROJECT modify the user's edit. Call them only when the user clearly asked for that change.",
      "The user may be asked to approve each one; if they decline, stop and say so - do not retry it another way.",
      "Read-only tools are always safe. Use get_project_context when you need to know what is in the sequence.",
      "Edie's one-click workflows are available as presets (list_presets / apply_preset); low-level edits (markers, trims, moves, fades...) via list_legacy_actions / run_legacy_action.",
      "",
      "Reply briefly in plain language. When you finish, say what you did and give the full path of any file you saved. If a tool fails, explain why in one or two sentences and suggest the next step."
    ].join("\n");
  }

  /* ---------- turn arguments ---------- */

  function uuid(nodeRequire) {
    var crypto = nodeRequire("crypto");
    if (crypto.randomUUID) {
      return crypto.randomUUID();
    }
    var b = crypto.randomBytes(16);
    b[6] = (b[6] & 15) | 64;
    b[8] = (b[8] & 63) | 128;
    var h = b.toString("hex");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }

  function tomlString(value) {
    return JSON.stringify(String(value));
  }

  /* t: {provider, previous, session, model, effort, images[], mcpConfigPath, nodePath, mcpScript,
         toolsFile, workDir}. Returns the argv after the CLI name ("claude" / "codex"). */
  function turnArgs(t) {
    var images = t.images || [];
    if (t.provider === "claude") {
      var args = ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
        "--mcp-config", t.mcpConfigPath, "--strict-mcp-config",
        "--setting-sources", "", "--disable-slash-commands",
        "--system-prompt", systemPrompt()];
      if (images.length) {
        var dirs = {};
        args.push("--tools", "Read", "--allowedTools", "mcp__" + Tools.SERVER_NAME, "Read");
        for (var i = 0; i < images.length; i++) {
          var dir = images[i].replace(/[\/\\][^\/\\]*$/, "");
          if (dir && !dirs[dir]) {
            dirs[dir] = true;
            args.push("--add-dir", dir);
          }
        }
      } else {
        args.push("--tools", "", "--allowedTools", "mcp__" + Tools.SERVER_NAME);
      }
      if (t.model) {
        args.push("--model", t.model);
      }
      if (t.effort) {
        args.push("--effort", t.effort);
      }
      args.push.apply(args, t.previous ? ["--resume", t.previous] : ["--session-id", t.session]);
      return args;
    }
    var codex = ["exec"];
    if (t.previous) {
      codex.push("resume", t.previous);
    }
    for (var k = 0; k < images.length; k++) {
      codex.push("-i", images[k]);
    }
    codex.push("--json", "--skip-git-repo-check", "--ignore-user-config",
      "-c", "approval_policy=\"never\"",
      "-c", "sandbox_mode=\"read-only\"",
      "-c", "mcp_servers." + Tools.SERVER_NAME + ".command=" + tomlString(t.nodePath),
      "-c", "mcp_servers." + Tools.SERVER_NAME + ".args=[" + tomlString(t.mcpScript) + "]",
      "-c", "mcp_servers." + Tools.SERVER_NAME + ".env={PRAI_TOOLS_FILE=" + tomlString(t.toolsFile) + "}",
      "-c", "mcp_servers." + Tools.SERVER_NAME + ".tool_timeout_sec=1800",
      "-c", "mcp_servers." + Tools.SERVER_NAME + ".startup_timeout_sec=30",
      "-c", "mcp_servers." + Tools.SERVER_NAME + ".default_tools_approval_mode=\"approve\"");
    if (!t.previous && t.workDir) {
      codex.push("-C", t.workDir);
    }
    if (t.model) {
      codex.push("-m", t.model);
    }
    codex.push("-");
    return codex;
  }

  /* Codex has no --system-prompt for exec: the first turn carries it. */
  function turnPrompt(provider, firstTurn, text, images) {
    var body = String(text || "");
    if (provider === "claude" && images && images.length) {
      body += "\n\nAttached images (open them with Read):\n" + images.join("\n");
    }
    if (provider === "codex" && firstTurn) {
      body = systemPrompt() + "\n\n---\n\nUser request:\n" + body;
    }
    return body;
  }

  function mcpConfig(nodePath, mcpScript, toolsFile) {
    var servers = {};
    servers[Tools.SERVER_NAME] = { type: "stdio", command: nodePath, args: [mcpScript], env: { PRAI_TOOLS_FILE: toolsFile } };
    return { mcpServers: servers };
  }

  /* ---------- reading the streams ---------- */

  function stripServer(name) {
    var prefix = "mcp__" + Tools.SERVER_NAME + "__";
    return String(name || "").indexOf(prefix) === 0 ? String(name).slice(prefix.length) : String(name || "tool");
  }

  function stepFor(id, toolName, input) {
    var name = stripServer(toolName);
    var tool = Tools.toolByName(name);
    var target = "";
    if (input && typeof input === "object") {
      target = input.input_path || input.path || input.preset || input.audio_track || input.file_path || "";
      if (!target && input.actions && input.actions.length) {
        target = input.actions.map(function (a) { return a && a.type; }).join(", ");
      }
    }
    return { step: { id: String(id), name: name, target: String(target).replace(/^.*[\/\\]/, ""), mutates: !!(tool && tool.mutates), known: !!tool } };
  }

  /* Claude stream-json -> events: {session}, {text}, {step}, {result,failed}, {finished, reply} */
  function claudeEvents(line) {
    var e;
    try {
      e = JSON.parse(line);
    } catch (err) {
      return [];
    }
    if (!e || typeof e !== "object") {
      return [];
    }
    var sub = typeof e.parent_tool_use_id === "string" && e.parent_tool_use_id.length > 0;
    var blocks = e.message && Array.isArray(e.message.content) ? e.message.content : [];
    var out = [];
    switch (e.type) {
      case "system":
        return e.subtype === "init" && typeof e.session_id === "string" ? [{ session: e.session_id }] : [];
      case "stream_event":
        var d = e.event && e.event.delta;
        if (!sub && e.event && e.event.type === "content_block_delta" && d && d.type === "text_delta" && d.text) {
          return [{ text: d.text }];
        }
        if (!sub && e.event && e.event.type === "content_block_start" && e.event.index > 0 && e.event.content_block && e.event.content_block.type === "text") {
          return [{ text: "", block: true }];
        }
        return [];
      case "assistant":
        for (var i = 0; i < blocks.length; i++) {
          if (blocks[i] && blocks[i].type === "tool_use") {
            out.push(stepFor(blocks[i].id, blocks[i].name, blocks[i].input));
          }
        }
        return out;
      case "user":
        for (var j = 0; j < blocks.length; j++) {
          if (blocks[j] && blocks[j].type === "tool_result") {
            out.push({ result: String(blocks[j].tool_use_id || ""), failed: blocks[j].is_error === true, detail: toolResultText(blocks[j].content) });
          }
        }
        return out;
      case "result":
        var first = Array.isArray(e.errors) ? e.errors[0] : undefined;
        var reply = typeof e.result === "string" ? e.result : "";
        var reason = (typeof first === "string" ? first : (first && first.message)) || reply || "The run failed.";
        return [{ finished: e.is_error === true ? reason : null, reply: reply }];
      default:
        return [];
    }
  }

  function toolResultText(content) {
    if (typeof content === "string") {
      return content.slice(0, 600);
    }
    if (Array.isArray(content)) {
      return content.map(function (c) { return c && c.type === "text" ? c.text : ""; }).join("\n").slice(0, 600);
    }
    return "";
  }

  function codexMessage(m) {
    var t = typeof m === "string" ? m : "";
    try {
      var j = JSON.parse(t);
      return String((j && j.error && j.error.message) || (j && j.message) || t);
    } catch (err) {
      return t;
    }
  }

  function codexReader() {
    return function (line) {
      var e;
      try {
        e = JSON.parse(line);
      } catch (err) {
        return [];
      }
      if (!e || typeof e !== "object") {
        return [];
      }
      switch (e.type) {
        case "thread.started":
          return typeof e.thread_id === "string" ? [{ session: e.thread_id }] : [];
        case "turn.completed":
          return [{ finished: null, reply: "" }];
        case "turn.failed":
          return [{ finished: codexMessage(e.error && e.error.message) || "The run failed.", reply: "" }];
        case "error":
          return [{ problem: codexMessage(e.message) }];
        case "item.started":
        case "item.updated":
        case "item.completed":
          break;
        default:
          return [];
      }
      var item = e.item || {};
      var id = String(item.id || Math.random());
      var done = e.type === "item.completed";
      var failed = item.status === "failed" || item.status === "declined";
      switch (item.type) {
        case "agent_message":
          return done && typeof item.text === "string" && item.text.trim() ? [{ text: item.text.trim(), block: true }] : [];
        case "mcp_tool_call":
          var step = stepFor(id, item.tool || "tool", item.arguments);
          if (item.server && item.server !== Tools.SERVER_NAME) {
            step.step.name = item.server + " · " + (item.tool || "tool");
          }
          return done ? [step, { result: id, failed: failed || !!(item.result && item.result.is_error) || !!item.error }] : [step];
        case "command_execution":
          var cmd = { step: { id: id, name: "shell", target: String(item.command || "").slice(0, 80), mutates: false, known: false } };
          return done ? [cmd, { result: id, failed: failed || (typeof item.exit_code === "number" && item.exit_code !== 0) }] : [cmd];
        default:
          return [];
      }
    };
  }

  /* ---------- failures in plain language ---------- */

  var SESSION_LOST = /no conversation found|no (session|rollout|thread|conversation) (was )?found|could not find (session|thread|conversation)|conversation not found|session not found/i;
  var LOGIN = {
    claude: /Opening authentication page in your browser|"error":"authentication_failed"|Not logged in|Invalid API key|Please run \/login|OAuth token has expired/i,
    codex: /not logged in|codex login|401 Unauthorized|refresh token|token (has )?expired/i
  };
  var LIMIT = /usage limit|rate limit|rate_limit|429|quota|limit reached|overloaded/i;
  var NOT_FOUND = /command not found|not found\. Install/i;

  function sessionLost(text) {
    return SESSION_LOST.test(String(text || ""));
  }

  function plainFailure(provider, code, errors, finishedReason) {
    var name = PROVIDER_NAMES[provider] || provider;
    var all = String(errors || "") + "\n" + String(finishedReason || "");
    if (code === 127 || NOT_FOUND.test(all)) {
      return provider === "claude" ? "Claude Code is not installed on this Mac (or not on PATH). Install it, or pick Codex in the provider menu." : "The Codex CLI is not installed on this Mac. Install it, or pick Claude in the provider menu.";
    }
    if (LOGIN[provider] && LOGIN[provider].test(all)) {
      return provider === "claude" ? "Claude Code needs you to sign in. Run `claude` once in Terminal and log in, then press Try again." : "Codex needs you to sign in. Run `codex login` in Terminal, then press Try again.";
    }
    if (LIMIT.test(all)) {
      return name + " hit a usage or rate limit. Wait a bit, switch model or provider, then press Try again.";
    }
    if (/model/i.test(all) && /not (supported|found)|unknown|invalid/i.test(all)) {
      return name + " does not accept the selected model. Pick another model (or the default) and press Try again.";
    }
    if (finishedReason && !/^Command exited/.test(finishedReason) && finishedReason.length < 300 && !/\n/.test(finishedReason)) {
      return name + " stopped: " + finishedReason;
    }
    return name + " stopped unexpectedly" + (code !== null && code !== undefined ? " (exit code " + code + ")" : "") + ". The details are in the Edie agent log.";
  }

  /* ---------- running one turn ---------- */

  /* opts: {nodeRequire, provider, command (zsh script), input, cwd, onEvent(ev), onExit({code, errors, cancelled}), log(text)} */
  function runTurn(opts) {
    var nodeRequire = opts.nodeRequire;
    var cp = nodeRequire("child_process");
    var proc = nodeRequire("process");
    var parse = opts.provider === "claude" ? claudeEvents : codexReader();
    var child = cp.spawn("/bin/zsh", ["-lc", opts.command], { cwd: opts.cwd || nodeRequire("os").homedir(), detached: true, env: proc.env });
    var buffer = "";
    var errors = "";
    var cancelled = false;
    var exited = false;
    function feed(text) {
      buffer += text;
      var lines = buffer.split("\n");
      buffer = lines.pop();
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].replace(/\r$/, "");
        if (!line) {
          continue;
        }
        var events = parse(line);
        if (!events.length && line.charAt(0) !== "{" && opts.log) {
          opts.log("stdout: " + line.slice(0, 500));
        }
        for (var k = 0; k < events.length; k++) {
          opts.onEvent(events[k]);
        }
      }
    }
    child.stdout.on("data", function (c) { feed(c.toString()); });
    child.stderr.on("data", function (c) {
      var t = c.toString();
      errors += t;
      if (errors.length > 20000) {
        errors = errors.slice(errors.length - 20000);
      }
    });
    child.on("error", function (err) {
      errors += "\n" + String(err && err.message ? err.message : err);
    });
    child.on("close", function (code) {
      exited = true;
      if (buffer) {
        feed("\n");
      }
      if (opts.log && errors.replace(/\s+/g, "")) {
        opts.log("stderr (exit " + code + "):\n" + errors.slice(-6000));
      }
      opts.onExit({ code: code, errors: errors, cancelled: cancelled });
    });
    child.stdin.on("error", function () {});
    child.stdin.write(opts.input || "");
    child.stdin.end();

    return {
      stop: function () {
        if (exited) {
          return;
        }
        cancelled = true;
        try {
          proc.kill(-child.pid, "SIGTERM");
        } catch (err) {
          try { child.kill("SIGTERM"); } catch (e2) {}
        }
        setTimeout(function () {
          if (!exited) {
            try { proc.kill(-child.pid, "SIGKILL"); } catch (err) {}
          }
        }, 1500);
      }
    };
  }

  /* ---------- conversations ---------- */

  function emptyStore() {
    return { version: 1, current: "", conversations: [] };
  }

  function loadStore(fs, file) {
    try {
      var data = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!data || !Array.isArray(data.conversations)) {
        return emptyStore();
      }
      /* A run that never recorded its end was cut off (panel closed, Premiere quit). */
      for (var c = 0; c < data.conversations.length; c++) {
        var msgs = data.conversations[c].messages || [];
        for (var m = 0; m < msgs.length; m++) {
          if (msgs[m].run && !msgs[m].run.ended) {
            msgs[m].run.ended = msgs[m].run.started || Date.now();
            msgs[m].run.cut = true;
            (msgs[m].steps || []).forEach(function (s) {
              if (s.state === "running") {
                s.state = "unknown";
              }
            });
          }
        }
      }
      return data;
    } catch (err) {
      return emptyStore();
    }
  }

  function saveStore(fs, path, file, store) {
    store.conversations.sort(function (a, b) { return (b.updated || 0) - (a.updated || 0); });
    if (store.conversations.length > MAX_CONVERSATIONS) {
      store.conversations = store.conversations.slice(0, MAX_CONVERSATIONS);
    }
    store.conversations.forEach(function (c) {
      if (c.messages.length > MAX_MESSAGES) {
        c.messages = c.messages.slice(c.messages.length - MAX_MESSAGES);
      }
    });
    Tools.writeFileAtomic(fs, path, file, JSON.stringify(store), 384);
  }

  function newConversation(nodeRequire) {
    return { id: uuid(nodeRequire), title: "New chat", created: Date.now(), updated: Date.now(), messages: [], sessions: {} };
  }

  function titleFrom(text) {
    var t = String(text || "").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
    return t ? (t.length > 48 ? t.slice(0, 47) + "…" : t) : "New chat";
  }

  /* A short recap so a turn that lost its CLI session still has the thread. */
  function recap(conversation, upToIndex) {
    var lines = [];
    var msgs = conversation.messages.slice(0, upToIndex);
    var start = Math.max(0, msgs.length - 8);
    for (var i = start; i < msgs.length; i++) {
      if (msgs[i].text) {
        lines.push((msgs[i].role === "user" ? "User: " : "You: ") + String(msgs[i].text).slice(0, 800));
      }
    }
    return lines.length ? "Earlier in this chat (the previous session could not be resumed):\n" + lines.join("\n") + "\n\n---\n\n" : "";
  }

  return {
    PROVIDER_NAMES: PROVIDER_NAMES,
    systemPrompt: systemPrompt,
    turnArgs: turnArgs,
    turnPrompt: turnPrompt,
    mcpConfig: mcpConfig,
    claudeEvents: claudeEvents,
    codexReader: codexReader,
    sessionLost: sessionLost,
    plainFailure: plainFailure,
    runTurn: runTurn,
    loadStore: loadStore,
    saveStore: saveStore,
    newConversation: newConversation,
    titleFrom: titleFrom,
    recap: recap,
    uuid: uuid
  };
}));
