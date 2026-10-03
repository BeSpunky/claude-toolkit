# --- The OS packages (one apt transaction, composed from this project's layers) ---
# Every active layer's packages, grouped BY CAPABILITY so a reader can tell why any given package is here —
# and so it leaves with the layer that needs it. Best-effort with retry: apt mirrors are occasionally flaky
# over Docker DNS, so a transient failure only WARNS — it never aborts post-create (set -e) and leaves the
# container half-provisioned.
#
# The list lives in ONE variable, so the hand-recovery command printed on failure is DERIVED from it rather
# than retyped. Accumulated across assignments rather than declared as a bash ARRAY so each capability keeps
# its own comment WITHOUT making the file bash-only: this script may be chained from a project's own `/bin/sh`
# postCreateCommand (`.devcontainer/post-create.bespunky.sh`), where an array is a PARSE error that kills the
# run at this line and skips every step below it.
OS_PACKAGES=""
{{OS_PACKAGES}}

echo "[post-create] installing OS packages:$OS_PACKAGES"
os_apt_ok=0
for attempt in 1 2 3; do
  # $OS_PACKAGES is deliberately UNQUOTED: word-splitting into one argument per package is the point. Safe
  # because every member is a Debian package name — no whitespace, no glob characters.
  # shellcheck disable=SC2086
  if sudo apt-get update && sudo apt-get install -y $OS_PACKAGES; then
    os_apt_ok=1; break
  fi
  if [ "$attempt" -lt 3 ]; then
    echo "[post-create] OS package install attempt $attempt/3 failed (often transient Docker DNS); retrying in $((attempt * 10))s..."
    sleep $((attempt * 10))
  fi
done
if [ "$os_apt_ok" = 1 ]; then
  # `apt-get install -y` exiting 0 IS the check; probing one member and announcing readiness for all of them
  # would be a false assurance.
  echo "[post-create] OS packages ready"
else
  echo "[post-create] WARNING: OS packages failed after 3 attempts — likely a transient network issue."
  echo "[post-create]          The container is otherwise ready, but EVERYTHING in this one transaction is missing."
  echo "[post-create]          Finish this one step once the network settles:"
  echo "[post-create]            sudo apt-get update && sudo apt-get install -y$OS_PACKAGES"
fi
