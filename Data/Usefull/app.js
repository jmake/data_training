const POLL_MS = 3000;

const SESSIONS = {
  rowing:  { prefix: "r", accent: "accent-rowing",  url: "/data/rowing" },
  running: { prefix: "n", accent: "accent-running", url: "/data/running" }
};

const cleanMethod  = { rowing: "raw", running: "raw" };
const etags        = {};
const inited       = { rowing: false, running: false };
const sessionCache = {};

function cacheKey(name) { return `${name}_${cleanMethod[name]}`; }

// ── Plotly base layout ──
function baseLayout(yLabel) {
  return {
    paper_bgcolor: "transparent",
    plot_bgcolor:  "transparent",
    margin: { l: 54, r: 14, t: 32, b: 36 },
    font:   { family: "Inter, system-ui, sans-serif", color: "#64748b", size: 10 },
    xaxis: {
      title: { text: "Time (s)", standoff: 4 },
      gridcolor: "#1a2540", zerolinecolor: "#1e293b", color: "#4a5a7a"
    },
    yaxis: {
      title: { text: yLabel, standoff: 4 },
      gridcolor: "#1a2540", zerolinecolor: "#1e293b", color: "#4a5a7a"
    },
    showlegend: false,
    hovermode: "x unified"
  };
}

const PLOTLY_CFG = { responsive: true, displaylogo: false, modeBarButtonsToRemove: ["toImage","sendDataToCloud"] };

function traceGL(t, y, color, width = 1.2) {
  return { x: t, y, type: "scattergl", mode: "lines", line: { color, width }, hovertemplate: "%{y:.3f}<extra></extra>" };
}
function traceSVG(t, y, color, width = 1.5) {
  return { x: t, y, type: "scatter",   mode: "lines", line: { color, width }, hovertemplate: "%{y:.0f}<extra></extra>" };
}

// ── Stats cards ──
function fmt_duration(s) {
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2,"0")}`;
}

function renderStats(name, st) {
  const accent = SESSIONS[name].accent;
  const card = (label, value, unit) =>
    `<div class="stat-card ${accent}">
       <div class="stat-label">${label}</div>
       <div class="stat-value">${value}<span class="stat-unit">${unit}</span></div>
     </div>`;

  document.getElementById(`acc-stats-${name}`).innerHTML = [
    card("ACC RMS",     st.acc_rms,                    "g"),
    card("Sample Rate", st.sample_rate,                 "Hz"),
    card("ACC Points",  st.acc_samples.toLocaleString(), ""),
  ].join("");

  document.getElementById(`hr-stats-${name}`).innerHTML = [
    card("Duration", fmt_duration(st.duration_s), "min"),
    card("Avg HR",   st.hr_avg,                   "bpm"),
    card("Max HR",   st.hr_max,                   "bpm"),
    card("Min HR",   st.hr_min,                   "bpm"),
  ].join("");
}

// ── Render charts ──
function renderCharts(name, data, init) {
  const p = SESSIONS[name].prefix;
  const { acc, hr } = data;

  // HR → SVG (few points, avoids WebGL context limit)
  // ACC → WebGL (large datasets)
  const charts = [
    { id: `${p}-hr`,  traces: [traceSVG(hr.t,  hr.bpm,  "#f87171")], layout: baseLayout("BPM") },
    { id: `${p}-mag`, traces: [traceGL(acc.t,  acc.mag, "#a78bfa")], layout: baseLayout("g")   },
    { id: `${p}-ax`,  traces: [traceGL(acc.t,  acc.x,   "#38bdf8")], layout: baseLayout("g")   },
    { id: `${p}-ay`,  traces: [traceGL(acc.t,  acc.y,   "#4ade80")], layout: baseLayout("g")   },
    { id: `${p}-az`,  traces: [traceGL(acc.t,  acc.z,   "#fb923c")], layout: baseLayout("g")   },
  ];

  charts.forEach(({ id, traces, layout }) => {
    if (init) {
      Plotly.newPlot(id, traces, layout, PLOTLY_CFG);
    } else {
      // Preserve user zoom: re-inject xaxis.range if not in autorange
      const el = document.getElementById(id);
      const xa = el && el._fullLayout && el._fullLayout.xaxis;
      if (xa && !xa.autorange) {
        layout = { ...layout, xaxis: { ...layout.xaxis, range: [xa.range[0], xa.range[1]], autorange: false } };
      }
      Plotly.react(id, traces, layout, PLOTLY_CFG);
    }
  });

  if (init) setupSync(name, charts.map(c => c.id));
}

// ── Synchronized zoom/pan ──
function setupSync(name, ids) {
  let syncing = false;
  ids.forEach(srcId => {
    document.getElementById(srcId).on("plotly_relayout", ev => {
      if (syncing) return;
      syncing = true;
      let update = null;
      if (ev["xaxis.autorange"]) {
        update = { "xaxis.autorange": true };
      } else if (ev["xaxis.range[0]"] !== undefined) {
        update = { "xaxis.range": [ev["xaxis.range[0]"], ev["xaxis.range[1]"]] };
      }
      if (update) {
        ids.forEach(tgtId => { if (tgtId !== srcId) Plotly.relayout(tgtId, update); });
      }
      syncing = false;
    });
  });
}

// ── Fetch + cache session data ──
async function fetchSession(name) {
  const key   = cacheKey(name);
  const clean = cleanMethod[name];
  const url   = SESSIONS[name].url + `?clean=${clean}`;
  const headers = {};
  if (etags[key]) headers["If-None-Match"] = etags[key];

  let res;
  try {
    res = await fetch(url, { headers });
  } catch (e) {
    setStatus("error", "Server unreachable");
    return false;
  }

  if (res.status === 304) {
    setStatus("live", "Live · no change");
    return true;
  }
  if (!res.ok) {
    setStatus("error", `HTTP ${res.status}`);
    return false;
  }

  etags[key] = res.headers.get("ETag");
  sessionCache[key] = await res.json();
  setStatus("live", "Live");
  return true;
}

// ── Render cached data for a tab (only when visible) ──
function renderIfVisible(name) {
  const key = cacheKey(name);
  if (!sessionCache[key]) return;
  const data = sessionCache[key];
  renderStats(name, data.stats);
  renderCharts(name, data, !inited[name]);
  if (!inited[name]) inited[name] = true;
}

// ── Status pill ──
function setStatus(cls, text) {
  const pill = document.getElementById("status-pill");
  pill.className = cls;
  document.getElementById("status-text").textContent = text;
}

// ── Tab switching ──
let activeTab = "rowing";

function resizeTab(name) {
  const p = SESSIONS[name].prefix;
  ["hr","mag","ax","ay","az"].forEach(c => {
    const el = document.getElementById(`${p}-${c}`);
    if (el && el.layout) Plotly.Plots.resize(el);
  });
}

document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", async () => {
    const tab = btn.dataset.tab;
    if (tab === activeTab) return;
    activeTab = tab;

    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
    document.getElementById(`tab-${tab}`).classList.add("active");

    const key = cacheKey(tab);
    if (!sessionCache[key]) {
      await fetchSession(tab);
      renderIfVisible(tab);
    } else if (!inited[tab]) {
      renderIfVisible(tab);
    } else {
      setTimeout(() => resizeTab(tab), 30);
    }
  });
});

// ── Cleaning method selector ──
document.querySelectorAll(".clean-select").forEach(sel => {
  sel.addEventListener("change", async () => {
    const name = sel.dataset.tab;
    cleanMethod[name] = sel.value;
    const ok = await fetchSession(name);
    if (ok) renderIfVisible(name);
  });
});

// ── Boot: only load active tab ──
(async () => {
  await fetchSession("rowing");
  renderIfVisible("rowing");
  document.getElementById("loading-overlay").classList.add("hidden");
})();

// ── Poll: fetch + re-render only active tab ──
setInterval(async () => {
  const ok = await fetchSession(activeTab);
  if (ok && sessionCache[cacheKey(activeTab)]) renderIfVisible(activeTab);
}, POLL_MS);
