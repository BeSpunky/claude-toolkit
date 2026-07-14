#!/usr/bin/env python3
"""
serve.py — the mock harness's static server, plus the one endpoint that makes comments REAL.

Why this exists instead of `python3 -m http.server`:

  The user's comments are the most valuable thing a mock review produces. Keeping them in
  localStorage means keeping them in an ORIGIN — and this server binds a random free port,
  so every restart is a new origin and every comment is silently lost. Worse, reading them
  back would require a live CDP session with the exact browser they were typed into.

  So comments are written to DISK (comments.json, beside the mocks). They survive a restart,
  a reboot, and a closed browser; Claude reads them by reading a FILE, which works whether the
  review happened live in a shared browser or asynchronously while nobody was watching.

Endpoints:
  GET  /comments      → the comments array (JSON)
  POST /comments      → append one comment  {text, variant, element, anchor, note, at, viewport}
  DELETE /comments    → clear them all
  everything else     → static files from this folder
"""
import json
import os
import socket
import sys
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
STORE = os.path.join(HERE, 'comments.json')
MAX_BODY = 1 << 20  # 1 MB — a comment is a sentence, not a payload


def load():
    try:
        with open(STORE, encoding='utf-8') as f:
            data = json.load(f)
            return data if isinstance(data, list) else []
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def save(comments):
    tmp = STORE + '.tmp'                      # write-then-rename: never leave a half-written store
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(comments, f, indent=2, ensure_ascii=False)
    os.replace(tmp, STORE)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=HERE, **kw)

    def log_message(self, *a):
        pass                                   # a mock review is not a place for access logs

    def _json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.split('?')[0] == '/comments':
            return self._json(load())
        return super().do_GET()

    def do_POST(self):
        if self.path.split('?')[0] != '/comments':
            return self.send_error(404)
        try:
            length = int(self.headers.get('Content-Length', 0))
        except ValueError:
            return self._json({'error': 'bad length'}, 400)
        if length <= 0 or length > MAX_BODY:
            return self._json({'error': 'bad length'}, 400)
        try:
            comment = json.loads(self.rfile.read(length))
        except json.JSONDecodeError:
            return self._json({'error': 'bad json'}, 400)
        if not isinstance(comment, dict) or not str(comment.get('text', '')).strip():
            return self._json({'error': 'empty comment'}, 400)

        comments = load()
        comment['ts'] = datetime.now(timezone.utc).isoformat(timespec='seconds')
        comment['n'] = len(comments) + 1
        comments.append(comment)
        save(comments)                         # ← on disk, before the response returns
        return self._json(comments, 201)

    def do_DELETE(self):
        if self.path.split('?')[0] != '/comments':
            return self.send_error(404)
        save([])
        return self._json([])


def free_port():
    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    port = s.getsockname()[1]
    return s, port


if __name__ == '__main__':
    # The mocks are throwaway EVIDENCE: they must never reach git. The folder ignores itself.
    gitignore = os.path.join(HERE, '.gitignore')
    if not os.path.exists(gitignore):
        with open(gitignore, 'w', encoding='utf-8') as f:
            f.write('*\n')

    # Hold the probe socket until the server takes the port — no TOCTOU window for a racing serve.
    probe, port = free_port()
    ThreadingHTTPServer.allow_reuse_address = True
    probe.close()
    try:
        server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    except OSError as e:
        print(f'port {port} was taken: {e}', file=sys.stderr)
        sys.exit(1)

    print(f'http://127.0.0.1:{port}/gallery.html', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
