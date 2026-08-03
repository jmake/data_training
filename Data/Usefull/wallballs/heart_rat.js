function renderHeartRate(data) {
  if (!data || !data.hr) return;
  const hr = data.hr;
  const hrTrace = {
    x: hr.t,
    y: hr.bpm,
    type: 'scatter',
    mode: 'lines',
    name: 'Heart Rate',
    line: { color: '#ef4444', width: 2 }
  };
  const el = document.getElementById('wb-hr-plot');
  const xa = el && el._fullLayout && el._fullLayout.xaxis;
  let layout = baseLayout('BPM');
  if (xa && !xa.autorange) {
    layout = { ...layout, xaxis: { ...layout.xaxis, range: [xa.range[0], xa.range[1]], autorange: false } };
  }
  Plotly.react('wb-hr-plot', [hrTrace], layout, PLOTLY_CFG);
}
