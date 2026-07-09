#!/usr/bin/env bash
# shared-browser — one browser a human and Claude drive together, entirely inside the devcontainer.
#
#   Human  → http://localhost:${SB_WEB}   (noVNC, the ONLY forwarded port)
#   Claude → http://127.0.0.1:${SB_CDP}   (CDP, loopback ONLY — full remote control, never forward)
#
# The stack (each a black box over the one below):
#   Xvfb :99  ─ fluxbox WM ─ Chromium (persistent, CDP loopback) ─ x11vnc (:5900) ─ websockify/noVNC (:6080)
# A persistent recorder attaches over CDP and streams console/network/nav to logs/events.jsonl.
#
# This is the single public seam. Callers say up/down/navigate/status — never touch Xvfb/x11vnc directly.
#
# ROBUSTNESS (why this file is long): a long-lived, multi-process, human+agent-shared stack is a leak
# magnet. Every lifecycle failure is designed OUT, not left to discipline:
#   • idempotent `up` that REAPS stale leftovers before starting — validated by PID *and* cmdline, so a
#     reused PID owned by something else is NEVER killed (mirrors tools/reap-emulators.sh discipline);
#   • an flock so two `up`s can't half-start the stack;
#   • a readiness gate on all three ports, with a diagnostic dump + self-teardown on timeout (no half-up);
#   • a `down` that kills exactly this stack by PID file and VERIFIES the ports are actually free;
#   • a foreign process holding one of our ports is reported, never killed.
#
# The seven brief gotchas are baked in by construction (see the inline "gotcha #N" markers):
#   #1 software-GL flags   #2 unset Wayland   #3 resolve Chromium via playwright/-core/@playwright/test
#   #4 own Xvfb not ambient :12   #5 PID-file lifecycle, never `pkill -f`   #6 validated/explicit param passing
#   #7 loopback CDP
#
# NOTE on `set`: -u (catch typos) and pipefail (surface pipeline errors), but deliberately NOT -e —
# this script runs many legitimate non-zero probes (kill -0, port checks, curl) whose failure is data,
# not an abort. Errors are handled explicitly.
set -uo pipefail

# ── Constants (env-overridable; these exact CONTRACT defaults) ─────────────────────────────────────
SB_DISPLAY="${SB_DISPLAY:-:99}"
SB_GEOM="${SB_GEOM:-1440x900x24}"
SB_VNC="${SB_VNC:-5900}"                                   # x11vnc RFB port (loopback)
SB_WEB="${SB_WEB:-6080}"                                   # noVNC/websockify port (the ONLY forwarded one)
SB_CDP="${SB_CDP:-9223}"                                   # Chromium DevTools port (loopback ONLY)
SB_RUNTIME="${SB_RUNTIME:-${XDG_RUNTIME_DIR:-/tmp}/shared-browser}"
export SB_RUNTIME                                          # so the spawned recorder.mjs writes events.jsonl under the SAME base
SB_NOVNC_WEB="${SB_NOVNC_WEB:-/usr/share/novnc}"           # static noVNC client dir (from the `novnc` apt pkg)

# Tunable timeouts / limits (env-overridable).
SB_READY_TIMEOUT="${SB_READY_TIMEOUT:-30}"                 # seconds to wait for all 3 ports on `up`
SB_WAIT_TIMEOUT="${SB_WAIT_TIMEOUT:-300}"                  # seconds `navigate --wait` polls the app URL
SB_NAV_TIMEOUT_MS="${SB_NAV_TIMEOUT_MS:-30000}"           # per-navigation timeout (ms)
SB_KILL_GRACE_TICKS="${SB_KILL_GRACE_TICKS:-30}"          # 0.1s ticks of SIGTERM grace before SIGKILL
SB_LOG_TAIL="${SB_LOG_TAIL:-200}"                          # default lines for `logs`

# ── Derived values ─────────────────────────────────────────────────────────────────────────────────
# Window size from GEOM: "1440x900x24" → W=1440, H=900 (drop the depth).
WIN_W="${SB_GEOM%%x*}"
_geom_rest="${SB_GEOM#*x}"
WIN_H="${_geom_rest%%x*}"

# X socket path for readiness: ":99" (or ":99.0") → display number 99 → /tmp/.X11-unix/X99.
_disp_num="${SB_DISPLAY#:}"; _disp_num="${_disp_num%%.*}"
X_SOCKET="/tmp/.X11-unix/X${_disp_num}"

CDP_URL="http://127.0.0.1:${SB_CDP}"
NOVNC_URL="http://localhost:${SB_WEB}/vnc.html?autoconnect=true&resize=scale&reconnect=true&show_dot=true"

PROFILE="$SB_RUNTIME/profile"                              # Chromium --user-data-dir (fresh by default)
LOGS="$SB_RUNTIME/logs"
SHOTS="$LOGS/screenshots"                                  # verify.mjs writes before/after PNGs here
EVENTS="$LOGS/events.jsonl"                                # recorder stream
LOCK="$SB_RUNTIME/up.lock"

# Where the sibling helpers live, and the workspace root (for Node module resolution — gotcha #3).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RECORDER="$SCRIPT_DIR/recorder.mjs"
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/../.." 2>/dev/null && pwd || echo "$SCRIPT_DIR")"

# Start order (dependencies first) and its reverse for teardown (recorder torn down first).
START_ORDER=(xvfb fluxbox chrome x11vnc websockify)
TEARDOWN_ORDER=(recorder websockify x11vnc chrome fluxbox xvfb)

STARTED=()                                                 # what THIS `up` invocation started (for self-teardown)

# ── Tiny output helpers ─────────────────────────────────────────────────────────────────────────────
say() { printf '[shared-browser] %s\n' "$*"; }
ok()  { printf '[shared-browser] %s\n' "$*"; }
err() { printf '[shared-browser] %s\n' "$*" >&2; }
die() { err "$*"; exit 1; }

pid_file() { printf '%s/%s.pid' "$SB_RUNTIME" "$1"; }
# The recorder's spawn stdout/stderr go to recorder.out — recorder.mjs itself appends its status to
# recorder.log, so keeping them separate avoids a truncate-vs-append clash on one file.
log_file() { if [ "$1" = recorder ]; then printf '%s/recorder.out' "$LOGS"; else printf '%s/%s.log' "$LOGS" "$1"; fi; }

ensure_dirs() { mkdir -p "$SB_RUNTIME" "$PROFILE" "$LOGS" "$SHOTS"; }

# ── Per-component identity: the owned port (if any) and a cmdline SIGNATURE ───────────────────────────
# The signature is a fixed substring that appears in the process's /proc/<pid>/cmdline. We match by
# PID *and* signature so a PID that has been recycled to a foreign process is never mistaken for ours
# (gotcha #5: this is why we never `pkill -f`). Each signature is unique to OUR launch of the component.
component_port() {
  case "$1" in
    chrome)     printf '%s' "$SB_CDP" ;;
    x11vnc)     printf '%s' "$SB_VNC" ;;
    websockify) printf '%s' "$SB_WEB" ;;
    *)          printf '' ;;
  esac
}
component_sig() {
  case "$1" in
    xvfb)       printf 'Xvfb %s' "$SB_DISPLAY" ;;
    fluxbox)    printf 'fluxbox' ;;
    chrome)     printf -- '--user-data-dir=%s' "$PROFILE" ;;   # unique to our profile path
    x11vnc)     printf -- '-rfbport %s' "$SB_VNC" ;;
    websockify) printf 'websockify' ;;
    recorder)   printf 'recorder.mjs' ;;
    *)          printf '' ;;
  esac
}

# ── Process / port primitives ─────────────────────────────────────────────────────────────────────────
proc_alive()   { kill -0 "$1" 2>/dev/null; }                       # signal 0 = "does this pid exist & can I signal it"
proc_cmdline() { local f="/proc/$1/cmdline"; [ -r "$f" ] || return 1; tr '\0' ' ' < "$f"; }
proc_matches() { proc_cmdline "$1" 2>/dev/null | grep -Fq -- "$2"; }  # -F: signature is a literal, not a regex

# A component counts as "running" only if its PID file points at a live process whose cmdline still
# matches OUR signature. Anything else (dead pid, recycled pid, foreign proc) is NOT ours.
component_running() {
  local comp="$1" pidf pid
  pidf="$(pid_file "$comp")"
  [ -f "$pidf" ] || return 1
  pid="$(cat "$pidf" 2>/dev/null)"
  [ -n "$pid" ] || return 1
  proc_alive "$pid" || return 1
  proc_matches "$pid" "$(component_sig "$comp")"
}

# Is anything LISTENING on 127.0.0.1:<port> (any interface)? Uses ss (iproute2, base image) — no psmisc dep.
port_listening() { ss -ltn 2>/dev/null | awk -v p=":$1" '$4 ~ (p "$"){f=1} END{exit(f?0:1)}'; }

# PIDs holding <port> (LISTEN or connected), space-separated. ss -p prints "...pid=NNN...".
port_holders() {
  ss -tanp 2>/dev/null | awk -v p=":$1" '
    $4 ~ (p "$") { s=$0; while (match(s, /pid=[0-9]+/)) { print substr(s, RSTART+4, RLENGTH-4); s=substr(s, RSTART+RLENGTH) } }
  ' | sort -u | tr '\n' ' '
}

# ── Spawning: detach as a session leader, pin the DAEMON's own PID ────────────────────────────────────
# `setsid` puts the daemon in its own session so it survives Claude's shell AND this CLI process
# (reparented to init/PID 1, which reaps it — no zombies). We record the pid via `$$` from inside the
# wrapper and then `exec`, so the PID file names the ACTUAL daemon regardless of whether setsid forks
# (a job-control group leader makes it fork; $$+exec pins the real pid either way). Also `cd` to the
# workspace root so Node resolves `playwright` from node_modules (gotcha #3), and detach stdin.
spawn() {
  local comp="$1"; shift
  local pidf logf
  pidf="$(pid_file "$comp")"
  logf="$(log_file "$comp")"
  # 9>&-: close the inherited flock fd (cmd_up holds the up.lock on fd 9). Without this, every daemon
  # keeps the lock open for its whole life, so after `up` the next lock-taking verb (navigate, re-up)
  # blocks the full flock timeout and dies. Closing it in each child's redirection list lets the very
  # next cmd_up/navigate re-acquire the flock immediately.
  setsid bash -c 'cd "$1" || exit 1; echo $$ > "$2"; shift 2; exec "$@"' \
    _ "$WORKSPACE_ROOT" "$pidf" "$@" >"$logf" 2>&1 </dev/null 9>&- &
  disown 2>/dev/null || true
  say "started $comp (pid $(cat "$pidf" 2>/dev/null || echo '?')) → $logf"
}

# Stop one component by its PID file: SIGTERM, grace-poll, then SIGKILL. Only ever touches a process
# that is STILL ours (alive + matching cmdline) — a stale/recycled pid is simply forgotten, never killed.
kill_component() {
  local comp="$1" pidf pid t
  pidf="$(pid_file "$comp")"
  [ -f "$pidf" ] || return 0
  pid="$(cat "$pidf" 2>/dev/null || true)"
  if [ -n "$pid" ] && proc_alive "$pid" && proc_matches "$pid" "$(component_sig "$comp")"; then
    kill -TERM "$pid" 2>/dev/null || true
    for ((t=0; t<SB_KILL_GRACE_TICKS; t++)); do proc_alive "$pid" || break; sleep 0.1; done
    if proc_alive "$pid"; then
      kill -KILL "$pid" 2>/dev/null || true
      for ((t=0; t<20; t++)); do proc_alive "$pid" || break; sleep 0.1; done
    fi
  fi
  rm -f "$pidf"
}

# Reclaim a port ONLY if every holder is provably ours (cmdline matches the signature). A FOREIGN
# holder → clear error, return non-zero, and we do NOT kill it. When ours: SIGTERM → poll → SIGKILL,
# and (like reap-emulators.sh) do not return until the port is actually FREE — "sent a kill" ≠ "freed".
reclaim_port_if_ours() {
  local port="$1" sig="$2" pid holders t
  holders="$(port_holders "$port")"
  [ -z "${holders// }" ] && return 0
  for pid in $holders; do
    if ! proc_matches "$pid" "$sig"; then
      err "port $port is held by a FOREIGN process (pid $pid): $(proc_cmdline "$pid" 2>/dev/null | cut -c1-120)"
      err "refusing to kill it — stop that process, or point shared-browser at a free port via SB_* env."
      return 1
    fi
  done
  say "reclaiming our stale port $port (pids:$holders)"
  for pid in $holders; do kill -TERM "$pid" 2>/dev/null || true; done
  # ~1s grace, then force; ~6s hard ceiling. Re-check ownership before each SIGKILL (pid could recycle).
  for ((t=0; t<60; t++)); do
    port_listening "$port" || return 0
    if [ "$t" -eq 10 ]; then
      for pid in $(port_holders "$port"); do
        proc_matches "$pid" "$sig" && kill -KILL "$pid" 2>/dev/null || true
      done
    fi
    sleep 0.1
  done
  port_listening "$port" && { err "failed to free port $port"; return 1; }
  return 0
}

# ── up support ────────────────────────────────────────────────────────────────────────────────────────
prepare_env() {
  # gotcha #2: the devcontainer exports a VS Code WAYLAND_DISPLAY; x11vnc auto-detects "Wayland" and
  # refuses to serve our X11 Xvfb. Unset it (and XDG_SESSION_TYPE) for the whole stack — everything
  # here is deliberately the X11 path. gotcha #4: pin DISPLAY to OUR Xvfb, never the ambient :12.
  export DISPLAY="$SB_DISPLAY"
  unset WAYLAND_DISPLAY XDG_SESSION_TYPE
}

preflight_deps() {
  local bin missing=()
  for bin in Xvfb fluxbox x11vnc websockify node ss curl setsid flock; do
    command -v "$bin" >/dev/null 2>&1 || missing+=("$bin")
  done
  if [ "${#missing[@]}" -ne 0 ]; then
    err "missing dependencies: ${missing[*]}"
    err "install via the devcontainer post-create (apt): xvfb x11vnc novnc websockify fluxbox iproute2 curl util-linux"
    err "  (xvfb→Xvfb, iproute2→ss, util-linux→flock/setsid, curl→curl; node comes from the base image)"
    return 1
  fi
}

# gotcha #3: resolve Chromium via whichever Playwright package is installed. Printed path, empty on failure.
resolve_chromium() {
  ( cd "$WORKSPACE_ROOT" && node -e '
    for (const m of ["playwright", "playwright-core", "@playwright/test"]) {
      try { const p = require(m).chromium.executablePath(); if (p) { console.log(p); process.exit(0); } } catch (e) {}
    }
    process.exit(3);
  ' 2>/dev/null )
}

# Drop stale PID files so `up` restarts what actually died — but NEVER kill (dead already, or the pid
# was recycled to a foreign process). Genuinely-ours-and-alive components are left running (idempotency).
reap_stale() {
  local comp pidf
  for comp in "${TEARDOWN_ORDER[@]}"; do
    pidf="$(pid_file "$comp")"
    [ -f "$pidf" ] || continue
    component_running "$comp" && continue
    rm -f "$pidf"
  done
}

# Before starting a ported component that isn't running-as-ours, make sure its port is either free or
# an OUR orphan we can reclaim. A foreign holder aborts `up` (we neither start over it nor kill it).
preflight_ports() {
  local comp port
  for comp in chrome x11vnc websockify; do
    component_running "$comp" && continue
    port="$(component_port "$comp")"
    port_listening "$port" || continue
    reclaim_port_if_ours "$port" "$(component_sig "$comp")" || return 1
  done
}

wait_for_x() {
  local deadline=$(( $(date +%s) + 10 ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    [ -S "$X_SOCKET" ] && return 0
    sleep 0.1
  done
  return 1
}

# The readiness gate: no half-up stack. Block until all three ports listen, or time out.
readiness_gate() {
  local deadline=$(( $(date +%s) + SB_READY_TIMEOUT ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if port_listening "$SB_VNC" && port_listening "$SB_WEB" && port_listening "$SB_CDP"; then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

dump_diagnostics() {
  local comp lf
  err "──────── diagnostics: last ${SB_LOG_TAIL} lines per component ────────"
  for comp in "${START_ORDER[@]}"; do
    lf="$(log_file "$comp")"
    err "──── $comp  ($lf) ────"
    if [ -f "$lf" ]; then tail -n "${SB_LOG_TAIL}" "$lf" >&2; else err "(no log written — did it start?)"; fi
  done
}

teardown_started() {
  local i
  for ((i=${#STARTED[@]}-1; i>=0; i--)); do kill_component "${STARTED[i]}"; done
}

# ── Verbs ─────────────────────────────────────────────────────────────────────────────────────────────
cmd_up() {
  ensure_dirs
  # Serialize concurrent `up`s so two callers can't half-start the stack (design: "concurrent up races").
  exec 9>"$LOCK" || die "cannot open lock file $LOCK"
  flock -w 60 9 || die "another shared-browser 'up' is in progress (lock held) — try again shortly"

  preflight_deps || exit 1
  prepare_env

  local chrome_bin
  chrome_bin="$(resolve_chromium || true)"
  { [ -n "$chrome_bin" ] && [ -x "$chrome_bin" ]; } || die "Chromium not found via Playwright — run: npx playwright install chromium"

  reap_stale
  preflight_ports || die "refusing to start: a foreign process holds one of our ports (see message above)"

  STARTED=()

  # 1. Xvfb — OUR own framebuffer (gotcha #4). -nolisten tcp: no network X, local socket only.
  if ! component_running xvfb; then
    spawn xvfb Xvfb "$SB_DISPLAY" -screen 0 "$SB_GEOM" -nolisten tcp
    STARTED+=(xvfb)
    wait_for_x || err "warning: Xvfb socket $X_SOCKET not visible yet — the readiness gate will decide"
  else say "xvfb already running"; fi

  # 2. fluxbox — a minimal WM so Chromium gets a mapped, managed window (screenshots then composite).
  if ! component_running fluxbox; then spawn fluxbox fluxbox; STARTED+=(fluxbox); else say "fluxbox already running"; fi

  # 3. Chromium — headed, persistent, software-GL (gotcha #1), loopback CDP (gotcha #7).
  #    --disable-gpu --use-gl=swiftshader --in-process-gpu: no GPU in the container → software compositing,
  #    without which `page.screenshot` fails. --disable-dev-shm-usage: tiny /dev/shm in containers.
  if ! component_running chrome; then
    spawn chrome "$chrome_bin" \
      --remote-debugging-port="$SB_CDP" --remote-debugging-address=127.0.0.1 \
      --user-data-dir="$PROFILE" --no-sandbox --no-first-run --no-default-browser-check \
      --disable-gpu --use-gl=swiftshader --in-process-gpu --disable-dev-shm-usage \
      --window-position=0,0 --window-size="$WIN_W,$WIN_H" about:blank
    STARTED+=(chrome)
  else say "chrome already running"; fi

  # 4. x11vnc — mirror the Xvfb display over VNC. -localhost: loopback bind (never exposed directly).
  #    -shared: the human's input and Claude's automation act on the SAME screen at once. -forever:
  #    survives client disconnects so the human can reconnect. -nopw acceptable ONLY because it is
  #    loopback + reached solely via the user's own forwarded localhost.
  if ! component_running x11vnc; then
    spawn x11vnc x11vnc -display "$SB_DISPLAY" -rfbport "$SB_VNC" -localhost -forever -shared -nopw -noxdamage -quiet
    STARTED+=(x11vnc)
  else say "x11vnc already running"; fi

  # 5. websockify + noVNC static client — the ONLY forwarded port. Bind loopback (127.0.0.1:$SB_WEB);
  #    VS Code's port-forward reaches it over localhost. Target the loopback VNC port.
  if ! component_running websockify; then
    spawn websockify websockify --web="$SB_NOVNC_WEB" "127.0.0.1:$SB_WEB" "127.0.0.1:$SB_VNC"
    STARTED+=(websockify)
  else say "websockify already running"; fi

  # READINESS GATE — no silent half-up. On timeout: dump each log, tear down what THIS run started, fail.
  if ! readiness_gate; then
    err "readiness gate FAILED: not all of ${SB_VNC}/${SB_WEB}/${SB_CDP} came up within ${SB_READY_TIMEOUT}s"
    dump_diagnostics
    teardown_started
    die "shared-browser up failed — torn down what this run started (clean slate for the next up)"
  fi

  # 6. Recorder — auto-start once CDP is live (so connectOverCDP succeeds). Streams events to JSONL.
  if ! component_running recorder; then spawn recorder node "$RECORDER"; STARTED+=(recorder); else say "recorder already running"; fi

  ok "shared-browser is UP."
  printf '  noVNC (open this in your browser): %s\n' "$NOVNC_URL"
  printf '  CDP (loopback — do NOT forward):   %s\n' "$CDP_URL"
}

cmd_down() {
  ensure_dirs
  local comp entry port rc=0 still=()

  # Kill exactly this stack, by PID file, in reverse dependency order. Never pattern-kill.
  for comp in "${TEARDOWN_ORDER[@]}"; do kill_component "$comp"; done

  # VERIFY the ports are actually free (a kill is async; freed ≠ signalled). Reclaim any OUR leftover
  # still on a port (e.g. a prior instance whose PID file was lost); a FOREIGN holder is reported, not killed.
  for entry in "chrome:$SB_CDP" "x11vnc:$SB_VNC" "websockify:$SB_WEB"; do
    comp="${entry%%:*}"; port="${entry##*:}"
    if port_listening "$port"; then reclaim_port_if_ours "$port" "$(component_sig "$comp")" || rc=1; fi
  done

  for port in "$SB_VNC" "$SB_WEB" "$SB_CDP"; do port_listening "$port" && still+=("$port"); done
  if [ "${#still[@]}" -ne 0 ]; then err "after down, still listening: ${still[*]}"; return 1; fi

  ok "shared-browser is DOWN (ports ${SB_VNC}/${SB_WEB}/${SB_CDP} free)."
  return "$rc"
}

cmd_restart() { cmd_down || true; cmd_up; }

cmd_navigate() {
  local a url="" wait=0
  for a in "$@"; do
    case "$a" in
      --url=*) url="${a#--url=}" ;;
      --wait)  wait=1 ;;
      *)       die "navigate: unknown argument '$a' (usage: navigate --url=<u> [--wait])" ;;
    esac
  done
  [ -n "$url" ] || die "navigate: --url=<u> is required"

  cmd_up                                                   # ensure the stack is up (idempotent)

  if [ "$wait" -eq 1 ]; then
    say "waiting for $url to answer (timeout ${SB_WAIT_TIMEOUT}s)…"
    if ! wait_for_url "$url"; then
      # NON-FATAL by design: `serve-with-shared-browser` runs this navigate in a parallel run-commands
      # alongside `serve`. A non-zero exit here would tear down the co-served `serve`. So when the app
      # never comes up, WARN and leave the browser running — exit 0. Only a genuine hard failure (stack
      # failing to come `up`, above) is fatal.
      err "app not reachable after ${SB_WAIT_TIMEOUT}s — leaving the browser up; navigate manually when ready"
      err "  (open $NOVNC_URL, or re-run: shared-browser navigate --url=$url once the app is serving)"
      return 0
    fi
  fi

  say "navigating the shared browser → $url"
  navigate_cdp "$url" || die "navigation failed (is the app serving? see: shared-browser logs chrome)"
  ok "navigated to $url  —  watch it at $NOVNC_URL"
}

# Poll the app URL until it answers with ANY HTTP status (even 4xx = the server is up). "000" = no response.
wait_for_url() {
  local url="$1" code deadline=$(( $(date +%s) + SB_WAIT_TIMEOUT ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "$url" 2>/dev/null || echo 000)"
    [ -n "$code" ] && [ "$code" != "000" ] && return 0
    sleep 0.5
  done
  return 1
}

# Drive the shared browser to <url> over CDP. Params are passed as a REAL env prefix (gotcha #6: never a
# NAME=val positional after `node -e`, which becomes an arg, not an env var). connectOverCDP → goto → close.
# browser.close() only DETACHES the CDP session; the shared browser (and the human's session) stays up.
navigate_cdp() {
  ( cd "$WORKSPACE_ROOT" && SB_NAV_URL="$1" SB_CDP_URL="$CDP_URL" SB_NAV_TIMEOUT_MS="$SB_NAV_TIMEOUT_MS" node - ) <<'NODE'
const requireFirst = (mods) => {
  for (const m of mods) { try { return require(m); } catch (e) {} }
  throw new Error('Playwright not found (tried playwright / playwright-core / @playwright/test)');
};
const { chromium } = requireFirst(['playwright', 'playwright-core', '@playwright/test']);
const url = process.env.SB_NAV_URL;
const cdp = process.env.SB_CDP_URL;
const timeout = Number(process.env.SB_NAV_TIMEOUT_MS) || 30000;
(async () => {
  const browser = await chromium.connectOverCDP(cdp, { timeout });
  try {
    const ctx = browser.contexts()[0] || (await browser.newContext());
    const page = ctx.pages()[0] || (await ctx.newPage());
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    await page.bringToFront().catch(() => {});
  } finally {
    await browser.close();               // detaches only — the shared browser keeps running
  }
})().catch((e) => { console.error(String((e && e.stack) || e)); process.exit(1); });
NODE
}

cmd_status() {
  local json=0
  [ "${1:-}" = "--json" ] && json=1

  local vnc web cdp up comp state first
  port_listening "$SB_VNC" && vnc=true || vnc=false
  port_listening "$SB_WEB" && web=true || web=false
  port_listening "$SB_CDP" && cdp=true || cdp=false
  up=false
  { [ "$vnc" = true ] && [ "$web" = true ] && [ "$cdp" = true ]; } && up=true

  if [ "$json" -eq 1 ]; then
    printf '{'
    printf '"up":%s,' "$up"
    printf '"ports":{"vnc":%s,"web":%s,"cdp":%s},' "$vnc" "$web" "$cdp"
    printf '"components":{'
    first=1
    for comp in "${START_ORDER[@]}" recorder; do
      component_running "$comp" && state=true || state=false
      [ "$first" -eq 1 ] || printf ','
      printf '"%s":%s' "$comp" "$state"
      first=0
    done
    printf '},'
    printf '"cdp":"%s",' "$CDP_URL"
    printf '"url":"%s"' "$NOVNC_URL"
    printf '}\n'
  else
    printf 'shared-browser status: %s\n' "$([ "$up" = true ] && echo UP || echo DOWN)"
    for comp in "${START_ORDER[@]}" recorder; do
      component_running "$comp" && state='up' || state='down'
      printf '  %-11s %s\n' "$comp" "$state"
    done
    printf '  %-11s %s (port %s)\n' 'vnc'  "$([ "$vnc" = true ] && echo listening || echo -)" "$SB_VNC"
    printf '  %-11s %s (port %s)\n' 'web'  "$([ "$web" = true ] && echo listening || echo -)" "$SB_WEB"
    printf '  %-11s %s (port %s)\n' 'cdp'  "$([ "$cdp" = true ] && echo listening || echo -)" "$SB_CDP"
    printf '  %-11s %s\n' 'url' "$NOVNC_URL"
    printf '  %-11s %s\n' 'cdp-url' "$CDP_URL"
  fi
}

cmd_url() { printf '%s\n' "$NOVNC_URL"; }

cmd_logs() {
  local a comp="" since="" level=""
  for a in "$@"; do
    case "$a" in
      --since=*) since="${a#--since=}" ;;
      --level=*) level="${a#--level=}" ;;
      --*)       die "logs: unknown option '$a'" ;;
      *)         comp="$a" ;;
    esac
  done
  case "$comp" in
    ""|events|recorder)
      [ -f "$EVENTS" ] || die "no recorder events yet ($EVENTS) — is the stack up?"
      filter_events "$since" "$level"
      ;;
    xvfb|fluxbox|chrome|x11vnc|websockify)
      local lf; lf="$(log_file "$comp")"
      [ -f "$lf" ] || die "no log for '$comp' ($lf)"
      tail -n "$SB_LOG_TAIL" "$lf"
      ;;
    *)
      die "logs: unknown component '$comp' (choose: xvfb|fluxbox|chrome|x11vnc|websockify|recorder)"
      ;;
  esac
}

# Filter the recorder JSONL by --since (ISO-8601 or epoch s/ms) and --level. Done in Node so a partly-
# written trailing line can't break us and timestamp/level fields are parsed, not regex-scraped.
# ASSUMPTION (verify against recorder.mjs): each line carries a timestamp in `ts`|`time`|`timestamp`
# (ISO string or epoch) and a `level` field. Lines without the fields pass the corresponding filter.
filter_events() {
  SB_EVENTS="$EVENTS" SB_SINCE="${1:-}" SB_LEVEL="${2:-}" node - <<'NODE'
const fs = require('fs');
const file = process.env.SB_EVENTS;
const sinceRaw = process.env.SB_SINCE || '';
let level = (process.env.SB_LEVEL || '').toLowerCase();
if (level === 'warn') level = 'warning';                                        // Playwright uses `warning`, not `warn`
const toMs = (v) => {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'number') return String(v).length >= 13 ? v : v * 1000;      // 13 digits ≈ epoch ms
  if (/^\d+$/.test(v)) { const n = Number(v); return String(v).length >= 13 ? n : n * 1000; }
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
};
const since = toMs(sinceRaw);
const rl = require('readline').createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let o;
  try { o = JSON.parse(line); }
  catch (e) { if (since === null && !level) process.stdout.write(line + '\n'); return; }
  if (since !== null) {
    const ms = toMs(o.ts || o.time || o.timestamp);
    if (ms !== null && !(ms >= since)) return;                                   // has a ts and it's older → drop
  }
  if (level) {
    // --level matches the `level` field the recorder now stamps on EVERY event (shared spec):
    //   console → its own level (Playwright's `warning`, not `warn`); pageerror → error;
    //   requestfailed → error; response → error (>=500) / warning (>=400) / info; navigation → info.
    // So `--level=error` surfaces uncaught exceptions + failed requests + 5xx, not only console.error.
    // A user-supplied `warn` was normalized to `warning` above. A line lacking `level` is filtered out.
    if (String(o.level || '').toLowerCase() !== level) return;
  }
  process.stdout.write(line + '\n');
});
NODE
}

cmd_clean() {
  cmd_down || true                                        # stop the stack first, so we don't wipe a live profile
  rm -rf "$PROFILE" "$LOGS"
  rm -f "$SB_RUNTIME"/*.pid
  ensure_dirs
  ok "cleaned: profile + logs + screenshots wiped ($SB_RUNTIME)."
}

usage() {
  cat <<EOF
shared-browser — a browser a human and Claude drive together (in-container).

USAGE
  shared-browser up                              start missing components, readiness-gate, auto-start recorder, print noVNC URL
  shared-browser navigate --url=<u> [--wait]     ensure up; (optionally wait for <u>); drive the shared browser to it via CDP
  shared-browser status [--json]                 per-component up/down + ports + URL (machine-readable with --json)
  shared-browser url                             print the noVNC URL (for scripting)
  shared-browser logs [component] [--since=<ts>] [--level=<lvl>]
                                                 tail a component log (xvfb|fluxbox|chrome|x11vnc|websockify),
                                                 or the recorder events.jsonl (default; filter by --since/--level)
  shared-browser down                            stop exactly this stack (PID files), verify ports freed
  shared-browser restart                         down + up
  shared-browser clean                           wipe profile + logs + screenshots

Human opens:  $NOVNC_URL
Claude drives (loopback, never forward):  $CDP_URL
Env overrides: SB_DISPLAY SB_GEOM SB_VNC SB_WEB SB_CDP SB_RUNTIME (see the top of this script).
EOF
}

# ── Dispatch ───────────────────────────────────────────────────────────────────────────────────────────
main() {
  local verb="${1:-}"; [ "$#" -gt 0 ] && shift
  case "$verb" in
    up)                 cmd_up "$@" ;;
    navigate)           cmd_navigate "$@" ;;
    status)             cmd_status "$@" ;;
    url)                cmd_url ;;
    logs)               cmd_logs "$@" ;;
    down)               cmd_down "$@" ;;
    restart)            cmd_restart "$@" ;;
    clean)              cmd_clean "$@" ;;
    ""|-h|--help|help)  usage ;;
    *)                  err "unknown verb: $verb"; usage; exit 2 ;;
  esac
}
main "$@"
