#!/usr/bin/env bash
# The Docker fallback runs on a known image, and a run that cannot work says so and stops.
#
# WHY THIS IS A TEST. The fallback used to take the newest typescript-node image on MCR. When :26 appeared with no yarn
# and no corepack, `house.sh new` printed `env: 'yarn': No such file or directory`, then died on `chown: cannot access`,
# with exit 1 and no project — the run's own failure replaced by the failure of its cleanup. Nothing here had changed.
#
# What is asserted, against a fake `docker` that records every call and plays the part it is told to (no image, no
# network): the image comes from HOUSE_NODE_MAJOR and from no registry; a missing package manager stops the run before
# the program starts; a program that dies reports itself with its own exit code, does not chown what does not exist,
# and is never pushed to GitHub; a failed chown still ends a run that had otherwise succeeded.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENGINE="$ROOT/plugins/house/engine"
HOUSE_SH="$ENGINE/house.sh"
[ -f "$HOUSE_SH" ] || { echo "FATAL: house.sh not found at $HOUSE_SH" >&2; exit 2; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FAILED=0
ok()   { printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; FAILED=1; }

mkdir -p "$TMP/bin" "$TMP/projects"
export CALLS="$TMP/calls"
cat > "$TMP/bin/docker" <<'FAKE'
#!/usr/bin/env bash
[ "$1" = "run" ] || exit 0
case "$*" in
  *'command -v "$1"'*) echo "probe" >> "$CALLS"; exit "${FAKE_PROBE_RC:-0}" ;;
  *' chown '*)         echo "chown" >> "$CALLS"; exit "${FAKE_CHOWN_RC:-0}" ;;
  *)                   echo "program" >> "$CALLS"
                       [ -z "${FAKE_CREATES:-}" ] || mkdir -p "$FAKE_CREATES"
                       exit "${FAKE_PROGRAM_RC:-0}" ;;
esac
FAKE
for tool in gh curl; do printf '#!/usr/bin/env bash\necho %s >> "$CALLS"\nexit 1\n' "$tool" > "$TMP/bin/$tool"; done
chmod +x "$TMP/bin/"*

# One scaffold on the Docker path; its output lands in $out, its exit code in $rc.
scaffold() {
  : > "$CALLS"
  out="$(env PATH="$TMP/bin:$PATH" "$@" bash "$HOUSE_SH" new --docker --github --preset=angular "$TMP/projects/shop" 2>&1)"
  rc=$?
}
called() { grep -qx "$1" "$CALLS"; }

echo "── the image"
major="$(. "$ENGINE/container-engine.sh"; PATH="$TMP/bin:$PATH" base_image_node_major)"
house="$(sed -n "s/^export const HOUSE_NODE_MAJOR = '\([0-9]*\)'.*/\1/p" "$ENGINE/nx-tools/src/generators/_utils/versions.ts")"
[ -n "$major" ] && [ "$major" = "$house" ] && ok "the runner is HOUSE_NODE_MAJOR ($major)" || fail "runner '$major', house '$house'"
grep -qE "TYPESCRIPT_NODE_IMAGE_MAJORS.*[[ ]$major[],]" "$ENGINE/nx-tools/src/generators/_utils/node-facts.ts" \
  && ok "…and MCR publishes an image for it" || fail "no typescript-node:$major in node-facts.ts"
: > "$CALLS"; (. "$ENGINE/container-engine.sh"; PATH="$TMP/bin:$PATH" base_image_node_major >/dev/null)
called curl && fail "choosing the image asked the network" || ok "…and choosing it asks no registry"

echo "── --print-inner runs nothing"
: > "$CALLS"
env PATH="$TMP/bin:$PATH" bash "$HOUSE_SH" new --docker --print-inner --preset=angular "$TMP/projects/shop" >/dev/null 2>&1
[ -s "$CALLS" ] && fail "--print-inner ran: $(tr '\n' ' ' < "$CALLS")" || ok "no container started"

echo "── the image has no package manager"
scaffold FAKE_PROBE_RC=1
[ "$rc" -ne 0 ] && ok "non-zero exit ($rc)" || fail "exit 0"
grep -qF "typescript-node:$major has no 'yarn'" <<< "$out" && ok "names the image and the tool" || fail "no clear error: $out"
called program && fail "the program ran anyway" || ok "the program never started"
called chown && fail "it went on to chown" || ok "no chown"
[ -e "$TMP/projects/shop" ] && fail "something was created" || ok "nothing was created"

echo "── the image cannot be run at all"
scaffold FAKE_PROBE_RC=125
[ "$rc" -ne 0 ] && grep -qF "could not run" <<< "$out" && ok "says so, non-zero ($rc)" || fail "rc=$rc: $out"
called program && fail "the program ran anyway" || ok "the program never started"

echo "── the program dies having created nothing"
scaffold FAKE_PROGRAM_RC=127
[ "$rc" -eq 127 ] && ok "the program's own exit code" || fail "exit $rc, not 127"
grep -q "^NEW_FAILED $TMP/projects/shop (exit 127)" <<< "$out" && ok "NEW_FAILED, naming the project" || fail "no NEW_FAILED: $out"
grep -qF "not created" <<< "$out" && ok "says nothing was created" || fail "does not say what is left: $out"
grep -qF "UPGRADE_FAILED" <<< "$out" && fail "a scaffold reported as an upgrade" || ok "no upgrade advice"
called chown && fail "chowned a project that does not exist" || ok "no chown"
called gh && fail "tried to publish a failed scaffold" || ok "nothing published"

echo "── the program dies part-way"
scaffold FAKE_PROGRAM_RC=3 "FAKE_CREATES=$TMP/projects/shop"
[ "$rc" -eq 3 ] && ok "the program's own exit code" || fail "exit $rc, not 3"
called chown && ok "the partial tree is handed back" || fail "no chown of the partial tree"
grep -qF "partly created" <<< "$out" && ok "says what is left" || fail "does not say what is left: $out"
called gh && fail "tried to publish a failed scaffold" || ok "nothing published"
rm -rf "$TMP/projects/shop"

echo "── the program dies and the chown fails too"
scaffold FAKE_PROGRAM_RC=3 FAKE_CHOWN_RC=9 "FAKE_CREATES=$TMP/projects/shop"
[ "$rc" -eq 3 ] && ok "the program's failure is the one reported" || fail "exit $rc, not 3"
grep -q "^NEW_FAILED" <<< "$out" && ok "NEW_FAILED still printed" || fail "no NEW_FAILED: $out"
rm -rf "$TMP/projects/shop"

echo "── the program succeeds and the chown fails"
scaffold FAKE_CHOWN_RC=9 "FAKE_CREATES=$TMP/projects/shop"
[ "$rc" -eq 9 ] && ok "ends the run with the chown's exit code" || fail "exit $rc, not 9"
grep -qF "could not hand" <<< "$out" && ok "says why" || fail "no clear error: $out"
called gh && fail "published with ownership unrestored" || ok "nothing published"

exit "$FAILED"
