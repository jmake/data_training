// ── FFT Plotly Trace & Layout Builders ──────────────────────────────────────────

function buildFftPlotlyConfig(st, t, origSignal, recon, freqs, power) {
  const isNorm = st.clean === "norm";
  const isIqr = st.clean === "iqr";
  const yLabel = isNorm ? "Normalized" : (isIqr ? "Q3 + A x IQR" : "g");
  const yFreqLabel = isNorm ? "Amplitude (Normalized)" : (isIqr ? "Amplitude (Q3 + A x IQR)" : "Amplitude (g)");

  // Time Domain Trace & Layout
  const trTime = [
    {
      x: t, y: Array.from(origSignal), type: "scattergl", mode: "lines",
      name: "Original", line: { color: "#ef4444", width: 1 }
    },
    {
      x: t, y: recon, type: "scattergl", mode: "lines",
      name: "Reconstruction", line: { color: "#38bdf8", width: 1.5 }
    }
  ];

  const lyTime = {
    uirevision: `${st.signal}_${st.clean}`,
    paper_bgcolor: "transparent", plot_bgcolor: "transparent",
    margin: { l: 54, r: 14, t: 32, b: 36 },
    font: { family: "Inter, system-ui, sans-serif", color: "#64748b", size: 10 },
    xaxis: { title: { text: "Time (s)", standoff: 4 }, gridcolor: "#1a2540", zerolinecolor: "#1e293b", color: "#4a5a7a" },
    yaxis: { title: { text: yLabel, standoff: 4 }, gridcolor: "#1a2540", zerolinecolor: "#1e293b", color: "#4a5a7a" },
    showlegend: true, hovermode: "x unified",
    legend: { font: { size: 10, color: "#94a3b8" }, bgcolor: "transparent", orientation: "h", x: 0, y: 1.08 }
  };

  // Frequency Domain Trace & Layout
  const trFreq = [
    {
      x: Array.from(freqs), y: Array.from(power),
      type: "scatter", mode: "lines", name: "Spectrum",
      line: { color: "#818cf8", width: 1.2 },
      fill: "tozeroy", fillcolor: "rgba(129,140,248,0.07)"
    }
  ];

  const lyFreq = {
    uirevision: `${st.signal}_${st.clean}`,
    paper_bgcolor: "transparent", plot_bgcolor: "transparent",
    margin: { l: 54, r: 14, t: 32, b: 36 },
    font: { family: "Inter, system-ui, sans-serif", color: "#64748b", size: 10 },
    xaxis: { title: { text: "Frequency (Hz)", standoff: 4 }, gridcolor: "#1a2540", zerolinecolor: "#1e293b", color: "#4a5a7a" },
    yaxis: { title: { text: yFreqLabel, standoff: 4 }, gridcolor: "#1a2540", zerolinecolor: "#1e293b", color: "#4a5a7a", type: "log" },
    showlegend: false, hovermode: "x unified",
    shapes: [{
      type: "rect", xref: "x", yref: "paper",
      x0: st.fmin, x1: st.fmax, y0: 0, y1: 1,
      fillcolor: "rgba(56,189,248,0.09)",
      line: { color: "rgba(56,189,248,0.4)", width: 1 }
    }]
  };

  return { trTime, lyTime, trFreq, lyFreq };
}
