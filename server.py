"""Static server for the Infallyn app.

Local dev:  python3 server.py   ->  http://localhost:8000
Override port with:  PORT=8080 python3 server.py

Serves the generated single-file app (index.html) plus the PWA manifest,
icons and the src/ modules. Threaded + HTTP/1.1 so a browser can fetch many
assets concurrently without stalling, and reusable-address so a restart never
fails on a lingering socket.
"""
import functools
import http.server
import os
import socketserver
import sys
import time

PORT = int(os.environ.get("PORT", "8000"))
APP = "index.html"
ROOT = os.path.dirname(os.path.abspath(__file__))

# Make sure the manifest and module files are served with sane types.
http.server.SimpleHTTPRequestHandler.extensions_map.update(
    {
        ".webmanifest": "application/manifest+json",
        ".mjs": "text/javascript",
        ".js": "text/javascript",
        ".json": "application/json",
        ".wasm": "application/wasm",
    }
)


class Handler(http.server.SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_GET(self):
        # Friendly aliases -> the single-file app.
        if self.path in ("/", "/index.html", "/infallyn", "/app"):
            self.path = "/" + APP
        return super().do_GET()

    def do_HEAD(self):
        if self.path in ("/", "/index.html", "/infallyn", "/app"):
            self.path = "/" + APP
        return super().do_HEAD()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True
    # Don't die on a client that disconnects mid-transfer.
    request_queue_size = 64


def bind(retries=30, delay=2.0):
    """Bind PORT, waiting out TIME_WAIT sockets left by a previous run.

    A killed server can leave server-side TIME_WAIT entries on the same port
    for ~60s; these make bind() fail with EADDRINUSE even with SO_REUSEADDR.
    """
    handler = functools.partial(Handler, directory=ROOT)
    for attempt in range(1, retries + 1):
        try:
            return Server(("0.0.0.0", PORT), handler)
        except OSError as exc:
            if attempt == retries:
                sys.exit(
                    f"Infallyn: cannot bind port {PORT} ({exc}). Set PORT=<n> to change."
                )
            print(
                f"Infallyn: port {PORT} busy ({exc}); retry {attempt}/{retries} "
                f"in {delay:.0f}s",
                flush=True,
            )
            time.sleep(delay)


def main():
    httpd = bind()
    print(f"Infallyn serving {ROOT} on http://0.0.0.0:{PORT}", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
