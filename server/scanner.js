var fs = require("fs");
var fsp = fs.promises;
var path = require("path");
var shared = require("./shared");

// ============ Status / Activity / TokenHeat ============

function getStatus(fileMtimeMs, lastMeaningfulTs, lastMeaningfulStopReason) {
  var now = Date.now();
  var fileAge = (fileMtimeMs > 0) ? (now - fileMtimeMs) : Infinity;
  var tsMs = typeof lastMeaningfulTs === "string" ? new Date(lastMeaningfulTs).getTime() : (lastMeaningfulTs || 0);
  var msgAge = (tsMs > 0) ? (now - tsMs) : Infinity;

  // end_turn → AI自然结束 → 时间递进链
  if (lastMeaningfulStopReason === "end_turn") {
    if (msgAge < 1 * 60 * 60 * 1000) return "completed";
    if (msgAge < 6 * 60 * 60 * 1000) return "idle";
    if (msgAge < 7 * 24 * 60 * 60 * 1000) return "休眠";
    return "归档";
  }

  // stop_sequence(用户按停止) / pause_turn / max_tokens → 中断，不随时间降级
  if (lastMeaningfulStopReason === "stop_sequence" || lastMeaningfulStopReason === "pause_turn" || lastMeaningfulStopReason === "max_tokens") {
    return "interrupted";
  }

  // tool_use → AI正在干活，文件应该频繁写入
  if (lastMeaningfulStopReason === "tool_use") {
    if (fileAge < 10 * 60 * 1000) return "running";
    return "异常"; // 文件10分钟没动，进程可能崩了
  }

  // null (最后有意义消息是user) → 等待AI回复
  if (fileAge < 10 * 60 * 1000) return "running";
  return "异常"; // 用户发了消息但10分钟内无响应
}

// 活跃度 Lv = floor(sqrt(近3h提问数 × 20))，上限99
function getActivity(recentUserMsgs) {
  if (!recentUserMsgs || recentUserMsgs <= 0) return "L0";
  var lv = Math.floor(Math.sqrt(recentUserMsgs * 20));
  if (lv > 99) lv = 99;
  return "L" + lv;
}

// 热度 Lv = floor(cbrt(累计token / 10))，上限99
function getTokenHeat(totalTokens) {
  if (!totalTokens || totalTokens <= 0) return "L0";
  var lv = Math.floor(Math.cbrt(totalTokens / 10));
  if (lv < 0) lv = 0;
  if (lv > 99) lv = 99;
  return "L" + lv;
}

// ============ JSONL Parsing ============

function parseLine(line) {
  try { return JSON.parse(line); } catch (e) { return null; }
}

function parseSessionFull(filePath) {
  return parseSessionChunk(filePath, 0);
}

function parseSessionChunk(filePath, startOffset, existingPromptIds) {
  var info = {
    id: null, title: null, customTitle: null, aiTitle: null,
    firstUserMsg: null, lastTimestamp: null, cwd: null,
    version: null, slug: null, entrypoint: null, model: null,
    totalLines: 0,
    _itok: 0, _otok: 0, _ctok: 0,
    recentUserMsgs: 0, recentMsgTotal: 0,
    userMsgCount: 0, assistantMsgCount: 0,
    fileSize: 0, fileMtime: null, fileMtimeMs: 0,
    lastStopReason: null, lastEntryType: null, lastEntrySubtype: null,
    lastMeaningfulTimestamp: null, lastMeaningfulStopReason: undefined,
    keyDecisions: [], toolCallCount: 0, fileWriteCount: 0,
    _seenPromptIds: {}
  };
  if (existingPromptIds) { info._seenPromptIds = Object.assign({}, existingPromptIds); }

  var content;
  try {
    var stat = fs.statSync(filePath);
    info.fileSize = stat.size;
    info.fileMtime = stat.mtime.toISOString();
    info.fileMtimeMs = stat.mtimeMs;
    if (startOffset > 0 && stat.size <= startOffset) {
      if (stat.size < startOffset) return { _truncated: true, filePath: filePath, fileSize: stat.size, fileMtime: info.fileMtime, fileMtimeMs: info.fileMtimeMs };
      return null;
    }
    var fd = fs.openSync(filePath, "r");
    try {
      var buf = Buffer.alloc(Math.max(1, stat.size - startOffset));
      var bytesRead = fs.readSync(fd, buf, 0, buf.length, startOffset);
      content = buf.toString("utf-8", 0, bytesRead);
    } finally { fs.closeSync(fd); }
  } catch (e) {
    if (startOffset > 0) return null;
    return info;
  }

  if (!content || content.trim() === "") {
    return (startOffset === 0) ? info : null;
  }

  var lines = content.split("\n");
  var lineCount = 0;
  var recentCutoff = Date.now() - 3 * 60 * 60 * 1000;

  for (var i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "") continue;
    var obj = parseLine(lines[i]);
    if (!obj) continue;
    lineCount++;

    if (!info.id && obj.sessionId) info.id = obj.sessionId;
    if (!info.cwd && obj.cwd) info.cwd = obj.cwd;
    if (!info.version && obj.version) info.version = obj.version;
    if (!info.slug && obj.slug) info.slug = obj.slug;
    if (!info.entrypoint && obj.entrypoint) info.entrypoint = obj.entrypoint;

    if (obj.type === "ai-title" && obj.aiTitle) info.aiTitle = obj.aiTitle;
    if (obj.type === "custom-title" && obj.customTitle) info.customTitle = obj.customTitle;

    if (obj.type === "user") {
      var pid = obj.promptId;
      var isNewUserMsg = false;
      if (pid) {
        if (!info._seenPromptIds[pid]) {
          info._seenPromptIds[pid] = true;
          info.userMsgCount++;
          if (obj.timestamp && new Date(obj.timestamp).getTime() > recentCutoff) info.recentUserMsgs++;
          isNewUserMsg = true;
        }
      } else {
        info.userMsgCount++;
        if (obj.timestamp && new Date(obj.timestamp).getTime() > recentCutoff) info.recentUserMsgs++;
        isNewUserMsg = true;
      }
      if (!info.firstUserMsg && obj.message && obj.message.content && Array.isArray(obj.message.content)) {
        for (var j = 0; j < obj.message.content.length; j++) {
          if (obj.message.content[j].type === "text" && obj.message.content[j].text) {
            var t = obj.message.content[j].text.trim();
            if (t.indexOf("<ide_opened_file>") === -1 && !/^File (created|modified|deleted)/.test(t)) {
              info.firstUserMsg = t.slice(0, 500);
              break;
            }
          }
        }
      }
    }

    if (obj.type === "assistant") {
      info.assistantMsgCount++;
      if (obj.timestamp && new Date(obj.timestamp).getTime() > recentCutoff) info.recentMsgTotal++;
      if (obj.message && obj.message.stop_reason) info.lastStopReason = obj.message.stop_reason;
      if (obj.message && obj.message.usage) {
        info._itok += (obj.message.usage.input_tokens || 0);
        info._otok += (obj.message.usage.output_tokens || 0);
        info._ctok += (obj.message.usage.cache_read_input_tokens || 0);
      }
      if (!info.model && obj.message && obj.message.model) info.model = obj.message.model;

      if (obj.message && obj.message.content && Array.isArray(obj.message.content)) {
        for (var k = 0; k < obj.message.content.length; k++) {
          var block = obj.message.content[k];
          if (block.type === "tool_use") {
            info.toolCallCount++;
            var dec = { timestamp: obj.timestamp || null, tool: block.name || "unknown", input: block.input ? JSON.stringify(block.input).slice(0, 200) : "", type: "tool_call" };
            if (block.name === "write_to_file" || block.name === "write" || block.name === "Edit" || block.name === "Write") {
              info.fileWriteCount++;
              dec.type = "file_write";
            }
            info.keyDecisions.push(dec);
          }
        }
      }
    }

    if (obj.type === "user" || obj.type === "assistant") {
      info.lastMeaningfulTimestamp = obj.timestamp || info.lastMeaningfulTimestamp;
      if (obj.type === "assistant" && obj.message && obj.message.stop_reason) {
        info.lastMeaningfulStopReason = obj.message.stop_reason;
      } else if (obj.type === "user" && isNewUserMsg) {
        info.lastMeaningfulStopReason = null; // only genuine new user msg resets stop_reason
      }
    }
    info.lastEntryType = obj.type;
    if (obj.type === "system" && obj.subtype) info.lastEntrySubtype = obj.subtype;
    if (obj.timestamp) info.lastTimestamp = obj.timestamp;
  }

  if (startOffset === 0) {
    info.totalLines = lineCount;
    info.title = info.customTitle || info.aiTitle || (info.firstUserMsg ? info.firstUserMsg.slice(0, 80) : null) || "(无标题)";
  }
  return info;
}

// Merge incremental delta into cached session
function mergeSessionData(cached, delta) {
  if (!delta || !cached) return cached;
  cached.lastTimestamp = delta.lastTimestamp || cached.lastTimestamp;
  cached.lastStopReason = delta.lastStopReason || cached.lastStopReason;
  cached.lastEntryType = delta.lastEntryType || cached.lastEntryType;
  cached.lastEntrySubtype = delta.lastEntrySubtype || cached.lastEntrySubtype;
  cached.lastMeaningfulTimestamp = delta.lastMeaningfulTimestamp || cached.lastMeaningfulTimestamp;
  if (delta.lastMeaningfulStopReason !== undefined) cached.lastMeaningfulStopReason = delta.lastMeaningfulStopReason;
  cached._itok += (delta._itok || 0);
  cached._otok += (delta._otok || 0);
  cached._ctok += (delta._ctok || 0);
  cached.userMsgCount += (delta.userMsgCount || 0);
  cached.assistantMsgCount += (delta.assistantMsgCount || 0);
  cached.recentUserMsgs += (delta.recentUserMsgs || 0);
  cached.recentMsgTotal += (delta.recentMsgTotal || 0);
  cached.totalLines += (delta.totalLines || 0);
  if (delta._seenPromptIds) {
    if (!cached._seenPromptIds) cached._seenPromptIds = {};
    for (var pid2 in delta._seenPromptIds) {
      if (delta._seenPromptIds.hasOwnProperty(pid2)) cached._seenPromptIds[pid2] = true;
    }
  }
  cached.fileMtime = delta.fileMtime || cached.fileMtime;
  cached.fileMtimeMs = delta.fileMtimeMs || cached.fileMtimeMs;
  cached.fileSize = delta.fileSize || cached.fileSize;
  cached.toolCallCount += (delta.toolCallCount || 0);
  cached.fileWriteCount += (delta.fileWriteCount || 0);
  if (delta.model && !cached.model) cached.model = delta.model;
  if (delta.cwd && !cached.cwd) cached.cwd = delta.cwd;
  if (delta.title && delta.title !== "(无标题)") cached.title = delta.title;
  if (delta.aiTitle) { cached.aiTitle = delta.aiTitle; if (!cached.customTitle) cached.title = delta.aiTitle; }
  if (delta.customTitle) { cached.customTitle = delta.customTitle; cached.title = delta.customTitle; }
  if (delta.firstUserMsg && !cached.firstUserMsg) cached.firstUserMsg = delta.firstUserMsg;
  if (delta.keyDecisions && delta.keyDecisions.length > 0) {
    if (!cached.keyDecisions) cached.keyDecisions = [];
    cached.keyDecisions = cached.keyDecisions.concat(delta.keyDecisions);
    if (cached.keyDecisions.length > 100) cached.keyDecisions = cached.keyDecisions.slice(-100);
  }
  cached._dirty = true;
  return cached;
}

// ============ Async Session Scanning ============

async function dirExists(dirPath) {
  try { await fsp.access(dirPath); return true; } catch (e) { return false; }
}

async function scanSessions(dir, results, parentSessionId) {
  if (!results) results = [];
  if (!(await dirExists(dir))) return results;

  var entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch (e) { return results; }

  for (var i = 0; i < entries.length; i++) {
    var full = path.join(dir, entries[i].name);
    var isAgent = entries[i].name.startsWith("agent-");

    if (entries[i].isDirectory() && entries[i].name !== "memory" && entries[i].name !== "subagents" && entries[i].name !== "tool-results" && !isAgent) {
      await scanSessions(full, results, parentSessionId);
    } else if (entries[i].isFile() && entries[i].name.endsWith(".jsonl") && !isAgent) {
      var sessionId = entries[i].name.replace(".jsonl", "");
      var cached = shared.sessionCache.get(sessionId);
      var offInfo = shared.fileOffsets.get(full);
      var info;

      if (cached && offInfo && offInfo.offset > 0) {
        var delta = parseSessionChunk(full, offInfo.offset, cached._seenPromptIds);
        if (delta) {
          if (delta._truncated) {
            // Truncated: full re-parse (still sync since parseSessionChunk uses sync APIs)
            info = parseSessionChunk(full, 0);
            if (info && info.id) {
              shared.fileOffsets.set(full, { offset: info.fileSize || 0, mtime: info.fileMtimeMs });
              shared.sessionCache.set(info.id, info);
            }
          } else {
            info = mergeSessionData(cached, delta);
            shared.fileOffsets.set(full, { offset: info.fileSize || 0, mtime: info.fileMtimeMs });
            shared.sessionCache.set(info.id, info);
          }
        } else {
          // No new data, use cached — but refresh fileMtimeMs from current stat
          info = cached;
          try {
            var st = await fsp.stat(full);
            info.fileMtimeMs = st.mtimeMs;
            info._fileSize = st.size;
          } catch (e) {}
        }
      } else {
        info = parseSessionChunk(full, 0);
        if (info && info.id) {
          shared.fileOffsets.set(full, { offset: info.fileSize || 0, mtime: info.fileMtimeMs });
          shared.sessionCache.set(info.id, info);
        }
      }

      if (info && info.id) {
        info._file = full;
        results.push(info);
      }
    }
  }
  return results;
}

module.exports = {
  getStatus: getStatus,
  getActivity: getActivity,
  getTokenHeat: getTokenHeat,
  parseLine: parseLine,
  parseSessionFull: parseSessionFull,
  parseSessionChunk: parseSessionChunk,
  mergeSessionData: mergeSessionData,
  scanSessions: scanSessions
};
