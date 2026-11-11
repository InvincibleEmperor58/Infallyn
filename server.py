"""Static server for the Infallyn app — local dev: python3 server.py → http://localhost:8000"""
import http.server, socketserver, functools, os

PORT = 8000
APP = "index.html"

class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path in ("/", "/index.html", "/infallyn", "/app"):
            self.path = "/" + APP
        return super().do_GET()
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

with socketserver.TCPServer(("0.0.0.0", PORT), functools.partial(Handler, directory=os.path.dirname(os.path.abspath(__file__)))) as httpd:
    print(f"Infallyn serving on http://localhost:{PORT}")
    httpd.serve_forever()
