import os
import math

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
