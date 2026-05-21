var fs = require("fs");
var path = require("path");
var shared = require("./shared");
var scanner = require("./scanner");

function loadAgentNames() {
  try { return JSON.parse(fs.readFileSync(shared.AGENT_NAMES_FILE, "utf-8")); } catch (e) { return {}; }
}

function buildAgentName(subagent_type, description, fallback) {
  var parts = [];
  if (subagent_type) parts.push(subagent_type);
  if (description) parts.push(description.slice(0, 50));
  if (parts.length > 0) return parts.join(": ");
  return fallback || "";
}

// ============ Sub-Agent Detection ============

function findSubAgentFiles(sessionDir) {
  var results = [];
  var subagentsDir = path.join(sessionDir, "subagents");
  if (!fs.existsSync(subagentsDir)) return results;
  var entries;
  try { entries = fs.readdirSync(subagentsDir, { withFileTypes: true }); } catch (e) { return results; }
  for (var i = 0; i < entries.length; i++) {
    if (entries[i].isFile() && entries[i].name.endsWith(".jsonl") && entries[i].name.startsWith("agent-")) {
      results.push({ filePath: path.join(subagentsDir, entries[i].name), agentId: entries[i].name.replace(".jsonl", ""), parentSessionDir: sessionDir });
    }
  }
  return results;
}

function parseSubAgent(filePath, agentId, parentSessionId) {
  var info = {
    id: agentId, parentSessionId: parentSessionId, title: agentId, type: "sub-agent",
    model: null, status: "idle",
    totalLines: 0, _itok: 0, _otok: 0,
    lastTimestamp: null, lastEntryType: null, lastStopReason: null,
    lastMeaningfulTimestamp: null, lastMeaningfulStopReason: undefined,
    fileSize: 0, fileMtime: null, fileMtimeMs: 0,
    keyDecisions: [], toolCallCount: 0
  };

  try {
    var stat = fs.statSync(filePath);
    info.fileSize = stat.size;
    info.fileMtime = stat.mtime.toISOString();
    info.fileMtimeMs = stat.mtimeMs;
  } catch (e) { return info; }

  var content;
  try { content = fs.readFileSync(filePath, "utf-8"); } catch (e) { return info; }

  var lines = content.trim().split("\n");
  info.totalLines = lines.length;

  var firstUserText = null;
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "") continue;
    var obj = scanner.parseLine(lines[i]);
    if (!obj) continue;

    // Extract title from first user message
    if (firstUserText === null && obj.type === "user" && obj.message && obj.message.content) {
      for (var k2 = 0; k2 < obj.message.content.length; k2++) {
        if (obj.message.content[k2].type === "text" && obj.message.content[k2].text) {
          var rawText = obj.message.content[k2].text;
          var textLines = rawText.split("\n");
          var cleaned = "";
          for (var li = 0; li < textLines.length; li++) {
            var tline = textLines[li].trim();
            if (/^(Base directory|You are|你是一个|System:|\[|#)/.test(tline)) continue;
            if (tline) { cleaned = tline; break; }
          }
          if (!cleaned) cleaned = rawText.replace(/\n/g, " ").trim();
          firstUserText = cleaned.slice(0, 60);
          break;
        }
      }
    }

    if (obj.type === "assistant") {
      if (obj.message && obj.message.stop_reason) info.lastStopReason = obj.message.stop_reason;
      if (obj.message && obj.message.usage) {
        info._itok += (obj.message.usage.input_tokens || 0);
        info._otok += (obj.message.usage.output_tokens || 0);
      }
      if (!info.model && obj.message && obj.message.model) info.model = obj.message.model;
      if (obj.message && obj.message.content && Array.isArray(obj.message.content)) {
        for (var k = 0; k < obj.message.content.length; k++) {
          if (obj.message.content[k].type === "tool_use") {
            info.toolCallCount++;
            info.keyDecisions.push({
              timestamp: obj.timestamp || null,
              tool: obj.message.content[k].name || "unknown",
              input: obj.message.content[k].input ? JSON.stringify(obj.message.content[k].input).slice(0, 200) : ""
            });
          }
        }
      }
    }
    if (obj.type === "user" || obj.type === "assistant") {
      info.lastMeaningfulTimestamp = obj.timestamp || info.lastMeaningfulTimestamp;
      if (obj.type === "assistant" && obj.message && obj.message.stop_reason) {
        info.lastMeaningfulStopReason = obj.message.stop_reason;
      } else if (obj.type === "user") {
        info.lastMeaningfulStopReason = null;
      }
    }
    info.lastEntryType = obj.type;
    if (obj.timestamp) info.lastTimestamp = obj.timestamp;
  }

  // Use extracted first user message as title if available and no better name yet
  if (firstUserText && info.title === agentId) {
    info.title = firstUserText;
  }

  // Try meta file for descriptive title (takes priority over auto-extraction)
  var metaPath = filePath.replace(".jsonl", ".meta.json");
  try {
    var meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
    if (meta.description) info.title = meta.description.slice(0, 80);
  } catch (e) {}

  return info;
}

function scanSubAgents(sessions) {
  shared.subAgentCache.clear();
  for (var i = 0; i < sessions.length; i++) {
    var s = sessions[i];
    if (!s._file) continue;
    var sessionDir = path.dirname(s._file);
    var subDir = path.join(sessionDir, s.id);
    // Check both possible locations for subagents/
    var dirs = [subDir, sessionDir];
    for (var d = 0; d < dirs.length; d++) {
      var agentFiles = findSubAgentFiles(dirs[d]);
      for (var a = 0; a < agentFiles.length; a++) {
        var agentKey = s.id + "::" + agentFiles[a].agentId;
        if (!shared.subAgentCache.has(agentKey)) {
          var agentInfo = parseSubAgent(agentFiles[a].filePath, agentFiles[a].agentId, s.id);
          shared.subAgentCache.set(agentKey, agentInfo);
        }
      }
    }
  }
}

module.exports = {
  loadAgentNames: loadAgentNames,
  buildAgentName: buildAgentName,
  findSubAgentFiles: findSubAgentFiles,
  parseSubAgent: parseSubAgent,
  scanSubAgents: scanSubAgents
};
