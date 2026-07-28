import os
import json
import math
from http.server import BaseHTTPRequestHandler, HTTPServer

BASE = os.path.dirname(os.path.abspath(__file__))

SESSIONS = {
    "rowing": {
        "acc": "Polar_H10_1D61CD3D_1784733608827_ACC.txt",
        "hr":  "Polar_H10_1D61CD3D_1784733608827_HR.txt",
    },
    "running": {
        "acc": "polar_sense_065afd32_1785223632096_acc.txt",
        "hr":  "polar_sense_065afd32_1785223632096_hr.txt",
    }
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
        "duration_s":   round(acc["t"][-1], 2) if n > 0 else 0,
        "acc_samples":  n,
        "acc_rms":      round(acc_rms, 2),
        "sample_rate":  sr,
        "hr_avg":       round(sum(bpm) / len(bpm), 1) if bpm else 0,
        "hr_max":       int(max(bpm)) if bpm else 0,
        "hr_min":       int(min(bpm)) if bpm else 0,
    }


def load_session(name):
    sess     = SESSIONS[name]
    acc_path = os.path.join(BASE, sess["acc"])
    hr_path  = os.path.join(BASE, sess["hr"])

    acc_mt = os.path.getmtime(acc_path)
    hr_mt  = os.path.getmtime(hr_path)
    etag   = f'"{hash((acc_mt, hr_mt))}"'

    cached = _cache.get(name)
    if cached and cached["etag"] == etag:
        return cached["payload"], etag

    acc     = read_acc(acc_path)
    hr      = read_hr(hr_path)
    payload = json.dumps({"acc": acc, "hr": hr, "stats": compute_stats(acc, hr)}).encode()
    _cache[name] = {"etag": etag, "payload": payload}
    print(f"[cache] {name} reloaded ({len(payload) // 1024} KB)")
    return payload, etag


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith("/data/"):
            name = self.path[6:]
            if name not in SESSIONS:
                self.send_response(404)
                self.end_headers()
                return

            payload, etag = load_session(name)

            if self.headers.get("If-None-Match") == etag:
                self.send_response(304)
                self.end_headers()
                return

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("ETag", etag)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        elif self.path in ("/", "/index.html"):
            with open(os.path.join(BASE, "index.html"), "rb") as f:
                content = f.read()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)

        else:
            self.send_response(404)
            self.end_headers()

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
    print()
    HTTPServer(("", port), Handler).serve_forever()
