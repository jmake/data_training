// ── FFT Analysis section ─────────────────────────────────────────────────────

const fftState = {
  rowing:    { signal: "mag", clean: "iqr", autocut: "harmonics", fmin: 0, fmax: null, result: null, inited: false, segMethod: "mined", segThresh: 0.75 },
  running:   { signal: "mag", clean: "iqr", autocut: "harmonics", fmin: 0, fmax: null, result: null, inited: false, segMethod: "mined", segThresh: 0.75 },
  wallballs: { signal: "mag", clean: "iqr", autocut: "harmonics", fmin: 0, fmax: null, result: null, inited: false, segMethod: "mined", segThresh: 0.75 }
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
  const reconRaw = bandpassReconstruct(st.result, st.fmin, st.fmax);
  const recon = reconRaw.map(v => v + mean);

  // Calculate Preserved Energy
  let bandPower = 0;
  let totalPower = 0;
  for (let i = 0; i < freqs.length; i++) {
    const f = freqs[i];
    totalPower += power[i];
    if (f >= st.fmin && f <= st.fmax) {
      bandPower += power[i];
    }
  }
  const pctEnergy = totalPower > 0 ? (bandPower / totalPower) * 100 : 0;

  // Calculate Noise Reduction (SD of orig zero-mean vs SD of recon zero-mean)
  const zeroMeanSignal = Array.from(origSignal).map(v => v - mean);
  const sdOrig = Math.sqrt(zeroMeanSignal.reduce((sum, v) => sum + v*v, 0) / zeroMeanSignal.length);
  const sdRecon = Math.sqrt(reconRaw.reduce((sum, v) => sum + v*v, 0) / reconRaw.length);
  const pctNoiseReduction = sdOrig > 0 ? ((sdOrig - sdRecon) / sdOrig) * 100 : 0;

  // Update UI Elements
  document.getElementById(`fft-energy-${name}`).textContent = pctEnergy.toFixed(1);
  document.getElementById(`fft-noise-${name}`).textContent = pctNoiseReduction.toFixed(1);

  // ── Cycle Segmentation calculations ──
  const fdom = getDominantFrequency(st.result);
  const fs = SESSIONS[name].sample_rate || 50;
  let boundaries = [];
  let template = [];
  let alignedSegments = [];

  if (fdom > 0) {
    const L = Math.round(fs / fdom);
    if (L > 5 && L < reconRaw.length / 2) {
      if (st.segMethod === "average") {
        template = extractTemplateAverage(reconRaw, L);
      } else {
        template = extractTemplateMined(reconRaw, L);
      }

      const results = segmentSignalNCC(reconRaw, template, st.segThresh, fs, t);
      boundaries = results.boundaries;

      // Extract and align cycles
      if (boundaries && boundaries.length > 0) {
        alignedSegments = boundaries.map(b => {
          const rawSeg = reconRaw.slice(b.idx0, b.idx1);
          const res = resampleSignal(rawSeg, 100);
          return zScoreSignal(res);
        });
      }

      document.getElementById(`fft-seg-count-${name}`).textContent = results.count;
      document.getElementById(`fft-seg-dur-${name}`).textContent = results.avgDuration.toFixed(2);

      const templateDivId = `${p}-fft-template`;
      const { tr: trTemp, ly: lyTemp } = buildFftTemplateConfig(st, template, fs);
      Plotly.react(templateDivId, trTemp, lyTemp, PLOTLY_CFG);

      const alignedDivId = `${p}-fft-aligned`;
      const { tr: trAligned, ly: lyAligned } = buildFftAlignedConfig(st, alignedSegments);
      Plotly.react(alignedDivId, trAligned, lyAligned, PLOTLY_CFG);
    }
  } else {
    document.getElementById(`fft-seg-count-${name}`).textContent = "0";
    document.getElementById(`fft-seg-dur-${name}`).textContent = "0.00";
    const templateDivId = `${p}-fft-template`;
    Plotly.react(templateDivId, [], {}, PLOTLY_CFG);
    const alignedDivId = `${p}-fft-aligned`;
    Plotly.react(alignedDivId, [], {}, PLOTLY_CFG);
  }

  const { trTime, lyTime, trFreq, lyFreq } = buildFftPlotlyConfig(st, t, origSignal, recon, freqs, power, boundaries);

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
["rowing", "running", "wallballs"].forEach(name => {
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

  document.getElementById(`fft-seg-method-${name}`).addEventListener("change", e => {
    st.segMethod = e.target.value;
    fftUpdateFilter(name);
  });

  document.getElementById(`fft-seg-thresh-${name}`).addEventListener("input", e => {
    const val = parseFloat(e.target.value);
    st.segThresh = val;
    document.getElementById(`fft-seg-thresh-val-${name}`).textContent = val.toFixed(2);
    fftUpdateFilter(name);
  });
});

// ── Cycle Segmentation Algorithms ──

function getDominantFrequency(result) {
  const { freqs, power } = result;
  let maxIdx = 1;
  let maxVal = -1;
  for (let i = 1; i < power.length; i++) {
    if (freqs[i] < 0.15) continue; // ignore DC/leakage
    if (power[i] > maxVal) {
      maxVal = power[i];
      maxIdx = i;
    }
  }
  return freqs[maxIdx] || 0.5;
}

function extractTemplateAverage(signal, L) {
  const template = new Float64Array(L);
  const numSlices = Math.floor(signal.length / L);
  if (numSlices === 0) return template;
  
  for (let i = 0; i < numSlices; i++) {
    const start = i * L;
    for (let j = 0; j < L; j++) {
      template[j] += signal[start + j];
    }
  }
  for (let j = 0; j < L; j++) {
    template[j] /= numSlices;
  }
  return template;
}

function extractTemplateMined(signal, L) {
  const step = Math.max(1, Math.floor(L / 4));
  let bestIdx = 0;
  let maxCorr = -2;
  
  for (let i = 0; i <= signal.length - 2 * L; i += step) {
    const seg1 = signal.slice(i, i + L);
    const seg2 = signal.slice(i + L, i + 2 * L);
    const corr = calculateNCCPair(seg1, seg2);
    if (corr > maxCorr) {
      maxCorr = corr;
      bestIdx = i;
    }
  }
  return signal.slice(bestIdx, bestIdx + L);
}

function calculateNCCPair(a, b) {
  const L = a.length;
  const meanA = a.reduce((sum, v) => sum + v, 0) / L;
  const meanB = b.reduce((sum, v) => sum + v, 0) / L;
  
  let num = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < L; i++) {
    const devA = a[i] - meanA;
    const devB = b[i] - meanB;
    num += devA * devB;
    varA += devA * devA;
    varB += devB * devB;
  }
  const den = Math.sqrt(varA * varB);
  return den > 0 ? num / den : 0;
}

function segmentSignalNCC(signal, template, thresh, fs, t) {
  const N = signal.length;
  const L = template.length;
  const ncc = computeNCC(signal, template);
  
  const boundaries = [];
  const minSeparation = Math.floor(0.6 * L);
  
  for (let i = 1; i < ncc.length - 1; i++) {
    if (ncc[i] >= thresh && ncc[i] > ncc[i - 1] && ncc[i] >= ncc[i + 1]) {
      if (boundaries.length === 0 || (i - boundaries[boundaries.length - 1].idx) >= minSeparation) {
        boundaries.push({ idx: i, time: t[i] });
      }
    }
  }
  
  const count = boundaries.length;
  let avgDuration = 0;
  if (count > 1) {
    let totalDur = 0;
    for (let i = 1; i < count; i++) {
      totalDur += boundaries[i].time - boundaries[i - 1].time;
    }
    avgDuration = totalDur / (count - 1);
  } else if (count === 1) {
    avgDuration = L / fs;
  }
  
  const segments = boundaries.map((b, i) => {
    const nextB = boundaries[i + 1];
    const endIdx = nextB ? nextB.idx : Math.min(b.idx + L, t.length - 1);
    return {
      x0: b.time,
      x1: t[endIdx],
      idx0: b.idx,
      idx1: endIdx
    };
  });
  
  return {
    boundaries: segments,
    count: count,
    avgDuration: avgDuration
  };
}

function computeNCC(signal, template) {
  const N = signal.length;
  const L = template.length;
  const ncc = new Float64Array(N - L + 1);
  
  const tMean = template.reduce((a, b) => a + b, 0) / L;
  const tZero = template.map(v => v - tMean);
  const tVar = tZero.reduce((sum, v) => sum + v*v, 0);
  const tSD = Math.sqrt(tVar);
  if (tSD === 0) return ncc;
  
  for (let i = 0; i <= N - L; i++) {
    let sSum = 0;
    for (let j = 0; j < L; j++) sSum += signal[i + j];
    const sMean = sSum / L;
    
    let num = 0;
    let sVar = 0;
    for (let j = 0; j < L; j++) {
      const sVal = signal[i + j] - sMean;
      num += sVal * tZero[j];
      sVar += sVal * sVal;
    }
    const sSD = Math.sqrt(sVar);
    if (sSD > 0) {
      ncc[i] = num / (sSD * tSD);
    } else {
      ncc[i] = 0;
    }
  }
  return ncc;
}

function resampleSignal(sig, targetLen) {
  const n = sig.length;
  const resampled = new Float64Array(targetLen);
  if (n <= 1) return resampled;
  for (let i = 0; i < targetLen; i++) {
    const pos = (i / (targetLen - 1)) * (n - 1);
    const idx = Math.floor(pos);
    const frac = pos - idx;
    if (idx >= n - 1) {
      resampled[i] = sig[n - 1];
    } else {
      resampled[i] = sig[idx] * (1 - frac) + sig[idx + 1] * frac;
    }
  }
  return resampled;
}

function zScoreSignal(sig) {
  const n = sig.length;
  if (n === 0) return sig;
  const mean = sig.reduce((a, b) => a + b, 0) / n;
  const variance = sig.reduce((sum, v) => sum + (v - mean) * (v - mean), 0) / n;
  const sd = Math.sqrt(variance);
  if (sd === 0) return sig;
  return sig.map(v => (v - mean) / sd);
}
