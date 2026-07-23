#!/usr/bin/env bash
# serve.sh — serve the mocks for review, on a RANDOM FREE PORT.
#
# Never the project's default/forwarded port: that one belongs to whatever the user launched
# manually (bespunky-workflow:local-server-isolation).
#
# Serving over http (not file://) is required: the gallery fetches mocks.json, the comment layer
# POSTs to /comments, and the page hot-reloads over an SSE /events stream. Comments are persisted
# to comments.json ON DISK by serve.py — they survive a restart, a reboot, and a closed browser,
# and Claude reads them by reading that file.
#
# The URL is printed on the FIRST line (stdout) so callers can capture it. To spare the user any
# port-forwarding fuss, the best way to show it is to open that URL in the shared browser
# (bespunky-browser-automation:shared-browser) — the user then watches over the forwarded :6080,
# and Claude drives the live gallery over CDP (window.mockGoto / mockViewport / mockState).
#
#   bash serve.sh          # start; prints the gallery URL on stdout
#   bash serve.sh --stop   # stop the server this script started
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$DIR/.serve.pid"

is_ours() {  # only ever kill a python process that is OUR server (PIDs get reused)
  local pid="$1"
  [[ -r "/proc/$pid/cmdline" ]] && tr '\0' ' ' < "/proc/$pid/cmdline" | grep -q "serve.py"
}

if [[ "${1:-}" == "--stop" ]]; then
  if [[ -f "$PID_FILE" ]] && is_ours "$(cat "$PID_FILE")"; then
    kill "$(cat "$PID_FILE")" 2>/dev/null || true
    echo "stopped"
  else
    echo "not running"
  fi
  rm -f "$PID_FILE"
  exit 0
fi

# A previous server for THIS folder is still up? Reuse it — a second one would orphan the first,
# and (worse) leave the user commenting on a page whose URL you never printed.
if [[ -f "$PID_FILE" ]] && is_ours "$(cat "$PID_FILE")"; then
  echo "already serving (pid $(cat "$PID_FILE")); run 'bash serve.sh --stop' first" >&2
  exit 1
fi

# serve.py prints the URL on its first line; hold it open and hand the URL back.
FIFO="$(mktemp -u)"
mkfifo "$FIFO"
python3 "$DIR/serve.py" > "$FIFO" 2>/dev/null &
echo $! > "$PID_FILE"

if ! read -r -t 10 URL < "$FIFO"; then
  rm -f "$FIFO" "$PID_FILE"
  echo "server failed to start" >&2
  exit 1
fi
rm -f "$FIFO"
echo "$URL"
