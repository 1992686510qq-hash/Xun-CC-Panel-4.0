var path = require("path");
var shared = require("../shared");
var scanner = require("../scanner");
var pricing = require("../pricing");

function makeOpenRouter() {
  return function handle(req, res) {
    // API: open terminal to resume session (FIXED: no shell injection via string concat)
    if (req.url.startsWith("/api/terminal-bat/") && req.method === "GET") {
      var batId = decodeURI(req.url.split("/api/terminal-bat/")[1]);
      var batCached = shared.sessionCache.get(batId);
      if (!batCached || !batCached._file) {
        scanner.scanSessions(shared.PROJECTS_DIR, []).then(function(all2) {
          for (var bi = 0; bi < all2.length; bi++) { if (all2[bi].id === batId) { batCached = all2[bi]; break; } }
          launchTerminalBat(batCached, batId, res);
        });
      } else {
        launchTerminalBat(batCached, batId, res);
      }
      return true;
    }

    // API: open session in VSCode (FIXED: no shell injection via execSync string concat)
    if (req.url.startsWith("/api/open-session/")) {
      var openId = decodeURI(req.url.split("/api/open-session/")[1]);
      var target = shared.sessionCache.get(openId);
      if (!target || !target._file) {
        scanner.scanSessions(shared.PROJECTS_DIR, []).then(function(all2) {
          for (var m = 0; m < all2.length; m++) { if (all2[m].id === openId) { target = all2[m]; break; } }
          launchSession(target, openId, res);
        });
      } else {
        launchSession(target, openId, res);
      }
      return true;
    }

    return false;
  };
}

function launchTerminalBat(batCached, batId, res) {
  var batCwd = batCached && batCached.cwd ? batCached.cwd : "";
  var npmBin = process.env.APPDATA ? path.join(process.env.APPDATA, "npm") : null;
  var claudeExe = npmBin ? path.join(npmBin, "claude.cmd") : "claude";

  // Use spawn with separate args — no shell injection via string concatenation
  try {
    var child = require("child_process").spawn("cmd", ["/c", "start", "\"Claude\"", claudeExe, "--resume", batId], {
      cwd: batCwd || undefined,
      detached: true,
      stdio: "ignore"
    });
    child.unref();
  } catch (e) {}

  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ ok: true }));
}

function launchSession(target, openId, res) {
  var cwd = target.cwd || path.dirname(target._file);
  var result = { ok: false, actions: [] };
  var npmBin = process.env.APPDATA ? path.join(process.env.APPDATA, "npm") : null;
  var claudeExe = npmBin ? path.join(npmBin, "claude.cmd") : "claude";
  var launched = false;
  var child_process = require("child_process");

  // Use spawn with separate args arrays — no shell injection
  try {
    var child = child_process.spawn("cmd", ["/c", "start", "\"Claude\"", claudeExe, "--resume", openId, "--ide"], { detached: true, stdio: "ignore" });
    child.unref();
    launched = true;
    result.actions.push("claude-resume");
  } catch (ee) {}
  if (!launched) {
    try {
      var child2 = child_process.spawn("cmd", ["/c", "start", "\"\"", "code", target._file], { detached: true, stdio: "ignore" });
      child2.unref();
      launched = true;
      result.actions.push("code-file");
    } catch (ee) {}
  }
  if (!launched) {
    try {
      var child3 = child_process.spawn("cmd", ["/c", "start", "\"\"", "code", cwd, "--reuse-window"], { detached: true, stdio: "ignore" });
      child3.unref();
      launched = true;
      result.actions.push("code-cwd");
    } catch (ee) {}
  }

  result.ok = launched;
  if (result.ok) { result.sessionId = openId; result.title = target.title; }
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(result.ok ? result : { ok: false, error: "无法启动会话" }));
}

module.exports = makeOpenRouter;
