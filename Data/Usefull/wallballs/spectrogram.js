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

  const trace = {
    x: spec.t,
    y: spec.f,
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
    hovertemplate: 
      'Time: %{x:.2f}s<br>' +
      'Frequency: %{y:.2f} Hz<br>' +
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

  const el = document.getElementById('wb-spec-plot');
  const xa = el && el._fullLayout && el._fullLayout.xaxis;
  
  let layout = baseLayout('Frequency (Hz)');
  layout.margin = { ...layout.margin, b: 70 };
  layout.showlegend = false;
  layout.shapes = shapes;
  
  // Set Y-axis to logarithmic with custom clean ticks and intermediate gridlines
  const yTicksHz = [
    0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9,
    1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0,
    10.0, 20.0
  ];
  const tickText = yTicksHz.map(v => (v === 0.1 || v === 1.0 || v === 10.0) ? v.toString() : "");

  layout.xaxis = {
    ...layout.xaxis,
    showgrid: true,
    gridcolor: 'rgba(255,255,255,1.0)',
    layer: 'above traces'
  };

  layout.yaxis = {
    ...layout.yaxis,
    type: 'log',
    tickvals: yTicksHz,
    ticktext: tickText,
    showgrid: true,
    gridcolor: 'rgba(255,255,255,1.0)',
    layer: 'above traces',
    autorange: true
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
