var fs = require("fs");
var fsp = fs.promises;
var path = require("path");
var shared = require("../shared");
var scanner = require("../scanner");
var pricing = require("../pricing");
var agentsMod = require("../agents");

function makeSessionRouter() {
  return function handle(req, res) {
    // API: session agent relations (tree/timeline data)
    if (req.url.indexOf("/api/session/") === 0 && req.url.indexOf("/relations") > 0) {
      var relId = decodeURI(req.url.split("/api/session/")[1].split("/relations")[0]);
      var relTarget = shared.sessionCache.get(relId);
      if (!relTarget || !relTarget._file) {
        scanner.scanSessions(shared.PROJECTS_DIR, []).then(function(all3) {
          for (var ri = 0; ri < all3.length; ri++) { if (all3[ri].id === relId) { relTarget = all3[ri]; break; } }
          buildRelationsResponse(relTarget, relId, res);
        });
      } else {
        buildRelationsResponse(relTarget, relId, res);
      }
      return true;
    }

    // API: single session
    if (req.url.startsWith("/api/session/") && !req.url.startsWith("/api/session/snapshot")) {
      var sessUrl = req.url.split("/api/session/")[1];
      var qpos = sessUrl.indexOf("?");
      var sid = qpos >= 0 ? decodeURI(sessUrl.slice(0, qpos)) : decodeURI(sessUrl);
      var query = {};
      if (qpos >= 0) { var qs = sessUrl.slice(qpos+1).split("&"); for (var qi=0; qi<qs.length; qi++) { var kv=qs[qi].split("="); query[kv[0]]=kv[1]||""; } }
      var isFull = query.full === "1";
      var limit = parseInt(query.limit) || (isFull ? 0 : 200);

      // Look up session from cache first (fast path), fall back to full scan
      var cached = shared.sessionCache.get(sid);
      if (!cached || !cached._file) {
        scanner.scanSessions(shared.PROJECTS_DIR, []).then(function(all) {
          for (var j = 0; j < all.length; j++) { if (all[j].id === sid) { cached = all[j]; break; } }
          buildSessionDetailResponse(cached, sid, limit, res);
        });
      } else {
        buildSessionDetailResponse(cached, sid, limit, res);
      }
      return true;
    }

    return false;
  };
}

function buildSessionDetailResponse(cached, sid, limit, res) {
  if (!cached || !cached._file) { res.writeHead(404); res.end(JSON.stringify({ error: "not found" })); return; }
  var fpath = cached._file;

  var rawLines = [];
  var totalLines = cached.totalLines || 0;
  try {
    if (limit > 0) {
      var fsize = fs.statSync(fpath).size;
      var tailBytes = Math.min(fsize, limit * 1200 + 32768);
      var buf = Buffer.alloc(tailBytes);
      var fd = fs.openSync(fpath, "r");
      fs.readSync(fd, buf, 0, tailBytes, fsize - tailBytes);
      fs.closeSync(fd);
      var tailText = buf.toString("utf-8");
      var lines = tailText.split("\n");
      if (tailBytes < fsize && lines.length > 1) lines.shift();
      var takeStart = Math.max(0, lines.length - limit);
      if (!totalLines && lines.length > 0) totalLines = Math.max(lines.length, Math.round(fsize / (tailBytes / lines.length)));
      for (var k = takeStart; k < lines.length; k++) { try { rawLines.push(JSON.parse(lines[k])); } catch (e) {} }
    } else {
      var raw = fs.readFileSync(fpath, "utf-8").trim().split("\n");
      totalLines = raw.length;
      for (var k = 0; k < raw.length; k++) { try { rawLines.push(JSON.parse(raw[k])); } catch (e) {} }
    }
  } catch (e) {}

  var resp = {
    id: cached.id, title: cached.title, cwd: cached.cwd, model: cached.model,
    firstUserMsg: cached.firstUserMsg, customTitle: cached.customTitle, aiTitle: cached.aiTitle,
    _itok: cached._itok, _otok: cached._otok, _ctok: cached._ctok,
    userMsgCount: cached.userMsgCount, assistantMsgCount: cached.assistantMsgCount,
    recentUserMsgs: cached.recentUserMsgs, recentMsgTotal: cached.recentMsgTotal,
    keyDecisions: cached.keyDecisions, toolCallCount: cached.toolCallCount,
    fileWriteCount: cached.fileWriteCount, subAgents: cached.subAgents,
    lastTimestamp: cached.lastTimestamp, lastMeaningfulTimestamp: cached.lastMeaningfulTimestamp,
    lastStopReason: cached.lastStopReason, lastMeaningfulStopReason: cached.lastMeaningfulStopReason,
    messages: rawLines, totalLines: totalLines, limitUsed: limit,
    status: scanner.getStatus(cached.fileMtimeMs, cached.lastMeaningfulTimestamp, cached.lastMeaningfulStopReason),
    activity: scanner.getActivity(cached.recentUserMsgs || 0),
    tokenHeat: scanner.getTokenHeat((cached._itok || 0) + (cached._otok || 0)),
    cost: pricing.calcCost(cached),
    filePath: fpath
  };

  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(resp));
}

function buildRelationsResponse(relTarget, relId, res) {
  if (!relTarget || !relTarget._file) { res.writeHead(404); res.end(JSON.stringify({ error: "not found" })); return; }

  var nodes = [];
  var edges = [];
  var dispatchCalls = [];

  // Main node
  nodes.push({
    id: relTarget.id, type: "main", title: relTarget.title || relTarget.id,
    status: scanner.getStatus(relTarget.fileMtimeMs, relTarget.lastMeaningfulTimestamp, relTarget.lastMeaningfulStopReason),
    model: relTarget.model, tokenHeat: relTarget.tokenHeat, cost: pricing.calcCost(relTarget),
    startTime: relTarget.lastTimestamp, fileMtime: relTarget.fileMtime
  });

  // Parse parent file for Agent/Task dispatch events
  var parentDir = path.dirname(relTarget._file);
  try {
    var pContent = fs.readFileSync(relTarget._file, "utf-8");
    var pLines = pContent.trim().split("\n");
    for (var pi = 0; pi < pLines.length; pi++) {
      var pObj = scanner.parseLine(pLines[pi]);
      if (!pObj || pObj.type !== "assistant" || !pObj.message || !pObj.message.content) continue;
      for (var pj = 0; pj < pObj.message.content.length; pj++) {
        var block = pObj.message.content[pj];
        if (block.type === "tool_use" && (block.name === "Agent" || block.name === "Task" || block.name === "TeamCreate")) {
          dispatchCalls.push({
            time: pObj.timestamp || null,
            line: pi,
            tool: block.name,
            description: (block.input && block.input.description) || "",
            subagent_type: (block.input && block.input.subagent_type) || "",
            prompt: (block.input && block.input.prompt ? block.input.prompt.slice(0, 200) : "") || ""
          });
        }
      }
    }
  } catch (e) {}

  // Parse sub-agents
  var subDirs = [path.join(parentDir, relId, "subagents"), path.join(parentDir, "subagents")];
  var subAgentMap = {};
  for (var sd = 0; sd < subDirs.length; sd++) {
    if (!fs.existsSync(subDirs[sd])) continue;
    var saFiles = fs.readdirSync(subDirs[sd]).filter(function(f) { return f.startsWith("agent-") && f.endsWith(".jsonl"); });
    for (var sa = 0; sa < saFiles.length; sa++) {
      var saPath = path.join(subDirs[sd], saFiles[sa]);
      var saAgentId = saFiles[sa].replace(".jsonl", "");
      var saStat = fs.statSync(saPath);
      var saInfo = {
        id: saAgentId, type: "sub-agent", title: saAgentId, status: "idle",
        model: null, cost: 0, startTime: null, _itok: 0, _otok: 0, toolCallCount: 0
      };
      try {
        var saContent = fs.readFileSync(saPath, "utf-8");
        var saLines = saContent.trim().split("\n");
        var firstUserFound = false;
        for (var sl = 0; sl < saLines.length; sl++) {
          var saObj = scanner.parseLine(saLines[sl]);
          if (!saObj) continue;
          if (!firstUserFound && saObj.type === "user" && saObj.message && saObj.message.content) {
            for (var sk = 0; sk < saObj.message.content.length; sk++) {
              if (saObj.message.content[sk].type === "text" && saObj.message.content[sk].text) {
                saInfo.title = saObj.message.content[sk].text.slice(0, 100).replace(/\n/g, " ");
                firstUserFound = true;
                break;
              }
            }
          }
          if (!saInfo.startTime && saObj.timestamp) saInfo.startTime = saObj.timestamp;
          if (saObj.type === "assistant" && saObj.message && saObj.message.usage) {
            saInfo._itok += (saObj.message.usage.input_tokens || 0);
            saInfo._otok += (saObj.message.usage.output_tokens || 0);
            if (!saInfo.model && saObj.message.model) saInfo.model = saObj.message.model;
          }
          if (saObj.type === "assistant" && saObj.message && saObj.message.stop_reason) {
            saInfo.lastStopReason = saObj.message.stop_reason;
          }
          if (saObj.type === "assistant" && saObj.message && saObj.message.content) {
            for (var sc = 0; sc < saObj.message.content.length; sc++) {
              if (saObj.message.content[sc].type === "tool_use") saInfo.toolCallCount++;
            }
          }
        }
        saInfo.status = saInfo.lastStopReason === "end_turn" ? "completed" : saInfo.lastStopReason === "tool_use" ? (Date.now() - saStat.mtimeMs < 10 * 60 * 1000 ? "running" : "异常") : "idle";
        var p2 = (pricing.getPricing() && pricing.getPricing()[saInfo.model]) || pricing.defaultPricing();
        saInfo.cost = Math.round(((saInfo._itok / 1e6) * p2.input + (saInfo._otok / 1e6) * p2.output) * 1000) / 1000;
      } catch (e) {}
      nodes.push(saInfo);
      subAgentMap[saAgentId] = saInfo;
    }
  }

  // Match dispatch calls to sub-agents by time proximity
  var sortedCalls = dispatchCalls.filter(function(c) { return c.time; }).sort(function(a, b) { return a.time.localeCompare(b.time); });
  var sortedAgents = nodes.filter(function(n) { return n.type === "sub-agent" && n.startTime; }).sort(function(a, b) { return a.startTime.localeCompare(b.startTime); });
  var usedAgents = {};

  for (var ci = 0; ci < sortedCalls.length; ci++) {
    var call = sortedCalls[ci];
    var bestMatch = null, bestDist = Infinity;
    for (var ai = 0; ai < sortedAgents.length; ai++) {
      if (usedAgents[sortedAgents[ai].id]) continue;
      var dist = Math.abs(new Date(call.time).getTime() - new Date(sortedAgents[ai].startTime).getTime());
      if (dist < bestDist && dist < 60000) { bestDist = dist; bestMatch = sortedAgents[ai]; }
    }
    if (bestMatch) {
      usedAgents[bestMatch.id] = true;
      var nameCfg = agentsMod.loadAgentNames();
      if (nameCfg.agents && nameCfg.agents[bestMatch.id]) {
        bestMatch.title = nameCfg.agents[bestMatch.id];
      } else {
        var autoName = agentsMod.buildAgentName(call.subagent_type, call.description, bestMatch.title);
        if (autoName && autoName.length > 3) bestMatch.title = autoName;
      }
      edges.push({ from: relId, to: bestMatch.id, time: call.time, description: call.description, subagent_type: call.subagent_type, tool: call.tool });
    } else {
      edges.push({ from: relId, to: null, time: call.time, description: call.description, subagent_type: call.subagent_type, tool: call.tool, unmatched: true });
    }
  }
  for (var ui = 0; ui < sortedAgents.length; ui++) {
    if (!usedAgents[sortedAgents[ui].id]) {
      edges.push({ from: relId, to: sortedAgents[ui].id, time: sortedAgents[ui].startTime, description: sortedAgents[ui].title, subagent_type: "", tool: "Agent" });
    }
  }

  // Phase detection
  var PHASE_GAP_MS = 10 * 60 * 1000;
  var PARALLEL_WIN_MS = 4 * 60 * 1000;

  var matchedEdges = edges.filter(function(e) { return e.time && e.to && !e.unmatched; })
    .sort(function(a, b) { return a.time.localeCompare(b.time); });

  var userMessages = [];
  try {
    for (var pi2 = 0; pi2 < pLines.length; pi2++) {
      var pObj2 = scanner.parseLine(pLines[pi2]);
      if (pObj2 && pObj2.type === "user" && pObj2.message && pObj2.message.content && pObj2.timestamp) {
        for (var pk = 0; pk < pObj2.message.content.length; pk++) {
          if (pObj2.message.content[pk].type === "text" && pObj2.message.content[pk].text) {
            userMessages.push({ time: pObj2.timestamp, text: pObj2.message.content[pk].text.slice(0, 120).replace(/\n/g, " ") });
            break;
          }
        }
      }
    }
  } catch (e) {}

  var phases = [];
  var currentPhase = null;

  for (var ei = 0; ei < matchedEdges.length; ei++) {
    var edge = matchedEdges[ei];
    var edgeTime = new Date(edge.time).getTime();

    var phaseLabel = "";
    for (var ui2 = userMessages.length - 1; ui2 >= 0; ui2--) {
      if (new Date(userMessages[ui2].time).getTime() <= edgeTime) { phaseLabel = userMessages[ui2].text.slice(0, 60); break; }
    }

    var startNewPhase = !currentPhase || (edgeTime - currentPhase._lastTime) > PHASE_GAP_MS;

    if (startNewPhase) {
      currentPhase = { index: phases.length + 1, label: phaseLabel || ("阶段" + (phases.length + 1)), startTime: edge.time, endTime: edge.time, _lastTime: edgeTime, _label: phaseLabel, groups: [], agentCount: 0 };
      phases.push(currentPhase);
      currentPhase.groups.push({ type: "sequential", agentIds: [edge.to], startTime: edge.time, endTime: edge.time, label: edge.description ? edge.description.slice(0, 40) : "" });
      currentPhase.agentCount = 1;
    } else {
      currentPhase.endTime = edge.time;
      currentPhase.agentCount++;
      var timeSinceGroupStart = edgeTime - new Date(currentPhase.groups[currentPhase.groups.length - 1].startTime).getTime();
      if (timeSinceGroupStart < PARALLEL_WIN_MS) {
        var cg = currentPhase.groups[currentPhase.groups.length - 1];
        cg.agentIds.push(edge.to);
        cg.endTime = edge.time;
        if (cg.agentIds.length > 1) cg.type = "parallel";
      } else {
        currentPhase.groups.push({ type: "sequential", agentIds: [edge.to], startTime: edge.time, endTime: edge.time, label: edge.description ? edge.description.slice(0, 40) : "" });
      }
      currentPhase._lastTime = edgeTime;
    }
  }

  // Waterfall trace
  var waterfallSpans = [];
  var wfFirstTs = null;
  var wfParentStack = [];

  for (var wi = 0; wi < pLines.length; wi++) {
    var wObj = scanner.parseLine(pLines[wi]);
    if (!wObj || !wObj.timestamp) continue;
    var wTs = new Date(wObj.timestamp).getTime();
    if (wfFirstTs === null) wfFirstTs = wTs;
    var relStart = wTs - wfFirstTs;
    var span = { id: waterfallSpans.length, ts: wObj.timestamp, relStart: relStart, depth: 0 };

    if (wObj.type === "user") {
      span.type = "user";
      span.name = "提问";
      if (wObj.message && wObj.message.content && Array.isArray(wObj.message.content)) {
        for (var wk = 0; wk < wObj.message.content.length; wk++) {
          if (wObj.message.content[wk].type === "text" && wObj.message.content[wk].text) {
            span.text = wObj.message.content[wk].text.slice(0, 120);
            break;
          }
        }
      }
      span.duration = 0;
      wfParentStack = [];
    } else if (wObj.type === "assistant") {
      span.type = "assistant";
      span.stopReason = (wObj.message && wObj.message.stop_reason) || null;
      span.name = span.stopReason === "tool_use" ? "工具调用" : span.stopReason === "end_turn" ? "回复" : "响应";
      span.tokens = wObj.message && wObj.message.usage ? { input: wObj.message.usage.input_tokens || 0, output: wObj.message.usage.output_tokens || 0 } : null;
      span.model = (wObj.message && wObj.message.model) || null;
      span.duration = 0;
      wfParentStack = [];
      if (wObj.message && wObj.message.content && Array.isArray(wObj.message.content)) {
        for (var wj = 0; wj < wObj.message.content.length; wj++) {
          var wBlock = wObj.message.content[wj];
          if (wBlock.type === "tool_use") {
            var toolSpan = { id: waterfallSpans.length + 1, type: "tool_use", name: wBlock.name || "unknown", ts: wObj.timestamp, relStart: relStart, depth: 1, duration: 0, parentId: span.id, toolInput: wBlock.input ? JSON.stringify(wBlock.input).slice(0, 120) : "" };
            waterfallSpans.push(toolSpan);
            span.duration = 0;
          }
        }
      }
    } else if (wObj.type === "attachment" || wObj.type === "tool_result") {
      span.type = "tool_result";
      span.name = "结果";
      span.depth = 1;
      span.duration = 0;
    } else {
      continue;
    }

    waterfallSpans.push(span);
  }

  for (var wd = 0; wd < waterfallSpans.length - 1; wd++) {
    if (waterfallSpans[wd].type === "assistant" || waterfallSpans[wd].type === "tool_use") {
      var nextRel = waterfallSpans[wd + 1].relStart;
      if (nextRel > waterfallSpans[wd].relStart) {
        waterfallSpans[wd].duration = nextRel - waterfallSpans[wd].relStart;
      }
    }
    if (waterfallSpans[wd].type === "user") {
      waterfallSpans[wd].duration = 2000;
    }
  }
  var lastWf = waterfallSpans[waterfallSpans.length - 1];
  if (lastWf && lastWf.duration === 0 && (lastWf.type === "assistant" || lastWf.type === "tool_use")) {
    lastWf.duration = 1000;
  }

  if (waterfallSpans.length > 200) {
    waterfallSpans = waterfallSpans.slice(-200);
    var reAnchor = waterfallSpans[0].relStart;
    for (var wt = 0; wt < waterfallSpans.length; wt++) {
      waterfallSpans[wt].id = wt;
      waterfallSpans[wt].relStart -= reAnchor;
    }
  }

  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ sessionId: relId, nodes: nodes, edges: edges, dispatchCount: dispatchCalls.length, phases: phases, waterfall: waterfallSpans }));
}

module.exports = makeSessionRouter;
