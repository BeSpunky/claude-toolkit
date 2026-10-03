// tools/worktree-domains/proxy.mjs — a tiny, self-contained reverse proxy for `<slug>.localhost` domains.
//
// Uses ONLY Node built-ins (http + net) — no npm dependency, no apt package beyond what the
// shared-browser stack already installs. It fronts every worktree's dev-server: a request to
// `http://<slug>.localhost/` (Chromium auto-resolves any `*.localhost` to 127.0.0.1) is routed by the
// leading DNS label (the slug) to `127.0.0.1:<port>` per the slug→port registry (routes.json).
//
// Two paths, both proxied:
//   • plain HTTP  — forwarded via http.request, response streamed back.
//   • WebSocket   — the `upgrade` event is spliced raw over a net socket, so Angular/Vite HMR survives.
//
// The upstream Host header is rewritten to `127.0.0.1:<port>` so a dev-server that vets the Host header
// (webpack-dev-server allowedHosts / Vite server.allowedHosts) accepts the forwarded request; the
// original host is preserved as X-Forwarded-Host. The browser's address bar keeps `<slug>.localhost`,
// so any client-side hostname logic (e.g. the worktree tab-label) is unaffected.
//
// routes.json is re-read on mtime change (cheap stat per request), so `register` / `unregister` /
// `reconcile` take effect live without restarting the proxy.
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';

const ROUTES_FILE = process.env.WD_ROUTES || `${process.env.WD_RUNTIME || `${process.env.XDG_RUNTIME_DIR || '/tmp'}/worktree-domains`}/routes.json`;
const PORT = Number(process.env.WD_PORT) || 80;
const HOST = process.env.WD_HOST || '127.0.0.1';

// Cache routes.json, reloading only when its mtime changes.
let cache = { mtime: -1, routes: {} };
function routes() {
  try {
    const st = fs.statSync(ROUTES_FILE);
    if (st.mtimeMs !== cache.mtime) {
      cache = { mtime: st.mtimeMs, routes: JSON.parse(fs.readFileSync(ROUTES_FILE, 'utf8') || '{}') };
    }
  } catch {
    cache = { mtime: -1, routes: {} };
  }
  return cache.routes;
}

// Slug = the leading DNS label of the Host header (`<slug>.localhost[:port]` → `<slug>`).
function slugOf(hostHeader) {
  if (!hostHeader) return '';
  return hostHeader.split(':')[0].split('.')[0].toLowerCase();
}

function portFor(req) {
  const p = routes()[slugOf(req.headers.host)];
  return typeof p === 'number' && p > 0 ? p : null;
}

const server = http.createServer((req, res) => {
  const port = portFor(req);
  if (!port) {
    res.writeHead(502, { 'content-type': 'text/plain' });
    res.end(`worktree-domains: no route for host "${req.headers.host || ''}"\n`);
    return;
  }
  const headers = { ...req.headers, host: `127.0.0.1:${port}`, 'x-forwarded-host': req.headers.host || '' };
  const upstream = http.request({ host: '127.0.0.1', port, method: req.method, path: req.url, headers }, (upRes) => {
    res.writeHead(upRes.statusCode || 502, upRes.headers);
    upRes.pipe(res);
  });
  upstream.on('error', (e) => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
    res.end(`worktree-domains: upstream error on :${port} (${e.code || e.message})\n`);
  });
  req.pipe(upstream);
});

// WebSocket / HMR upgrade: raw TCP splice, Host rewritten so the dev-server accepts the forwarded socket.
server.on('upgrade', (req, socket, head) => {
  const port = portFor(req);
  if (!port) { socket.destroy(); return; }
  const upstream = net.connect(port, '127.0.0.1', () => {
    const headers = { ...req.headers, host: `127.0.0.1:${port}` };
    let raw = `${req.method} ${req.url} HTTP/1.1\r\n`;
    for (const [k, v] of Object.entries(headers)) {
      if (Array.isArray(v)) for (const vv of v) raw += `${k}: ${vv}\r\n`;
      else raw += `${k}: ${v}\r\n`;
    }
    raw += '\r\n';
    upstream.write(raw);
    if (head && head.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
});

server.on('clientError', (_err, socket) => {
  try { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch { /* socket already gone */ }
});

server.listen(PORT, HOST, () => {
  console.log(`[worktree-domains] proxy listening on ${HOST}:${PORT} (routes: ${ROUTES_FILE})`);
});
server.on('error', (e) => {
  console.error(`[worktree-domains] proxy failed to bind ${HOST}:${PORT}: ${e.code || e.message}`);
  process.exit(1);
});
