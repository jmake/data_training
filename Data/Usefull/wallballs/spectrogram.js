function renderSpectrogram(data, state) {
  if (!data || !data.acc) return;
  const acc = data.acc;
  const origSignal = acc[state.signal];
  const fs = data.stats.sample_rate || 50;

  // Compute zero-mean signal to run the spectrogram
  const mean = origSignal.reduce((a, b) => a + b, 0) / origSignal.length;
  const zeroMeanSignal = origSignal.map(v => v - mean);

  // Choose the source signal based on configuration
  let targetSignal = zeroMeanSignal;
  if (state.specSource === 'filtered') {
    const fftRes = signalFFT(zeroMeanSignal, fs);
    targetSignal = bandpassReconstruct(fftRes, state.lowCut, state.highCut);
  }

  // Compute spectrogram using 1024 segment size, 896 overlap, up to Nyquist limit
  const spec = computeSpectrogram(targetSignal, fs, 1024, 896);

  // Find absolute minimum and maximum power values in the spectrogram
  let minVal = Infinity;
  let maxVal = -Infinity;
  for (let y = 0; y < spec.Sxx.length; y++) {
    for (let x = 0; x < spec.Sxx[y].length; x++) {
      const val = spec.Sxx[y][x];
      if (val < minVal) minVal = val;
      if (val > maxVal) maxVal = val;
    }
  }

  // If the active signal changed or it is the first load, reset state and inputs to the real signal bounds
  const minSlider = document.getElementById('wb-spec-min-slider');
  const maxSlider = document.getElementById('wb-spec-max-slider');
  const minInput = document.getElementById('wb-spec-min');
  const maxInput = document.getElementById('wb-spec-max');

  if (state.lastSignal !== state.signal) {
    state.specMin = minVal;
    state.specMax = maxVal;
    state.lastSignal = state.signal;

    if (minInput) minInput.value = minVal.toFixed(6);
    if (maxInput) maxInput.value = maxVal.toFixed(6);
  }

  // Update HTML sliders range dynamically to match calculated power bounds
  if (minSlider && maxSlider) {
    const rangeSpan = maxVal - minVal;
    const stepVal = rangeSpan > 0 ? rangeSpan / 1000 : 0.001;

    minSlider.min = minVal;
    minSlider.max = maxVal;
    minSlider.step = stepVal;
    minSlider.value = state.specMin;

    maxSlider.min = minVal;
    maxSlider.max = maxVal;
    maxSlider.step = stepVal;
    maxSlider.value = state.specMax;
  }

  // Generate hover text to display physical frequency values
  const hoverText = [];
  for (let y = 0; y < spec.f.length; y++) {
    const f = spec.f[y];
    const row = [];
    for (let x = 0; x < spec.t.length; x++) {
      row.push(f.toFixed(2));
    }
    hoverText.push(row);
  }

  const trace = {
    x: spec.t,
    y: spec.f.map(f => Math.log10(f)), // Map to log10 coordinates directly
    z: spec.Sxx,
    type: 'heatmap',
    zmin: state.specMin,
    zmax: state.specMax,
    colorscale: 'Viridis',
    showscale: true,
    colorbar: {
      orientation: 'h',
      y: -0.25,
      yanchor: 'top',
      thickness: 12,
      len: 0.6,
      tickfont: { color: '#9ca3af', size: 9 }
    },
    text: hoverText,
    hovertemplate: 
      'Time: %{x:.2f}s<br>' +
      'Frequency: %{text} Hz<br>' +
      'Power: %{z:.6f} g²<extra></extra>'
  };

  // Peak division lines (Alternative 1)
  const shapes = [];
  if (data.hr_peaks) {
    data.hr_peaks.forEach(peak => {
      shapes.push({
        type: 'line',
        xref: 'x',
        yref: 'paper',
        x0: peak,
        x1: peak,
        y0: 0,
        y1: 1,
        line: { color: 'rgba(255, 255, 255, 0.3)', width: 1, dash: 'dash' }
      });
    });
  }

  // Determine dynamic frequency display boundaries based on source
  const minF = spec.f[0];
  const maxF = spec.f[spec.f.length - 1];
  let displayMin = minF;
  let displayMax = maxF;

  if (state.specSource === 'filtered') {
    if (state.lowCut > 0) {
      displayMin = Math.max(minF, state.lowCut);
    }
    if (state.highCut > 0) {
      displayMax = Math.min(maxF, state.highCut);
    }
  }

  // Dynamically compute powers of 10 within display bounds for gridlines and label text
  const startPower = Math.ceil(Math.log10(displayMin));
  const endPower = Math.floor(Math.log10(displayMax));

  const mainYTicks = [];
  for (let p = startPower; p <= endPower; p++) {
    mainYTicks.push(Math.pow(10, p));
  }

  // Draw horizontal gridlines above the heatmap for the main powers of 10 ticks
  mainYTicks.forEach(v => {
    shapes.push({
      type: 'line',
      xref: 'paper',
      yref: 'y',
      x0: 0,
      x1: 1,
      y0: Math.log10(v),
      y1: Math.log10(v),
      line: { color: 'rgba(255, 255, 255, 0.2)', width: 1 },
      layer: 'above'
    });
  });

  const el = document.getElementById('wb-spec-plot');
  const xa = el && el._fullLayout && el._fullLayout.xaxis;
  
  let layout = baseLayout('Frequency (Hz)');
  layout.margin = { ...layout.margin, b: 70 };
  layout.showlegend = false;
  layout.shapes = shapes;
  
  // Dynamically generate log sub-ticks (1 through 9 for each power decade)
  const yTicksHz = [];
  for (let p = startPower - 1; p <= endPower + 1; p++) {
    const base = Math.pow(10, p);
    for (let mult = 1; mult <= 9; mult++) {
      const val = base * mult;
      if (val >= displayMin && val <= displayMax) {
        yTicksHz.push(val);
      }
    }
  }

  const tickVals = yTicksHz.map(v => Math.log10(v));
  const tickText = yTicksHz.map(v => {
    const isPowerOf10 = Math.abs(Math.log10(v) - Math.round(Math.log10(v))) < 1e-9;
    return isPowerOf10 ? v.toString() : "";
  });

  layout.yaxis = {
    ...layout.yaxis,
    type: 'linear', // Use linear axis with log data to bypass Plotly bugs
    tickmode: 'array',
    tickvals: tickVals,
    ticktext: tickText,
    range: [Math.log10(displayMin), Math.log10(displayMax)],
    autorange: false
  };

  Plotly.react('wb-spec-plot', [trace], layout, PLOTLY_CFG);
}

function computeSpectrogram(signal, fs, nperseg = 1024, noverlap = 896) {
  const step = nperseg - noverlap;
  const N = _nextPow2(nperseg);
  const half = Math.floor(N / 2) + 1;

  // Frequency axis: skip index 0 (0 Hz) to prevent log(0) errors
  const freqs = [];
  for (let k = 1; k < half; k++) {
    freqs.push((k * fs) / N);
  }
  const nFreqs = freqs.length;

  const t_spec = [];
  const Sxx = [];
  for (let y = 0; y < nFreqs; y++) {
    Sxx.push([]);
  }

  // Hanning window
  const win = new Float64Array(nperseg);
  for (let i = 0; i < nperseg; i++) {
    win[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (nperseg - 1)));
  }

  const re = new Float64Array(N);
  const im = new Float64Array(N);

  for (let offset = 0; offset + nperseg <= signal.length; offset += step) {
    const center_t = (offset + nperseg / 2) / fs;
    t_spec.push(center_t);

    // Apply Hanning window
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < nperseg; i++) {
      re[i] = signal[offset + i] * win[i];
    }

    _fft(re, im);

    // One-sided magnitude spectrum (skipping index 0)
    for (let k = 1; k < half; k++) {
      const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]) / nperseg;
      const val = (k === half - 1) ? mag : mag * 2;
      Sxx[k - 1].push(val);
    }
  }

  return { t: t_spec, f: freqs, Sxx: Sxx };
}
