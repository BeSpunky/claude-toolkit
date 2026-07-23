#!/usr/bin/env python3
"""
serve.py — the mock harness's static server. It does three things a plain
`python3 -m http.server` cannot, and each one is load-bearing:

  1. COMMENTS ARE REAL (persisted).  The user's words are the most valuable thing a
     mock review produces. localStorage would tie them to an ORIGIN — and this server
     binds a RANDOM free port, so every restart is a new origin and every comment is
     silently lost. So comments are written to DISK (comments.json, beside the mocks):
     they survive a restart, a reboot, a closed browser. Claude reads them by reading a
     FILE, which works whether the review was co-driven or happened while nobody watched.

  2. HOT RELOAD (no build, no framework).  A watcher thread notices when a variant,
     mocks.json, or the review layer changes on disk and pushes a Server-Sent Event to
     every open gallery — so when Claude edits a mock, the page updates itself in front
     of the user. This is the one capability a bare static server lacks and the whole
     reason someone reaches for a framework's dev server; here it costs ~40 lines and
     keeps the folder dependency-free and instantly throwable.

  3. A STATE SNAPSHOT for Claude.  GET /state returns the comments, the VERDICT, and what the harness
     knows — so Claude can read the review's status in one request, live or async.

  4. THE VERDICT (the decision, not a comment).  A mock review exists to produce a DECISION — pick a
     concept to proceed with, or reject them all. That is a first-class act, not feedback on a detail, so
     it has its own store (verdict.json) and its own endpoints. Claude WATCHES it like the inbox and, when
     it lands, proceeds to build the chosen direction (a mock yes is provisional — it licenses the build).

A comment's lifecycle: DRAFT → SUBMITTED → HANDLED.
  · draft      — pinned, not yet sent (the user is still collecting them)
  · submitted  — sent to Claude (via POST /submit, or POST /comments {submitted:true} in live mode)
  · handled    — Claude addressed it (PATCH); its pin VANISHES from the live mock and shows resolved
                 (green ✓ + reply) in the gallery's side-list and the round's history snapshot
Claude acts on SUBMITTED-and-not-handled comments (see /state → `pending`). Each comment also carries
a `dom` blob (tag, id, classes, text, rect, styles, ancestor path) so Claude gets full context, not
just the words.

Endpoints:
  GET  /comments      → the comments array (JSON)
  POST /comments      → append one comment  {text, variant, element, anchor, note, at, viewport, dom, submitted?}
  POST /submit        → flip every DRAFT comment to SUBMITTED (the "send the batch to Claude" gesture)
  PATCH /comments     → partial update       {n, text?, status?, handled?, reply?}  ← handle / edit / send one
  POST /comments {…, status}                  → restore a comment exactly (Undo re-creates a removed one)
  DELETE /comments        → clear them all
  DELETE /comments?n=<n>   → remove one comment (so a single stray pin is easy to manage)
  GET  /events        → Server-Sent Events: {reload, changed:[…]} on file change; {comments} on comment change
  GET  /state         → {comments, pending, files_version, comments_version} — one-shot status for Claude
  POST /version       → commit a ROUND {variant, note?}: freeze the live mock as a snapshot + bump the round
  GET  /versions      → {<variant>: {current, rounds:[{v, ts, snapshot, note}]}} — the round history
  GET  /verdict       → the current verdict {kind, choice, note, version, ts} or null   ← THE DECISION
  POST /verdict       → record it {kind:'chosen'|'none', choice?, note?}  (choice = variant key when chosen)
  DELETE /verdict     → clear the verdict (the user un-decides)
  everything else     → static files from this folder (including .versions/<variant>__v<n>.html snapshots)
"""
import json
import os
import socket
import sys
import threading
import time
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
STORE = os.path.join(HERE, 'comments.json')
VERSTORE = os.path.join(HERE, 'versions.json')
VERDICT_STORE = os.path.join(HERE, 'verdict.json')   # the DECISION — which concept to proceed with, or none
SNAPDIR = os.path.join(HERE, '.versions')      # per-round HTML snapshots (dot-dir → git-ignored, not watched)
MAX_BODY = 1 << 20  # 1 MB — a comment is a sentence, not a payload

# Files the watcher must IGNORE: its own outputs and process bookkeeping. Watching
# comments.json / versions.json / verdict.json here would make every comment, commit, or decision
# also trigger a page reload.
WATCH_IGNORE = {'comments.json', 'comments.json.tmp', 'versions.json', 'versions.json.tmp',
                'verdict.json', 'verdict.json.tmp', '.gitignore', '.serve.pid'}
WATCH_EXTS = ('.html', '.htm', '.css', '.js', '.json', '.svg')

# ---- shared change-version state (read by every SSE client) ----
_lock = threading.Lock()
# A SEPARATE lock serializes the comments.json read-modify-write so two concurrent requests
# (the user pinning a comment while Claude checks one off) can't lose an update. It is never held
# while acquiring _lock (bump() is called AFTER the with-block), so the two locks can't deadlock.
_comments_lock = threading.Lock()
_state = {
    'files': 0,        # bumped when a watched file changes on disk
    'comments': 0,     # bumped on POST/DELETE
    'changed': [],     # relative paths that changed in the latest files bump
}


def bump(kind, changed=None):
    with _lock:
        _state[kind] += 1
        if changed is not None:
            _state['changed'] = changed


def snapshot():
    with _lock:
        return dict(_state)


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


# ---- versions / rounds ----
# A mock is iterated in ROUNDS (v1 → v2 → …). The live mock file (variants/<variant>.html) is always
# the CURRENT round; committing a round freezes the current file as an HTML snapshot and increments the
# round. Comments are stamped with the round they were made against, so they are version-bound and the
# live mock shows only the current round's open pins (handled/past-round pins never clutter it).
_versions_lock = threading.Lock()


def load_versions():
    try:
        with open(VERSTORE, encoding='utf-8') as f:
            data = json.load(f)
            return data if isinstance(data, dict) else {}
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def save_versions(vs):
    tmp = VERSTORE + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(vs, f, indent=2, ensure_ascii=False)
    os.replace(tmp, VERSTORE)


def current_round(variant, vs=None):
    vs = load_versions() if vs is None else vs
    return int(vs.get(variant, {}).get('current', 1))


def commit_round(variant, note=''):
    """Freeze the live mock (variants/<variant>.html) as a snapshot of the current round, then bump."""
    # A variant is a bare filename stem; reject anything that could escape variants/ or .versions/.
    if not variant or '/' in variant or '\\' in variant or '..' in variant:
        return None
    with _versions_lock:
        vs = load_versions()
        cur = current_round(variant, vs)
        src = os.path.join(HERE, 'variants', f'{variant}.html')
        if not os.path.isfile(src):
            return None                        # nothing to freeze — unknown variant
        os.makedirs(SNAPDIR, exist_ok=True)
        snap_rel = f'.versions/{variant}__v{cur}.html'   # one level deep, so the mock's ../review.* still resolve
        with open(src, encoding='utf-8') as f:
            html = f.read()
        tmp = os.path.join(HERE, snap_rel) + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            f.write(html)
        os.replace(tmp, os.path.join(HERE, snap_rel))
        entry = {'v': cur, 'ts': datetime.now(timezone.utc).isoformat(timespec='seconds'),
                 'snapshot': snap_rel, 'note': str(note)}
        node = vs.setdefault(variant, {'current': cur, 'rounds': []})
        node['rounds'].append(entry)
        node['current'] = cur + 1
        save_versions(vs)
        return vs


# ---- the verdict (the decision) ----
# A mock review's whole purpose is a DECISION: choose a concept to proceed with, or reject them all.
# That is not a comment (feedback on a detail) — it is the GATE, so it gets its own single-object store.
# kind='chosen' → `choice` is the picked variant's key; kind='none' → all rejected (choice=None).
_verdict_lock = threading.Lock()


def load_verdict():
    try:
        with open(VERDICT_STORE, encoding='utf-8') as f:
            data = json.load(f)
            return data if isinstance(data, dict) else None
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def save_verdict(verdict):
    tmp = VERDICT_STORE + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(verdict, f, indent=2, ensure_ascii=False)
    os.replace(tmp, VERDICT_STORE)


def scan():
    """A signature of every watched file's mtime, keyed by path relative to HERE."""
    sig = {}
    for root, dirs, files in os.walk(HERE):
        dirs[:] = [d for d in dirs if not d.startswith('.')]
        for name in files:
            if name in WATCH_IGNORE or not name.endswith(WATCH_EXTS):
                continue
            path = os.path.join(root, name)
            try:
                sig[os.path.relpath(path, HERE)] = os.stat(path).st_mtime
            except OSError:
                pass
    return sig


def watch():
    """Poll mtimes; on any change, record which paths changed and bump the files version."""
    prev = scan()
    while True:
        time.sleep(0.4)
        cur = scan()
        if cur != prev:
            changed = sorted(
                p for p in set(prev) | set(cur) if prev.get(p) != cur.get(p)
            )
            bump('files', changed)
            prev = cur


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

    def _sse(self):
        """Stream file-change and comment-change events. One long-lived response per gallery."""
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Connection', 'keep-alive')
        self.end_headers()
        sent = snapshot()
        try:
            # Announce the current versions once, so a client that reconnects re-syncs.
            self.wfile.write(b': connected\n\n')
            self.wfile.flush()
            ticks = 0
            while True:
                time.sleep(0.5)
                now = snapshot()
                if now['files'] != sent['files']:
                    data = json.dumps({'v': now['files'], 'changed': now['changed']})
                    self.wfile.write(f'event: reload\ndata: {data}\n\n'.encode('utf-8'))
                    self.wfile.flush()
                if now['comments'] != sent['comments']:
                    data = json.dumps({'v': now['comments']})
                    self.wfile.write(f'event: comments\ndata: {data}\n\n'.encode('utf-8'))
                    self.wfile.flush()
                sent = now
                ticks += 1
                if ticks % 30 == 0:            # a keep-alive comment every ~15s
                    self.wfile.write(b': ping\n\n')
                    self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass                               # the gallery tab closed — let the thread end

    def do_GET(self):
        path = self.path.split('?')[0]
        if path == '/':                        # a bare URL opens the gallery (nicer to hand a human)
            self.send_response(302)
            self.send_header('Location', '/gallery.html')
            self.end_headers()
            return
        if path == '/comments':
            return self._json(load())
        if path == '/versions':
            return self._json(load_versions())
        if path == '/verdict':
            return self._json(load_verdict())
        if path == '/events':
            return self._sse()
        if path == '/state':
            s = snapshot()
            comments = load()
            # `pending` = submitted-but-not-yet-handled: exactly the comments Claude should act on.
            pending = [c for c in comments if c.get('status') == 'submitted' and not c.get('handled')]
            return self._json({
                'comments': comments,
                'pending': pending,
                'verdict': load_verdict(),          # the DECISION — read this to know if the user has chosen
                'files_version': s['files'],
                'comments_version': s['comments'],
            })
        return super().do_GET()

    def do_POST(self):
        path = self.path.split('?')[0]

        # /submit — flip every DRAFT comment to SUBMITTED (the "send the batch to Claude" gesture).
        if path == '/submit':
            with _comments_lock:
                comments = load()
                changed = False
                for c in comments:
                    if c.get('status') == 'draft':
                        c['status'] = 'submitted'
                        changed = True
                if changed:
                    save(comments)
            bump('comments')
            return self._json(comments)

        # /version — commit a ROUND: freeze the live mock as a snapshot and bump. Claude calls this
        # right BEFORE it edits the mock for a new round, so the snapshot captures what was reviewed.
        if path == '/version':
            try:
                length = int(self.headers.get('Content-Length', 0))
            except ValueError:
                self.close_connection = True
                return self._json({'error': 'bad length'}, 400)
            if length < 0 or length > MAX_BODY:
                self.close_connection = True   # unread body would desync a keep-alive socket
                return self._json({'error': 'too large'}, 400)
            try:
                body = json.loads(self.rfile.read(length)) if length > 0 else {}
            except json.JSONDecodeError:
                return self._json({'error': 'bad json'}, 400)
            variant = str(body.get('variant', '')).strip()
            if not variant:
                return self._json({'error': 'need variant'}, 400)
            vs = commit_round(variant, body.get('note', ''))
            if vs is None:
                return self._json({'error': 'no such variant'}, 404)
            bump('comments')                   # gallery re-pulls /versions alongside comments
            return self._json(vs)

        # /verdict — record THE DECISION (choose a concept, or reject all). This is the review's gate; it is
        # deliberately NOT a comment. Claude watches for it and, once set, proceeds to build the chosen concept.
        if path == '/verdict':
            try:
                length = int(self.headers.get('Content-Length', 0))
            except ValueError:
                self.close_connection = True
                return self._json({'error': 'bad length'}, 400)
            if length < 0 or length > MAX_BODY:
                self.close_connection = True   # unread/negative body would desync a keep-alive socket
                return self._json({'error': 'bad length'}, 400)
            try:
                body = json.loads(self.rfile.read(length)) if length > 0 else {}
            except json.JSONDecodeError:
                return self._json({'error': 'bad json'}, 400)
            kind = str(body.get('kind', 'chosen'))
            if kind not in ('chosen', 'none'):
                return self._json({'error': "kind must be 'chosen' or 'none'"}, 400)
            choice = str(body.get('choice', '')).strip() or None
            if kind == 'chosen':
                # Mirror /version's strictness: a choice must be a real variant, never a path-escape or a
                # typo that would paint a phantom "✓ Chosen: <junk>". Variants live at variants/<key>.html.
                if not choice:
                    return self._json({'error': 'chosen needs a choice (variant key)'}, 400)
                if '/' in choice or '\\' in choice or '..' in choice \
                        or not os.path.isfile(os.path.join(HERE, 'variants', f'{choice}.html')):
                    return self._json({'error': 'no such variant'}, 404)
            verdict = {
                'kind': kind,
                'choice': choice if kind == 'chosen' else None,
                'note': str(body.get('note', '')),
                # stamp the round the chosen concept was on, so DECISION.md records exactly what was approved
                'version': current_round(choice) if kind == 'chosen' else None,
                'ts': datetime.now(timezone.utc).isoformat(timespec='seconds'),
            }
            with _verdict_lock:
                save_verdict(verdict)
            bump('comments')                   # gallery re-pulls /verdict alongside comments; Claude's watch sees it
            return self._json(verdict, 201)

        if path != '/comments':
            return self.send_error(404)
        try:
            length = int(self.headers.get('Content-Length', 0))
        except ValueError:
            self.close_connection = True       # unread body would desync a keep-alive socket
            return self._json({'error': 'bad length'}, 400)
        if length <= 0 or length > MAX_BODY:
            self.close_connection = True
            return self._json({'error': 'bad length'}, 400)
        try:
            comment = json.loads(self.rfile.read(length))
        except json.JSONDecodeError:
            return self._json({'error': 'bad json'}, 400)
        if not isinstance(comment, dict) or not str(comment.get('text', '')).strip():
            return self._json({'error': 'empty comment'}, 400)

        # Lifecycle: a comment is a DRAFT until submitted, unless the client sends `submitted:true`
        # (the gallery's live "send on save" mode). Claude acts on SUBMITTED-and-not-handled comments.
        # An explicit `status` (used by Undo, to restore a removed comment exactly) wins over the flag.
        submitted = bool(comment.pop('submitted', False))
        restore = comment.pop('status', None)
        comment['status'] = restore if restore in ('draft', 'submitted', 'handled') else ('submitted' if submitted else 'draft')
        comment.setdefault('handled', comment['status'] == 'handled')
        # Version-bind: stamp the round this comment was made against (unless Undo restored an explicit one).
        comment.setdefault('version', current_round(comment.get('variant', '')))
        with _comments_lock:
            comments = load()
            comment['ts'] = datetime.now(timezone.utc).isoformat(timespec='seconds')
            comment['n'] = max((c.get('n', 0) for c in comments), default=0) + 1   # monotonic — never collides after a delete
            comments.append(comment)
            save(comments)                     # ← on disk, before the response returns
        bump('comments')                       # ← tell every open gallery to re-pull
        return self._json(comments, 201)

    def do_PATCH(self):
        # Mark a comment handled (and optionally record what was done about it), so the user watches
        # their notes get checked off as Claude re-mocks. Reflected live via the SSE comment channel.
        if self.path.split('?')[0] != '/comments':
            return self.send_error(404)
        try:
            length = int(self.headers.get('Content-Length', 0))
        except ValueError:
            self.close_connection = True
            return self._json({'error': 'bad length'}, 400)
        if length < 0 or length > MAX_BODY:
            self.close_connection = True   # unread/negative body would desync a keep-alive socket
            return self._json({'error': 'bad length'}, 400)
        try:
            patch = json.loads(self.rfile.read(length)) if length > 0 else {}
        except json.JSONDecodeError:
            return self._json({'error': 'bad json'}, 400)
        if not isinstance(patch, dict) or 'n' not in patch:
            return self._json({'error': 'need n'}, 400)
        with _comments_lock:
            comments = load()
            found = False
            for c in comments:
                if c.get('n') == patch['n']:
                    # Partial update: apply whichever of text / status / handled / reply are present.
                    if 'text' in patch and str(patch['text']).strip():
                        c['text'] = str(patch['text'])
                    if 'status' in patch and patch['status'] in ('draft', 'submitted', 'handled'):
                        c['status'] = patch['status']
                        c['handled'] = patch['status'] == 'handled'
                    if 'handled' in patch:
                        c['handled'] = bool(patch['handled'])
                        c['status'] = 'handled' if c['handled'] else (c.get('status') if c.get('status') != 'handled' else 'submitted')
                    if 'reply' in patch:
                        c['reply'] = str(patch['reply'])
                    found = True
                    break
            if not found:
                return self._json({'error': 'no such comment'}, 404)
            save(comments)
        bump('comments')
        return self._json(comments)

    def do_DELETE(self):
        if self.path.split('?')[0] == '/verdict':   # the user un-decides — clear the gate
            with _verdict_lock:
                save_verdict(None)
            bump('comments')
            return self._json(None)
        if self.path.split('?')[0] != '/comments':
            return self.send_error(404)
        # ?n=<n> removes a single comment (by its stable `n`); no query clears them all.
        query = self.path.split('?', 1)[1] if '?' in self.path else ''
        target = None
        for part in query.split('&'):
            if part.startswith('n='):
                try:
                    target = int(part[2:])
                except ValueError:
                    return self._json({'error': 'bad n'}, 400)
        with _comments_lock:
            comments = [] if target is None else [c for c in load() if c.get('n') != target]
            save(comments)
        bump('comments')
        return self._json(comments)


def free_port():
    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    port = s.getsockname()[1]
    return s, port


if __name__ == '__main__':
    # The mocks are throwaway EVIDENCE: they must never reach git. The folder ignores itself.
    # Guard: never do this when running the PRISTINE skill asset in place (…/assets/mock-harness),
    # or the `*` would make git ignore the harness's own source. Only a COPIED mocks folder self-ignores.
    in_skill_asset = os.path.basename(HERE) == 'mock-harness' and os.path.basename(os.path.dirname(HERE)) == 'assets'
    gitignore = os.path.join(HERE, '.gitignore')
    if not in_skill_asset and not os.path.exists(gitignore):
        with open(gitignore, 'w', encoding='utf-8') as f:
            f.write('*\n')

    # free_port() picks an open port, then we close the probe and bind it. There is a microscopic
    # window between close and bind; on loopback it never loses in practice, and if it did the bind
    # raises OSError below and we exit cleanly. (Not a hard guarantee — just a safe-degrading pick.)
    probe, port = free_port()
    ThreadingHTTPServer.allow_reuse_address = True
    ThreadingHTTPServer.daemon_threads = True   # SSE + watcher threads never block shutdown
    probe.close()
    try:
        server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    except OSError as e:
        print(f'port {port} was taken: {e}', file=sys.stderr)
        sys.exit(1)

    threading.Thread(target=watch, daemon=True).start()

    print(f'http://127.0.0.1:{port}/', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
