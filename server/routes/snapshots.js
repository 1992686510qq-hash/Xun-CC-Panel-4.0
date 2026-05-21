var fs = require("fs");
var path = require("path");
var shared = require("../shared");
var scanner = require("../scanner");
var snapshot = require("../snapshot");

function makeSnapshotsRouter() {
  return function handle(req, res) {
    // API: list snapshots
    if (req.url === "/api/snapshots") {
      snapshot.loadSnapshotsFromDisk();
      var list = shared.snapshotList.map(function(s) { return { id: s.id, timestamp: s.timestamp, sessionCount: s.data ? s.data.sessionCount : 0 }; });
      list.sort(function(a, b) { return b.timestamp.localeCompare(a.timestamp); });
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(list));
      return true;
    }

    // API: snapshot detail
    if (req.url.startsWith("/api/snapshot/") && req.url.indexOf("/api/snapshot/create") === -1 && req.url.indexOf("/api/snapshot/delete") === -1 && req.url.indexOf("/api/snapshot/rollback") === -1) {
      var snapId = decodeURI(req.url.split("/api/snapshot/")[1]);
      var snapFile = path.join(shared.SNAPSHOTS_DIR, snapId + ".json");
      if (!fs.existsSync(snapFile)) { res.writeHead(404); res.end(JSON.stringify({ error: "not found" })); return true; }
      try {
        var snapData = JSON.parse(fs.readFileSync(snapFile, "utf-8"));
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(snapData));
      } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: "read error" })); }
      return true;
    }

    // API: create snapshot
    if (req.url === "/api/snapshot/create") {
      scanner.scanSessions(shared.PROJECTS_DIR, []).then(function(sess) {
        for (var n = 0; n < sess.length; n++) {
          sess[n].status = scanner.getStatus(sess[n].fileMtimeMs, sess[n].lastMeaningfulTimestamp, sess[n].lastMeaningfulStopReason);
        }
        var snap = snapshot.saveSnapshot("manual-" + Date.now(), sess);
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(snap ? { ok: true, id: snap.id, timestamp: snap.timestamp } : { ok: false, error: "save failed" }));
      });
      return true;
    }

    // API: delete snapshot
    if (req.url.startsWith("/api/snapshot/delete/")) {
      var delId = decodeURI(req.url.split("/api/snapshot/delete/")[1]);
      snapshot.deleteSnapshot(delId);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true }));
      return true;
    }

    return false;
  };
}

module.exports = makeSnapshotsRouter;
