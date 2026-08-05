function renderTimeDomain(data, state) {
  if (!data || !data.acc) return;
  const acc = data.acc;
  const t = acc.t;
  const origSignal = acc[state.signal];
  const fs = data.stats.sample_rate || 50;

  // Reconstructed Signal (FFT + Filter)
  const mean = origSignal.reduce((a, b) => a + b, 0) / origSignal.length;
  const zeroMeanSignal = origSignal.map(v => v - mean);
  const fftRes = signalFFT(zeroMeanSignal, fs);
  const reconRaw = bandpassReconstruct(fftRes, state.lowCut, state.highCut);
  const recon = reconRaw.map(v => v + mean);

  // Power Filtered Reconstructed Signal (Overlap-Add)
  const reconPowerRaw = spectrogramOverlapAdd(zeroMeanSignal, fs, 1024, 896, state.specMin, state.specMax);
  const reconPower = reconPowerRaw.map(v => v + mean);

  // Downsample Filtered trace for plotting based on reconRate (Nyquist theorem limit)
  const step = Math.max(1, Math.floor(fs / state.reconRate));
  const plotT = [];
  const plotRecon = [];
  for (let i = 0; i < t.length; i += step) {
    plotT.push(t[i]);
    plotRecon.push(recon[i]);
  }

  const timeTraces = [
    {
      x: t,
      y: origSignal,
      type: 'scatter',
      mode: 'lines',
      name: 'Original',
      line: { color: '#4b5563', width: 1.5 }
    },
    {
      x: plotT,
      y: plotRecon,
      type: 'scatter',
      mode: 'lines+markers',
      name: 'Filtered',
      line: { color: '#06b6d4', width: 1.5 },
      marker: { size: 3 },
      selected: { marker: { color: '#f97316', size: 6, opacity: 1 } },
      unselected: { marker: { opacity: 0 } }
    },
    {
      x: t,
      y: reconPower,
      type: 'scatter',
      mode: 'lines',
      name: 'PowerA',
      visible: 'legendonly',
      line: { color: '#eab308', width: 1.5 }
    }
  ];

  const el = document.getElementById('wb-time-plot');
  const xa = el && el._fullLayout && el._fullLayout.xaxis;
  let layout = baseLayout('ACC Magnitude');
  if (xa && !xa.autorange) {
    layout = { ...layout, xaxis: { ...layout.xaxis, range: [xa.range[0], xa.range[1]], autorange: false } };
  } else {
    layout = { ...layout, xaxis: { ...layout.xaxis, range: [t[0], t[t.length - 1]], autorange: false } };
  }

  const shapes = [];
  if (data.hr_segments && data.hr_segments.length > 0) {
    const colors = [
      'rgba(239, 68, 68, 0.02)',
      'rgba(239, 68, 68, 0.05)'
    ];
    data.hr_segments.forEach((seg, i) => {
      shapes.push({
        type: 'rect',
        xref: 'x',
        yref: 'paper',
        x0: seg.x0,
        x1: seg.x1,
        y0: 0,
        y1: 1,
        fillcolor: colors[i % 2],
        line: { width: 0 },
        layer: 'below'
      });
    });
  }
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
        line: { color: 'rgba(239, 68, 68, 0.3)', width: 1, dash: 'dash' }
      });
    });
  }
  if (state.accSegments && state.accSegments.length > 0) {
    const accColors = [
      'rgba(34, 197, 94, 0.03)',
      'rgba(34, 197, 94, 0.07)'
    ];
    state.accSegments.forEach((seg, i) => {
      shapes.push({
        type: 'rect',
        xref: 'x',
        yref: 'paper',
        x0: seg.x0,
        x1: seg.x1,
        y0: 0,
        y1: 1,
        fillcolor: accColors[i % 2],
        line: { width: 0 },
        layer: 'below'
      });
    });
  }
  if (state.accPeaks && state.accPeaks.length > 0) {
    state.accPeaks.forEach(peak => {
      shapes.push({
        type: 'line',
        xref: 'x',
        yref: 'paper',
        x0: peak,
        x1: peak,
        y0: 0,
        y1: 1,
        line: { color: 'rgba(34, 197, 94, 0.5)', width: 1, dash: 'dash' }
      });
    });
  }
  layout.shapes = shapes;

  const timePlotCfg = {
    ...PLOTLY_CFG,
    modeBarButtonsToRemove: []
  };

  Plotly.react('wb-time-plot', timeTraces, layout, timePlotCfg).then(() => {
    const timeStatusEl = document.getElementById('wb-time-selection-status');
    if (timeStatusEl) {
      timeStatusEl.textContent = `(0 / ${plotT.length} pts)`;
    }
  });
}

/* Reconstruct signal from STFT windows using Overlap-Add, keeping bins with power within [pmin, pmax] */
function spectrogramOverlapAdd(signal, fs, nperseg = 1024, noverlap = 896, pmin, pmax) {
  const step = nperseg - noverlap;
  const N = _nextPow2(nperseg);
  const half = Math.floor(N / 2) + 1;

  const outSignal = new Float64Array(signal.length);
  const winSum = new Float64Array(signal.length);

  // Hanning window
  const win = new Float64Array(nperseg);
  for (let i = 0; i < nperseg; i++) {
    win[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (nperseg - 1)));
  }

  const re = new Float64Array(N);
  const im = new Float64Array(N);

  for (let offset = 0; offset + nperseg <= signal.length; offset += step) {
    // Apply Hanning window
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < nperseg; i++) {
      re[i] = signal[offset + i] * win[i];
    }

    // FFT
    _fft(re, im);

    // Filter bins based on local magnitude
    for (let k = 0; k < half; k++) {
      const mag = Math.sqrt(re[k]*re[k] + im[k]*im[k]) / nperseg;
      const val = (k === 0 || k === half - 1) ? mag : mag * 2;
      if (val < pmin || val > pmax) {
        re[k] = 0;
        im[k] = 0;
        if (k > 0 && k < half - 1) {
          re[N - k] = 0;
          im[N - k] = 0;
        }
      }
    }

    // IFFT
    _ifft(re, im);

    // Overlap-Add with Hanning window
    for (let i = 0; i < nperseg; i++) {
      outSignal[offset + i] += re[i] * win[i];
      winSum[offset + i] += win[i] * win[i];
    }
  }

  // Normalize by window sum
  const result = new Array(signal.length);
  for (let i = 0; i < signal.length; i++) {
    result[i] = winSum[i] > 1e-5 ? outSignal[i] / winSum[i] : 0;
  }
  return result;
}
