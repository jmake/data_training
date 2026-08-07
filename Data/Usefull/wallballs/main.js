let etag = null;
let inited = false;

async function fetchData() {
  try {
    const headers = {};
    if (etag) {
      headers['If-None-Match'] = etag;
    }
    const url = `/data/${state.sessionName}?clean=${state.clean}&seg_method=${state.segMethod}&seg_mode=${state.segMode}` + 
                `&signal=${state.signal}&math_op=${state.mathOp}&low_cut=${state.lowCut}&high_cut=${state.highCut}&acc_seg=${state.accSeg}` +
                (state.hrFreq ? `&hr_freq=${state.hrFreq}` : '');
    const res = await fetch(url, { headers });
    if (res.status === 304) {
      return;
    }
    if (!res.ok) {
      if (res.status === 404) {
        const errorData = await res.json().catch(() => ({}));
        alert(errorData.error || `Data for session '${state.sessionName}' not found.`);
      }
      throw new Error(`HTTP error! status: ${res.status}`);
    }
    const data = await res.json();
    etag = res.headers.get('ETag');
    state.data = data;

    // Populate editable ACC copies
    state.accPeaks = state.data.acc_peaks ? [...state.data.acc_peaks] : [];
    state.accSegments = state.data.acc_segments ? [...state.data.acc_segments] : [];
    const resetGroup = document.getElementById('wb-acc-reset-group');
    if (resetGroup) resetGroup.style.display = 'flex';

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

document.getElementById('wb-math-op').addEventListener('change', e => {
  state.mathOp = e.target.value;
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

let cachedLoadData = [];

async function populateLoadDropdown() {
  try {
    const res = await fetch(`/load_segments?session=${state.sessionName}`);
    if (res.ok) {
      cachedLoadData = await res.json();
      if (!Array.isArray(cachedLoadData)) cachedLoadData = [];
      const sigSelect = document.getElementById('wb-acc-load-sig');
      const methodSelect = document.getElementById('wb-acc-load-method');
      const addBtn = document.getElementById('wb-acc-add-plot');
      
      const signals = [...new Set(cachedLoadData.map(item => item.signal))];
      sigSelect.innerHTML = '<option value="" disabled selected>Signals</option>';
      methodSelect.innerHTML = '<option value="" disabled selected>Method</option>';
      sigSelect.disabled = signals.length === 0;
      methodSelect.disabled = true;
      addBtn.disabled = true;

      for (const sig of signals) {
        if (!sig) continue;
        const opt = document.createElement('option');
        opt.value = sig;
        opt.textContent = sig;
        sigSelect.appendChild(opt);
      }
    }
  } catch(e) {}
}

document.getElementById('wb-acc-load-sig').addEventListener('change', (e) => {
  const sig = e.target.value;
  const methodSelect = document.getElementById('wb-acc-load-method');
  const addBtn = document.getElementById('wb-acc-add-plot');
  
  methodSelect.innerHTML = '<option value="" disabled selected>Method</option>';
  addBtn.disabled = true;
  
  const methods = cachedLoadData.filter(item => item.signal === sig).map(item => item.method);
  
  if (methods.length > 0) {
    methodSelect.disabled = false;
    for (const m of methods) {
      if (!m) continue;
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = m;
      methodSelect.appendChild(opt);
    }
  } else {
    methodSelect.disabled = true;
  }
});

document.getElementById('wb-acc-load-method').addEventListener('change', () => {
  document.getElementById('wb-acc-add-plot').disabled = false;
});

document.getElementById('wb-acc-save').addEventListener('click', async () => {
  try {
    const plot = document.getElementById('wb-time-plot');
    let xrange = plot.layout && plot.layout.xaxis ? plot.layout.xaxis.range : null;
    let filteredPeaks = state.accPeaks;
    let filteredSegments = state.accSegments;
    if (xrange) {
      const [x0, x1] = xrange;
      filteredPeaks = state.accPeaks.filter(p => p >= x0 && p <= x1);
      filteredSegments = state.accSegments.filter(s => 
        (s.x0 >= x0 && s.x0 <= x1) || (s.x1 >= x0 && s.x1 <= x1) || (s.x0 <= x0 && s.x1 >= x1)
      );
    }
    const sigSelect = document.getElementById('wb-signal');
    const sigText = sigSelect.options[sigSelect.selectedIndex].text;
    const segSelect = document.getElementById('wb-acc-seg');
    const segText = segSelect.options[segSelect.selectedIndex].text;

    await fetch('/save_segments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session: state.sessionName,
        signal: sigText,
        method: segText,
        accPeaks: filteredPeaks,
        accSegments: filteredSegments,
        timestamp: new Date().toISOString()
      })
    });
    console.log('Segments saved successfully');
    populateLoadDropdown();
  } catch (err) {
    console.error('Save error:', err);
  }
});

const colors = ['#eab308', '#ef4444', '#3b82f6', '#ec4899', '#f97316'];
let colorIdx = 0;

function updateLoadedSegmentsUI() {
  const list = document.getElementById('wb-loaded-segments-list');
  list.innerHTML = '';
  for (const [sig, segData] of Object.entries(state.loadedCustomSegments)) {
    const item = document.createElement('div');
    item.style = `display: flex; align-items: center; justify-content: space-between; padding: 4px; background: rgba(255,255,255,0.05); border-left: 4px solid ${segData.color}; border-radius: 4px;`;
    item.innerHTML = `
      <span style="font-size: 12px; font-weight: bold; color: ${segData.color}; margin-left: 4px;">${sig}</span>
      <div style="display: flex; gap: 4px;">
        <button class="clean-select" style="cursor: pointer; padding: 2px 6px; font-size: 10px;" onclick="toggleSegVisible('${sig}')">${segData.visible ? 'Hide' : 'Show'}</button>
        <button class="clean-select" style="cursor: pointer; padding: 2px 6px; font-size: 10px;" onclick="removeSeg('${sig}')">Remove</button>
      </div>
    `;
    list.appendChild(item);
  }
}

window.toggleSegVisible = (sig) => {
  if (state.loadedCustomSegments[sig]) {
    state.loadedCustomSegments[sig].visible = !state.loadedCustomSegments[sig].visible;
    updateLoadedSegmentsUI();
    if (state.data) renderTimeDomain(state.data, state);
  }
};

window.removeSeg = (sig) => {
  delete state.loadedCustomSegments[sig];
  updateLoadedSegmentsUI();
  if (state.data) renderTimeDomain(state.data, state);
};

document.getElementById('wb-acc-load-data').addEventListener('click', populateLoadDropdown);

document.getElementById('wb-acc-add-plot').addEventListener('click', () => {
  const sig = document.getElementById('wb-acc-load-sig').value;
  const method = document.getElementById('wb-acc-load-method').value;
  if (!sig || !method) return;
  
  const dataItem = cachedLoadData.find(item => item.signal === sig && item.method === method);
  if (dataItem) {
    const key = `${sig} - ${method}`;
    state.loadedCustomSegments[key] = {
      peaks: dataItem.accPeaks || [],
      segments: dataItem.accSegments || [],
      color: colors[colorIdx % colors.length],
      visible: true
    };
    colorIdx++;
    updateLoadedSegmentsUI();
    if (state.data) renderTimeDomain(state.data, state);
    console.log('Segments loaded successfully for', key);
  }
});

document.getElementById('wb-acc-reset').addEventListener('click', () => {
  // Reset load sequence UI
  const sigSelect = document.getElementById('wb-acc-load-sig');
  const methodSelect = document.getElementById('wb-acc-load-method');
  const addBtn = document.getElementById('wb-acc-add-plot');
  
  sigSelect.innerHTML = '<option value="" disabled selected>Signals</option>';
  methodSelect.innerHTML = '<option value="" disabled selected>Method</option>';
  sigSelect.disabled = true;
  methodSelect.disabled = true;
  addBtn.disabled = true;
  
  // Clear currently loaded segments list
  state.loadedCustomSegments = {};
  updateLoadedSegmentsUI();
  if (state.data) renderTimeDomain(state.data, state);
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

// Start app
async function initApp() {
  try {
    const res = await fetch('/sessions?sport=wallballs');
    if (res.ok) {
      const data = await res.json();
      const select = document.getElementById('wb-session-select');
      select.innerHTML = '';
      
      // Filter strictly to numeric timestamps and sort chronologically
      const validSessions = data.sessions
        .filter(sess => sess.length === 13 && !isNaN(sess))
        .sort((a, b) => parseInt(a) - parseInt(b));
      
      validSessions.forEach(sess => {
        const option = document.createElement('option');
        option.value = sess;
        
        const d = new Date(parseInt(sess));
        const dateStr = d.toLocaleDateString(undefined, {month: 'short', day: '2-digit', year: 'numeric'});
        const timeStr = d.toLocaleTimeString(undefined, {hour: '2-digit', minute: '2-digit'});
        option.textContent = `${dateStr} - ${timeStr}`;
        
        select.appendChild(option);
      });
      
      if (validSessions.length > 0) {
        state.sessionName = validSessions.includes('1785393791901') ? '1785393791901' : validSessions[0];
        select.value = state.sessionName;
      }
    }
  } catch (e) {
    console.error('Failed to load sessions:', e);
  }

  if (state.sessionName) {
    try {
      await fetch(`/load_config?session_name=${state.sessionName}`);
    } catch (err) {
      console.error('Error triggering initial config load:', err);
    }
  }

  fetchData();
}

document.getElementById('wb-session-select').addEventListener('change', async e => {
  state.sessionName = e.target.value;
  etag = null;

  // Clear previously loaded segment data
  cachedLoadData = [];
  populateLoadDropdown();
  
  // Call load_config to ensure the config file is created on the backend
  try {
    await fetch(`/load_config?session_name=${state.sessionName}`);
  } catch (err) {
    console.error('Error triggering config load:', err);
  }

  fetchData();
});

document.getElementById('wb-btn-scan').addEventListener('click', async () => {
  const pathInput = document.getElementById('wb-scan-path').value;
  try {
    const res = await fetch('/scan_path', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: pathInput })
    });
    
    if (!res.ok) {
      if (res.status === 400) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || 'Failed to scan directory.');
      } else {
        alert('Server error while scanning directory.');
      }
      return;
    }
    
    // Rescan successful, reload dropdown
    initApp();
  } catch (e) {
    console.error('Scan failed', e);
    alert('Failed to connect to server for scanning.');
  }
});

// Save Config button
document.getElementById('wb-btn-save-config').addEventListener('click', async () => {
  const getRange = (id) => {
    const el = document.getElementById(id);
    if (el && el._fullLayout && el._fullLayout.xaxis && el._fullLayout.xaxis.range) {
      return el._fullLayout.xaxis.range.slice();
    }
    return null;
  };

  const cfg = {
    session_name: state.sessionName,
    clean:        state.clean,
    segMethod:    state.segMethod,
    segMode:      state.segMode,
    signal:       state.signal,
    mathOp:       state.mathOp,
    lowCut:       state.lowCut,
    highCut:      state.highCut,
    accSeg:       state.accSeg,
    hrFreq:       state.hrFreq,
    axisRanges: {
      time: getRange('wb-time-plot'),
      hr:   getRange('wb-hr-plot'),
      spec: getRange('wb-spec-plot')
    },
    segmentsFile: Object.keys(state.loadedCustomSegments || {}).length > 0 ? `wallballs_segments_${state.sessionName}.json` : null
  };

  try {
    const res = await fetch('/save_config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg)
    });
    if (res.ok) {
      alert(`Config saved for session ${state.sessionName}`);
    } else {
      alert('Failed to save config.');
    }
  } catch (err) {
    console.error('Save config error:', err);
    alert('Failed to connect to server for saving config.');
  }
});

initApp();
