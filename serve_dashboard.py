from __future__ import annotations

import http.server
import socketserver
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PORT = 4173


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)


with socketserver.TCPServer(("", PORT), Handler) as httpd:
    print(f"Phantom Flow dashboard: http://localhost:{PORT}/web/")
    httpd.serve_forever()
