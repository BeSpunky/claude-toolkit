#!/usr/bin/env bash
# shared-browser — one browser a human and Claude drive together, entirely inside the devcontainer.
#
#   Human  → the noVNC URL this script PRINTS  (the ONLY host-facing port — ALLOCATED, never assumed)
#   Claude → http://127.0.0.1:${SB_CDP}   (CDP, loopback ONLY — full remote control, never forward)
#
# The stack (each a black box over the one below):
#   Xvfb :99  ─ fluxbox WM ─ Chromium (persistent, CDP loopback) ─ x11vnc (:5900) ─ websockify/noVNC (allocated)
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
SB_CDP="${SB_CDP:-9223}"                                   # Chromium DevTools port (loopback ONLY)

# ── The noVNC port: the ONE host-facing port, and therefore the ONE that is ALLOCATED ────────────────
# VNC and CDP are loopback-only, so they live in this container's own netns and can never collide with
# another container. The noVNC port is different: it is forwarded to the HOST, where every devcontainer
# on this machine competes for the same number. A fixed 6080 doesn't fail loudly there — `up` succeeds
# in BOTH containers (each netns has its own free 6080), the editor silently forwards the second one to
# a different HOST port, and the URL we printed then points at the OTHER container's browser. Silent
# wrong-target, no error anywhere. So the port is allocated out of a band, claimed in a registry shared
# by every container on this Docker engine, and the URL is DERIVED from what we actually got.
#
# SB_WEB may still be set explicitly as an escape hatch — an explicit pin skips allocation entirely.
SB_WEB_PIN="${SB_WEB:-}"                                   # explicit pin (env) — bypasses allocation
SB_WEB=""                                                  # resolved by resolve_web_port (never assume)
# The band is INJECTED by the generator from src/generators/shared-browser/novnc-band.ts — the same
# module that emits devcontainer.json's per-port `requireLocalPort` entries. Never edit these numbers
# here: a port this script can pick but devcontainer.json doesn't cover is a port that fails SILENTLY.
SB_WEB_BAND_START="${SB_WEB_BAND_START:-{{novncBandStart}}}"
SB_WEB_BAND_SIZE="${SB_WEB_BAND_SIZE:-{{novncBandSize}}}"
# The cross-container registry. A FIXED-NAME docker volume mounted by every BeSpunky devcontainer, so
# its scope is exactly the collision scope: one Docker engine = one host = one set of host ports.
SB_REGISTRY="${SB_REGISTRY:-/var/opt/bespunky/ports}"
SB_CLAIM_TTL="${SB_CLAIM_TTL:-604800}"                     # seconds (7d) before an unrefreshed claim recycles
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
NOVNC_URL=""                                               # derived from the ALLOCATED port (resolve_web_port)
SB_WEB_ALLOCATED=false                                     # true only when the port is a REAL allocation, not a guess

PROFILE="$SB_RUNTIME/profile"                              # Chromium --user-data-dir (fresh by default)
LOGS="$SB_RUNTIME/logs"
SHOTS="$LOGS/screenshots"                                  # verify.mjs writes before/after PNGs here
EVENTS="$LOGS/events.jsonl"                                # recorder stream
LOCK="$SB_RUNTIME/up.lock"
WEBROOT="$SB_RUNTIME/novnc-web"                             # noVNC static client + our identity token
HOST_VERIFIED_FILE="$SB_RUNTIME/host-verified"             # result of the last host round-trip check
OBSERVE="$SB_RUNTIME/observe-only"                         # presence = observe-only (human is driving; attach/verify/navigate refuse to drive)
PORT_FILE="$SB_RUNTIME/web.port"                           # the allocated noVNC port — so every later verb agrees with the RUNNING stack

# Where the sibling helpers live, and the workspace root (for Node module resolution — gotcha #3).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RECORDER="$SCRIPT_DIR/recorder.mjs"
PORT_CLAIM="$SCRIPT_DIR/port-claim.mjs"                    # host-port arbitration (see its header for why not bash)
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/../.." 2>/dev/null && pwd || echo "$SCRIPT_DIR")"

# The identity the human SEES. noVNC titles the browser tab from the VNC desktop name, so stamping the
# workspace here defends every residual wrong-target case at once — a dismissed remap prompt, a squatter
# no gate could see, a second Docker engine, a port typed from memory, a stale bookmark. Ports are
# something you have to reason about; a tab that says the wrong project name is something you SEE.
SB_DESKTOP_NAME="${SB_DESKTOP_NAME:-$(basename "$WORKSPACE_ROOT") (shared browser)}"

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

# observe-only: a lock file in SB_RUNTIME. While present, the human is driving over noVNC and every
# automated driver (this CLI's navigate, and attach.mjs/verify.mjs) REFUSES to navigate/click/type — so
# Claude can yield the shared window for interactive steps (OAuth, a captcha) and resume afterwards.
observe_active() { [ -f "$OBSERVE" ]; }

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

# ── noVNC port allocation: the port is a RESULT, never a constant ─────────────────────────────────────
# The ARBITRATION lives in tools/shared-browser/port-claim.mjs, not here. That split is deliberate: bash
# is the right material for process supervision (ss, /proc, setsid, PID lifecycle) and the wrong material
# for a registry with ownership, expiry and atomicity — the bash version needed an flock and, on lock
# timeout, proceeded UNLOCKED, leaving a real double-booking race. Node's `open(path,'wx')` removes the
# race by construction, and the algorithm is covered by port-claim.test.mjs (including a genuine
# multi-process race), which a bash implementation could not be.
#
# What stays here is what only this script can know: WHICH PORT IS LIVE right now.

# The identity that owns a claim. It must name the DEV CONTAINER — not the tree, and not the container
# instance:
#   · not the tree, because there is exactly one shared browser per container (SB_RUNTIME is
#     container-scoped, so every worktree drives the same stack) — a per-tree identity would let a
#     worktree's `up` allocate a SECOND port for a browser that already exists;
#   · not the container INSTANCE, because a rebuild is the same dev container to its user. Keying on the
#     hostname (Docker's per-instance id) would burn a fresh band slot on every rebuild and orphan the
#     previous claim for a full TTL, while the "bookmarkable URL" promise quietly stops holding.
# ${devcontainerId} is the platform's own answer: "unique to the dev container ... and stable across
# rebuilds" (containers.dev JSON reference), exactly the lifetime a port reservation wants. The
# devcontainer generator passes it in as BESPUNKY_DEVCONTAINER_ID.
container_key() {
  if [ -n "${BESPUNKY_DEVCONTAINER_ID:-}" ]; then printf 'dc:%s' "$BESPUNKY_DEVCONTAINER_ID"; return 0; fi
  # FALLBACK for a container not built by the house generator (or one predating this): the git COMMON
  # dir — identical for the main tree and all its worktrees — plus the hostname. Correct, but the
  # hostname is the container instance, so the slot churns on rebuild. `status` reports the mode.
  local common root=""
  common="$(cd "$WORKSPACE_ROOT" 2>/dev/null && git rev-parse --git-common-dir 2>/dev/null || true)"
  [ -n "$common" ] && root="$(cd "$WORKSPACE_ROOT" 2>/dev/null && cd "$common" 2>/dev/null && pwd || true)"
  [ -n "$root" ] || root="$WORKSPACE_ROOT"
  printf '%s@%s' "$root" "$(cat /etc/hostname 2>/dev/null || echo unknown)"
}

# A port is a number in range — anything else (empty, partial write, junk env) is NOT a port. Without
# this a corrupt web.port or `SB_WEB=abc` produced invalid JSON on the documented machine interface.
valid_port() { case "${1:-}" in ''|*[!0-9]*) return 1 ;; esac; [ "$1" -ge 1 ] && [ "$1" -le 65535 ]; }

# The host as seen from inside: host.docker.internal when the runtime provides it (Docker Desktop, or
# --add-host=host-gateway), else the default route. Empty = we cannot see the host at all.
host_gateway() {
  if getent hosts host.docker.internal >/dev/null 2>&1; then printf 'host.docker.internal'; return 0; fi
  ip route 2>/dev/null | awk '/^default/{print $3; exit}'
}

# The registry is a MOUNT POINT the devcontainer provides — never created here (a directory we made
# ourselves would be container-local, so it would look usable while giving zero cross-container
# guarantee). Used for reporting; port-claim.mjs makes its own determination for the real decisions.
registry_ok() { [ -d "$SB_REGISTRY" ] && [ -w "$SB_REGISTRY" ]; }

# The port the RUNNING websockify actually bound, read from the process itself — the only source that
# can answer "which port reaches the browser the human is watching".
live_web_port() {
  local pid cmd p=""
  component_running websockify || return 1
  pid="$(cat "$(pid_file websockify)" 2>/dev/null || true)"
  [ -n "$pid" ] || return 1
  # Our spawn form is `websockify --web=<dir> 127.0.0.1:<web> 127.0.0.1:<vnc>` — the FIRST bound address
  # is the web port. We own that spawn (see cmd_up), so its argument order is ours to rely on.
  cmd="$(proc_cmdline "$pid" 2>/dev/null || true)"
  [ -n "$cmd" ] && p="$(printf '%s' "$cmd" | grep -oE '127\.0\.0\.1:[0-9]+' | head -n1 | cut -d: -f2)"
  # Fall back to the kernel's own view if the cmdline isn't parseable.
  valid_port "$p" || p="$(ss -ltnp 2>/dev/null | awk -v r="pid=$pid[,)]" '$0 ~ r {n=split($4,a,":"); print a[n]; exit}')"
  valid_port "$p" || return 1
  printf '%s' "$p"
}

# Run a port-claim verb. Prints its JSON on stdout; non-zero means the arbiter refused (and its JSON
# carries `.error`). Kept to ONE place so every call site passes the same identity/registry/band.
claim_cli() {
  local verb="$1"; shift
  node "$PORT_CLAIM" "$verb" \
    --registry="$SB_REGISTRY" --identity="$(container_key)" \
    --band-start="$SB_WEB_BAND_START" --band-size="$SB_WEB_BAND_SIZE" \
    --ttl="$SB_CLAIM_TTL" --gateway="$(host_gateway)" "$@"
}
# Pull one field out of the arbiter's JSON without assuming a JSON parser is on PATH.
claim_field() { printf '%s' "$1" | sed -n "s/.*\"$2\":\([^,}]*\).*/\1/p" | tr -d '"'; }

# Give the port back. Called only by `clean` — NOT by `down`, because a claim is this container's
# reservation, not the running stack's: keeping it across down/up is what makes the URL stable.
release_web_port() {
  valid_port "$SB_WEB" || return 0
  claim_cli release --port="$SB_WEB" >/dev/null 2>&1 || true
  rm -f "$PORT_FILE"
}

# Resolve SB_WEB (and the URL derived from it). Mode `allocate` (only `up`) may claim a port; every other
# verb READS, so `status`/`url`/`down` always describe the stack that is actually running.
resolve_web_port() {
  local mode="${1:-read}" port="" live="" rec="" out=""

  # THE LIVE LISTENER OUTRANKS EVERY RECORD AND EVERY PREFERENCE. "The port we allocated" and "the port
  # that is live" are different facts, and conflating them was a real bug with a real trigger: on the
  # upgrade path a `--repair` rewrites this script while a stack from the old fixed-port version is still
  # up, so there is a live websockify and NO recorded port. Trusting the record then allocated a SECOND
  # port, skipped spawning websockify ("already running"), failed the readiness gate — and left `url`
  # printing a port nothing was ever bound to, with exit 0. Asking the listener cannot be wrong.
  live="$(live_web_port || true)"

  if [ -n "$live" ]; then
    port="$live"
    if [ -n "$SB_WEB_PIN" ] && [ "$SB_WEB_PIN" != "$live" ]; then
      err "NOTE: SB_WEB=$SB_WEB_PIN ignored — a shared browser is already live on :$live."
      err "      To move it: shared-browser down && SB_WEB=$SB_WEB_PIN shared-browser up"
    fi
    # Self-heal the record so every later shell's `url`/`status`/`down` agrees with reality.
    if [ "$(cat "$PORT_FILE" 2>/dev/null || true)" != "$port" ]; then
      ensure_dirs; printf '%s' "$port" > "$PORT_FILE"
    fi
  elif [ -n "$SB_WEB_PIN" ]; then
    valid_port "$SB_WEB_PIN" || die "SB_WEB must be a port number in 1..65535 (got '$SB_WEB_PIN')."
    port="$SB_WEB_PIN"                                     # explicit pin — skips the SEARCH, not the claim
  else
    rec="$(cat "$PORT_FILE" 2>/dev/null || true)"          # a corrupt/partial record is NOT a port
    valid_port "$rec" && port="$rec"
  fi

  if [ -z "$port" ] && [ "$mode" = allocate ]; then
    ensure_dirs
    rec="$(cat "$PORT_FILE" 2>/dev/null || true)"; valid_port "$rec" || rec=0
    out="$(claim_cli allocate --recorded="$rec" --live="${live:-0}" 2>/dev/null || true)"
    port="$(claim_field "$out" port)"
    valid_port "$port" || die "could not allocate a noVNC port: ${out:-no response from port-claim.mjs}"
    printf '%s' "$port" > "$PORT_FILE"
  fi

  # Refresh the claim's TTL on EVERY `up`, not only when we allocated — otherwise a container that simply
  # keeps running (idempotent re-ups reuse the live port and skip allocation) would let its own claim age
  # out and become fair game. `up` runs on every `nx serve`, so "recently touched" is a real liveness
  # signal; that is what lets a deleted container's port recycle with no cleanup step. The arbiter
  # refuses to overwrite a claim that legitimately belongs to somebody else, and reports it.
  if [ "$mode" = allocate ] && valid_port "$port"; then
    out="$(claim_cli refresh --port="$port" 2>/dev/null || true)"
    if [ "$(claim_field "$out" conflict)" = "true" ]; then
      err "WARNING: noVNC port $port is CLAIMED BY ANOTHER container ($(claim_field "$out" owner)) — your"
      err "         viewer URL may open their browser. Run \`shared-browser clean\` to re-allocate."
    fi
  fi

  # No allocation yet (nothing has ever come up here) → there is NO port, and we say so rather than
  # inventing a plausible one. A speculative port that leaves this script looking real is the same
  # silent-wrong-URL failure in a new costume; `url` refuses, `status` prints "none yet".
  SB_WEB_ALLOCATED=true
  if ! valid_port "$port"; then port=0; SB_WEB_ALLOCATED=false; fi

  SB_WEB="$port"
  if [ "$SB_WEB_ALLOCATED" = true ]; then
    NOVNC_URL="http://localhost:${SB_WEB}/vnc.html?autoconnect=true&resize=scale&reconnect=true&show_dot=true"
  else
    NOVNC_URL=""
  fi
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
  for bin in Xvfb fluxbox x11vnc websockify node ss curl setsid flock timeout; do
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
  resolve_web_port allocate                                # decide the ONE host-facing port before anything binds

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
    #    -desktop: the RFB desktop name, which noVNC turns into the browser tab's title — see
    #    SB_DESKTOP_NAME above for why that matters more than it looks.
    spawn x11vnc x11vnc -display "$SB_DISPLAY" -rfbport "$SB_VNC" -desktop "$SB_DESKTOP_NAME" \
      -localhost -forever -shared -nopw -noxdamage -quiet
    STARTED+=(x11vnc)
  else say "x11vnc already running"; fi

  # 5. websockify + noVNC static client — the ONE host-facing port, on the ALLOCATED number. Bind
  #    loopback (127.0.0.1:$SB_WEB); the editor auto-forwards it. Because allocation already proved the
  #    number free on the host, the forward lands on the SAME number — which is what makes the URL we
  #    print below true on the host rather than a guess. Target the loopback VNC port.
  if ! component_running websockify; then
    # noVNC (the apt package) ships NO index.html, so a bare http://localhost:$SB_WEB/ — exactly what VS
    # Code's forwarded-port "open in browser" gives you — renders a directory listing instead of the
    # client. Serve from a runtime web root that mirrors the noVNC assets and adds an index.html that
    # redirects to vnc.html WITH the autoconnect params, so however the port is opened it lands live.
    if [ ! -e "$WEBROOT/vnc.html" ]; then
      mkdir -p "$WEBROOT"
      cp -r "$SB_NOVNC_WEB"/. "$WEBROOT"/ 2>/dev/null || true
    fi
    printf '<!doctype html><title>%s</title><meta http-equiv="refresh" content="0; url=vnc.html?autoconnect=true&resize=scale&reconnect=true&show_dot=true">\n' \
      "$SB_DESKTOP_NAME" > "$WEBROOT/index.html"
    spawn websockify websockify --web="$WEBROOT" "127.0.0.1:$SB_WEB" "127.0.0.1:$SB_VNC"
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
  # The editor discovers a new listener by polling /proc (≥2s, longer on a loaded container), so for a
  # moment after this line the URL is correct but not yet forwarded. Say so — otherwise the first click
  # gets connection-refused and reads as "the shared browser is broken".
  printf '    (the editor forwards it a moment after this line — if the first click is refused, retry once)\n'
  printf '    the tab is titled "%s" — if it names another project, you are on the wrong container\n' "$SB_DESKTOP_NAME"

  # Prove the mapping rather than assuming it (see verify_host_mapping).
  verify_host_mapping
  case "$(host_verified)" in
    true)  printf '    host mapping VERIFIED — :%s on the host reaches this browser\n' "$SB_WEB" ;;
    false) err "ALERT: host port $SB_WEB answers, but NOT with this browser — something else holds it."
           err "       Do NOT trust the URL above. Run: shared-browser clean && shared-browser up" ;;
    *)     printf '    host mapping unverified (no route to the host from here) — the tab title is your check\n' ;;
  esac
  printf '  CDP (loopback — do NOT forward):   %s\n' "$CDP_URL"

  # This change exists because a silent fallback handed people the wrong browser. So when a gate that
  # protects the host port is UNAVAILABLE, say it here — at the moment the URL is handed over — not only
  # in a provisioning log nobody re-reads. The most likely cause is a container that predates the
  # registry mount, which is exactly when a neighbour can still be squatting the port we just took.
  if ! registry_ok; then
    err "NOTE: allocated WITHOUT the cross-container registry ($SB_REGISTRY not mounted/writable)."
    err "      Parallel devcontainers cannot see each other's claims, so this URL is unverified against"
    err "      them. Rebuild this devcontainer to mount it. If the viewer shows ANOTHER project's app,"
    err "      that is why."
  fi
  if [ -z "$(host_gateway)" ]; then
    err "NOTE: no route to the host (host.docker.internal / default gateway) — the host-side port check"
    err "      was skipped, so a non-devcontainer process on the host could hold this port."
  fi
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

  # observe-only: the human is driving — do NOT steal the window. Non-fatal (return 0) so a co-served
  # `serve` isn't torn down; the human navigates manually, or Claude runs `resume` then re-navigates.
  if observe_active; then
    err "observe-only — human is driving; skipping navigate to $url (run: shared-browser resume)"
    return 0
  fi

  cmd_up                                                   # ensure the stack is up (idempotent)

  if [ "$wait" -eq 1 ]; then
    say "waiting for $url to answer (timeout ${SB_WAIT_TIMEOUT}s)…"
    if ! wait_for_url "$url"; then
      # NON-FATAL by design: the `serve` target's shared-browser layer runs this navigate in a parallel run-commands
      # alongside the app dev-server. A non-zero exit here would tear down the co-served dev-server. So when the app
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

# POSITIVE proof that the host port actually reaches THIS browser.
#
# Everything before this point is inference: we allocated a port nobody else claimed, so the editor
# *should* have forwarded it one-to-one. Inference is what produced the original bug. This closes the
# loop: write a random token into the noVNC webroot, then fetch it back THROUGH THE HOST. Getting our own
# token back is proof; getting someone else's content back is a caught wrong-target (loud, not silent);
# not reaching the host at all is honestly reported as unverified rather than assumed good.
#
# Writes true|false|unknown to HOST_VERIFIED_FILE so `status` can report it without re-probing.
verify_host_mapping() {
  local gw token got
  gw="$(host_gateway)"
  if [ -z "$gw" ] || ! valid_port "$SB_WEB"; then printf 'unknown' > "$HOST_VERIFIED_FILE"; return 0; fi
  token="sb-$$-$(date +%s)-${RANDOM}${RANDOM}"
  mkdir -p "$WEBROOT"
  printf '%s' "$token" > "$WEBROOT/.sb-identity"
  got="$(curl -s --max-time 3 "http://$gw:$SB_WEB/.sb-identity" 2>/dev/null || true)"
  if [ "$got" = "$token" ]; then
    printf 'true' > "$HOST_VERIFIED_FILE"
  elif [ -z "$got" ]; then
    printf 'unknown' > "$HOST_VERIFIED_FILE"                # host unreachable from here — say so, don't guess
  else
    printf 'false' > "$HOST_VERIFIED_FILE"                  # SOMETHING ELSE answers there
  fi
}
host_verified() { cat "$HOST_VERIFIED_FILE" 2>/dev/null || printf 'unknown'; }

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

  local vnc web cdp up comp state first observe
  port_listening "$SB_VNC" && vnc=true || vnc=false
  port_listening "$SB_WEB" && web=true || web=false
  port_listening "$SB_CDP" && cdp=true || cdp=false
  up=false
  { [ "$vnc" = true ] && [ "$web" = true ] && [ "$cdp" = true ]; } && up=true
  observe_active && observe=true || observe=false

  if [ "$json" -eq 1 ]; then
    printf '{'
    printf '"up":%s,' "$up"
    printf '"observeOnly":%s,' "$observe"
    printf '"ports":{"vnc":%s,"web":%s,"cdp":%s},' "$vnc" "$web" "$cdp"
    printf '"webPort":%s,' "$SB_WEB"
    printf '"webPortAllocated":%s,' "$SB_WEB_ALLOCATED"
    # Which allocation gates were actually available — the difference between a VERIFIED port and an
    # educated guess. A caller that only reads `url` cannot tell; these two say it out loud.
    printf '"registry":%s,' "$(registry_ok && echo true || echo false)"
    printf '"hostProbe":%s,' "$([ -n "$(host_gateway)" ] && echo true || echo false)"
    printf '"stableIdentity":%s,' "$([ -n "${BESPUNKY_DEVCONTAINER_ID:-}" ] && echo true || echo false)"
    printf '"hostVerified":"%s",' "$(host_verified)"
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
    # null, not a string: `url` refuses to print a speculative URL, so the machine surface must not hand
    # one over either. A caller reading .url gets a falsy value in exactly the state cmd_url errors in.
    if [ "$SB_WEB_ALLOCATED" = true ]; then printf '"url":"%s"' "$NOVNC_URL"; else printf '"url":null'; fi
    printf '}\n'
  else
    printf 'shared-browser status: %s\n' "$([ "$up" = true ] && echo UP || echo DOWN)"
    printf '  %-11s %s\n' 'mode' "$([ "$observe" = true ] && echo 'observe-only (human is driving)' || echo 'co-drive (automation may drive)')"
    for comp in "${START_ORDER[@]}" recorder; do
      component_running "$comp" && state='up' || state='down'
      printf '  %-11s %s\n' "$comp" "$state"
    done
    printf '  %-11s %s (port %s)\n' 'vnc'  "$([ "$vnc" = true ] && echo listening || echo -)" "$SB_VNC"
    printf '  %-11s %s (port %s)\n' 'web'  "$([ "$web" = true ] && echo listening || echo -)" "$([ "$SB_WEB_ALLOCATED" = true ] && printf '%s' "$SB_WEB" || printf 'unallocated')"
    printf '  %-11s %s (port %s)\n' 'cdp'  "$([ "$cdp" = true ] && echo listening || echo -)" "$SB_CDP"
    printf '  %-11s %s\n' 'url' "$([ "$SB_WEB_ALLOCATED" = true ] && printf '%s' "$NOVNC_URL" || printf 'none yet — run `up` to allocate one')"
    printf '  %-11s %s\n' 'cdp-url' "$CDP_URL"
    printf '  %-11s registry=%s host-probe=%s (band %s..%s)\n' 'allocation' \
      "$(registry_ok && echo yes || echo 'NO — parallel containers are invisible to each other')" \
      "$([ -n "$(host_gateway)" ] && echo yes || echo no)" \
      "$SB_WEB_BAND_START" "$(( SB_WEB_BAND_START + SB_WEB_BAND_SIZE - 1 ))"
  fi
}

# The single source of truth for the human's URL — and therefore the place that must NOT guess. Before
# the first `up` there is no allocation, so there is no URL: say so and fail, rather than print a
# plausible one that may belong to another container.
cmd_url() {
  [ "$SB_WEB_ALLOCATED" = true ] || die "no noVNC port allocated yet — run: shared-browser up"
  printf '%s\n' "$NOVNC_URL"
}

# Hand the shared window to the human: set the observe-only lock so every automated driver stands down.
cmd_observe() {
  ensure_dirs
  printf 'observe-only set at %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$OBSERVE"
  ok "observe-only ON — human is driving; automation will not navigate/click/type."
  # `observe` is legal on a DOWN stack, where the port is not allocated yet — so this must not print a
  # speculative URL (same rule as cmd_url). Nothing about a guess may leave this script looking real.
  if [ "$SB_WEB_ALLOCATED" = true ]; then ok "  watch at $NOVNC_URL"
  else ok "  (no browser up yet — run \`shared-browser up\`, then \`url\` for the viewer link)"; fi
  ok "  hand back with: shared-browser resume"
}

# Take the shared window back: clear the observe-only lock so automation may drive again.
cmd_resume() {
  rm -f "$OBSERVE"
  ok "observe-only OFF — automation may drive the shared browser again."
}

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
  release_web_port                                        # a full reset gives the port back; the next `up` re-allocates
  ensure_dirs
  ok "cleaned: profile + logs + screenshots wiped, noVNC port released ($SB_RUNTIME)."
}

usage() {
  cat <<EOF
shared-browser — a browser a human and Claude drive together (in-container).

USAGE
  shared-browser up                              start missing components, readiness-gate, auto-start recorder, print noVNC URL
  shared-browser navigate --url=<u> [--wait]     ensure up; (optionally wait for <u>); drive the shared browser to it via CDP
  shared-browser observe                         hand the shared window to the human — automation stands down (no navigate/click/type)
  shared-browser resume                          take the window back — automation may drive again
  shared-browser status [--json]                 per-component up/down + ports + observe-only mode + URL (machine-readable with --json)
  shared-browser url                             print the noVNC URL (for scripting) — the ONE source of truth for it
  shared-browser logs [component] [--since=<ts>] [--level=<lvl>]
                                                 tail a component log (xvfb|fluxbox|chrome|x11vnc|websockify),
                                                 or the recorder events.jsonl (default; filter by --since/--level)
  shared-browser down                            stop exactly this stack (PID files), verify ports freed
  shared-browser restart                         down + up
  shared-browser clean                           wipe profile + logs + screenshots

Human opens:  the URL from \`shared-browser url\` (allocated at \`up\` — never compose it)
Claude drives (loopback, never forward):  $CDP_URL

The noVNC port is ALLOCATED (band ${SB_WEB_BAND_START}..$(( SB_WEB_BAND_START + SB_WEB_BAND_SIZE - 1 )), claimed in $SB_REGISTRY), so parallel
devcontainers never contend for one host port. Never hardcode it — read it from \`url\` / \`status --json\`.

Env overrides: SB_DISPLAY SB_GEOM SB_VNC SB_CDP SB_RUNTIME SB_REGISTRY SB_WEB_BAND_START SB_WEB_BAND_SIZE
               SB_WEB (an explicit PIN — skips allocation; only for debugging a specific port).
EOF
}

# ── Dispatch ───────────────────────────────────────────────────────────────────────────────────────────
main() {
  local verb="${1:-}"; [ "$#" -gt 0 ] && shift
  # Resolve the allocated port FIRST, read-only, so every verb (and `usage`) speaks about the stack that
  # is actually running. `up` re-resolves in allocate mode once it holds the lock.
  resolve_web_port read
  case "$verb" in
    up)                 cmd_up "$@" ;;
    navigate)           cmd_navigate "$@" ;;
    observe)            cmd_observe ;;
    resume)             cmd_resume ;;
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
