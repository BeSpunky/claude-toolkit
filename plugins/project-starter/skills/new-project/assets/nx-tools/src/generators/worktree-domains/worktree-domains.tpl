#!/usr/bin/env bash
# worktree-domains — pretty `<slug>.localhost` routing for co-served worktrees, entirely in-container.
#
# One tiny reverse proxy on 127.0.0.1:80 fronts every worktree's dev-server: a browser hitting
# `http://<slug>.localhost/` (Chromium auto-resolves any `*.localhost` to loopback — no DNS, no hosts
# file) lands on the proxy, which forwards to `127.0.0.1:<port>` per a slug→port route registry. So the
# main tree and each git worktree each get a stable, human-readable domain instead of a shifted port a
# human has to remember (and that isn't forwarded anyway — worktree serves are :6080-only).
#
# The proxy is a self-contained Node reverse proxy (tools/worktree-domains/proxy.mjs) using ONLY Node
# built-ins (http + net) — no npm dep, no apt package beyond what the shared-browser stack already
# installs. It proxies BOTH plain HTTP and the WebSocket upgrade (so Angular/Vite HMR survives).
#
# This is the single public seam. The serve executor calls exactly:
#   worktree-domains register <slug> <port>     (idempotent; starts the proxy if down)
#   worktree-domains unregister <slug>
# Humans also get: list | reconcile | status | logs | stop.
#
# Lifecycle mirrors tools/shared-browser/shared-browser by construction: an flock so two starts can't
# race, a PID file validated by PID *and* cmdline signature (a recycled PID owned by something else is
# NEVER killed — never `pkill -f`), a readiness gate on the listen port, and a `stop` that verifies the
# port is actually freed. Route mutations are atomic (tmp-file + rename) so the live proxy — which
# re-reads routes.json on mtime change — never reads a half-written file.
#
# NOTE on `set`: -u + pipefail, but deliberately NOT -e — many legitimate non-zero probes (kill -0,
# port checks) whose failure is data, not an abort. Errors are handled explicitly.
set -uo pipefail

# ── Constants (env-overridable) ──────────────────────────────────────────────────────────────────────
WD_HOST="${WD_HOST:-127.0.0.1}"                            # proxy bind address (loopback, container-internal)
WD_PORT="${WD_PORT:-80}"                                   # proxy listen port — :80 so `http://<slug>.localhost/` just works
WD_RUNTIME="${WD_RUNTIME:-${XDG_RUNTIME_DIR:-/tmp}/worktree-domains}"
export WD_RUNTIME                                          # so the spawned proxy.mjs resolves the SAME base

WD_READY_TIMEOUT="${WD_READY_TIMEOUT:-15}"                 # seconds to wait for the proxy to listen on `start`
WD_KILL_GRACE_TICKS="${WD_KILL_GRACE_TICKS:-30}"          # 0.1s ticks of SIGTERM grace before SIGKILL
WD_LOG_TAIL="${WD_LOG_TAIL:-200}"                          # default lines for `logs`

# ── Derived paths ────────────────────────────────────────────────────────────────────────────────────
ROUTES="$WD_RUNTIME/routes.json"                           # the slug→port registry (JSON object)
LOGS="$WD_RUNTIME/logs"
PROXY_LOG="$LOGS/proxy.log"
LOCK="$WD_RUNTIME/up.lock"
PIDF="$WD_RUNTIME/proxy.pid"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROXY="$SCRIPT_DIR/proxy.mjs"
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/../.." 2>/dev/null && pwd || echo "$SCRIPT_DIR")"

PROXY_SIG="worktree-domains-proxy"                         # unique cmdline marker (passed as argv to node)

# ── Tiny output helpers ──────────────────────────────────────────────────────────────────────────────
say() { printf '[worktree-domains] %s\n' "$*"; }
ok()  { printf '[worktree-domains] %s\n' "$*"; }
err() { printf '[worktree-domains] %s\n' "$*" >&2; }
die() { err "$*"; exit 1; }

ensure_dirs() {
  mkdir -p "$WD_RUNTIME" "$LOGS"
  [ -f "$ROUTES" ] || printf '{}\n' > "$ROUTES"
}

# ── Process / port primitives (mirrors shared-browser: match by PID *and* cmdline signature) ──────────
proc_alive()   { kill -0 "$1" 2>/dev/null; }
proc_cmdline() { local f="/proc/$1/cmdline"; [ -r "$f" ] || return 1; tr '\0' ' ' < "$f"; }
proc_matches() { proc_cmdline "$1" 2>/dev/null | grep -Fq -- "$2"; }

# The proxy counts as running only if its PID file points at a live process still carrying OUR signature.
proxy_running() {
  local pid
  [ -f "$PIDF" ] || return 1
  pid="$(cat "$PIDF" 2>/dev/null)"
  [ -n "$pid" ] || return 1
  proc_alive "$pid" || return 1
  proc_matches "$pid" "$PROXY_SIG"
}

# Is anything LISTENING on 127.0.0.1:<port>? Uses ss (iproute2, already a shared-browser dep).
port_listening() { ss -ltn 2>/dev/null | awk -v p=":$1" '$4 ~ (p "$"){f=1} END{exit(f?0:1)}'; }

# ── Privileged-port floor (so a non-root proxy can bind :80 inside this container's net namespace) ─────
# The container has its own network namespace, so net.ipv4.ip_unprivileged_port_start is writable with
# sudo (the base image grants the `node` user passwordless sudo, as post-create relies on). Lower it to
# WD_PORT once. Best-effort + idempotent: already-low → no-op; can't lower → WARN with the manual fix and
# let the bind attempt fail loudly (callers treat domain routing as best-effort and fall back to :<port>).
ensure_unprivileged_port() {
  [ "$WD_PORT" -ge 1024 ] && return 0
  local cur
  if command -v sysctl >/dev/null 2>&1; then
    cur="$(sysctl -n net.ipv4.ip_unprivileged_port_start 2>/dev/null || echo 1024)"
    { [ -n "$cur" ] && [ "$cur" -le "$WD_PORT" ]; } && return 0
    sudo sysctl -w "net.ipv4.ip_unprivileged_port_start=$WD_PORT" >/dev/null 2>&1 && return 0
  fi
  # Fallback if procps/sysctl is absent: write the sysctl knob directly (tee is coreutils, always present).
  echo "$WD_PORT" | sudo tee /proc/sys/net/ipv4/ip_unprivileged_port_start >/dev/null 2>&1 && return 0
  err "could not lower the unprivileged-port floor to $WD_PORT — the proxy may fail to bind :$WD_PORT"
  err "  fix: sudo sysctl -w net.ipv4.ip_unprivileged_port_start=$WD_PORT   (then: worktree-domains reconcile)"
  return 0
}

# ── Spawning: detach as a session leader, pin the DAEMON's own PID (same idiom as shared-browser) ─────
# setsid → own session (survives Claude's shell + this CLI, reparented to init which reaps it). `$$`
# from inside the wrapper + `exec` pins the real pid. `cd` to the workspace root, detach stdin, and
# 9>&- closes the inherited flock fd so the next start/route mutation can re-acquire it immediately.
spawn_proxy() {
  setsid bash -c 'cd "$1" || exit 1; echo $$ > "$2"; shift 2; exec "$@"' \
    _ "$WORKSPACE_ROOT" "$PIDF" \
    env WD_ROUTES="$ROUTES" WD_PORT="$WD_PORT" WD_HOST="$WD_HOST" WD_RUNTIME="$WD_RUNTIME" \
    node "$PROXY" "$PROXY_SIG" \
    >"$PROXY_LOG" 2>&1 </dev/null 9>&- &
  disown 2>/dev/null || true
  say "started proxy (pid $(cat "$PIDF" 2>/dev/null || echo '?')) on $WD_HOST:$WD_PORT → $PROXY_LOG"
}

# Stop the proxy by its PID file: SIGTERM, grace-poll, then SIGKILL. Only ever touches a process that is
# STILL ours (alive + matching cmdline) — a stale/recycled pid is simply forgotten, never killed.
kill_proxy() {
  local pid t
  [ -f "$PIDF" ] || return 0
  pid="$(cat "$PIDF" 2>/dev/null || true)"
  if [ -n "$pid" ] && proc_alive "$pid" && proc_matches "$pid" "$PROXY_SIG"; then
    kill -TERM "$pid" 2>/dev/null || true
    for ((t=0; t<WD_KILL_GRACE_TICKS; t++)); do proc_alive "$pid" || break; sleep 0.1; done
    if proc_alive "$pid"; then
      kill -KILL "$pid" 2>/dev/null || true
      for ((t=0; t<20; t++)); do proc_alive "$pid" || break; sleep 0.1; done
    fi
  fi
  rm -f "$PIDF"
}

# Bring the proxy up if it isn't already. flock-serialized (no half-start races). Idempotent.
ensure_proxy_up() {
  ensure_dirs
  exec 9>"$LOCK" || die "cannot open lock file $LOCK"
  flock -w 30 9 || die "another worktree-domains start is in progress (lock held) — try again shortly"

  proxy_running && return 0
  [ -f "$PIDF" ] && rm -f "$PIDF"                          # stale pid file — proxy already proven not-ours-alive

  # A FOREIGN holder of the listen port aborts (we neither start over it nor kill it).
  if port_listening "$WD_PORT"; then
    err "port $WD_PORT is already in use by another process — refusing to start the proxy"
    err "  (stop that process, or point the proxy at a free port via WD_PORT)"
    return 1
  fi

  ensure_unprivileged_port
  spawn_proxy

  local deadline=$(( $(date +%s) + WD_READY_TIMEOUT ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if proxy_running && port_listening "$WD_PORT"; then return 0; fi
    sleep 0.2
  done
  err "proxy failed to come up on $WD_HOST:$WD_PORT within ${WD_READY_TIMEOUT}s — last log lines:"
  [ -f "$PROXY_LOG" ] && tail -n 20 "$PROXY_LOG" >&2
  return 1
}

# ── Route registry mutations (done in Node — robust JSON, atomic tmp+rename so the live proxy is safe) ─
route_set() {
  WD_ROUTES="$ROUTES" WD_SLUG="$1" WD_PORT_VAL="$2" node - <<'NODE'
const fs = require('fs');
const f = process.env.WD_ROUTES, slug = process.env.WD_SLUG, port = Number(process.env.WD_PORT_VAL);
let r = {}; try { r = JSON.parse(fs.readFileSync(f, 'utf8') || '{}'); } catch (e) { r = {}; }
r[slug] = port;
fs.writeFileSync(f + '.tmp', JSON.stringify(r, null, 2) + '\n');
fs.renameSync(f + '.tmp', f);
NODE
}

route_del() {
  WD_ROUTES="$ROUTES" WD_SLUG="$1" node - <<'NODE'
const fs = require('fs');
const f = process.env.WD_ROUTES, slug = process.env.WD_SLUG;
let r = {}; try { r = JSON.parse(fs.readFileSync(f, 'utf8') || '{}'); } catch (e) { r = {}; }
const had = Object.prototype.hasOwnProperty.call(r, slug);
delete r[slug];
fs.writeFileSync(f + '.tmp', JSON.stringify(r, null, 2) + '\n');
fs.renameSync(f + '.tmp', f);
process.exit(had ? 0 : 3);
NODE
}

# ── Validation ───────────────────────────────────────────────────────────────────────────────────────
valid_slug() {
  # A DNS label: 1–63 chars, [a-z0-9-], not starting/ending with a hyphen.
  [[ "$1" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$ ]]
}
valid_port() {
  [[ "$1" =~ ^[0-9]+$ ]] && [ "$1" -ge 1 ] && [ "$1" -le 65535 ]
}

# ── Verbs ────────────────────────────────────────────────────────────────────────────────────────────
cmd_register() {
  local slug="${1:-}" port="${2:-}"
  [ -n "$slug" ] && [ -n "$port" ] || die "usage: worktree-domains register <slug> <port>"
  valid_slug "$slug" || die "register: '$slug' is not a valid DNS label ([a-z0-9-], 1–63 chars, no leading/trailing '-')"
  valid_port "$port" || die "register: '$port' is not a valid port (1–65535)"

  ensure_dirs
  route_set "$slug" "$port"
  say "route  $slug.localhost → 127.0.0.1:$port"

  if ensure_proxy_up; then
    ok "http://$slug.localhost/  (via the proxy on :$WD_PORT)"
    return 0
  fi
  err "route recorded, but the proxy is not up — use http://localhost:$port/ meanwhile"
  return 1
}

cmd_unregister() {
  local slug="${1:-}"
  [ -n "$slug" ] || die "usage: worktree-domains unregister <slug>"
  ensure_dirs
  if route_del "$slug"; then say "unregistered $slug.localhost"; else say "no route for '$slug' (nothing to do)"; fi
  return 0
}

cmd_list() {
  ensure_dirs
  WD_ROUTES="$ROUTES" WD_PORT="$WD_PORT" node - <<'NODE'
const fs = require('fs');
let r = {}; try { r = JSON.parse(fs.readFileSync(process.env.WD_ROUTES, 'utf8') || '{}'); } catch (e) { r = {}; }
const keys = Object.keys(r).sort();
if (!keys.length) { console.log('(no routes)'); process.exit(0); }
const w = Math.max(...keys.map((k) => (k + '.localhost').length));
for (const k of keys) console.log(`  ${(k + '.localhost').padEnd(w)}  → 127.0.0.1:${r[k]}`);
NODE
}

cmd_reconcile() {
  ensure_dirs
  WD_ROUTES="$ROUTES" node - <<'NODE'
const fs = require('fs');
const net = require('net');
const cp = require('child_process');
const f = process.env.WD_ROUTES;
let r = {}; try { r = JSON.parse(fs.readFileSync(f, 'utf8') || '{}'); } catch (e) { r = {}; }

function basename(p) { return p.replace(/\/+$/, '').split('/').pop().toLowerCase().replace(/[^a-z0-9-]/g, '-'); }
function slugify(b) { return b.toLowerCase().replace(/\//g, '-').replace(/[^a-z0-9-]/g, '-'); }

// Live worktree slugs (best-effort): dir basename + sanitized branch for every worktree, incl. main.
let liveSlugs = null;
try {
  const out = cp.execSync('git worktree list --porcelain', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  liveSlugs = new Set();
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) { const d = line.slice(9).trim(); if (d) liveSlugs.add(basename(d)); }
    else if (line.startsWith('branch ')) { const b = line.slice(7).trim().replace(/^refs\/heads\//, ''); if (b) liveSlugs.add(slugify(b)); }
  }
} catch (e) { liveSlugs = null; }

const probe = (port) => new Promise((res) => {
  const s = net.connect(port, '127.0.0.1');
  let done = false;
  const fin = (v) => { if (!done) { done = true; s.destroy(); res(v); } };
  s.on('connect', () => fin(true));
  s.on('error', () => fin(false));
  s.setTimeout(500, () => fin(false));
});

(async () => {
  const kept = {}, dropped = [];
  for (const [slug, port] of Object.entries(r)) {
    const listening = await probe(Number(port));
    const worktreeGone = liveSlugs !== null && !liveSlugs.has(slug);
    if (!listening || worktreeGone) dropped.push([slug, port, !listening ? 'no listener' : 'worktree gone']);
    else kept[slug] = port;
  }
  fs.writeFileSync(f + '.tmp', JSON.stringify(kept, null, 2) + '\n');
  fs.renameSync(f + '.tmp', f);
  if (!dropped.length) console.log('no dead routes');
  else for (const [slug, port, why] of dropped) console.log(`dropped ${slug}.localhost → :${port} (${why})`);
})();
NODE
}

cmd_status() {
  ensure_dirs
  local up=down
  proxy_running && port_listening "$WD_PORT" && up=up
  printf 'worktree-domains proxy: %s (%s:%s)\n' "$up" "$WD_HOST" "$WD_PORT"
  cmd_list
}

cmd_logs() {
  [ -f "$PROXY_LOG" ] || die "no proxy log yet ($PROXY_LOG) — is the proxy up? (worktree-domains register …)"
  tail -n "$WD_LOG_TAIL" "$PROXY_LOG"
}

cmd_stop() {
  ensure_dirs
  kill_proxy
  if port_listening "$WD_PORT" && proxy_running; then err "after stop, proxy still listening on :$WD_PORT"; return 1; fi
  ok "proxy stopped."
  return 0
}

usage() {
  cat <<EOF
worktree-domains — pretty <slug>.localhost routing for co-served worktrees (in-container).

USAGE
  worktree-domains register <slug> <port>   ensure <slug>.localhost → 127.0.0.1:<port>; start the proxy if down (idempotent)
  worktree-domains unregister <slug>        remove the route (proxy stays up)
  worktree-domains list                     print the current routes
  worktree-domains reconcile                drop routes with no listener / whose worktree is gone (git worktree list)
  worktree-domains status                   proxy up/down + the route table
  worktree-domains logs                     tail the proxy log
  worktree-domains stop                     stop the proxy (routes are kept)

The proxy binds $WD_HOST:$WD_PORT (loopback, container-internal — NOT forwarded). Chromium auto-resolves
any *.localhost to 127.0.0.1, so no DNS or hosts file is needed. WebSocket upgrades (HMR) are proxied.
Env overrides: WD_HOST WD_PORT WD_RUNTIME (see the top of this script).
EOF
}

# ── Dispatch ───────────────────────────────────────────────────────────────────────────────────────────
main() {
  local verb="${1:-}"; [ "$#" -gt 0 ] && shift
  case "$verb" in
    register)           cmd_register "$@" ;;
    unregister)         cmd_unregister "$@" ;;
    list)               cmd_list ;;
    reconcile)          cmd_reconcile ;;
    status)             cmd_status ;;
    logs)               cmd_logs ;;
    stop)               cmd_stop ;;
    ""|-h|--help|help)  usage ;;
    *)                  err "unknown verb: $verb"; usage; exit 2 ;;
  esac
}
main "$@"
