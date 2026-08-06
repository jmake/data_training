/* 
 * NOTE: The code must be modular. It is permitted and encouraged to divide 
 * the code into multiple files when convenient to prevent files from growing too large.
 */
let cachedLoadData = [];

async function populateLoadDropdown() {
  try {
    const res = await fetch('/load_segments?session=wallballs');
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
        session: 'wallballs',
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
