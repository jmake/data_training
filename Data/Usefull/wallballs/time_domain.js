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

  const timeTraces = [
    {
      x: t,
      y: origSignal,
      type: 'scatter',
      mode: 'lines',
      name: 'Original',
      line: { color: '#ef4444', width: 1 }
    },
    {
      x: t,
      y: recon,
      type: 'scatter',
      mode: 'lines',
      name: 'Filtered',
      line: { color: '#06b6d4', width: 1.5 }
    }
  ];

  const el = document.getElementById('wb-time-plot');
  const xa = el && el._fullLayout && el._fullLayout.xaxis;
  let layout = baseLayout('ACC Magnitude');
  if (xa && !xa.autorange) {
    layout = { ...layout, xaxis: { ...layout.xaxis, range: [xa.range[0], xa.range[1]], autorange: false } };
  }

  const shapes = [];
  if (data.hr_segments && data.hr_segments.length > 0) {
    const colors = [
      'rgba(255, 255, 255, 0.02)',
      'rgba(255, 255, 255, 0.05)'
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
  layout.shapes = shapes;

  Plotly.react('wb-time-plot', timeTraces, layout, PLOTLY_CFG);
}
