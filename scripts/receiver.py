#!/usr/bin/env python3
"""Controllable HTTP receiver for failure injection testing (SC-03/SC-04).

Control endpoints:
  GET /control?status=500   -> set mode to return HTTP 500 on /event
  GET /control?status=200   -> set mode to return HTTP 200 on /event
  GET /control?timeout=5    -> set mode to sleep 5s then 200 on /event
  GET /control?poison=1     -> set mode to return invalid JSON with 200

Delivery endpoint:
  GET /event                -> returns current mode response (default 200)

Default mode: status=200 with JSON body.
"""
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs
import time
import json
import sys

RECEIVER_PORT = 9099
RECEIVER_MODE = {"status": 200, "poison": False, "timeout": 0}

class ReceiverHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)

        if parsed.path == "/control":
            if "status" in params:
                RECEIVER_MODE["status"] = int(params["status"][0])
                RECEIVER_MODE["poison"] = False
                RECEIVER_MODE["timeout"] = 0
            if "timeout" in params:
                RECEIVER_MODE["timeout"] = int(params["timeout"][0])
                RECEIVER_MODE["status"] = 200
                RECEIVER_MODE["poison"] = False
            if "poison" in params:
                RECEIVER_MODE["poison"] = True
                RECEIVER_MODE["status"] = 200
                RECEIVER_MODE["timeout"] = 0
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"mode": RECEIVER_MODE}).encode())
            return

        if parsed.path == "/event":
            if RECEIVER_MODE["timeout"] > 0:
                time.sleep(RECEIVER_MODE["timeout"])

            status = RECEIVER_MODE["status"]
            if RECEIVER_MODE["poison"]:
                body = "NOT-VALID-JSON{{{"
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(body.encode())
                return

            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"received": True, "status": status}).encode())
            return

        self.send_response(404)
        self.end_headers()

    def do_POST(self):
        # Read body (may be empty)
        content_length = int(self.headers.get('Content-Length', 0))
        self.rfile.read(content_length)
        # Treat POST same as GET for the target path
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)

        if parsed.path == "/event":
            if RECEIVER_MODE["timeout"] > 0:
                time.sleep(RECEIVER_MODE["timeout"])

            status = RECEIVER_MODE["status"]
            if RECEIVER_MODE["poison"]:
                body = "NOT-VALID-JSON{{{"
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(body.encode())
                return

            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"received": True, "status": status}).encode())
            return

        self.send_response(404)
        self.end_headers()

    def log_message(self, format, *args):
        sys.stdout.write(f"[receiver] {format % args}\n")
        sys.stdout.flush()


if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", RECEIVER_PORT), ReceiverHandler)
    print(f"[receiver] Listening on port {RECEIVER_PORT}", flush=True)
    server.serve_forever()
