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
      line: { color: 'rgba(255,255,255,0.15)', width: 1 }
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
  Plotly.react('wb-time-plot', timeTraces, layout, PLOTLY_CFG);
}
