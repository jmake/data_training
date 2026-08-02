// ── FFT Analysis section ─────────────────────────────────────────────────────

const fftState = {
  rowing: { signal: "mag", clean: "iqr", autocut: "harmonics", fmin: 0, fmax: null, result: null, inited: false, segMethod: "mined", segThresh: 0.75, segSep: 0.6 },
  running: { signal: "mag", clean: "iqr", autocut: "harmonics", fmin: 0, fmax: null, result: null, inited: false, segMethod: "mined", segThresh: 0.75, segSep: 0.6 },
  wallballs: { signal: "mag", clean: "iqr", autocut: "harmonics", fmin: 0, fmax: null, result: null, inited: false, segMethod: "mined", segThresh: 0.75, segSep: 0.6 }
};

let activeAbortController = null;

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
    document.getElementById(`fft-fmin-val-${name}`).value = 0.0;
    document.getElementById(`fft-fmax-val-${name}`).value = parseFloat(nyq.toFixed(1));
  }

  // Apply Auto High Cut if active
  if (st.autocut) {
    const val = calculateAutoHighCut(st);
    if (val !== undefined) {
      st.fmax = val;
      const fmaxEl = document.getElementById(`fft-fmax-${name}`);
      fmaxEl.value = val;
      document.getElementById(`fft-fmax-val-${name}`).value = parseFloat(val.toFixed(1));
    }
  }

  await fftRenderCharts(name, t, signal);
}

async function fftRenderCharts(name, t, origSignal) {
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
  const sdOrig = Math.sqrt(zeroMeanSignal.reduce((sum, v) => sum + v * v, 0) / zeroMeanSignal.length);
  const sdRecon = Math.sqrt(reconRaw.reduce((sum, v) => sum + v * v, 0) / reconRaw.length);
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
      let results;
      if (st.segMethod === "ruptures") {
        // Calculate number of samples in the visible zoom range
        let idxStart = 0;
        let idxEnd = reconRaw.length - 1;
        if (st.zoomMin !== null && st.zoomMin !== undefined) {
          const idx = t.findIndex(v => v >= st.zoomMin);
          if (idx !== -1) idxStart = idx;
        }
        if (st.zoomMax !== null && st.zoomMax !== undefined) {
          const idx = t.findIndex(v => v >= st.zoomMax);
          if (idx !== -1) idxEnd = idx;
        }
        const N_zoom = idxEnd - idxStart + 1;
        
        // Memory estimate check (threshold = 1.0 GB ~ 16,000 samples)
        if (N_zoom > 16000) {
          const memGB = (N_zoom * N_zoom * 4 / 1e9).toFixed(1);
          const proceed = confirm(`This signal range contains ${N_zoom.toLocaleString()} samples and requires approximately ${memGB} GB of RAM to run Ruptures. This could freeze or crash the server. Do you want to proceed?`);
          if (!proceed) {
            document.getElementById(`fft-seg-method-${name}`).value = "mined";
            st.segMethod = "mined";
            setTimeout(() => fftUpdateFilter(name), 10);
            return;
          }
        }

        const penVal = (st.segSep * 15.0).toFixed(1);
        let url = `/data/segment/${name}?clean=${st.clean}&signal=${st.signal}&pen=${penVal}`;
        if (st.zoomMin !== null && st.zoomMin !== undefined) {
          url += `&t_start=${st.zoomMin}`;
        }
        if (st.zoomMax !== null && st.zoomMax !== undefined) {
          url += `&t_end=${st.zoomMax}`;
        }

        const overlay = document.getElementById("calc-overlay");
        const cancelBtn = document.getElementById("calc-cancel-btn");
        overlay.classList.remove("hidden");

        if (activeAbortController) {
          activeAbortController.abort();
        }
        activeAbortController = new AbortController();
        const { signal: abortSignal } = activeAbortController;

        const cancelHandler = () => {
          if (activeAbortController) {
            activeAbortController.abort();
          }
          overlay.classList.add("hidden");
          document.getElementById(`fft-seg-method-${name}`).value = "mined";
          st.segMethod = "mined";
          fftUpdateFilter(name);
        };
        cancelBtn.onclick = cancelHandler;

        try {
          const res = await fetch(url, { signal: abortSignal });
          const resData = await res.json();
          overlay.classList.add("hidden");
          activeAbortController = null;

          if (resData.error) {
            alert(resData.message);
            document.getElementById(`fft-seg-method-${name}`).value = "mined";
            st.segMethod = "mined";
            results = { boundaries: [], count: 0, avgDuration: 0, template: new Float64Array(100) };
            setTimeout(() => fftUpdateFilter(name), 10);
          } else {
            boundaries = resData.boundaries;
            const count = boundaries.length;
            let avgDuration = 0;
            if (count > 0) {
              avgDuration = boundaries.reduce((sum, seg) => sum + (seg.x1 - seg.x0), 0) / count;
            }
            const templateLength = 100;
            template = new Float64Array(templateLength);
            const zSlices = [];
            for (const seg of boundaries) {
              const rawSeg = reconRaw.slice(seg.idx0, seg.idx1);
              const resampled = resampleSignal(rawSeg, templateLength);
              zSlices.push(zScoreSignal(resampled));
            }
            if (zSlices.length > 0) {
              for (let j = 0; j < templateLength; j++) {
                let sum = 0;
                for (let k = 0; k < zSlices.length; k++) sum += zSlices[k][j];
                template[j] = sum / zSlices.length;
              }
            }
            results = { boundaries, count, avgDuration, template };
          }
        } catch (err) {
          overlay.classList.add("hidden");
          activeAbortController = null;
          if (err.name === "AbortError") {
            console.log("Ruptures calculation aborted by user.");
            return;
          }
          console.error("Ruptures fetch failed:", err);
          results = { boundaries: [], count: 0, avgDuration: 0, template: new Float64Array(100) };
        }
      } else if (st.segMethod === "wavelet") {
        results = segmentWavelet(reconRaw, L, fs, t, st.segSep);
        boundaries = results.boundaries;
        template = results.template;
      } else {
        if (st.segMethod === "average") {
          template = extractTemplateAverage(reconRaw, L);
        } else {
          template = extractTemplateMined(reconRaw, L);
        }
        results = segmentSignalNCC(reconRaw, template, st.segThresh, fs, t, st.segSep);
        boundaries = results.boundaries;
      }

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
    
    // Zoom/pan listener to slice Ruptures and calculate visible statistics
    const timeEl = document.getElementById(timeDivId);
    if (timeEl) {
      timeEl.on("plotly_relayout", ev => {
        let changed = false;
        if (ev["xaxis.autorange"]) {
          st.zoomMin = null;
          st.zoomMax = null;
          changed = true;
        } else if (ev["xaxis.range[0]"] !== undefined) {
          st.zoomMin = ev["xaxis.range[0]"];
          st.zoomMax = ev["xaxis.range[1]"];
          changed = true;
        }
        if (changed) {
          fftUpdateFilter(name);
        }
      });
    }
    
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
async function fftUpdateFilter(name) {
  const st = fftState[name];
  if (!st.result) return;
  const data = sessionCache[`${name}_${st.clean}`];
  if (!data) return;
  await fftRenderCharts(name, data.acc.t, data.acc[st.signal]);
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
        document.getElementById(`fft-fmax-val-${name}`).value = parseFloat(val.toFixed(1));
        fftUpdateFilter(name);
      }
    }
  });

  const fminSlider = document.getElementById(`fft-fmin-${name}`);
  const fmaxSlider = document.getElementById(`fft-fmax-${name}`);
  const fminNum = document.getElementById(`fft-fmin-val-${name}`);
  const fmaxNum = document.getElementById(`fft-fmax-val-${name}`);

  fminSlider.addEventListener("input", e => {
    let val = parseFloat(e.target.value);
    if (val >= st.fmax) { val = st.fmax - 0.1; e.target.value = val; }
    st.fmin = val;
    fminNum.value = parseFloat(val.toFixed(1));
    fftUpdateFilter(name);
  });

  fmaxSlider.addEventListener("input", e => {
    let val = parseFloat(e.target.value);
    if (val <= st.fmin) { val = st.fmin + 0.1; e.target.value = val; }
    st.fmax = val;
    fmaxNum.value = parseFloat(val.toFixed(1));
    st.autocut = "";
    document.getElementById(`fft-autocut-${name}`).value = "";
    fftUpdateFilter(name);
  });

  const updateFromFminNum = () => {
    let val = parseFloat(fminNum.value);
    if (isNaN(val)) return;
    const nyq = (st.result && st.result.freqs) ? st.result.freqs[st.result.freqs.length - 1] : 100;
    if (val < 0) val = 0;
    if (val > nyq) val = nyq;
    if (val >= st.fmax) { val = st.fmax - 0.1; }
    fminNum.value = parseFloat(val.toFixed(1));
    st.fmin = val;
    fminSlider.value = val;
    fftUpdateFilter(name);
  };

  const updateFromFmaxNum = () => {
    let val = parseFloat(fmaxNum.value);
    if (isNaN(val)) return;
    const nyq = (st.result && st.result.freqs) ? st.result.freqs[st.result.freqs.length - 1] : 100;
    if (val < 0) val = 0;
    if (val > nyq) val = nyq;
    if (val <= st.fmin) { val = st.fmin + 0.1; }
    fmaxNum.value = parseFloat(val.toFixed(1));
    st.fmax = val;
    fmaxSlider.value = val;
    st.autocut = "";
    document.getElementById(`fft-autocut-${name}`).value = "";
    fftUpdateFilter(name);
  };

  fminNum.addEventListener("change", updateFromFminNum);
  fminNum.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      updateFromFminNum();
      fminNum.blur();
    }
  });
  fmaxNum.addEventListener("change", updateFromFmaxNum);
  fmaxNum.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      updateFromFmaxNum();
      fmaxNum.blur();
    }
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

  document.getElementById(`fft-seg-sep-${name}`).addEventListener("input", e => {
    const val = parseFloat(e.target.value);
    st.segSep = val;
    document.getElementById(`fft-seg-sep-val-${name}`).textContent = val.toFixed(2);
    fftUpdateFilter(name);
  });
});

// ── Wire up spectrum collapse titles ──────────────────────────────────────────
document.querySelectorAll(".chart-title-toggle").forEach(titleEl => {
  titleEl.addEventListener("click", () => {
    const activity = titleEl.dataset.activity;
    const targetId = titleEl.dataset.target;
    const card = document.getElementById(`fft-spectrum-card-${activity}`);
    const plotEl = document.getElementById(targetId);

    if (card.classList.contains("collapsed")) {
      card.classList.remove("collapsed");
      titleEl.textContent = "Spectrum";
      setTimeout(() => {
        if (plotEl && plotEl.layout) {
          Plotly.Plots.resize(plotEl);
        }
      }, 30);
    } else {
      card.classList.add("collapsed");
      titleEl.textContent = "Show";
    }
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

function segmentSignalNCC(signal, template, thresh, fs, t, segSep = 0.6) {
  const N = signal.length;
  const L = template.length;
  const ncc = computeNCC(signal, template);

  const boundaries = [];
  const minSeparation = Math.floor(segSep * L);

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
  const tVar = tZero.reduce((sum, v) => sum + v * v, 0);
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

function rickerWavelet(t, s) {
  const ratio = t / s;
  const r2 = ratio * ratio;
  return (1 - r2) * Math.exp(-r2 / 2);
}

function segmentWavelet(signal, L, fs, t, segSep = 0.6) {
  const N = signal.length;
  const coefs = new Float64Array(N);
  const scale = Math.max(2, L / 3);
  const winSize = Math.round(3 * scale);

  for (let i = 0; i < N; i++) {
    let sum = 0;
    for (let offset = -winSize; offset <= winSize; offset++) {
      const idx = i + offset;
      if (idx >= 0 && idx < N) {
        const wt = rickerWavelet(offset, scale);
        sum += signal[idx] * wt;
      }
    }
    coefs[i] = sum;
  }

  const boundaries = [];
  const minDist = Math.max(5, Math.round(segSep * L));
  const candidates = [];
  for (let i = 1; i < N - 1; i++) {
    if (coefs[i] > 0 && coefs[i - 1] <= 0) {
      candidates.push(i);
    }
  }

  const keptIndices = [];
  for (const idx of candidates) {
    let ok = true;
    for (const kept of keptIndices) {
      if (Math.abs(idx - kept) < minDist) {
        ok = false;
        break;
      }
    }
    if (ok) {
      keptIndices.push(idx);
    }
  }
  keptIndices.sort((a, b) => a - b);

  const segments = [];
  for (let i = 0; i < keptIndices.length - 1; i++) {
    const idx0 = keptIndices[i];
    const idx1 = keptIndices[i + 1];
    segments.push({
      idx0: idx0,
      idx1: idx1,
      x0: t[idx0],
      x1: t[idx1]
    });
  }

  const count = segments.length;
  let avgDuration = 0;
  if (count > 0) {
    avgDuration = segments.reduce((sum, seg) => sum + (seg.x1 - seg.x0), 0) / count;
  }

  const templateLength = 100;
  const template = new Float64Array(templateLength);
  const zSlices = [];
  for (const seg of segments) {
    const rawSeg = signal.slice(seg.idx0, seg.idx1);
    const resampled = resampleSignal(rawSeg, templateLength);
    zSlices.push(zScoreSignal(resampled));
  }
  if (zSlices.length > 0) {
    for (let j = 0; j < templateLength; j++) {
      let sum = 0;
      for (let k = 0; k < zSlices.length; k++) sum += zSlices[k][j];
      template[j] = sum / zSlices.length;
    }
  }

  return { boundaries: segments, count, avgDuration, template };
}
