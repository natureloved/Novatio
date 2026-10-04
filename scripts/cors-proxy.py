#!/usr/bin/env python3
"""CORS shim in front of the Canton JSON Ledger API.

Why this exists: the JSON API answers OPTIONS preflight with 404 and sets no
Access-Control-* headers, so a browser refuses to read it even though curl
succeeds. The API has no flag for this (checked the full --help), so a browser
can only ever reach it through something that adds the headers.

binds 127.0.0.1 only, forwards to the JSON API on localhost, and answers
preflight itself instead of passing it through.

    scripts/cors-proxy.py <listen_port> <upstream_port>

Dev-local only. It adds `Access-Control-Allow-Origin: *`, which is fine for a
loopback denial: no cookies are sent, so there is no credentialed request to
steal, and the bearer token lives in the browser's origin anyway. Do not put
this in front of a ledger reachable off this host - point the reverse proxy at
a real origin allowlist instead.

stdlib only, so a judge running this project needs nothing but Python.
"""

import json
import sys
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LISTEN_PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 7578
UPSTREAM = "http://127.0.0.1:" + (sys.argv[2] if len(sys.argv) > 2 else "7575")

ALLOW_ORIGIN = "*"
ALLOW_HEADERS = "Authorization, Content-Type"
ALLOW_METHODS = "GET, POST, OPTIONS"


class Handler(BaseHTTPRequestHandler):
    # HTTP/1.1 + an explicit Content-Length on every response, so the
    # connection can be reused without the browser guessing body length.
    protocol_version = "HTTP/1.1"
    server_version = "novatio-cors-proxy"

    def _cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", ALLOW_ORIGIN)
        self.send_header("Access-Control-Allow-Methods", ALLOW_METHODS)
        self.send_header("Access-Control-Allow-Headers", ALLOW_HEADERS)
        self.send_header("Access-Control-Max-Age", "600")
        self.send_header("Vary", "Origin")

    def _reply(self, code, body=b"", content_type="application/json"):
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self._cors_headers()
        self.end_headers()
        if body:
            self.wfile.write(body)

    def do_OPTIONS(self):
        # Upstream 404s this, which is the entire bug. Answer it here.
        self._reply(204)

    def do_GET(self):
        self._forward("GET")

    def do_POST(self):
        self._forward("POST")

    def _forward(self, method):
        length = int(self.headers.get("Content-Length") or 0)
        payload = self.rfile.read(length) if length else None

        req = urllib.request.Request(
            UPSTREAM + self.path, data=payload, method=method)
        # Only forward what the JSON API accepts; Host, Accept-Encoding and
        # friends from the browser would confuse it.
        for header in ("Authorization", "Content-Type"):
            value = self.headers.get(header)
            if value:
                req.add_header(header, value)

        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                self._reply(resp.status, resp.read())
        except urllib.error.HTTPError as exc:
            # The JSON API hides failures inside a 200, so a real HTTP error
            # here is exceptional - pass it through with its own body.
            try:
                body = exc.read()
            except Exception:
                body = b""
            self._reply(exc.code, body)
        except Exception as exc:
            self._reply(
                502,
                json.dumps({"errors": ["cors proxy: " + str(exc)]}).encode())

    def log_message(self, *args):
        pass  # keep the console quiet; requests are visible in devtools


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", LISTEN_PORT), Handler).serve_forever()
