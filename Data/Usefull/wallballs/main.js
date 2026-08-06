let etag = null;
let inited = false;

async function fetchData() {
  try {
    const headers = {};
    if (etag) {
      headers['If-None-Match'] = etag;
    }
    const url = `/data/wallballs?clean=${state.clean}&seg_method=${state.segMethod}&seg_mode=${state.segMode}` + 
                `&signal=${state.signal}&low_cut=${state.lowCut}&high_cut=${state.highCut}&acc_seg=${state.accSeg}` +
                (state.hrFreq ? `&hr_freq=${state.hrFreq}` : '');
    const res = await fetch(url, { headers });
    if (res.status === 304) {
      return;
    }
    if (!res.ok) return;
    etag = res.headers.get('ETag');
    state.data = await res.json();

    // Populate editable ACC copies
    state.accPeaks = state.data.acc_peaks ? [...state.data.acc_peaks] : [];
    state.accSegments = state.data.acc_segments ? [...state.data.acc_segments] : [];
    const resetGroup = document.getElementById('wb-acc-reset-group');
    if (resetGroup) resetGroup.style.display = state.accPeaks.length > 0 ? 'flex' : 'none';

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

          if (selectedCount > 0) {
            const times = ev.points.map(p => p.x);
            const tMin = Math.min(...times);
            const tMax = Math.max(...times);
            state.selectedTimeRange = [tMin, tMax];

            if (state.specData) {
              const spec = state.specData;
              const selectedTimeIndices = [];
              for (let i = 0; i < spec.t.length; i++) {
                if (spec.t[i] >= tMin && spec.t[i] <= tMax) {
                  selectedTimeIndices.push(i);
                }
              }

              if (selectedTimeIndices.length > 0) {
                let maxPower = -Infinity;
                selectedTimeIndices.forEach(col => {
                  for (let row = 0; row < spec.Sxx.length; row++) {
                    const power = spec.Sxx[row][col];
                    if (power > maxPower) maxPower = power;
                  }
                });

                const threshold = 0.1 * maxPower;
                let minF = Infinity;
                let maxF = -Infinity;
                selectedTimeIndices.forEach(col => {
                  for (let row = 0; row < spec.Sxx.length; row++) {
                    const power = spec.Sxx[row][col];
                    if (power >= threshold) {
                      const f = spec.f[row];
                      if (f < minF) minF = f;
                      if (f > maxF) maxF = f;
                    }
                  }
                });

                if (minF !== Infinity && maxF !== -Infinity) {
                  state.selectedFreqRange = [minF, maxF];
                } else {
                  state.selectedFreqRange = null;
                }
              } else {
                state.selectedFreqRange = null;
              }
            } else {
              state.selectedFreqRange = null;
            }
          } else {
            state.selectedTimeRange = null;
            state.selectedFreqRange = null;
          }

          if (state.data) {
            renderSpectrogram(state.data, state);
          }
        });

        timePlot.on('plotly_doubleclick', () => {
          const totalCount = timePlot.data && timePlot.data[1] && timePlot.data[1].x ? timePlot.data[1].x.length : 0;
          timeStatusEl.textContent = `(0 / ${totalCount} pts)`;
          state.selectedTimeRange = null;
          state.selectedFreqRange = null;
          if (state.data) {
            renderSpectrogram(state.data, state);
          }
        });

        timePlot.addEventListener('click', e => {
          if (!state.accPeaks || state.accPeaks.length === 0) return;
          const xaxis = timePlot._fullLayout && timePlot._fullLayout.xaxis;
          if (!xaxis) return;
          const rect = timePlot.getBoundingClientRect();
          const mouseXPixel = (e.clientX - rect.left) - xaxis._offset;
          const dataX = xaxis.range[0] + (mouseXPixel / xaxis._length) * (xaxis.range[1] - xaxis.range[0]);
          const tolerance = (xaxis.range[1] - xaxis.range[0]) * 0.05;
          const idx = state.accPeaks.findIndex(p => Math.abs(p - dataX) <= tolerance);
          if (idx === -1) return;
          state.accPeaks.splice(idx, 1);
          const tStart = state.data.acc.t[0];
          const tEnd = state.data.acc.t[state.data.acc.t.length - 1];
          const allPoints = [tStart, ...state.accPeaks, tEnd].sort((a, b) => a - b);
          state.accSegments = [];
          for (let i = 0; i < allPoints.length - 1; i++) {
            state.accSegments.push({ x0: allPoints[i], x1: allPoints[i + 1] });
          }
          renderTimeDomain(state.data, state);
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
  fetchData();
});

document.getElementById('wb-clean').addEventListener('change', e => {
  state.clean = e.target.value;
  fetchData();
});

document.getElementById('wb-low-cut').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    state.lowCut = parseFloat(e.target.value) || 0;
    fetchData();
  }
});

document.getElementById('wb-high-cut').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    state.highCut = parseFloat(e.target.value) || 0;
    fetchData();
  }
});

document.getElementById('wb-recon-rate').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    state.reconRate = parseFloat(e.target.value) || 20;
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

document.getElementById('wb-acc-seg').addEventListener('change', e => {
  state.accSeg = e.target.value;
  fetchData();
});

document.getElementById('wb-acc-save').addEventListener('click', async () => {
  try {
    await fetch('/save_segments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session: 'wallballs',
        accPeaks: state.accPeaks,
        accSegments: state.accSegments
      })
    });
    console.log('Segments saved successfully');
  } catch (err) {
    console.error('Save error:', err);
  }
});

document.getElementById('wb-acc-load').addEventListener('click', async () => {
  try {
    const res = await fetch('/load_segments?session=wallballs');
    if (res.ok) {
      const data = await res.json();
      state.accPeaks = data.accPeaks || [];
      state.accSegments = data.accSegments || [];
      if (state.data) renderTimeDomain(state.data, state);
      console.log('Segments loaded successfully');
    }
  } catch (err) {
    console.error('Load error:', err);
  }
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

document.getElementById('wb-spec-source').addEventListener('change', e => {
  state.specSource = e.target.value;
  renderCharts();
});

// Toggle plot visibilities on title clicks
const plotToggles = [
  { titleSel: '.processing-title', plotId: 'wb-processing-content', innerPlots: ['wb-time-plot'] },
  { titleSel: '.time-title', plotId: 'wb-time-plot', innerPlots: ['wb-time-plot'] },
  { titleSel: '.hr-analysis-title', plotId: 'wb-hr-analysis-content', innerPlots: ['wb-hr-plot'] },
  { titleSel: '.hr-title', plotId: 'wb-hr-plot', innerPlots: ['wb-hr-plot'] },
  { titleSel: '.spec-analysis-title', plotId: 'wb-spec-analysis-content', innerPlots: ['wb-spec-plot'] },
  { titleSel: '.spec-title', plotId: 'wb-spec-plot', innerPlots: ['wb-spec-plot'] }
];

plotToggles.forEach(t => {
  const titleEl = document.querySelector(t.titleSel);
  const plot = document.getElementById(t.plotId);
  if (titleEl && plot) {
    titleEl.style.cursor = 'pointer';
    titleEl.addEventListener('click', () => {
      if (plot.style.display === 'none') {
        plot.style.display = t.plotId.endsWith('-content') ? 'flex' : 'block';
        if (t.innerPlots) {
          t.innerPlots.forEach(pId => {
            const innerPlot = document.getElementById(pId);
            if (innerPlot) Plotly.Plots.resize(innerPlot);
          });
        }
      } else {
        plot.style.display = 'none';
      }
    });
  }
});

// Reset ACC Segments
document.getElementById('wb-acc-reset').addEventListener('click', () => {
  if (!state.data) return;
  state.accPeaks = state.data.acc_peaks ? [...state.data.acc_peaks] : [];
  state.accSegments = state.data.acc_segments ? [...state.data.acc_segments] : [];
  renderTimeDomain(state.data, state);
});

// Initial Load
fetchData();
