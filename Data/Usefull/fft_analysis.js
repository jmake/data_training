// ── FFT Analysis section ─────────────────────────────────────────────────────

const fftState = {
  rowing: { signal: "x", clean: "raw", autocut: "", fmin: 0, fmax: null, result: null, inited: false },
  running: { signal: "x", clean: "raw", autocut: "", fmin: 0, fmax: null, result: null, inited: false }
};

// Fetch data for FFT independently from the main ACC clean selector
async function fftFetch(name, clean) {
  const key = `${name}_${clean}`;
  if (sessionCache[key]) return true;
  const url = SESSIONS[name].url + `?clean=${clean}`;
  const headers = {};
  if (etags[key]) headers["If-None-Match"] = etags[key];
  try {
    const res = await fetch(url, { headers });
    if (res.status === 304) return true;
    if (!res.ok) return false;
    etags[key] = res.headers.get("ETag");
    sessionCache[key] = await res.json();
    return true;
  } catch (e) { return false; }
}

async function fftRun(name) {
  const st = fftState[name];
  updateSignalOptions(name);
  const ok = await fftFetch(name, st.clean);
  if (!ok) return;

  const data = sessionCache[`${name}_${st.clean}`];
  const signal = data.acc[st.signal];
  const fs = data.stats.sample_rate;
  const t = data.acc.t;

  const mean = signal.reduce((a, b) => a + b, 0) / signal.length;
  st.mean = mean;
  const zeroMeanSignal = signal.map(v => v - mean);

  // Compute FFT (un-windowed for reconstruction, windowed for spectrum)
  st.result = signalFFT(zeroMeanSignal, fs);
  const nyq = fs / 2;

  // Initialize sliders on first run
  if (st.fmax === null) {
    st.fmax = nyq;
    const fminEl = document.getElementById(`fft-fmin-${name}`);
    const fmaxEl = document.getElementById(`fft-fmax-${name}`);
    fminEl.max = nyq; fminEl.value = 0;
    fmaxEl.max = nyq; fmaxEl.value = nyq;
    document.getElementById(`fft-fmin-val-${name}`).textContent = "0.0 Hz";
    document.getElementById(`fft-fmax-val-${name}`).textContent = `${nyq.toFixed(1)} Hz`;
  }

  // Apply Auto High Cut if active
  if (st.autocut) {
    const val = calculateAutoHighCut(st);
    if (val !== undefined) {
      st.fmax = val;
      const fmaxEl = document.getElementById(`fft-fmax-${name}`);
      fmaxEl.value = val;
      document.getElementById(`fft-fmax-val-${name}`).textContent = `${val.toFixed(1)} Hz`;
    }
  }

  fftRenderCharts(name, t, signal);
}

function fftRenderCharts(name, t, origSignal) {
  const st = fftState[name];
  if (!st.result) return;

  const p = SESSIONS[name].prefix;
  const { freqs, power } = st.result;
  const mean = st.mean || 0;
  const recon = bandpassReconstruct(st.result, st.fmin, st.fmax).map(v => v + mean);

  const isNorm = st.clean === "norm";
  const isIqr = st.clean === "iqr";
  const yLabel = isNorm ? "Normalized" : (isIqr ? "Q3 + A x IQR" : "g");
  const yFreqLabel = isNorm ? "Amplitude (Normalized)" : (isIqr ? "Amplitude (Q3 + A x IQR)" : "Amplitude (g)");

  // ── Time domain: original (dim) + reconstruction (blue) ──
  const trTime = [
    {
      x: t, y: Array.from(origSignal), type: "scattergl", mode: "lines",
      name: "Original", line: { color: "#ef4444", width: 1 }
    },
    {
      x: t, y: recon, type: "scattergl", mode: "lines",
      name: "Reconstruction", line: { color: "#38bdf8", width: 1.5 }
    }
  ];
  const lyTime = {
    uirevision: `${st.signal}_${st.clean}`,
    paper_bgcolor: "transparent", plot_bgcolor: "transparent",
    margin: { l: 54, r: 14, t: 32, b: 36 },
    font: { family: "Inter, system-ui, sans-serif", color: "#64748b", size: 10 },
    xaxis: { title: { text: "Time (s)", standoff: 4 }, gridcolor: "#1a2540", zerolinecolor: "#1e293b", color: "#4a5a7a" },
    yaxis: { title: { text: yLabel, standoff: 4 }, gridcolor: "#1a2540", zerolinecolor: "#1e293b", color: "#4a5a7a" },
    showlegend: true, hovermode: "x unified",
    legend: { font: { size: 10, color: "#94a3b8" }, bgcolor: "transparent", orientation: "h", x: 0, y: 1.08 }
  };

  // ── Spectrum: filled area + selected band shading ──
  const trFreq = [
    {
      x: Array.from(freqs), y: Array.from(power),
      type: "scatter", mode: "lines", name: "Spectrum",
      line: { color: "#818cf8", width: 1.2 },
      fill: "tozeroy", fillcolor: "rgba(129,140,248,0.07)"
    }
  ];
  const lyFreq = {
    uirevision: `${st.signal}_${st.clean}`,
    paper_bgcolor: "transparent", plot_bgcolor: "transparent",
    margin: { l: 54, r: 14, t: 32, b: 36 },
    font: { family: "Inter, system-ui, sans-serif", color: "#64748b", size: 10 },
    xaxis: { title: { text: "Frequency (Hz)", standoff: 4 }, gridcolor: "#1a2540", zerolinecolor: "#1e293b", color: "#4a5a7a" },
    yaxis: { title: { text: yFreqLabel, standoff: 4 }, gridcolor: "#1a2540", zerolinecolor: "#1e293b", color: "#4a5a7a", type: "log" },
    showlegend: false, hovermode: "x unified",
    shapes: [{
      type: "rect", xref: "x", yref: "paper",
      x0: st.fmin, x1: st.fmax, y0: 0, y1: 1,
      fillcolor: "rgba(56,189,248,0.09)",
      line: { color: "rgba(56,189,248,0.4)", width: 1 }
    }]
  };

  const timeDivId = `${p}-fft-time`;
  const freqDivId = `${p}-fft-freq`;

  if (!st.inited) {
    Plotly.newPlot(timeDivId, trTime, lyTime, PLOTLY_CFG);
    Plotly.newPlot(freqDivId, trFreq, lyFreq, PLOTLY_CFG);
    st.inited = true;
  } else {
    Plotly.react(timeDivId, trTime, lyTime, PLOTLY_CFG);
    Plotly.react(freqDivId, trFreq, lyFreq, PLOTLY_CFG);
  }
}

// Calculate auto high cut frequency
function calculateAutoHighCut(st) {
  if (!st.result || !st.autocut) return st.fmax;
  const { freqs, power } = st.result;
  const nyq = freqs[freqs.length - 1];

  if (st.autocut === "energy") {
    const totalPower = Array.from(power).reduce((a, b) => a + b, 0);
    let cumSum = 0;
    for (let i = 0; i < power.length; i++) {
      cumSum += power[i];
      if (cumSum >= 0.95 * totalPower) {
        return freqs[i];
      }
    }
    return nyq;
  }

  if (st.autocut === "harmonics") {
    // Ignore low-frequency drift/leakage below 0.15 Hz for dominant harmonics search
    let startIdx = 0;
    for (let i = 0; i < freqs.length; i++) {
      if (freqs[i] >= 0.15) {
        startIdx = i;
        break;
      }
    }
    let maxIdx = startIdx;
    let maxVal = -1;
    for (let i = startIdx; i < power.length; i++) {
      if (power[i] > maxVal) {
        maxVal = power[i];
        maxIdx = i;
      }
    }
    const fdom = freqs[maxIdx];
    return Math.min(fdom * 5, nyq);
  }

  return st.fmax;
}

// Disable Magnitude signal option when Normalized cleaning is selected
function updateSignalOptions(name) {
  const st = fftState[name];
  const sigSelect = document.getElementById(`fft-signal-${name}`);
  if (!sigSelect) return;
  const magOption = sigSelect.querySelector('option[value="mag"]');
  if (!magOption) return;

  if (st.clean === "norm") {
    magOption.disabled = true;
    if (st.signal === "mag") {
      st.signal = "x";
      sigSelect.value = "x";
      st.result = null;
    }
  } else {
    magOption.disabled = false;
  }
}

// Fast path: only update reconstruction + band shading (no re-FFT)
function fftUpdateFilter(name) {
  const st = fftState[name];
  if (!st.result) return;
  const data = sessionCache[`${name}_${st.clean}`];
  if (!data) return;
  fftRenderCharts(name, data.acc.t, data.acc[st.signal]);
}

// ── Wire up controls ──────────────────────────────────────────────────────────
["rowing", "running"].forEach(name => {
  const st = fftState[name];

  document.getElementById(`fft-signal-${name}`).addEventListener("change", e => {
    st.signal = e.target.value;
    st.result = null;
    fftRun(name);
  });

  document.getElementById(`fft-clean-${name}`).addEventListener("change", async e => {
    st.clean = e.target.value;
    st.result = null;
    await fftRun(name);
  });

  document.getElementById(`fft-autocut-${name}`).addEventListener("change", e => {
    st.autocut = e.target.value;
    if (st.autocut) {
      const val = calculateAutoHighCut(st);
      if (val !== undefined) {
        st.fmax = val;
        const fmaxEl = document.getElementById(`fft-fmax-${name}`);
        fmaxEl.value = val;
        document.getElementById(`fft-fmax-val-${name}`).textContent = `${val.toFixed(1)} Hz`;
        fftUpdateFilter(name);
      }
    }
  });

  document.getElementById(`fft-fmin-${name}`).addEventListener("input", e => {
    let val = parseFloat(e.target.value);
    if (val >= st.fmax) { val = st.fmax - 0.1; e.target.value = val; }
    st.fmin = val;
    document.getElementById(`fft-fmin-val-${name}`).textContent = `${val.toFixed(1)} Hz`;
    fftUpdateFilter(name);
  });

  document.getElementById(`fft-fmax-${name}`).addEventListener("input", e => {
    let val = parseFloat(e.target.value);
    if (val <= st.fmin) { val = st.fmin + 0.1; e.target.value = val; }
    st.fmax = val;
    document.getElementById(`fft-fmax-val-${name}`).textContent = `${val.toFixed(1)} Hz`;
    st.autocut = "";
    document.getElementById(`fft-autocut-${name}`).value = "";
    fftUpdateFilter(name);
  });
});
