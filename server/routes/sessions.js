var shared = require("../shared");
var scanner = require("../scanner");
var agents = require("../agents");
var pricing = require("../pricing");

function makeSessionsRouter() {
  return function handle(req, res) {
    // API: all sessions with sub-agents
    if (req.url === "/api/sessions") {
      scanner.scanSessions(shared.PROJECTS_DIR, []).then(function(sessions) {
        agents.scanSubAgents(sessions);
        sessions.sort(function(a, b) { return (b.lastTimestamp || "0").localeCompare(a.lastTimestamp || "0"); });

        for (var i = 0; i < sessions.length; i++) {
          var s = sessions[i];
          s.status = scanner.getStatus(s.fileMtimeMs, s.lastMeaningfulTimestamp, s.lastMeaningfulStopReason);
          s.activity = scanner.getActivity(s.recentUserMsgs || 0);
          s.tokenHeat = scanner.getTokenHeat((s._itok || 0) + (s._otok || 0));
          s.cost = pricing.calcCost(s);
          s.type = "main";
          s.filePath = s._file;
          s.subAgents = [];
          delete s._file;
          delete s.fileMtimeMs;
          delete s._dirty;

          shared.subAgentCache.forEach(function(agent, key) {
            if (key.indexOf(s.id + "::") === 0) {
              agent.status = scanner.getStatus(agent.fileMtimeMs, agent.lastMeaningfulTimestamp, agent.lastMeaningfulStopReason);
              agent.cost = pricing.calcCost(agent);
              s.subAgents.push(agent);
            }
          });
        }

        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(sessions));
      });
      return true;
    }

    // API: flat grid of all agents (main + sub)
    if (req.url === "/api/agents") {
      scanner.scanSessions(shared.PROJECTS_DIR, []).then(function(allSessions) {
        agents.scanSubAgents(allSessions);
        var agentList = [];

        for (var i = 0; i < allSessions.length; i++) {
          var ms = allSessions[i];
          ms.status = scanner.getStatus(ms.fileMtimeMs, ms.lastMeaningfulTimestamp, ms.lastMeaningfulStopReason);
          ms.activity = scanner.getActivity(ms.recentUserMsgs || 0);
          ms.tokenHeat = scanner.getTokenHeat((ms._itok || 0) + (ms._otok || 0));
          ms.cost = pricing.calcCost(ms);
          ms.type = "main";
          delete ms._file;
          delete ms.fileMtimeMs;
          agentList.push(ms);

          shared.subAgentCache.forEach(function(agent, key) {
            if (key.indexOf(ms.id + "::") === 0) {
              agent.status = scanner.getStatus(agent.fileMtimeMs, agent.lastMeaningfulTimestamp, agent.lastMeaningfulStopReason);
              agent.cost = pricing.calcCost(agent);
              agentList.push(agent);
            }
          });
        }

        agentList.sort(function(a, b) {
          var sa = a.status === "running" ? 0 : 1;
          var sb = b.status === "running" ? 0 : 1;
          if (sa !== sb) return sa - sb;
          return (b.lastTimestamp || "0").localeCompare(a.lastTimestamp || "0");
        });

        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(agentList));
      });
      return true;
    }

    return false;
  };
}

module.exports = makeSessionsRouter;
