#!/usr/bin/env bash
# bespunky-voice — audio-endpoint.sh : resolve WHERE the audio goes.
#
# The one place the plugin knows how to find a PulseAudio-protocol server (real
# PulseAudio, PipeWire-pulse, or WSLg's). Every script that plays or records
# (speak.sh, listen.sh, voice-auto.sh status) sources this and calls
# `voice_resolve_endpoint`; none of them knows a socket path or a host kind.
#
# The endpoint is found by SOCKET EXISTENCE (and, when pactl is available, by a
# server actually answering) — never by asking "is this WSL". Candidates, in order:
#   1. $PULSE_SERVER                              whatever the environment says
#   2. /run/bespunky/host/pulse/native            the BeSpunky devcontainer bridge
#   3. /run/bespunky/host/pulse/PulseServer       (same bridge, WSLg's socket name)
#   4. /mnt/wslg/PulseServer                      a container not yet rebuilt onto the bridge
#   5. ${XDG_RUNTIME_DIR:-/run/user/$UID}/pulse/native   running directly on a Linux host
#
# Mic gain is a property of the endpoint: WSLg's RDP microphone arrives
# near-silent at unity gain, so an endpoint reached via WSLg defaults to 200%;
# every other server defaults to 100% (boosting a normal mic only clips it).
# "Via WSLg" = the devcontainer passed a host WSL distro through
# (BESPUNKY_HOST_WSL_DISTRO non-empty), or the winning socket is WSLg's own
# (/mnt/wslg/…, or the PulseServer name only WSLg uses). BESPUNKY_VOICE_MIC_GAIN
# overrides either way. This file is the ONLY place that WSL knowledge lives.
#
# Contract (after `voice_resolve_endpoint`):
#   success (0): PULSE_SERVER exported to the winner; VOICE_ENDPOINT (the server
#                string), VOICE_ENDPOINT_VIA (which candidate won),
#                VOICE_MIC_GAIN, VOICE_MIC_GAIN_WHY set.
#   failure (1): VOICE_ENDPOINT_DIAGNOSIS holds a multi-line explanation — every
#                candidate tried, why it failed, and what to do. Nothing is
#                printed; the caller decides whether the failure matters (macOS
#                `say`/afplay need no PulseAudio at all).
#
# Run directly (not sourced) it prints the resolution — a one-line diagnostic.

# Is a PulseAudio server reachable at "$1" (a PULSE_SERVER string)? Echoes the
# reason on failure. Uses pactl when present; otherwise socket existence is the
# best evidence available (a non-unix server is then taken on trust).
_voice_probe_server() {
  local server="$1" path=""
  case "$server" in
    unix:*) path="${server#unix:}" ;;
    /*)     path="$server" ;;
  esac
  if [ -n "$path" ] && [ ! -S "$path" ]; then
    if [ -e "$path" ]; then echo "$path exists but is not a socket"; else echo "no socket at $path"; fi
    return 1
  fi
  if command -v pactl >/dev/null 2>&1; then
    local t=""
    command -v timeout >/dev/null 2>&1 && t="timeout 3"
    if ! PULSE_SERVER="$server" $t pactl info >/dev/null 2>&1; then
      echo "socket present but no server answered (pactl info failed — stale socket, or the server refused this user)"
      return 1
    fi
  fi
  return 0
}

voice_resolve_endpoint() {
  local runtime="${XDG_RUNTIME_DIR:-/run/user/$(id -u 2>/dev/null || echo 0)}"
  local -a labels=() servers=()
  if [ -n "${PULSE_SERVER:-}" ]; then
    labels+=("\$PULSE_SERVER"); servers+=("$PULSE_SERVER")
  fi
  labels+=("devcontainer bridge" "devcontainer bridge (WSLg socket)" "WSLg (container not rebuilt)" "host session")
  servers+=("unix:/run/bespunky/host/pulse/native" \
            "unix:/run/bespunky/host/pulse/PulseServer" \
            "unix:/mnt/wslg/PulseServer" \
            "unix:$runtime/pulse/native")

  local tried="" seen=" " i server reason
  VOICE_ENDPOINT="" VOICE_ENDPOINT_VIA="" VOICE_ENDPOINT_DIAGNOSIS=""
  for i in "${!servers[@]}"; do
    server="${servers[$i]}"
    # Normalize a bare path to the unix: form so duplicates collapse.
    case "$server" in /*) server="unix:$server" ;; esac
    case "$seen" in *" $server "*) continue ;; esac
    seen="$seen$server "
    if reason="$(_voice_probe_server "$server")"; then
      VOICE_ENDPOINT="$server"
      VOICE_ENDPOINT_VIA="${labels[$i]}"
      break
    fi
    tried="$tried
  - ${labels[$i]} ($server): $reason"
  done

  if [ -z "$VOICE_ENDPOINT" ]; then
    VOICE_ENDPOINT_DIAGNOSIS="bespunky-voice: no reachable audio endpoint (a PulseAudio-protocol server). Tried, in order:$tried
To fix:
  - In a BeSpunky devcontainer: enable voice (house.sh upgrade --voice <project>) and rebuild the
    container, so the host's PulseAudio socket is bridged to /run/bespunky/host/pulse.
  - On a Linux host: make sure PulseAudio or PipeWire-pulse is running for your user (pactl info).
  - Elsewhere: point PULSE_SERVER at a reachable server (unix:/path/to/native, or tcp:host:port)."
    return 1
  fi
  export PULSE_SERVER="$VOICE_ENDPOINT"

  local default_gain="100%" why="default"
  case "$VOICE_ENDPOINT" in
    unix:/mnt/wslg/*|*/PulseServer) default_gain="200%"; why="WSLg default — its microphone is quiet" ;;
  esac
  if [ -n "${BESPUNKY_HOST_WSL_DISTRO:-}" ]; then
    default_gain="200%"; why="WSLg default — its microphone is quiet"
  fi
  if [ -n "${BESPUNKY_VOICE_MIC_GAIN:-}" ]; then
    VOICE_MIC_GAIN="$BESPUNKY_VOICE_MIC_GAIN"; VOICE_MIC_GAIN_WHY="BESPUNKY_VOICE_MIC_GAIN"
  else
    VOICE_MIC_GAIN="$default_gain"; VOICE_MIC_GAIN_WHY="$why"
  fi
  return 0
}

# Executed directly → print the resolution.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  if voice_resolve_endpoint; then
    echo "audio endpoint: $VOICE_ENDPOINT (via $VOICE_ENDPOINT_VIA)"
    echo "mic gain: $VOICE_MIC_GAIN ($VOICE_MIC_GAIN_WHY)"
  else
    echo "$VOICE_ENDPOINT_DIAGNOSIS" >&2
    exit 1
  fi
fi
