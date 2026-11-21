/* The one place PR FX's panel starts a shell (2026-11-21), loaded before every script that runs one.
 *
 * Every AI function, the panel's agent chat and its helper lookups are POSIX shell scripts of small steps (ffmpeg,
 * WhisperX, sed, curl, the claude/codex CLIs). On the Mac they run in zsh as a login shell, as always. On Windows the
 * same script runs in Git for Windows' bash, so each function works there without being rewritten one by one; the few
 * truly Mac-only lines (open -a, stat -f, Apple Vision) branch on isWindows(). tools/check-platform.js fails on a
 * "/bin/zsh" or a Mac-only command anywhere outside this file or such a branch.
 */
(function (global) {
  "use strict";
  var cachedBash = null;

  function isWindows(nodeRequire) {
    return !!(nodeRequire && nodeRequire("process").platform === "win32");
  }

  /** Git for Windows' bash.exe, or "". */
  function bashPath(nodeRequire) {
    var fs = nodeRequire("fs");
    if (cachedBash && fs.existsSync(cachedBash)) {
      return cachedBash;
    }
    var path = nodeRequire("path");
    var env = nodeRequire("process").env;
    var places = [
      env.ProgramFiles && path.join(env.ProgramFiles, "Git", "bin", "bash.exe"),
      env["ProgramFiles(x86)"] && path.join(env["ProgramFiles(x86)"], "Git", "bin", "bash.exe"),
      env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Programs", "Git", "bin", "bash.exe")
    ];
    // Git installed elsewhere: its bash is beside the cmd folder it puts on PATH.
    String(env.PATH || env.Path || "").split(";").forEach(function (dir) {
      if (/[\\\/]Git[\\\/]cmd[\\\/]?$/i.test(dir)) {
        places.push(path.join(dir, "..", "bin", "bash.exe"));
      }
    });
    for (var i = 0; i < places.length; i++) {
      if (places[i] && fs.existsSync(places[i])) {
        cachedBash = places[i];
        return places[i];
      }
    }
    return "";
  }

  var MISSING = "On Windows, AI functions run their steps in Git Bash, which isn't installed. Install it from Edie's board in " +
    "Creative Assist (Git Bash → Install) or with: winget install Git.Git. Then try again.";

  /** [program, args] that run `command` in the login shell of this computer. Throws when Windows has no Git Bash. */
  function shellArgs(nodeRequire, command) {
    if (isWindows(nodeRequire)) {
      var bash = bashPath(nodeRequire);
      if (!bash) {
        throw new Error(MISSING);
      }
      return [bash, ["-lc", command]];
    }
    return ["/bin/zsh", ["-lc", command]];
  }

  function options(nodeRequire, extra) {
    var o = { cwd: nodeRequire("os").homedir(), env: nodeRequire("process").env, windowsHide: true };
    Object.keys(extra || {}).forEach(function (key) {
      if (extra[key] !== undefined) {
        o[key] = extra[key];
      }
    });
    // A detached child gets its own console window on Windows; there the whole tree is ended with taskkill instead.
    if (isWindows(nodeRequire)) {
      delete o.detached;
      // Python on Windows writes to a pipe in the old ANSI code page (cp1252), so WhisperX crashed on the first
      // transcribed line it printed in Chinese ("UnicodeEncodeError: 'charmap' codec", 2026-11-22). UTF-8 throughout,
      // as on the Mac.
      var env = {};
      Object.keys(o.env || {}).forEach(function (key) { env[key] = o.env[key]; });
      env.PYTHONUTF8 = "1";
      env.PYTHONIOENCODING = "utf-8";
      o.env = env;
    }
    return o;
  }

  /** child_process.spawn of `command` in the shell. */
  function spawn(nodeRequire, command, extra) {
    var a = shellArgs(nodeRequire, command);
    return nodeRequire("child_process").spawn(a[0], a[1], options(nodeRequire, extra));
  }

  /** child_process.execFile of `command` in the shell; a missing Git Bash comes back as the callback's error. */
  function execFile(nodeRequire, command, extra, callback) {
    var a;
    try {
      a = shellArgs(nodeRequire, command);
    } catch (err) {
      setTimeout(function () { callback(err, "", ""); }, 0);
      return null;
    }
    return nodeRequire("child_process").execFile(a[0], a[1], options(nodeRequire, extra), callback);
  }

  /** Ends a step and everything it started: the process group on the Mac, the process tree on Windows. */
  function endTree(nodeRequire, child, hard) {
    if (!child || !child.pid) {
      return;
    }
    if (isWindows(nodeRequire)) {
      try {
        nodeRequire("child_process").execFile("taskkill.exe", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }, function () {});
      } catch (err) {
        try { child.kill(); } catch (killErr) {}
      }
      return;
    }
    try {
      nodeRequire("process").kill(-child.pid, hard ? "SIGKILL" : "SIGTERM");
    } catch (groupErr) {
      try { child.kill(hard ? "SIGKILL" : "SIGTERM"); } catch (killErr) {}
    }
  }

  global.prfxShell = { isWindows: isWindows, bashPath: bashPath, spawn: spawn, execFile: execFile, endTree: endTree, missingMessage: MISSING };
}(typeof window !== "undefined" ? window : this));
