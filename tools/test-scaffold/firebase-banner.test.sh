#!/usr/bin/env bash
# The Firebase welcome banner's /etc/profile.d hook — what every LOGIN SHELL in a Firebase devcontainer sources.
#
# WHAT THIS GUARDS. /etc/profile.d is read by /bin/sh (dash) as often as by bash, and a line there that does not
# parse breaks every login shell — not just the banner. The hook used `source` (dash has none) and an unquoted
# workspace path (a space, or a quote, split it in both shells). Here the shipped post-create piece writes the
# hook for a workspace whose path holds a space AND a quote, and both shells source it.
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/text.sh"  # in_text: grep captured output without a SIGPIPE race
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GEN="$ROOT/plugins/project-starter/skills/new-project/assets/nx-tools/src/generators"
PIECE="$GEN/devcontainer/post-create/firebase-banner.sh.tpl"
BANNER="$GEN/firebase-emulators/firebase-welcome.sh.tpl"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FAILED=0
ok()   { printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; FAILED=1; }

WS="$TMP/o'brien projects/shop"
mkdir -p "$WS/tools"
: > "$WS/firebase.json"
cp "$BANNER" "$WS/tools/firebase-welcome.sh"

# Run the piece as post-create does (bash, WS set), with `sudo tee <file>` captured instead of written to /etc.
HOOK="$TMP/zz-firebase-welcome.sh"
( WS="$WS"; sudo() { shift; cat > "$HOOK"; }; . "$PIECE" ) >/dev/null
[ -s "$HOOK" ] || { fail "the piece wrote no profile.d hook"; exit 1; }

for sh in dash bash; do
  command -v "$sh" >/dev/null 2>&1 || { echo "  skip  $sh unavailable"; continue; }
  out="$(cd / && "$sh" -c ". '$HOOK'" 2>&1)"; rc=$?
  if [ "$rc" -eq 0 ] && in_text "$out" -q 'Firebase setup is pending'; then
    ok "$sh sources the hook from a path with a space and a quote, and the banner shows"
  else
    fail "$sh: rc=$rc: $out"
  fi
done

: > "$WS/.firebaserc"   # linked, and no house-wired client: the banner must go silent
out="$(cd / && dash -c ". '$HOOK'" 2>&1)"
[ -z "$out" ] && ok "silent once .firebaserc exists (no client to wire)" || fail "still printing after setup: $out"
exit "$FAILED"
