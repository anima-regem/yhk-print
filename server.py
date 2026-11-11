"""Serve the YHK Print web app and optionally relay local jobs over the Mac's Bluetooth."""

import argparse
import base64
import binascii
import json
import secrets
import subprocess
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit


WEB = Path(__file__).resolve().parent / "docs"
MAX_RASTER = 1600 * 48
MAX_BODY = 4 * ((MAX_RASTER + 2) // 3) + 256


class Relay(ThreadingHTTPServer):
    def __init__(self, address, printer, key):
        super().__init__(address, Handler)
        self.host_header = f"{address[0]}:{self.server_port}"
        self.printer = printer
        self.key = key
        self.job = threading.Lock()


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".webmanifest": "application/manifest+json",
        ".woff2": "font/woff2",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB), **kwargs)

    def setup(self):
        super().setup()
        self.connection.settimeout(12)

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        super().end_headers()

    def respond(self, status, data):
        content = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def do_GET(self):
        if urlsplit(self.path).path == "/relay.json":
            self.respond(200, {"requiresKey": bool(self.server.key)})
        else:
            super().do_GET()

    def do_POST(self):
        path = urlsplit(self.path).path
        if path not in {"/api/print", "/api/status"}:
            self.respond(404, {"message": "Unknown printer command."})
            return
        host = self.headers.get("Host", "")
        origin = self.headers.get("Origin")
        if host != self.server.host_header or (origin and origin != f"http://{host}"):
            self.respond(403, {"message": "Open the app from the address shown on your Mac."})
            return
        expected = f"Bearer {self.server.key}" if self.server.key else "Bearer"
        supplied = self.headers.get("Authorization", "").strip()
        if not secrets.compare_digest(supplied.encode(), expected.encode()):
            self.respond(401, {"message": "The pairing key is missing or incorrect. Reopen the link on your Mac terminal."})
            return
        if self.headers.get_content_type() != "application/json":
            self.respond(415, {"message": "Use the YHK Print page to send jobs."})
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= MAX_BODY:
                raise ValueError("Invalid request size.")
            payload = json.loads(self.rfile.read(size))
            if not isinstance(payload, dict):
                raise ValueError("Invalid request.")
            raster = None
            if path == "/api/print":
                raster = base64.b64decode(payload.get("raster", ""), validate=True)
                if not raster or len(raster) > MAX_RASTER or len(raster) % 48:
                    raise ValueError("Invalid raster size.")
        except (ValueError, TypeError, binascii.Error):
            self.respond(400, {"message": "The slip is invalid or too long."})
            return

        if not self.server.job.acquire(blocking=False):
            self.respond(409, {"message": "The Mac is already talking to the printer. Try again when it finishes."})
            return
        try:
            command = "print-raster" if raster is not None else "status"
            result = subprocess.run(
                [self.server.printer, command], input=raster or b"", capture_output=True, timeout=360
            )
            output = (result.stdout if result.returncode == 0 else result.stderr).decode(errors="replace").strip()
            self.respond(200 if result.returncode == 0 else 503, {
                "message": output or "The Mac printer command failed."
            })
        except subprocess.TimeoutExpired:
            self.respond(504, {"message": "The printer timed out. Check the paper before retrying."})
        finally:
            self.server.job.release()


def wifi_address():
    ports = subprocess.run(
        ["networksetup", "-listallhardwareports"], capture_output=True, text=True, check=True
    ).stdout
    for section in ports.split("\n\n"):
        if "Hardware Port: Wi-Fi" in section:
            for line in section.splitlines():
                if line.startswith("Device: "):
                    return subprocess.run(
                        ["ipconfig", "getifaddr", line.removeprefix("Device: ")], capture_output=True, text=True
                    ).stdout.strip()
    return ""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--printer", required=True, help=argparse.SUPPRESS)
    parser.add_argument("--port", type=int, default=7314)
    parser.add_argument("--share", action="store_true", help="allow phones on your Wi-Fi to print with a pairing key")
    parser.add_argument("--no-open", action="store_true", help="skip opening the browser on the Mac")
    options = parser.parse_args()

    address = wifi_address() if options.share else "127.0.0.1"
    if not address:
        parser.exit(1, "Connect your Mac to Wi-Fi before running ./yhk web --share.\n")
    key = secrets.token_urlsafe(18) if options.share else ""
    try:
        server = Relay((address, options.port), options.printer, key)
    except (OSError, OverflowError) as error:
        parser.exit(1, f"Could not start the relay: {error}\n")
    port = server.server_port
    url = f"http://{address}:{port}/"
    if key:
        print(f"Open on a phone on the same Wi-Fi:\n{url}#key={key}\n\nPairing key: {key}", flush=True)
    else:
        print(f"Open YHK Print at {url}", flush=True)
    print("Press Control-C to stop sharing.", flush=True)
    if not options.no_open:
        subprocess.Popen(["open", f"{url}#key={key}" if key else url])
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
