#!/usr/bin/env node
/* PR AI stdio MCP server. Dependency-free CommonJS, run with the system node.
 *
 * The Claude / Codex CLI starts this for a chat turn. It speaks JSON-RPC over
 * stdin/stdout and forwards every tool call to the PR AI panel's local HTTP
 * tool server, whose {port, token} it reads from the file named by
 * PRAI_TOOLS_FILE (default: <support>/agent-server.json) on every call, so a
 * panel reload with a new port is picked up.
 *
 * Test by hand:
 *   printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
 *     '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | node client/prai/agent/mcp.js
 */
"use strict";

var fs = require("fs");
var os = require("os");
var path = require("path");
var http = require("http");
var readline = require("readline");
var Tools = require("./tools.js");

var VERSION = "1.0.0";
var INFO = process.env.PRAI_TOOLS_FILE || path.join(Tools.supportDir(os, path, process.env), "agent-server.json");
var CALL_TIMEOUT_MS = 30 * 60 * 1000;

function text(t, isError) {
  var out = { content: [{ type: "text", text: t }] };
  if (isError) {
    out.isError = true;
  }
  return out;
}

function serverInfo() {
  var info;
  try {
    info = JSON.parse(fs.readFileSync(INFO, "utf8"));
  } catch (err) {
    throw new Error("The PR AI panel is not running (no tool server). Open the PR FX panel's PR AI tab in Premiere, then try again.");
  }
  if (!info || !info.port || !info.token) {
    throw new Error("The PR AI tool server file is incomplete. Reopen the PR AI tab.");
  }
  return info;
}

function request(method, route, body) {
  return new Promise(function (resolve, reject) {
    var info;
    try {
      info = serverInfo();
    } catch (err) {
      reject(err);
      return;
    }
    var data = body ? JSON.stringify(body) : "";
    var req = http.request({
      host: "127.0.0.1",
      port: info.port,
      path: route,
      method: method,
      headers: { "X-PRAI-Token": info.token, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }
    }, function (res) {
      var chunks = [];
      res.on("data", function (c) { chunks.push(c); });
      res.on("end", function () {
        var raw = Buffer.concat(chunks).toString("utf8");
        if (res.statusCode === 403) {
          reject(new Error("The PR AI panel refused the call (stale token). Reopen the PR AI tab."));
          return;
        }
        try {
          resolve(JSON.parse(raw));
        } catch (err) {
          reject(new Error("The PR AI panel sent an unreadable reply."));
        }
      });
    });
    req.setTimeout(CALL_TIMEOUT_MS, function () {
      req.destroy(new Error("The PR AI panel did not answer within 30 minutes."));
    });
    req.on("error", function (err) {
      reject(err && err.code === "ECONNREFUSED" ? new Error("The PR AI panel is not running. Open the PR FX panel's PR AI tab in Premiere, then try again.") : err);
    });
    req.end(data);
  });
}

function call(name, args) {
  if (!Tools.toolByName(name)) {
    return Promise.resolve(text("Unknown tool: " + name, true));
  }
  return request("POST", "/call", { name: name, arguments: args || {} }).then(function (res) {
    if (!res.ok) {
      return text(res.error || "The tool failed.", true);
    }
    var result = res.result;
    return text(typeof result === "string" ? result : JSON.stringify(result, null, 2));
  }, function (err) {
    return text(String(err && err.message ? err.message : err), true);
  });
}

function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: id, result: result }) + "\n");
}
function fail(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: id, error: { code: code, message: message } }) + "\n");
}

var INSTRUCTIONS = "PR AI edits the open Adobe Premiere Pro project. Tools chain: e.g. transcribe_audio_to_srt -> optimize_srt -> save_srt. " +
  "Tools whose description starts with CHANGES THE PROJECT modify the user's edit: call them only when the user asked for that change.";

var rl = readline.createInterface({ input: process.stdin });
var pending = 0;
var closed = false;
rl.on("line", function (line) {
  var msg;
  try {
    msg = JSON.parse(line);
  } catch (err) {
    return;
  }
  var id = msg && msg.id;
  var method = msg && msg.method;
  var params = (msg && msg.params) || {};
  if (id === undefined || id === null) {
    return;
  }
  try {
    if (method === "initialize") {
      reply(id, {
        protocolVersion: params.protocolVersion || "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: Tools.SERVER_NAME, version: VERSION },
        instructions: INSTRUCTIONS
      });
      return;
    }
    if (method === "ping") {
      reply(id, {});
      return;
    }
    if (method === "tools/list") {
      reply(id, { tools: Tools.toolList() });
      return;
    }
    if (method === "tools/call") {
      pending++;
      call(params.name, params.arguments || {}).then(function (result) {
        reply(id, result);
      }).then(function () {
        pending--;
        if (closed && !pending) {
          process.exit(0);
        }
      });
      return;
    }
    if (method === "resources/list") {
      reply(id, { resources: [] });
      return;
    }
    if (method === "prompts/list") {
      reply(id, { prompts: [] });
      return;
    }
    fail(id, -32601, "Method not found: " + method);
  } catch (err) {
    fail(id, -32603, String(err && err.message ? err.message : err));
  }
});
rl.on("close", function () {
  closed = true;
  if (!pending) {
    process.exit(0);
  }
});
