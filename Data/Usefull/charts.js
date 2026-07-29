const PLOTLY_CFG = {
  responsive: true,
  displaylogo: false,
  modeBarButtonsToRemove: ["toImage", "sendDataToCloud"]
};

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

function traceGL(t, y, color, width = 1.2) {
  return { x: t, y, type: "scattergl", mode: "lines", line: { color, width }, hovertemplate: "%{y:.3f}<extra></extra>" };
}

function traceSVG(t, y, color, width = 1.5) {
  return { x: t, y, type: "scatter", mode: "lines", line: { color, width }, hovertemplate: "%{y:.0f}<extra></extra>" };
}

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
