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
from urllib.parse import urlparse, parse_qs
from http.server import BaseHTTPRequestHandler, HTTPServer

from data_loader import BASE, SESSIONS
from signal_processing import CLEANERS
from static_files import serve_static_file
from api_routes import handle_load_segments, handle_save_segments, handle_get_data, handle_get_sessions, handle_scan_path

# ── HTTP handler ──────────────────────────────────────────────────────────────

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        path   = parsed.path
        params = parse_qs(parsed.query)

        if path == "/sessions":
            handle_get_sessions(self, params)
        elif path.startswith("/load_segments"):
            handle_load_segments(self, params)
        elif path.startswith("/data/"):
            handle_get_data(self, path, params)
        else:
            serve_static_file(self, path, BASE)

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/save_segments":
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            handle_save_segments(self, post_data)
        elif parsed.path == "/scan_path":
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            handle_scan_path(self, post_data)
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
    print(f"\n  Cleaning methods: {list(CLEANERS.keys())}\n")
    HTTPServer(("", port), Handler).serve_forever()
