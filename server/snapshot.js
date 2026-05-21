var fs = require("fs");
var path = require("path");
var shared = require("./shared");

function loadSnapshotsFromDisk() {
  try {
    if (!fs.existsSync(shared.SNAPSHOTS_DIR)) { fs.mkdirSync(shared.SNAPSHOTS_DIR, { recursive: true }); return; }
    var files = fs.readdirSync(shared.SNAPSHOTS_DIR).filter(function(f) { return f.endsWith(".json"); }).sort();
    shared.snapshotList = [];
    for (var i = 0; i < files.length; i++) {
      try {
        var data = JSON.parse(fs.readFileSync(path.join(shared.SNAPSHOTS_DIR, files[i]), "utf-8"));
        shared.snapshotList.push({ id: files[i].replace(".json", ""), file: files[i], data: data, timestamp: data.timestamp || "" });
      } catch (e) { /* skip corrupt */ }
    }
  } catch (e) { console.error("[CC面板] loadSnapshots:", e.message); }
}

function saveSnapshot(id, sessions) {
  var timestamp = new Date().toISOString();
  var snapshot = {
    id: id, timestamp: timestamp, sessionCount: sessions.length,
    sessions: sessions.map(function(s) {
      return {
        id: s.id, title: s.title, status: s.status, activity: s.activity, tokenHeat: s.tokenHeat,
        _itok: s._itok || 0, _otok: s._otok || 0, model: s.model,
        lastTimestamp: s.lastTimestamp, fileMtime: s.fileMtime,
        lastStopReason: s.lastStopReason, userMsgCount: s.userMsgCount,
        assistantMsgCount: s.assistantMsgCount, cwd: s.cwd,
        keyDecisions: (s.keyDecisions || []).slice(-20)
      };
    })
  };

  var filePath = path.join(shared.SNAPSHOTS_DIR, id + ".json");
  try {
    fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2), "utf-8");
    shared.snapshotList.push({ id: id, file: id + ".json", data: snapshot, timestamp: timestamp });
    // Keep max 30 auto-snapshots
    var autos = shared.snapshotList.filter(function(s) { return s.id.indexOf("auto-") === 0; });
    if (autos.length > 30) {
      autos.sort(function(a, b) { return a.timestamp.localeCompare(b.timestamp); });
      var toDel = autos.slice(0, autos.length - 30);
      for (var d = 0; d < toDel.length; d++) {
        try { fs.unlinkSync(path.join(shared.SNAPSHOTS_DIR, toDel[d].id + ".json")); } catch (e) {}
        shared.snapshotList = shared.snapshotList.filter(function(s) { return s.id !== toDel[d].id; });
      }
    }
    return snapshot;
  } catch (e) { return null; }
}

function deleteSnapshot(id) {
  try { fs.unlinkSync(path.join(shared.SNAPSHOTS_DIR, id + ".json")); } catch (e) {}
  shared.snapshotList = shared.snapshotList.filter(function(s) { return s.id !== id; });
}

module.exports = {
  loadSnapshotsFromDisk: loadSnapshotsFromDisk,
  saveSnapshot: saveSnapshot,
  deleteSnapshot: deleteSnapshot
};
