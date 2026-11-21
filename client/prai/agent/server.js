/* PR AI agent tool server.
 *
 * A tiny HTTP server inside the PR AI panel on 127.0.0.1 (random port) that
 * runs the tools in tools.js. The stdio MCP server (mcp.js), which the Claude
 * or Codex CLI starts, proxies every tool call here, because only the panel can
 * reach Premiere (evalScript) and PR AI's Whisper/caption code.
 *
 * {port, token, pid} goes to <support>/agent-server.json, mode 0600, written
 * atomically. Every request needs the X-PRAI-Token header; anything else 403.
 *
 * UMD: window.PRAIAgentServer in the panel, require()-able under node (tests).
 */
(function (root, factory) {
  /* CEP's browser context also defines module/exports. */
  if (typeof window === "undefined" && typeof module === "object" && module.exports) {
    module.exports = factory(require("./tools.js"));
  } else {
    root.PRAIAgentServer = factory(root.PRAIAgentTools);
  }
}(typeof self !== "undefined" ? self : this, function (Tools) {
  "use strict";

  var INFO_FILE = "agent-server.json";

  /* options: {nodeRequire, deps (tools.createHandlers deps), supportDir?, log?(text), onCall?(name, args, phase, info)} */
  function start(options) {
    var nodeRequire = options.nodeRequire;
    var http = nodeRequire("http");
    var crypto = nodeRequire("crypto");
    var fs = nodeRequire("fs");
    var path = nodeRequire("path");
    var os = nodeRequire("os");
    var proc = nodeRequire("process");
    var log = options.log || function () {};
    var dir = options.supportDir || Tools.supportDir(os, path, proc.env);
    Tools.ensureDir(fs, dir, 448);
    var infoPath = path.join(dir, INFO_FILE);
    var token = crypto.randomBytes(24).toString("hex");
    var deps = options.deps;
    deps.supportDir = dir;
    deps.nodeRequire = nodeRequire;
    var call = Tools.createHandlers(deps);
    var active = 0;

    function send(res, status, body) {
      var text = JSON.stringify(body);
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(text);
    }

    var server = http.createServer(function (req, res) {
      if (req.headers["x-prai-token"] !== token || req.headers.origin) {
        send(res, 403, { ok: false, error: "forbidden" });
        return;
      }
      if (req.method === "GET" && req.url === "/health") {
        send(res, 200, { ok: true, pid: proc.pid, active: active });
        return;
      }
      if (req.method === "GET" && req.url === "/tools") {
        send(res, 200, { ok: true, tools: Tools.toolList() });
        return;
      }
      if (req.method === "POST" && req.url === "/call") {
        var chunks = [];
        var size = 0;
        req.on("data", function (c) {
          size += c.length;
          if (size > 8 * 1024 * 1024) {
            req.destroy();
            return;
          }
          chunks.push(c);
        });
        req.on("end", function () {
          var body;
          try {
            body = JSON.parse(nodeRequire("buffer").Buffer.concat(chunks).toString("utf8") || "{}");
          } catch (err) {
            send(res, 400, { ok: false, error: "Bad JSON." });
            return;
          }
          var name = String(body.name || "");
          var args = body.arguments && typeof body.arguments === "object" ? body.arguments : {};
          var started = Date.now();
          active++;
          log("tool " + name + " " + JSON.stringify(args).slice(0, 400));
          if (options.onCall) {
            options.onCall(name, args, "start");
          }
          call(name, args).then(function (result) {
            log("tool " + name + " ok in " + (Date.now() - started) + "ms");
            if (options.onCall) {
              options.onCall(name, args, "ok", result);
            }
            send(res, 200, { ok: true, result: result === undefined ? null : result });
          }, function (err) {
            var message = String(err && err.message ? err.message : err);
            log("tool " + name + " failed: " + message);
            if (options.onCall) {
              options.onCall(name, args, "failed", message);
            }
            send(res, 200, { ok: false, error: message });
          }).then(function () {
            active--;
          });
        });
        return;
      }
      send(res, 404, { ok: false, error: "not found" });
    });
    server.timeout = 0;
    server.keepAliveTimeout = 5000;
    if ("requestTimeout" in server) {
      server.requestTimeout = 0;
    }

    return new Promise(function (resolve, reject) {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", function () {
        var port = server.address().port;
        try {
          Tools.writeFileAtomic(fs, path, infoPath, JSON.stringify({ port: port, token: token, pid: proc.pid, started: new Date().toISOString() }), 384);
          fs.chmodSync(infoPath, 384);
        } catch (err) {
          server.close();
          reject(err);
          return;
        }
        log("agent tool server on 127.0.0.1:" + port);
        resolve({
          port: port,
          infoPath: infoPath,
          supportDir: dir,
          call: call,
          close: function () {
            try {
              var info = JSON.parse(fs.readFileSync(infoPath, "utf8"));
              if (info && info.port === port) {
                fs.unlinkSync(infoPath);
              }
            } catch (err) {
            }
            server.close();
          }
        });
      });
    });
  }

  return { start: start, INFO_FILE: INFO_FILE };
}));
