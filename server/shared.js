var path = require("path");

var PROJECTS_DIR = process.env.CLAUDE_PROJECTS_DIR || path.join(process.env.HOME || process.env.USERPROFILE || "~", ".claude", "projects");
var SNAPSHOTS_DIR = path.join(process.env.HOME || process.env.USERPROFILE || "~", ".claude", "armada", "snapshots");
var PORT = parseInt(process.env.CC_DASHBOARD_PORT || "3100", 10);
var HTML_FILE = path.join(__dirname, "..", "index.html");
var AGENT_NAMES_FILE = path.join(process.env.HOME || process.env.USERPROFILE || "~", ".claude", "agent-names.json");

module.exports = {
  PROJECTS_DIR: PROJECTS_DIR,
  SNAPSHOTS_DIR: SNAPSHOTS_DIR,
  PORT: PORT,
  HTML_FILE: HTML_FILE,
  AGENT_NAMES_FILE: AGENT_NAMES_FILE,

  // Session cache
  sessionCache: new Map(),
  subAgentCache: new Map(),
  fileOffsets: new Map(),

  // SSE
  sseClients: [],
  SSE_MAX_CLIENTS: 50,

  // Watchers
  watchers: [],
  WATCH_DEBOUNCE_MS: 800,
  pendingChanges: new Map(),
  _processing: false,

  // Snapshots
  snapshotList: [],
  lastAutoSnapshot: 0,
  AUTO_SNAPSHOT_INTERVAL: 5 * 60 * 1000,

  // Pricing (loaded dynamically)
  PRICING: null
};
