// ── FFT Plotly Trace & Layout Builders ──────────────────────────────────────────

function buildFftPlotlyConfig(st, t, origSignal, recon, freqs, power, boundaries = []) {
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

  if (boundaries && boundaries.length > 0) {
    const colors = [
      "rgba(56, 189, 248, 0.16)",  // Light blue
      "rgba(129, 140, 248, 0.16)"  // Light indigo
    ];
    lyTime.shapes = boundaries.map((b, i) => ({
      type: "rect", xref: "x", yref: "paper",
      x0: b.x0, x1: b.x1, y0: 0, y1: 1,
      fillcolor: colors[i % 2],
      line: { width: 0 }
    }));
  }

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

function buildFftTemplateConfig(st, template, fs) {
  const L = template.length;
  const x = [];
  for (let i = 0; i < L; i++) {
    x.push(i / fs); // plot against time offset in seconds
  }

  const tr = [
    {
      x: x, y: Array.from(template),
      type: "scatter", mode: "lines", name: "Template",
      line: { color: "#38bdf8", width: 1.8 }
    }
  ];

  const ly = {
    paper_bgcolor: "transparent", plot_bgcolor: "transparent",
    margin: { l: 40, r: 10, t: 15, b: 30 },
    font: { family: "Inter, system-ui, sans-serif", color: "#64748b", size: 9 },
    xaxis: { title: { text: "Time Offset (s)", standoff: 4 }, gridcolor: "#1a2540", zerolinecolor: "#1e293b", color: "#4a5a7a" },
    yaxis: { gridcolor: "#1a2540", zerolinecolor: "#1e293b", color: "#4a5a7a" },
    showlegend: false, hovermode: "x"
  };

  return { tr, ly };
}

function buildFftAlignedConfig(st, alignedSegments) {
  const targetLen = 100;
  const x = [];
  for (let i = 0; i < targetLen; i++) {
    x.push(i / (targetLen - 1)); // normalized position [0, 1]
  }

  const traces = [];

  if (alignedSegments && alignedSegments.length > 0) {
    // Draw individual grey traces
    alignedSegments.forEach(seg => {
      traces.push({
        x: x, y: Array.from(seg),
        type: "scatter", mode: "lines",
        line: { color: "rgba(148, 163, 184, 0.12)", width: 1 },
        showlegend: false
      });
    });

    // Calculate mean & std dev
    const nSegs = alignedSegments.length;
    const mean = new Float64Array(targetLen);
    const std = new Float64Array(targetLen);
    for (let j = 0; j < targetLen; j++) {
      let sum = 0;
      for (let k = 0; k < nSegs; k++) sum += alignedSegments[k][j];
      mean[j] = sum / nSegs;

      let sumSq = 0;
      for (let k = 0; k < nSegs; k++) sumSq += (alignedSegments[k][j] - mean[j]) ** 2;
      std[j] = Math.sqrt(sumSq / nSegs);
    }

    const upper = [];
    const lower = [];
    for (let j = 0; j < targetLen; j++) {
      upper.push(mean[j] + std[j]);
      lower.push(mean[j] - std[j]);
    }

    // Add standard deviation band
    traces.push({
      x: x.concat(x.slice().reverse()),
      y: upper.concat(lower.slice().reverse()),
      fill: "toself",
      fillcolor: "rgba(56, 189, 248, 0.14)",
      line: { width: 0 },
      name: "±1 SD",
      showlegend: true
    });

    // Add mean line
    traces.push({
      x: x, y: Array.from(mean),
      type: "scatter", mode: "lines",
      line: { color: "#38bdf8", width: 2.2 },
      name: "Mean Profile",
      showlegend: true
    });
  }

  const ly = {
    paper_bgcolor: "transparent", plot_bgcolor: "transparent",
    margin: { l: 40, r: 14, t: 15, b: 30 },
    font: { family: "Inter, system-ui, sans-serif", color: "#64748b", size: 9 },
    xaxis: { title: { text: "Normalized Cycle Position", standoff: 4 }, gridcolor: "#1a2540", zerolinecolor: "#1e293b", color: "#4a5a7a" },
    yaxis: { title: { text: "z-scored", standoff: 4 }, gridcolor: "#1a2540", zerolinecolor: "#1e293b", color: "#4a5a7a" },
    showlegend: true, hovermode: "x",
    legend: { font: { size: 9, color: "#94a3b8" }, bgcolor: "transparent", orientation: "h", x: 0, y: 1.15 }
  };

  return { tr: traces, ly };
}
