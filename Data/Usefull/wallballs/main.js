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

// Toggle plot visibilities on title clicks
const plotToggles = [
  { titleSel: '.time-title', plotId: 'wb-time-plot' },
  { titleSel: '.hr-title', plotId: 'wb-hr-plot' },
  { titleSel: '.spec-title', plotId: 'wb-spec-title' }
];

plotToggles.forEach(t => {
  const titleEl = document.querySelector(t.titleSel);
  const plot = document.getElementById(t.plotId === 'wb-spec-title' ? 'wb-spec-plot' : t.plotId); // fix plot vs title id mismatch
  if (titleEl && plot) {
    titleEl.style.cursor = 'pointer';
    titleEl.addEventListener('click', () => {
      if (plot.style.display === 'none') {
        plot.style.display = 'block';
        Plotly.Plots.resize(plot);
      } else {
        plot.style.display = 'none';
      }
    });
  }
});

// Initial Load & Poll
fetchData();
setInterval(fetchData, 3000);
