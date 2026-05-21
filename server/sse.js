var shared = require("./shared");

function broadcastSSE(data) {
  if (shared.sseClients.length === 0) return;
  var msg = "data: " + JSON.stringify(data) + "\n\n";
  var dead = [];
  for (var i = 0; i < shared.sseClients.length; i++) {
    try { shared.sseClients[i].write(msg); } catch (e) { dead.push(i); }
  }
  for (var j = dead.length - 1; j >= 0; j--) {
    shared.sseClients.splice(dead[j], 1);
  }
}

function addSSEClient(res) {
  if (shared.sseClients.length >= shared.SSE_MAX_CLIENTS) {
    try { shared.sseClients.shift().end(); } catch (e) {}
  }
  shared.sseClients.push(res);
}

function removeSSEClient(res) {
  var idx = shared.sseClients.indexOf(res);
  if (idx >= 0) shared.sseClients.splice(idx, 1);
}

function handleSSE(req, res) {
  if (req.url !== "/api/events") return false;
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no"
  });
  res.write(": connected\n\n");
  addSSEClient(res);
  var keepalive = setInterval(function() {
    try { res.write(": hb\n\n"); } catch (e) { clearInterval(keepalive); removeSSEClient(res); }
  }, 15000);
  req.on("close", function() { clearInterval(keepalive); removeSSEClient(res); });
  return true;
}

function cleanupSSE() {
  for (var i = 0; i < shared.sseClients.length; i++) {
    try { shared.sseClients[i].end(); } catch (e) {}
  }
  shared.sseClients.length = 0;
}

module.exports = {
  broadcastSSE: broadcastSSE,
  addSSEClient: addSSEClient,
  removeSSEClient: removeSSEClient,
  handleSSE: handleSSE,
  cleanupSSE: cleanupSSE
};
