// Global State
const state = {
  signal: 'x',
  clean: 'iqr',
  lowCut: 0,
  highCut: 2.0,
  reconRate: 4.0,
  segMethod: 'peaks',
  segMode: 'distance',
  hrFreq: null,
  specMin: 0.0,
  specMax: 0.5,
  lastSignal: null,
  data: null
};

const PLOTLY_CFG = {
  responsive: true,
  displayModeBar: true,
  modeBarButtonsToRemove: ['select2d', 'lasso2d'],
  displaylogo: false
};

const baseLayout = (titleY) => ({
  uirevision: true,
  paper_bgcolor: 'transparent',
  plot_bgcolor: 'transparent',
  margin: { l: 60, r: 20, t: 10, b: 40 },
  font: { family: 'Outfit, sans-serif', color: '#9ca3af', size: 11 },
  xaxis: {
    title: { text: 'Time (s)', standoff: 6 },
    gridcolor: 'rgba(255,255,255,0.04)',
    zerolinecolor: 'rgba(255,255,255,0.08)'
  },
  yaxis: {
    title: { text: titleY, standoff: 6 },
    gridcolor: 'rgba(255,255,255,0.04)',
    zerolinecolor: 'rgba(255,255,255,0.08)'
  },
  showlegend: true,
  legend: {
    x: 0.01,
    y: 0.99,
    xanchor: 'left',
    yanchor: 'top',
    bgcolor: 'rgba(0,0,0,0)',
    orientation: 'h',
    font: { size: 10 }
  }
});

let etag = null;
let inited = false;

async function fetchData() {
  try {
    const headers = {};
    if (etag) {
      headers['If-None-Match'] = etag;
    }
    const url = `/data/wallballs?clean=${state.clean}&seg_method=${state.segMethod}&seg_mode=${state.segMode}` + 
                (state.hrFreq ? `&hr_freq=${state.hrFreq}` : '');
    const res = await fetch(url, { headers });
    if (res.status === 304) {
      return;
    }
    if (!res.ok) return;
    etag = res.headers.get('ETag');
    state.data = await res.json();

    // Show / Hide custom frequency group based on segMode
    const freqGroup = document.getElementById('wb-hr-freq-group');
    if (state.segMethod === 'peaks' && state.segMode === 'distance') {
      freqGroup.style.display = 'flex';
      if (state.hrFreq === null && state.data.hr_dom_freq) {
        document.getElementById('wb-hr-freq').value = state.data.hr_dom_freq.toFixed(3);
      }
    } else {
      freqGroup.style.display = 'none';
    }

    renderCharts();
    if (!inited) {
      setupSync(['wb-time-plot', 'wb-hr-plot', 'wb-spec-plot']);

      const timePlot = document.getElementById('wb-time-plot');
      const timeStatusEl = document.getElementById('wb-time-selection-status');
      if (timePlot && timeStatusEl) {
        timePlot.on('plotly_selected', ev => {
          const selectedCount = ev && ev.points ? ev.points.length : 0;
          const totalCount = timePlot.data && timePlot.data[1] && timePlot.data[1].x ? timePlot.data[1].x.length : 0;
          timeStatusEl.textContent = `(${selectedCount} / ${totalCount} pts)`;
        });
        timePlot.on('plotly_doubleclick', () => {
          const totalCount = timePlot.data && timePlot.data[1] && timePlot.data[1].x ? timePlot.data[1].x.length : 0;
          timeStatusEl.textContent = `(0 / ${totalCount} pts)`;
        });
      }

      inited = true;
    }
  } catch (err) {
    console.error('Fetch error:', err);
  }
}

function setupSync(ids) {
  let syncing = false;
  ids.forEach(srcId => {
    const el = document.getElementById(srcId);
    if (!el) return;
    el.on("plotly_relayout", ev => {
      if (syncing) return;
      syncing = true;
      let update = null;
      if (ev["xaxis.autorange"]) {
        update = { "xaxis.autorange": true };
      } else if (ev["xaxis.range[0]"] !== undefined) {
        update = { "xaxis.range": [ev["xaxis.range[0]"], ev["xaxis.range[1]"]] };
      } else if (ev["xaxis.range"]) {
        update = { "xaxis.range": [ev["xaxis.range"][0], ev["xaxis.range"][1]] };
      }
      if (update) {
        ids.forEach(tgtId => {
          if (tgtId !== srcId) {
            const tgtEl = document.getElementById(tgtId);
            if (tgtEl && tgtEl._fullLayout) {
              const tgtXa = tgtEl._fullLayout.xaxis;
              if (update["xaxis.autorange"] && tgtXa.autorange === true) return;
              if (update["xaxis.range"]) {
                const r = update["xaxis.range"];
                if (tgtXa.autorange === false && tgtXa.range &&
                    Math.abs(tgtXa.range[0] - r[0]) < 1e-4 &&
                    Math.abs(tgtXa.range[1] - r[1]) < 1e-4) {
                  return;
                }
              }
              Plotly.relayout(tgtId, update);
            }
          }
        });
      }
      syncing = false;
    });
  });
}

function renderCharts() {
  if (!state.data) return;
  renderHeartRate(state.data);
  renderTimeDomain(state.data, state);
  renderSpectrogram(state.data, state);
}

// Event Listeners
document.getElementById('wb-signal').addEventListener('change', e => {
  state.signal = e.target.value;
  renderCharts();
});

document.getElementById('wb-clean').addEventListener('change', e => {
  state.clean = e.target.value;
  fetchData();
});

document.getElementById('wb-low-cut').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    state.lowCut = parseFloat(e.target.value) || 0;
    renderCharts();
  }
});

document.getElementById('wb-high-cut').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    state.highCut = parseFloat(e.target.value) || 0;
    state.reconRate = state.highCut > 0 ? 2 * state.highCut : 50;
    document.getElementById('wb-recon-rate').value = state.reconRate.toFixed(1);
    renderCharts();
  }
});

document.getElementById('wb-recon-rate').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    state.reconRate = parseFloat(e.target.value) || (state.highCut > 0 ? 2 * state.highCut : 50);
    renderCharts();
  }
});

document.getElementById('wb-seg-method').addEventListener('change', e => {
  state.segMethod = e.target.value;
  const modeGroup = document.getElementById('wb-seg-mode-group');
  if (state.segMethod === 'peaks') {
    modeGroup.style.display = 'flex';
    document.getElementById('wb-seg-mode').value = 'distance';
    state.segMode = 'distance';
  } else {
    modeGroup.style.display = 'none';
  }
  state.hrFreq = null; // Reset to auto
  fetchData();
});

document.getElementById('wb-seg-mode').addEventListener('change', e => {
  state.segMode = e.target.value;
  state.hrFreq = null; // Reset to auto
  fetchData();
});

document.getElementById('wb-hr-freq').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const val = parseFloat(e.target.value);
    state.hrFreq = (!isNaN(val) && val > 0) ? val : null;
    fetchData();
  }
});

document.getElementById('wb-spec-min').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const val = parseFloat(e.target.value) || 0;
    state.specMin = val;
    document.getElementById('wb-spec-min-slider').value = val;
    renderCharts();
  }
});

document.getElementById('wb-spec-min-slider').addEventListener('input', e => {
  const val = parseFloat(e.target.value);
  state.specMin = val;
  document.getElementById('wb-spec-min').value = val.toFixed(3);
  renderCharts();
});

document.getElementById('wb-spec-max').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const val = parseFloat(e.target.value) || 0.5;
    state.specMax = val;
    document.getElementById('wb-spec-max-slider').value = val;
    renderCharts();
  }
});

document.getElementById('wb-spec-max-slider').addEventListener('input', e => {
  const val = parseFloat(e.target.value);
  state.specMax = val;
  document.getElementById('wb-spec-max').value = val.toFixed(3);
  renderCharts();
});

// Toggle Heart Rate plot visibility on header click
const hrHeader = document.querySelector('.chart-header.hr');
const hrPlot = document.getElementById('wb-hr-plot');
if (hrHeader && hrPlot) {
  hrHeader.style.cursor = 'pointer';
  hrHeader.addEventListener('click', () => {
    if (hrPlot.style.display === 'none') {
      hrPlot.style.display = 'block';
      Plotly.Plots.resize(hrPlot);
    } else {
      hrPlot.style.display = 'none';
    }
  });
}

// Initial Load & Poll
fetchData();
setInterval(fetchData, 3000);
