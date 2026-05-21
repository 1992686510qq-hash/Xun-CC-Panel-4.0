var fs = require("fs");
var path = require("path");
var shared = require("./shared");
var scanner = require("./scanner");
var agents = require("./agents");
var sse = require("./sse");
var snapshot = require("./snapshot");

function setupFileWatcher() {
  if (!fs.existsSync(shared.PROJECTS_DIR)) return;

  // Watch top-level project dirs recursively
  try {
    var topEntries = fs.readdirSync(shared.PROJECTS_DIR, { withFileTypes: true });
    for (var i = 0; i < topEntries.length; i++) {
      if (topEntries[i].isDirectory()) {
        var dirPath = path.join(shared.PROJECTS_DIR, topEntries[i].name);
        watchDir(dirPath);
      }
    }
  } catch (e) {
    console.error("[CC面板] watcher setup error:", e.message);
  }
}

function watchDir(dirPath) {
  try {
    var watcher = fs.watch(dirPath, { recursive: true }, function(eventType, filename) {
      if (!filename) return;
      // Debounce
      var key = dirPath;
      if (shared.pendingChanges.has(key)) clearTimeout(shared.pendingChanges.get(key));
      shared.pendingChanges.set(key, setTimeout(function() {
        shared.pendingChanges.delete(key);
        processChanges();
      }, shared.WATCH_DEBOUNCE_MS));
    });
    watcher.on("error", function() { /* swallow */ });
    shared.watchers.push(watcher);
  } catch (e) {
    // fs.watch may fail on some systems, polling fallback covers it
  }
}

var _processing = false;
function processChanges() {
  if (_processing) return;
  _processing = true;
  try {
    scanner.scanSessions(shared.PROJECTS_DIR, []).then(function(sessions) {
      agents.scanSubAgents(sessions);

      for (var i = 0; i < sessions.length; i++) {
        sessions[i].status = scanner.getStatus(sessions[i].fileMtimeMs, sessions[i].lastMeaningfulTimestamp, sessions[i].lastMeaningfulStopReason);
      }

      // Auto-snapshot
      var now = Date.now();
      if (now - shared.lastAutoSnapshot > shared.AUTO_SNAPSHOT_INTERVAL) {
        shared.lastAutoSnapshot = now;
        snapshot.saveSnapshot("auto-" + new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19), sessions);
      }

      sse.broadcastSSE({ type: "sessions-update", timestamp: new Date().toISOString() });
    }).finally(function() {
      _processing = false;
    });
  } catch (e) {
    _processing = false;
  }
}

function cleanupWatchers() {
  for (var i = 0; i < shared.watchers.length; i++) {
    try { shared.watchers[i].close(); } catch (e) {}
  }
  shared.watchers.length = 0;
}

module.exports = {
  setupFileWatcher: setupFileWatcher,
  watchDir: watchDir,
  processChanges: processChanges,
  cleanupWatchers: cleanupWatchers
};
