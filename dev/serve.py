#!/usr/bin/env python3
"""Tiny development server for Comicverse.

Serves the app from the repository root and injects the webxdc simulator at
/webxdc.js (the real messengers provide that file themselves).

    python3 dev/serve.py [port]
"""
import http.server
import os
import socketserver
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

    def do_GET(self):
        if self.path.split('?')[0] in ('/webxdc.js', '/dev/webxdc.js'):
            path = os.path.join(ROOT, 'dev', 'webxdc.js')
            try:
                with open(path, 'rb') as fh:
                    data = fh.read()
                self.send_response(200)
                self.send_header('Content-Type', 'text/javascript; charset=utf-8')
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)
            except OSError:
                self.send_error(404)
            return
        return super().do_GET()

    def log_message(self, fmt, *args):
        sys.stderr.write('%s - %s\n' % (self.address_string(), fmt % args))


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == '__main__':
    with Server(('0.0.0.0', PORT), Handler) as httpd:
        print('Comicverse dev server → http://localhost:%d' % PORT)
        httpd.serve_forever()
