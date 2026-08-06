import sys
import subprocess
import importlib.util

def ensure_package(import_name, pip_name=None):
    if importlib.util.find_spec(import_name) is None:
        subprocess.check_call([
            sys.executable, "-m", "pip", "install", pip_name or import_name
        ])

ensure_package("numpy") 
ensure_package("pandas") 
ensure_package("sklearn", "scikit-learn") 
ensure_package("ruptures") 
ensure_package("scipy")

import os
import json
import math
from urllib.parse import urlparse, parse_qs
from http.server import BaseHTTPRequestHandler, HTTPServer
from wallballs_analysis import HeartRateSegmenter

BASE = os.path.dirname(os.path.abspath(__file__))

SESSIONS = {
    "rowing": {
        "acc": "Polar_H10_1D61CD3D_1784733608827_ACC.txt",
        "hr":  "Polar_H10_1D61CD3D_1784733608827_HR.txt",
    },
    "running": {
        "acc": "polar_sense_065afd32_1785223632096_acc.txt",
        "hr":  "polar_sense_065afd32_1785223632096_hr.txt",
    },
    "wallballs": {
        "acc": "polar_h10_1d61cd3d_1785393791901_acc.txt",
        "hr":  "polar_h10_1d61cd3d_1785393791901_hr.txt",
    }
}

STATIC_MIME = {
    ".html": "text/html; charset=utf-8",
    ".css":  "text/css",
    ".js":   "application/javascript",
}

_cache = {}


def read_acc(path):
    t, x, y, z = [], [], [], []
    with open(path, "r") as f:
        for line in f:
            parts = line.strip().split(",")
            if len(parts) != 4:
                continue
            try:
                t.append(float(parts[0]))
                x.append(float(parts[1]))
                y.append(float(parts[2]))
                z.append(float(parts[3]))
            except ValueError:
                continue

    # Remove gravity: subtract DC offset (mean) from each axis
    n = len(x)
    if n > 0:
        mx = sum(x) / n
        my = sum(y) / n
        mz = sum(z) / n
        x = [v - mx for v in x]
        y = [v - my for v in y]
        z = [v - mz for v in z]

    # Normalize to g (Polar raw unit = mg)
    x   = [v / 1000.0 for v in x]
    y   = [v / 1000.0 for v in y]
    z   = [v / 1000.0 for v in z]

    # Recompute magnitude from gravity-free, normalized axes
    mag = [math.sqrt(xi*xi + yi*yi + zi*zi) for xi, yi, zi in zip(x, y, z)]

    return {"t": t, "x": x, "y": y, "z": z, "mag": mag}


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
    # future entries: "median": apply_median_filter, "savgol": apply_savgol, ...
}


# ── HR / Stats ────────────────────────────────────────────────────────────────

def read_hr(path):
    t, bpm = [], []
    with open(path, "r") as f:
        for line in f:
            parts = line.strip().split(",")
            if len(parts) != 2:
                continue
            try:
                t.append(float(parts[0]))
                bpm.append(float(parts[1]))
            except ValueError:
                continue
    return {"t": t, "bpm": bpm}


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

def load_session(name, clean="raw", seg_method="none", seg_mode="prominence", hr_freq=None, sig_name="x", low_cut=0.0, high_cut=2.0, acc_seg="none"):
    sess      = SESSIONS[name]
    acc_path  = os.path.join(BASE, sess["acc"])
    hr_path   = os.path.join(BASE, sess["hr"])

    acc_mt    = os.path.getmtime(acc_path)
    hr_mt     = os.path.getmtime(hr_path)
    cache_key = f"{name}_{clean}_{seg_method}_{seg_mode}_{hr_freq}_{sig_name}_{low_cut}_{high_cut}_{acc_seg}"
    etag      = f'"{hash((acc_mt, hr_mt, clean, seg_method, seg_mode, hr_freq, sig_name, low_cut, high_cut, acc_seg))}"'

    cached = _cache.get(cache_key)
    if cached and cached["etag"] == etag:
        return cached["payload"], etag

    acc_raw = read_acc(acc_path)
    acc     = CLEANERS.get(clean, CLEANERS["raw"])(acc_raw)
    hr      = read_hr(hr_path)

    hr_peaks = []
    hr_segments = []
    hr_dom_freq = 0.0
    if name == "wallballs" and seg_method == "peaks" and len(hr["bpm"]) > 2:
        segmenter = HeartRateSegmenter(hr["t"], hr["bpm"])
        t_start = acc["t"][0] if len(acc["t"]) > 0 else 0.0
        t_end = acc["t"][-1] if len(acc["t"]) > 0 else 0.0
        hr_peaks, hr_segments, hr_dom_freq = segmenter.get_segments(seg_mode, t_start, t_end, hr_freq)

    acc_peaks = []
    acc_segments = []
    if name == "wallballs" and acc_seg in ("mins", "maxs") and len(acc["t"]) > 2:
        from scipy.signal import find_peaks
        import numpy as np
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

        if acc_seg == "maxs":
            peaks_idx, _ = find_peaks(filtered, prominence=prom, distance=15)
        else:
            peaks_idx, _ = find_peaks(-filtered, prominence=prom, distance=15)

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


# ── HTTP handler ──────────────────────────────────────────────────────────────

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        path   = parsed.path
        params = parse_qs(parsed.query)

        if path.startswith("/load_segments"):
            session_name = params.get("session", ["wallballs"])[0]
            fpath = os.path.join(BASE, f"custom_segments_{session_name}.json")
            if os.path.exists(fpath):
                with open(fpath, "r") as f:
                    content = f.read().encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(content)))
                self.end_headers()
                self.wfile.write(content)
            else:
                self.send_response(404); self.end_headers()
            return

        if path.startswith("/data/"):
            name = path[6:]
            if name.startswith("segment/"):
                session_name = name[8:]
                if session_name not in SESSIONS:
                    self.send_response(404); self.end_headers(); return
                clean = params.get("clean", ["raw"])[0]
                if clean not in CLEANERS:
                    clean = "raw"
                sig_name = params.get("signal", ["mag"])[0]
                sess = SESSIONS[session_name]
                acc_path = os.path.join(BASE, sess["acc"])
                acc_raw = read_acc(acc_path)
                acc = CLEANERS.get(clean, CLEANERS["raw"])(acc_raw)
                if sig_name not in acc:
                    sig_name = "mag"
                signal = acc[sig_name]
                t_arr = acc["t"]
                
                # Slicing based on zoom range
                t_start_val = params.get("t_start", [None])[0]
                t_end_val = params.get("t_end", [None])[0]
                idx_start = 0
                idx_end = len(t_arr) - 1
                
                if t_start_val is not None and t_start_val != "null" and t_start_val != "":
                    try:
                        t_s = float(t_start_val)
                        idx_start = next((i for i, val in enumerate(t_arr) if val >= t_s), 0)
                    except ValueError:
                        pass
                
                if t_end_val is not None and t_end_val != "null" and t_end_val != "":
                    try:
                        t_e = float(t_end_val)
                        idx_end = next((i for i in range(len(t_arr)-1, -1, -1) if t_arr[i] <= t_e), len(t_arr) - 1)
                    except ValueError:
                        pass
                
                if idx_end < idx_start:
                    idx_end = idx_start
                
                sliced_signal = signal[idx_start : idx_end + 1]
                sliced_t = t_arr[idx_start : idx_end + 1]
                
                try:
                    pen_val = float(params.get("pen", [10.0])[0])
                except ValueError:
                    pen_val = 10.0
                
                import ruptures as rpt
                import numpy as np
                points = np.array(sliced_signal)
                
                try:
                    if len(points) > 10:
                        algo = rpt.Pelt(model="rbf").fit(points)
                        bkps = algo.predict(pen=pen_val)
                    else:
                        bkps = [len(points)]
                except MemoryError:
                    payload = json.dumps({
                        "error": "MemoryError",
                        "message": "Signal range is too long for Ruptures RBF. Please zoom in to a shorter range first."
                    }).encode()
                    self.send_response(400)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Access-Control-Allow-Origin", "*")
                    self.send_header("Content-Length", str(len(payload)))
                    self.end_headers()
                    self.wfile.write(payload)
                    return
                
                segments = []
                prev_idx = 0
                for bk in bkps:
                    idx0 = prev_idx
                    idx1 = min(bk, len(points) - 1)
                    if idx1 > idx0:
                        segments.append({
                            "idx0": int(idx0 + idx_start),
                            "idx1": int(idx1 + idx_start),
                            "x0": float(sliced_t[idx0]),
                            "x1": float(sliced_t[idx1])
                        })
                    prev_idx = idx1
                payload = json.dumps({"boundaries": segments}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
                return

            if name not in SESSIONS:
                self.send_response(404); self.end_headers(); return

            clean = params.get("clean", ["raw"])[0]
            if clean not in CLEANERS:
                clean = "raw"
            seg_method = params.get("seg_method", ["none"])[0]
            seg_mode = params.get("seg_mode", ["prominence"])[0]
            
            hr_freq_val = params.get("hr_freq", [None])[0]
            hr_freq = None
            if hr_freq_val and hr_freq_val != "null" and hr_freq_val != "":
                try:
                    hr_freq = float(hr_freq_val)
                except ValueError:
                    pass

            sig_name = params.get("signal", ["x"])[0]
            try:
                low_cut = float(params.get("low_cut", [0.0])[0])
            except ValueError:
                low_cut = 0.0
            try:
                high_cut = float(params.get("high_cut", [2.0])[0])
            except ValueError:
                high_cut = 2.0
            acc_seg = params.get("acc_seg", ["none"])[0]

            payload, etag = load_session(name, clean, seg_method, seg_mode, hr_freq, sig_name, low_cut, high_cut, acc_seg)

            if self.headers.get("If-None-Match") == etag:
                self.send_response(304); self.end_headers(); return

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("ETag", etag)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        else:
            # Static file serving (index.html, style.css, app.js, ...)
            fname = "index.html" if path in ("/", "/index.html") else path.lstrip("/")
            if fname == "wallballs":
                fname = "wallballs/wallballs.html"
            fpath = os.path.join(BASE, fname)
            ext   = os.path.splitext(fname)[1].lower()

            if os.path.isfile(fpath) and ext in STATIC_MIME:
                with open(fpath, "rb") as f:
                    content = f.read()
                self.send_response(200)
                self.send_header("Content-Type", STATIC_MIME[ext])
                self.send_header("Content-Length", str(len(content)))
                self.end_headers()
                self.wfile.write(content)
            else:
                self.send_response(404); self.end_headers()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/save_segments":
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            try:
                data = json.loads(post_data.decode('utf-8'))
                session_name = data.get("session", "wallballs")
                fpath = os.path.join(BASE, f"custom_segments_{session_name}.json")
                existing_data = []
                if os.path.exists(fpath):
                    with open(fpath, "r") as f:
                        try:
                            existing_data = json.load(f)
                            if not isinstance(existing_data, list):
                                existing_data = []
                        except json.JSONDecodeError:
                            existing_data = []
                
                # Check if this signal+method already exists and replace it
                found = False
                for i, entry in enumerate(existing_data):
                    if entry.get("signal") == data.get("signal") and entry.get("method") == data.get("method"):
                        existing_data[i] = data
                        found = True
                        break
                
                if not found:
                    existing_data.append(data)
                with open(fpath, "w") as f:
                    json.dump(existing_data, f, indent=2)
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"status": "ok"}')
            except Exception as e:
                self.send_response(500)
                self.end_headers()
                print("Error saving segments:", e)
            return
        self.send_response(404); self.end_headers()

    def log_message(self, fmt, *args):
        print(f"[{self.address_string()}] {fmt % args}")


if __name__ == "__main__":
    port = 8080
    print(f"\n  Serving → http://localhost:{port}\n")
    for name, sess in SESSIONS.items():
        for k, fname in sess.items():
            p = os.path.join(BASE, fname)
            marker = "✓" if os.path.exists(p) else "✗ MISSING"
            print(f"  [{name}][{k}] {fname}  {marker}")
    print(f"\n  Cleaning methods: {list(CLEANERS.keys())}\n")
    HTTPServer(("", port), Handler).serve_forever()
