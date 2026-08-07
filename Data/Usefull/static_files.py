import os

STATIC_MIME = {
    ".html": "text/html; charset=utf-8",
    ".css":  "text/css",
    ".js":   "application/javascript",
}

def serve_static_file(handler, path, base_dir):
    fname = "index.html" if path in ("/", "/index.html") else path.lstrip("/")
    if fname == "wallballs":
        fname = "wallballs/wallballs.html"
    fpath = os.path.join(base_dir, fname)
    ext   = os.path.splitext(fname)[1].lower()

    if os.path.isfile(fpath) and ext in STATIC_MIME:
        with open(fpath, "rb") as f:
            content = f.read()
        handler.send_response(200)
        handler.send_header("Content-Type", STATIC_MIME[ext])
        handler.send_header("Content-Length", str(len(content)))
        handler.end_headers()
        handler.wfile.write(content)
    else:
        handler.send_response(404)
        handler.end_headers()
