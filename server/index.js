// 阿勋的CC面板 4.0 — 缓存+增量版（端口31028），模块化架构
var http = require("http");
var fs = require("fs");
var path = require("path");
var shared = require("./shared");
var pricing = require("./pricing");
var scanner = require("./scanner");
var snapshot = require("./snapshot");
var sse = require("./sse");
var watcher = require("./watcher");
var agents = require("./agents");

// Route handlers
var sessionsRouter = require("./routes/sessions")();
var sessionRouter = require("./routes/session")();
var snapshotsRouter = require("./routes/snapshots")();
var openRouter = require("./routes/open")();

// ============ HTTP Server ============

var server = http.createServer(function(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  try {
    // SSE
    if (sse.handleSSE(req, res)) return;

    // 一次性 localStorage 导入路由
    if (req.url === "/import-localstorage") {
      var importFile = path.join(__dirname, "import-data.json");
      if (!fs.existsSync(importFile)) {
        res.writeHead(404); res.end("import-data.json not found");
        return;
      }
      var importData = fs.readFileSync(importFile, "utf8");
      var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>导入配置</title><style>body{font-family:system-ui;max-width:600px;margin:50px auto;padding:20px;background:#1a1a2e;color:#e0e0e0}.ok{color:#4caf50}.err{color:#f44336}.key{font-family:monospace;font-size:13px;margin:4px 0}.box{background:#16213e;border-radius:8px;padding:16px;margin:12px 0}h2{margin:0 0 8px}</style></head><body><h2>CC面板配置导入</h2><div id="status">正在导入...</div><div id="results" class="box"></div><script>!function(){var d=' + importData + ';var ok=0,fail=0,results=[];Object.entries(d).forEach(function(e){try{localStorage.setItem(e[0],e[1]);var v=e[1];results.push("<div class=\\"key\\">"+e[0]+" <span class=\\"ok\\">OK</span> ("+(v.length>80?v.substring(0,80)+"...":v)+")</div>");ok++}catch(err){results.push("<div class=\\"key\\">"+e[0]+" <span class=\\"err\\">FAIL: "+err.message+"</span></div>");fail++}});var status=document.getElementById("status");status.innerHTML=ok+" 个成功, "+fail+" 个失败 (共 "+Object.keys(d).length+" 项)";status.className=ok>0?"ok":"err";document.getElementById("results").innerHTML=results.join("");if(ok>0){var p=document.createElement("p");p.textContent="配置已写入 Edge localStorage for "+window.location.origin;p.className="ok";document.body.appendChild(p)}else{var p2=document.createElement("p");p2.textContent="未写入任何数据,请检查浏览器控制台";p2.className="err";document.body.appendChild(p2)}}();</script></body></html>';
      res.writeHead(200, {"Content-Type": "text/html; charset=utf-8"});
      res.end(html);
      return;
    }

    // HTML
    if (req.url === "/" || req.url === "/index.html") {
      if (fs.existsSync(shared.HTML_FILE)) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(fs.readFileSync(shared.HTML_FILE, "utf-8"));
      } else {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<h1>Dashboard HTML not found</h1>");
      }
      return;
    }

    // Static files
    if (req.url === "/sortable.min.js") {
      var sortableFile = path.join(path.dirname(shared.HTML_FILE), "sortable.min.js");
      if (fs.existsSync(sortableFile)) {
        res.writeHead(200, {"Content-Type": "application/javascript"});
        res.end(fs.readFileSync(sortableFile));
      } else {
        res.writeHead(404); res.end("404");
      }
      return;
    }

    // QR code images (优先 assets/ 目录，兼容根目录)
    if (req.url === "/qr-wechat.png") {
      var qrWx = path.join(path.dirname(shared.HTML_FILE), "assets", "qr-wechat.png");
      if (!fs.existsSync(qrWx)) qrWx = path.join(path.dirname(shared.HTML_FILE), "qr-wechat.png");
      if (fs.existsSync(qrWx)) {
        res.writeHead(200, {"Content-Type": "image/png"});
        res.end(fs.readFileSync(qrWx));
      } else { res.writeHead(404); res.end("404"); }
      return;
    }
    if (req.url === "/qr-alipay.jpg") {
      var qrAli = path.join(path.dirname(shared.HTML_FILE), "assets", "qr-alipay.jpg");
      if (!fs.existsSync(qrAli)) qrAli = path.join(path.dirname(shared.HTML_FILE), "qr-alipay.jpg");
      if (fs.existsSync(qrAli)) {
        res.writeHead(200, {"Content-Type": "image/jpeg"});
        res.end(fs.readFileSync(qrAli));
      } else { res.writeHead(404); res.end("404"); }
      return;
    }

    // Route modules
    if (openRouter(req, res)) return;
    if (sessionsRouter(req, res)) return;
    if (sessionRouter(req, res)) return;
    if (snapshotsRouter(req, res)) return;

    // 404
    res.writeHead(404); res.end("404");
  } catch (err) {
    res.writeHead(500); res.end("Server Error: " + err.message);
  }
});

// ============ Graceful Shutdown ============

function shutdown() {
  console.log("[CC面板] 正在关闭...");
  watcher.cleanupWatchers();
  sse.cleanupSSE();
  server.close(function() {
    console.log("[CC面板] 已关闭");
    process.exit(0);
  });
  // Force exit after 5s if cleanup hangs
  setTimeout(function() { process.exit(0); }, 5000);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// ============ Start ============

try { fs.mkdirSync(shared.SNAPSHOTS_DIR, { recursive: true }); } catch (e) {}
snapshot.loadSnapshotsFromDisk();

scanner.scanSessions(shared.PROJECTS_DIR, []).then(function(initialSessions) {
  agents.scanSubAgents(initialSessions);
  var runningCount = 0;
  for (var i = 0; i < initialSessions.length; i++) {
    initialSessions[i].status = scanner.getStatus(initialSessions[i].fileMtimeMs, initialSessions[i].lastMeaningfulTimestamp, initialSessions[i].lastMeaningfulStopReason);
    if (initialSessions[i].status === "running") runningCount++;
  }

  watcher.setupFileWatcher();

  // Fallback poll: 30s full scan
  setInterval(function() { watcher.processChanges(); }, 30000);

  server.listen(shared.PORT, function() {
    console.log("[阿勋的CC面板 4.0] CC多任务管理面板 → http://localhost:" + shared.PORT);
    console.log("[阿勋的CC面板 4.0] " + initialSessions.length + " 主会话 + " + shared.subAgentCache.size + " 子Agent (" + runningCount + " 活跃中)");
    console.log("[阿勋的CC面板 4.0] 实时推送: fs.watch + SSE /api/events");
    console.log("[阿勋的CC面板 4.0] 快照: " + shared.SNAPSHOTS_DIR);
    console.log("[阿勋的CC面板 4.0] Ctrl+C to stop");
  });
});
