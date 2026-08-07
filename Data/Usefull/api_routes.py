import os
import json
import numpy as np

from data_loader import BASE, SESSIONS, read_acc
import data_loader
from signal_processing import CLEANERS, load_session


def handle_get_sessions(handler, params):
    sport_filter = params.get("sport", [None])[0]
    sessions_list = []
    
    for key, data in SESSIONS.items():
        if sport_filter:
            acc_path = data.get("acc", "").lower()
            if sport_filter.lower() in acc_path or sport_filter.lower() == key.lower():
                sessions_list.append(key)
        else:
            sessions_list.append(key)
            
    payload = json.dumps({"sessions": sessions_list}).encode()
    handler.send_response(200)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Content-Length", str(len(payload)))
    handler.end_headers()
    handler.wfile.write(payload)

def handle_load_segments(handler, params):
    session_name = params.get("session", ["wallballs"])[0]
    fpath = os.path.join(data_loader.CURRENT_SCAN_PATH, f"wallballs_segments_{session_name}.json")
    if os.path.exists(fpath):
        with open(fpath, "r") as f:
            content = f.read().encode("utf-8")
        handler.send_response(200)
        handler.send_header("Content-Type", "application/json")
        handler.send_header("Content-Length", str(len(content)))
        handler.end_headers()
        handler.wfile.write(content)
    else:
        handler.send_response(404)
        handler.end_headers()


def handle_save_segments(handler, post_data):
    try:
        data = json.loads(post_data.decode('utf-8'))
        session_name = data.get("session", "wallballs")
        fpath = os.path.join(data_loader.CURRENT_SCAN_PATH, f"wallballs_segments_{session_name}.json")
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
        handler.send_response(200)
        handler.send_header("Content-Type", "application/json")
        handler.end_headers()
        handler.wfile.write(b'{"status": "ok"}')
    except Exception as e:
        handler.send_response(500)
        handler.end_headers()
        print("Error saving segments:", e)

def handle_scan_path(handler, post_data):
    try:
        data = json.loads(post_data.decode('utf-8'))
        raw_path = data.get("path", "")
        new_path = os.path.abspath(os.path.expanduser(raw_path))
        
        if not os.path.exists(new_path) or not os.path.isdir(new_path):
            payload = json.dumps({"error": f"Directory does not exist: {new_path}"}).encode()
            handler.send_response(400)
            handler.send_header("Content-Type", "application/json")
            handler.send_header("Content-Length", str(len(payload)))
            handler.end_headers()
            handler.wfile.write(payload)
            return
            
        data_loader.scan_sessions(new_path)
        
        payload = json.dumps({"status": "ok", "path": new_path}).encode()
        handler.send_response(200)
        handler.send_header("Content-Type", "application/json")
        handler.send_header("Content-Length", str(len(payload)))
        handler.end_headers()
        handler.wfile.write(payload)
    except Exception as e:
        handler.send_response(500)
        handler.end_headers()
        print("Error scanning path:", e)

def handle_get_data(handler, path, params):
    name = path[6:]  # strip "/data/"
    if name.startswith("segment/"):
        session_name = name[8:]
        if session_name not in SESSIONS:
            handler.send_response(404); handler.end_headers(); return
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
            handler.send_response(400)
            handler.send_header("Content-Type", "application/json")
            handler.send_header("Access-Control-Allow-Origin", "*")
            handler.send_header("Content-Length", str(len(payload)))
            handler.end_headers()
            handler.wfile.write(payload)
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
        handler.send_response(200)
        handler.send_header("Content-Type", "application/json")
        handler.send_header("Access-Control-Allow-Origin", "*")
        handler.send_header("Content-Length", str(len(payload)))
        handler.end_headers()
        handler.wfile.write(payload)
        return

    if name not in SESSIONS:
        handler.send_response(404); handler.end_headers(); return

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
    math_op = params.get("math_op", ["curve"])[0]
    try:
        low_cut = float(params.get("low_cut", [0.0])[0])
    except ValueError:
        low_cut = 0.0
    try:
        high_cut = float(params.get("high_cut", [2.0])[0])
    except ValueError:
        high_cut = 2.0
    acc_seg = params.get("acc_seg", ["none"])[0]

    try:
        payload, etag = load_session(name, clean, seg_method, seg_mode, hr_freq, sig_name, math_op, low_cut, high_cut, acc_seg)
    except FileNotFoundError:
        payload = json.dumps({"error": f"Session files for '{name}' not found on disk."}).encode()
        handler.send_response(404)
        handler.send_header("Content-Type", "application/json")
        handler.send_header("Access-Control-Allow-Origin", "*")
        handler.send_header("Content-Length", str(len(payload)))
        handler.end_headers()
        handler.wfile.write(payload)
        return

    if handler.headers.get("If-None-Match") == etag:
        handler.send_response(304); handler.end_headers(); return

    handler.send_response(200)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("ETag", etag)
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Content-Length", str(len(payload)))
    handler.end_headers()
    handler.wfile.write(payload)
