import os
import json
import math
import numpy as np
from scipy.signal import find_peaks
import scipy.integrate as integrate

from data_loader import SESSIONS, BASE, _cache, read_acc, read_hr
from wallballs_analysis import HeartRateSegmenter

# ── Cleaning methods ──────────────────────────────────────────────────────────

def apply_iqr_clip(acc, n=3.0):
    """Clip spike samples where magnitude exceeds Q3 + n*IQR.
    X/Y/Z are scaled proportionally so magnitude stays consistent."""
    mag = acc["mag"]
    s   = sorted(mag)
    q1  = s[max(0, int(len(s) * 0.25))]
    q3  = s[min(len(s) - 1, int(len(s) * 0.75))]
    fence = q3 + n * (q3 - q1)

    cx, cy, cz, cm = [], [], [], []
    for xi, yi, zi, m in zip(acc["x"], acc["y"], acc["z"], mag):
        if m > fence and m > 0:
            scale = fence / m
            cx.append(xi * scale)
            cy.append(yi * scale)
            cz.append(zi * scale)
            cm.append(fence)
        else:
            cx.append(xi)
            cy.append(yi)
            cz.append(zi)
            cm.append(m)

    return {"t": acc["t"], "x": cx, "y": cy, "z": cz, "mag": cm}


def apply_unit_norm(acc):
    mag = acc["mag"]
    cx, cy, cz, cm = [], [], [], []
    for xi, yi, zi, m in zip(acc["x"], acc["y"], acc["z"], mag):
        if m > 1e-6:
            cx.append(xi / m)
            cy.append(yi / m)
            cz.append(zi / m)
            cm.append(1.0)
        else:
            cx.append(0.0)
            cy.append(0.0)
            cz.append(0.0)
            cm.append(0.0)
    return {"t": acc["t"], "x": cx, "y": cy, "z": cz, "mag": cm}


CLEANERS = {
    "raw": lambda acc: acc,
    "iqr": apply_iqr_clip,
    "norm": apply_unit_norm,
}

# ── HR / Stats ────────────────────────────────────────────────────────────────

def compute_stats(acc, hr):
    n   = len(acc["t"])
    mag = acc["mag"]
    bpm = hr["bpm"]

    acc_rms = math.sqrt(sum(v*v for v in mag) / len(mag)) if mag else 0

    sr = 0
    if n > 1:
        dt = acc["t"][1] - acc["t"][0]
        sr = round(1.0 / dt) if dt > 0 else 0

    return {
        "duration_s":  round(acc["t"][-1], 2) if n > 0 else 0,
        "acc_samples": n,
        "acc_rms":     round(acc_rms, 4),
        "sample_rate": sr,
        "hr_avg":      round(sum(bpm) / len(bpm), 1) if bpm else 0,
        "hr_max":      int(max(bpm)) if bpm else 0,
        "hr_min":      int(min(bpm)) if bpm else 0,
    }


# ── Cache + load ──────────────────────────────────────────────────────────────

def load_session(name, clean="raw", seg_method="none", seg_mode="prominence", hr_freq=None, sig_name="x", math_op="curve", low_cut=0.0, high_cut=2.0, acc_seg="none"):
    sess      = SESSIONS[name]
    acc_path  = os.path.join(BASE, sess["acc"])
    hr_path   = os.path.join(BASE, sess["hr"])

    acc_mt    = os.path.getmtime(acc_path)
    hr_mt     = os.path.getmtime(hr_path)
    cache_key = f"{name}_{clean}_{seg_method}_{seg_mode}_{hr_freq}_{sig_name}_{math_op}_{low_cut}_{high_cut}_{acc_seg}"
    etag      = f'"{hash((acc_mt, hr_mt, clean, seg_method, seg_mode, hr_freq, sig_name, math_op, low_cut, high_cut, acc_seg))}"'

    cached = _cache.get(cache_key)
    if cached and cached["etag"] == etag:
        return cached["payload"], etag

    acc_raw = read_acc(acc_path)
    acc     = CLEANERS.get(clean, CLEANERS["raw"])(acc_raw)
    hr      = read_hr(hr_path)

    if sig_name in acc and len(acc["t"]) > 1:
        t_arr = np.array(acc["t"])
        sig_arr = np.array(acc[sig_name])
        if math_op == "derivative":
            acc[sig_name] = np.gradient(sig_arr, t_arr).tolist()
        elif math_op == "integral":
            acc[sig_name] = integrate.cumulative_trapezoid(sig_arr, t_arr, initial=0).tolist()

    hr_peaks = []
    hr_segments = []
    hr_dom_freq = 0.0
    if seg_method == "peaks" and len(hr["bpm"]) > 2:
        segmenter = HeartRateSegmenter(hr["t"], hr["bpm"])
        t_start = acc["t"][0] if len(acc["t"]) > 0 else 0.0
        t_end = acc["t"][-1] if len(acc["t"]) > 0 else 0.0
        hr_peaks, hr_segments, hr_dom_freq = segmenter.get_segments(seg_mode, t_start, t_end, hr_freq)

    acc_peaks = []
    acc_segments = []
    if acc_seg in ("mins", "maxs", "zeros", "critical", "inflection") and len(acc["t"]) > 2:
        sig_data = acc.get(sig_name, acc["x"])
        dt = acc["t"][1] - acc["t"][0]
        fs = 1.0 / dt if dt > 0 else 50.0

        N_orig = len(sig_data)
        N = 1
        while N < N_orig:
            N <<= 1

        mean_val = float(np.mean(sig_data))
        zero_mean = np.array(sig_data) - mean_val
        yf = np.fft.fft(zero_mean, n=N)
        for k in range(N):
            f = (k * fs / N) if k <= N // 2 else ((k - N) * fs / N)
            if abs(f) < low_cut or abs(f) > high_cut:
                yf[k] = 0.0
        filtered = np.fft.ifft(yf)[:N_orig].real + mean_val

        prom = float(np.std(filtered) * 0.5)
        if prom <= 0:
            prom = 0.1

        peaks_idx = []
        if acc_seg == "maxs":
            peaks_idx, _ = find_peaks(filtered, prominence=prom, distance=15)
        elif acc_seg == "mins":
            peaks_idx, _ = find_peaks(-filtered, prominence=prom, distance=15)
        elif acc_seg == "critical":
            maxs_idx, _ = find_peaks(filtered, prominence=prom, distance=15)
            mins_idx, _ = find_peaks(-filtered, prominence=prom, distance=15)
            peaks_idx = np.sort(np.concatenate((maxs_idx, mins_idx)))
        elif acc_seg == "zeros":
            peaks_idx = np.where(np.diff(np.sign(filtered)))[0]
        elif acc_seg == "inflection":
            grad1 = np.gradient(filtered)
            grad2 = np.gradient(grad1)
            peaks_idx = np.where(np.diff(np.sign(grad2)))[0]

        acc_peaks = [float(acc["t"][idx]) for idx in peaks_idx]
        all_points = [float(acc["t"][0])] + acc_peaks + [float(acc["t"][-1])]
        all_points = sorted(list(set(all_points)))
        for i in range(len(all_points) - 1):
            acc_segments.append({"x0": all_points[i], "x1": all_points[i+1]})

    payload = json.dumps({
        "acc": acc,
        "hr": hr,
        "stats": compute_stats(acc, hr),
        "hr_peaks": hr_peaks,
        "hr_segments": hr_segments,
        "hr_dom_freq": hr_dom_freq,
        "acc_peaks": acc_peaks,
        "acc_segments": acc_segments
    }).encode()
    _cache[cache_key] = {"etag": etag, "payload": payload}
    print(f"[cache] {cache_key} reloaded ({len(payload) // 1024} KB)")
    return payload, etag
