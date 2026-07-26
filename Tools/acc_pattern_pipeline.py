"""
Accelerometer signal pattern analysis pipeline.

1. Downloads the Polar H10 accelerometer file (time, X, Y, Z) from GitHub.
2. Normalizes X/Y/Z to [-1, 1] (time column excluded), plots the raw signals as a
   static PNG, and builds an interactive Plotly HTML plot of the raw X/Y/Z data.
3. For each component (X, Y, Z):
   a. Detects active regions using a baseline-deviation envelope + Otsu threshold.
   b. Estimates the dominant cycle period via autocorrelation.
   c. Segments individual cycles (valley-to-valley) within active regions.
   d. Saves the extracted pattern table (start/end time, duration, samples) as CSV.
   e. Aligns cycles (time-normalized to a fixed length, z-scored) and plots the
      overlay with mean +/- 1 std, when at least 2 patterns were found.
4. Builds a single combined interactive HTML with one titled section per component
   (X, Y, Z), each showing its stats (pattern count, mean/min/max duration) and its
   own Plotly plot with cycles shaded in alternating colors.
5. Builds a single combined interactive HTML with one titled section per component
   showing aligned-pattern stats (count, mean/std/range duration) and an overlay
   plot (all aligned cycles, mean +/- 1 std band).
6. Saves a JSON summary (pattern count and estimated period per component).

Requires plotly.js-dist-min installed locally (npm install plotly.js-dist-min)
in the same directory as this script, for the interactive HTML plots.
"""

import os
import json
import urllib.request
from io import StringIO

import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from scipy.signal import find_peaks
from scipy.interpolate import interp1d
from skimage.filters import threshold_otsu

DATA_URL = "https://raw.githubusercontent.com/jmake/data_training/main/Data/Polar_H10_1D61CD3D_1784733608827_ACC.txt"
OUTPUT_DIR = "/mnt/user-data/outputs"
COMPONENTS = ["X", "Y", "Z"]
TARGET_LEN = 100
XLIM_PREVIEW = (7.5, 30)


def load_data(url: str) -> pd.DataFrame:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    raw = urllib.request.urlopen(req).read().decode("utf-8")
    return pd.read_csv(StringIO(raw), header=None, names=["time", "X", "Y", "Z"])


def normalize_df(df: pd.DataFrame, exclude=("time",)) -> pd.DataFrame:
    df_norm = df.copy()
    for c in df.columns:
        if c in exclude:
            continue
        df_norm[c] = 2 * (df[c] - df[c].min()) / (df[c].max() - df[c].min()) - 1
    return df_norm


def plot_raw_data(df: pd.DataFrame, out_path: str) -> None:
    fig, axes = plt.subplots(4, 1, figsize=(12, 9), sharex=True)
    for ax, c in zip(axes, ["time", "X", "Y", "Z"]):
        ax.plot(df["time"], df[c], linewidth=0.8)
        ax.set_ylabel(c)
        ax.grid(True, alpha=0.3)
    axes[-1].set_xlabel("time (s)")
    plt.tight_layout()
    plt.savefig(out_path, dpi=120)
    plt.close()


def build_interactive_raw_plot(df: pd.DataFrame, plotly_lib: str, out_path: str) -> None:
    time_data = [round(t, 4) for t in df["time"].tolist()]
    traces_js = "const timeData = " + json.dumps(time_data) + ";\n"
    for col in ["X", "Y", "Z"]:
        traces_js += f"const {col}Data = " + json.dumps([round(v, 4) for v in df[col].tolist()]) + ";\n"

    html = """<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>Raw accelerometer data</title>
<style>
  body { font-family: sans-serif; margin: 0; padding: 10px; }
  #plot { width: 100%; height: 92vh; }
</style>
</head>
<body>
<div id="plot"></div>
<script>
""" + plotly_lib + """
</script>
<script>
""" + traces_js + """
const traces = [
  { x: timeData, y: XData, type: "scatter", mode: "lines", name: "X", line: {width: 1} },
  { x: timeData, y: YData, type: "scatter", mode: "lines", name: "Y", line: {width: 1} },
  { x: timeData, y: ZData, type: "scatter", mode: "lines", name: "Z", line: {width: 1} }
];
const layout = {
  title: "Raw accelerometer data (X, Y, Z)",
  xaxis: { title: "time (s)", rangeslider: {visible: true} },
  yaxis: { title: "value" },
  margin: {t: 40}
};
Plotly.newPlot("plot", traces, layout, {responsive: true});
</script>
</body>
</html>
"""
    with open(out_path, "w") as f:
        f.write(html)


def compute_activity_mask(df: pd.DataFrame, col: str, baseline_sec=2.0, window_sec=0.3,
                           min_duration_sec=0.15, gap_fill_sec=0.1) -> np.ndarray:
    dt = df["time"].diff().median()
    baseline_win = max(3, int(baseline_sec / dt))
    env_win = max(3, int(window_sec / dt))
    min_duration = max(1, int(min_duration_sec / dt))
    gap_fill = max(1, int(gap_fill_sec / dt))

    signal = df[col].values
    baseline = pd.Series(signal).rolling(baseline_win, center=True, min_periods=1).median().values
    deviation = np.abs(signal - baseline)
    envelope = pd.Series(deviation).rolling(env_win, center=True, min_periods=1).max().values
    threshold = threshold_otsu(envelope)
    mask = envelope > threshold

    diff = np.diff((~mask).astype(int), prepend=0, append=0)
    for s, e in zip(np.where(diff == 1)[0], np.where(diff == -1)[0]):
        if (e - s) < gap_fill:
            mask[s:e] = True

    diff = np.diff(mask.astype(int), prepend=0, append=0)
    for s, e in zip(np.where(diff == 1)[0], np.where(diff == -1)[0]):
        if (e - s) < min_duration:
            mask[s:e] = False

    return mask


def estimate_period_sec(df: pd.DataFrame, col: str, mask: np.ndarray) -> float:
    dt = df["time"].diff().median()
    idx = np.where(mask)[0]
    if len(idx) < 10:
        return 1.0
    sig = df[col].values[idx[0]:idx[0] + min(3000, len(idx))]
    sig = sig - sig.mean()
    ac = np.correlate(sig, sig, mode="full")[len(sig) - 1:]
    ac = ac / ac[0]
    peaks_ac, _ = find_peaks(ac, distance=int(0.3 / dt))
    if len(peaks_ac) == 0:
        return 1.0
    return float(peaks_ac[0] * dt)


def extract_cycle_patterns(df: pd.DataFrame, mask: np.ndarray, col: str, min_period_sec: float) -> pd.DataFrame:
    dt = df["time"].diff().median()
    distance = max(1, int(0.7 * min_period_sec / dt))
    signal = df[col].values
    valleys, _ = find_peaks(-signal, distance=distance, prominence=0.3)
    valleys = valleys[mask[valleys]]

    rows = []
    for i in range(len(valleys) - 1):
        s, e = int(valleys[i]), int(valleys[i + 1])
        if not mask[s:e].all():
            continue
        rows.append({
            "pattern_id": len(rows),
            "start_idx": s,
            "end_idx": e,
            "start_time": df["time"].iloc[s],
            "end_time": df["time"].iloc[e],
            "duration_s": df["time"].iloc[e] - df["time"].iloc[s],
            "n_samples": e - s,
        })
    return pd.DataFrame(rows)


def align_patterns(df: pd.DataFrame, table: pd.DataFrame, col: str, target_len: int) -> np.ndarray:
    aligned = np.zeros((len(table), target_len))
    x_new = np.linspace(0, 1, target_len)
    signal = df[col].values
    for i, row in table.iterrows():
        s, e = int(row["start_idx"]), int(row["end_idx"])
        seg = signal[s:e + 1]
        x_old = np.linspace(0, 1, len(seg))
        seg_resampled = interp1d(x_old, seg, kind="linear")(x_new)
        aligned[i] = (seg_resampled - seg_resampled.mean()) / (seg_resampled.std() + 1e-9)
    return aligned


def plot_aligned_patterns(aligned: np.ndarray, col: str, out_path: str) -> None:
    x_new = np.linspace(0, 1, aligned.shape[1])
    mean_pattern = aligned.mean(axis=0)
    std_pattern = aligned.std(axis=0)

    fig, ax = plt.subplots(figsize=(9, 5))
    for row in aligned:
        ax.plot(x_new, row, color="gray", alpha=0.15, linewidth=0.8)
    ax.plot(x_new, mean_pattern, color="red", linewidth=2, label="mean pattern")
    ax.fill_between(x_new, mean_pattern - std_pattern, mean_pattern + std_pattern,
                     color="red", alpha=0.2, label="±1 std")
    ax.set_xlabel("normalized cycle position")
    ax.set_ylabel(f"{col} (z-scored)")
    ax.set_title(f"Aligned patterns - {col} (n={len(aligned)})")
    ax.grid(True, alpha=0.3)
    ax.legend()
    plt.tight_layout()
    plt.savefig(out_path, dpi=120)
    plt.close()


def build_pattern_section(df: pd.DataFrame, table: pd.DataFrame, col: str) -> str:
    time_data = [round(t, 4) for t in df["time"].tolist()]
    signal_data = [round(v, 4) for v in df[col].tolist()]
    colors = ["rgba(46,160,67,0.28)", "rgba(255,165,0,0.28)"]
    shapes_data = [{
        "x0": row["start_time"], "x1": row["end_time"], "color": colors[i % 2]
    } for i, row in table.reset_index(drop=True).iterrows()]

    n_patterns = len(table)
    if n_patterns > 0:
        mean_dur = table["duration_s"].mean()
        min_dur = table["duration_s"].min()
        max_dur = table["duration_s"].max()
        stats_html = (
            f"Patterns detected: {n_patterns} &nbsp;|&nbsp; "
            f"Mean duration: {mean_dur:.3f}s &nbsp;|&nbsp; "
            f"Range: {min_dur:.3f}s - {max_dur:.3f}s"
        )
    else:
        stats_html = "Patterns detected: 0"

    div_id = f"plot_{col}"
    section_js = f"""
const timeData_{col} = """ + json.dumps(time_data) + f""";
const sigData_{col} = """ + json.dumps(signal_data) + f""";
const shapesRaw_{col} = """ + json.dumps(shapes_data) + f""";
const shapes_{col} = shapesRaw_{col}.map(p => ({{
  type: "rect", xref: "x", yref: "paper",
  x0: p.x0, x1: p.x1, y0: 0, y1: 1,
  fillcolor: p.color, line: {{width: 0}}
}}));
const trace_{col} = {{
  x: timeData_{col}, y: sigData_{col}, type: "scatter", mode: "lines",
  line: {{color: "black", width: 1}}, name: "{col}"
}};
const layout_{col} = {{
  xaxis: {{ title: "time (s)", rangeslider: {{visible: true}} }},
  yaxis: {{ title: "{col}", range: [-1.1, 1.1] }},
  shapes: shapes_{col},
  margin: {{t: 20}}
}};
Plotly.newPlot("{div_id}", [trace_{col}], layout_{col}, {{responsive: true}});
"""

    section_html = f"""
<div class="section">
  <h2>Component {col}</h2>
  <div class="stats">{stats_html}</div>
  <div id="{div_id}" class="plot"></div>
</div>
"""
    return section_html, section_js


def build_combined_interactive_plot(df: pd.DataFrame, tables: dict, plotly_lib: str, out_path: str) -> None:
    sections_html = []
    sections_js = []
    for col in COMPONENTS:
        section_html, section_js = build_pattern_section(df, tables[col], col)
        sections_html.append(section_html)
        sections_js.append(section_js)

    html = """<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>Pattern segments - all components</title>
<style>
  body { font-family: sans-serif; margin: 0; padding: 10px; }
  .section { margin-bottom: 30px; border-bottom: 1px solid #ddd; padding-bottom: 20px; }
  .section h2 { margin-bottom: 4px; }
  .stats { color: #555; font-size: 14px; margin-bottom: 8px; }
  .plot { width: 100%; height: 55vh; }
</style>
</head>
<body>
<h1>Detected cycle patterns - X, Y, Z</h1>
""" + "\n".join(sections_html) + """
<script>
""" + plotly_lib + """
</script>
<script>
""" + "\n".join(sections_js) + """
</script>
</body>
</html>
"""
    with open(out_path, "w") as f:
        f.write(html)


def build_aligned_section(aligned: np.ndarray, table: pd.DataFrame, col: str) -> tuple:
    div_id = f"aligned_{col}"
    if aligned is None or len(aligned) == 0:
        stats_html = "No patterns available for alignment."
        section_html = f"""
<div class="section">
  <h2>Component {col}</h2>
  <div class="stats">{stats_html}</div>
</div>
"""
        return section_html, ""

    x_new = np.linspace(0, 1, aligned.shape[1]).tolist()
    mean_pattern = aligned.mean(axis=0)
    std_pattern = aligned.std(axis=0)
    upper = (mean_pattern + std_pattern).tolist()
    lower = (mean_pattern - std_pattern).tolist()
    mean_pattern = mean_pattern.tolist()

    n_patterns = len(table)
    mean_dur = table["duration_s"].mean()
    std_dur = table["duration_s"].std()
    min_dur = table["duration_s"].min()
    max_dur = table["duration_s"].max()
    stats_html = (
        f"Patterns aligned: {n_patterns} &nbsp;|&nbsp; "
        f"Duration: {mean_dur:.3f}s &plusmn; {std_dur:.3f}s "
        f"(range {min_dur:.3f}s - {max_dur:.3f}s)"
    )

    individual_traces_js = ""
    for row in aligned:
        individual_traces_js += "{ x: xNew_" + col + ", y: " + json.dumps([round(v, 4) for v in row.tolist()]) + \
            ", type: 'scatter', mode: 'lines', line: {color: 'gray', width: 1}, opacity: 0.15, showlegend: false },\n"

    section_js = f"""
const xNew_{col} = """ + json.dumps(x_new) + f""";
const meanPattern_{col} = """ + json.dumps([round(v, 4) for v in mean_pattern]) + f""";
const upperBand_{col} = """ + json.dumps([round(v, 4) for v in upper]) + f""";
const lowerBand_{col} = """ + json.dumps([round(v, 4) for v in lower]) + f""";

const bandTrace_{col} = {{
  x: xNew_{col}.concat(xNew_{col}.slice().reverse()),
  y: upperBand_{col}.concat(lowerBand_{col}.slice().reverse()),
  fill: "toself", fillcolor: "rgba(255,0,0,0.15)", line: {{width: 0}},
  name: "+/-1 std", showlegend: true
}};
const meanTrace_{col} = {{
  x: xNew_{col}, y: meanPattern_{col}, type: "scatter", mode: "lines",
  line: {{color: "red", width: 2}}, name: "mean pattern"
}};
const individualTraces_{col} = [
{individual_traces_js}
];
const layout_{col} = {{
  xaxis: {{ title: "normalized cycle position" }},
  yaxis: {{ title: "{col} (z-scored)" }},
  margin: {{t: 20}}
}};
Plotly.newPlot("{div_id}", individualTraces_{col}.concat([bandTrace_{col}, meanTrace_{col}]), layout_{col}, {{responsive: true}});
"""

    section_html = f"""
<div class="section">
  <h2>Component {col}</h2>
  <div class="stats">{stats_html}</div>
  <div id="{div_id}" class="plot"></div>
</div>
"""
    return section_html, section_js


def build_combined_aligned_plot(aligned_dict: dict, tables: dict, plotly_lib: str, out_path: str) -> None:
    sections_html = []
    sections_js = []
    for col in COMPONENTS:
        section_html, section_js = build_aligned_section(aligned_dict.get(col), tables[col], col)
        sections_html.append(section_html)
        sections_js.append(section_js)

    html = """<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>Aligned patterns - all components</title>
<style>
  body { font-family: sans-serif; margin: 0; padding: 10px; }
  .section { margin-bottom: 30px; border-bottom: 1px solid #ddd; padding-bottom: 20px; }
  .section h2 { margin-bottom: 4px; }
  .stats { color: #555; font-size: 14px; margin-bottom: 8px; }
  .plot { width: 100%; height: 55vh; }
</style>
</head>
<body>
<h1>Aligned cycle patterns - X, Y, Z</h1>
""" + "\n".join(sections_html) + """
<script>
""" + plotly_lib + """
</script>
<script>
""" + "\n".join(sections_js) + """
</script>
</body>
</html>
"""
    with open(out_path, "w") as f:
        f.write(html)


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    df = load_data(DATA_URL)
    df_norm = normalize_df(df)

    plot_raw_data(df, os.path.join(OUTPUT_DIR, "raw_data.png"))

    plotly_lib_path = os.path.join(
        os.path.dirname(__file__), "node_modules", "plotly.js-dist-min", "plotly.min.js"
    )
    with open(plotly_lib_path) as f:
        plotly_lib = f.read()

    build_interactive_raw_plot(df_norm, plotly_lib, os.path.join(OUTPUT_DIR, "raw_data_interactive.html"))

    summary = {}
    tables = {}
    aligned_dict = {}

    for col in COMPONENTS:
        mask = compute_activity_mask(df_norm, col=col)
        period = estimate_period_sec(df_norm, col, mask)
        table = extract_cycle_patterns(df_norm, mask, col=col, min_period_sec=period)
        table.to_csv(os.path.join(OUTPUT_DIR, f"pattern_table_{col}.csv"), index=False)
        tables[col] = table

        if len(table) >= 2:
            aligned = align_patterns(df_norm, table, col=col, target_len=TARGET_LEN)
            np.save(os.path.join(OUTPUT_DIR, f"aligned_patterns_{col}.npy"), aligned)
            plot_aligned_patterns(aligned, col, os.path.join(OUTPUT_DIR, f"aligned_patterns_{col}.png"))
            aligned_dict[col] = aligned
        else:
            aligned_dict[col] = None

        summary[col] = {"n_patterns": len(table), "estimated_period_s": period}

    build_combined_interactive_plot(
        df_norm, tables, plotly_lib, os.path.join(OUTPUT_DIR, "patterns_interactive_combined.html")
    )
    build_combined_aligned_plot(
        aligned_dict, tables, plotly_lib, os.path.join(OUTPUT_DIR, "aligned_patterns_combined.html")
    )

    with open(os.path.join(OUTPUT_DIR, "summary.json"), "w") as f:
        json.dump(summary, f, indent=2)

    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
