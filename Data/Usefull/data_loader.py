import os
import math
import re

BASE = os.path.dirname(os.path.abspath(__file__))
CURRENT_SCAN_PATH = os.path.abspath(os.path.join(BASE, "..", "WallBalls"))

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

def scan_sessions(root_dir):
    global CURRENT_SCAN_PATH
    CURRENT_SCAN_PATH = root_dir
    
    # Clear previously scanned dynamic sessions (13-digit numeric keys)
    keys_to_remove = [k for k in SESSIONS if k.isdigit() and len(k) == 13]
    for k in keys_to_remove:
        del SESSIONS[k]
        
    temp_groups = {}
    
    # Recursively find all files
    for dirpath, _, filenames in os.walk(root_dir):
        for fname in filenames:
            if not fname.lower().endswith(".txt"):
                continue
            
            # Extract timestamp and suffix (ACC or HR)
            # Regex expects an optional underscore, exactly 13 digits, optional underscore, and a word before .txt
            match = re.search(r"_?(\d{13})(?:_([a-zA-Z0-9]+))?\.txt$", fname, re.IGNORECASE)
            if not match:
                continue
            
            timestamp = match.group(1)
            suffix = match.group(2)
            
            if not suffix:
                continue
                
            suffix = suffix.lower()
            if suffix not in ["acc", "hr"]:
                continue
                
            if timestamp not in temp_groups:
                temp_groups[timestamp] = {}
                
            temp_groups[timestamp][suffix] = os.path.join(dirpath, fname)
            
    # Validate and add to SESSIONS
    for ts, files in temp_groups.items():
        if "acc" in files and "hr" in files:
            acc_path = files["acc"]
            hr_path = files["hr"]
            
            try:
                # Validate ACC (expecting 4 columns on first line)
                with open(acc_path, "r") as f:
                    first_line = f.readline().strip()
                    if len(first_line.split(",")) != 4:
                        print(f"Error: {acc_path} has invalid format (not 4 columns).")
                        continue
                        
                # Validate HR (expecting 2 columns on first line)
                with open(hr_path, "r") as f:
                    first_line = f.readline().strip()
                    if len(first_line.split(",")) != 2:
                        print(f"Error: {hr_path} has invalid format (not 2 columns).")
                        continue
                        
                SESSIONS[ts] = {
                    "acc": acc_path,
                    "hr": hr_path
                }
            except Exception as e:
                print(f"Error reading files for session {ts}: {e}")

# Call the scanner immediately to populate SESSIONS
scan_sessions(CURRENT_SCAN_PATH)

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
