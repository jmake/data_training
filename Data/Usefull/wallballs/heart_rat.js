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
  layout.showlegend = false;
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

  Plotly.react('wb-hr-plot', [hrTrace], layout, PLOTLY_CFG);
}
