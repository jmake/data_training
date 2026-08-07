const PLOTLY_CFG = {
  responsive: true,
  displayModeBar: true,
  modeBarButtonsToRemove: ['select2d', 'lasso2d'],
  displaylogo: false
};

const baseLayout = (titleY) => ({
  uirevision: state.sessionName,
  paper_bgcolor: 'transparent',
  plot_bgcolor: 'transparent',
  margin: { l: 60, r: 20, t: 10, b: 40 },
  font: { family: 'Outfit, sans-serif', color: '#9ca3af', size: 11 },
  xaxis: {
    title: { text: 'Time (s)', standoff: 6 },
    gridcolor: 'rgba(255,255,255,0.04)',
    zerolinecolor: 'rgba(255,255,255,0.08)'
  },
  yaxis: {
    title: { text: titleY, standoff: 6 },
    gridcolor: 'rgba(255,255,255,0.04)',
    zerolinecolor: 'rgba(255,255,255,0.08)'
  },
  showlegend: true,
  legend: {
    x: 0.01,
    y: 0.99,
    xanchor: 'left',
    yanchor: 'top',
    bgcolor: 'rgba(0,0,0,0)',
    orientation: 'h',
    font: { size: 10 }
  }
});
