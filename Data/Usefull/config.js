const POLL_MS = 3000;

const SESSIONS = {
  rowing:    { prefix: "r", accent: "accent-rowing",  url: "/data/rowing" },
  running:   { prefix: "n", accent: "accent-running", url: "/data/running" },
  wallballs: { prefix: "w", accent: "accent-wallballs", url: "/data/wallballs" }
};

const cleanMethod  = { rowing: "raw", running: "raw", wallballs: "raw" };
const etags        = {};
const inited       = { rowing: false, running: false, wallballs: false };
const sessionCache = {};

function cacheKey(name) { return `${name}_${cleanMethod[name]}`; }
