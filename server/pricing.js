var fs = require("fs");
var path = require("path");

var DEFAULT_PRICING = {
  "deepseek-v4-pro":   { input: 1.0, cacheRead: 0.2, output: 2.0 },
  "deepseek-v4-flash": { input: 0.5, cacheRead: 0.1, output: 1.0 },
  "deepseek-v4":       { input: 0.5, cacheRead: 0.1, output: 1.0 }
};

var PRICING = null;
var pricingFile = path.join(process.env.HOME || process.env.USERPROFILE || "~", ".claude", "pricing.json");

function loadPricing() {
  try {
    var raw = fs.readFileSync(pricingFile, "utf-8");
    var loaded = JSON.parse(raw);
    if (loaded && typeof loaded === "object") {
      PRICING = loaded;
    } else {
      PRICING = DEFAULT_PRICING;
    }
  } catch (e) {
    PRICING = DEFAULT_PRICING;
  }
}

function defaultPricing() {
  return { input: 1.0, cacheRead: 0.2, output: 2.0 };
}

function calcCost(info) {
  var p = (PRICING && PRICING[info.model]) || defaultPricing();
  var cost = ((info._itok || 0) / 1e6) * p.input + ((info._ctok || 0) / 1e6) * p.cacheRead + ((info._otok || 0) / 1e6) * p.output;
  return Math.round(cost * 1000) / 1000;
}

// Load immediately
loadPricing();

module.exports = {
  getPricing: function() { return PRICING; },
  loadPricing: loadPricing,
  defaultPricing: defaultPricing,
  calcCost: calcCost
};
