#!/usr/bin/env bash
# `tools/seed/build-seeds.sh` — a STOP of a seed build ends its emulator suite, then releases the stack (S3-6).
#
# WHAT THIS GUARDS. A seed build is a stack of its own (`seed-build@<offset>`, claimed through the dev engine), and
# `tools/dev/dev stop seed-build --offset=N` stops it by its handle: one SIGTERM to the script. The script used to have
# no TERM trap — bash died at once, its EXIT trap released the record, and the foreground `firebase emulators:exec`
# (and its JVMs) kept running on the claimed block with no record left to find them by: a "stopped" stack still bound
# its ports. Now the stop is passed to the suite, the script waits for it, and only then lets the stack go.
#
# HOW. The shipped template, rendered with the dev engine, a one-world tools/seed/world.mjs, and a fake `firebase` that
# runs until told to stop and starts a child "JVM" — exactly the shape that was left behind.
set -uo pipefail
# A human runs these: under an AI agent (CLAUDECODE=1) the engine never takes the base ports.
unset CLAUDECODE

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TPL="${SEED_TPL:-$ROOT/plugins/house/engine/nx-tools/src/generators/firebase-emulators/seed-build-seeds.sh.tpl}"
[ -f "$TPL" ] || { echo "FATAL: seed-build-seeds.sh.tpl not found at $TPL" >&2; exit 2; }
command -v setsid >/dev/null 2>&1 || { echo "  skip  setsid unavailable"; exit 0; }

TMP="$(mktemp -d)"
W="$TMP/ws"
SESSION=''
cleanup() {
  [ -n "$SESSION" ] && kill -KILL -- "-$SESSION" 2>/dev/null
  # What the fake started, by the PIDs it recorded — never by name.
  for f in "$W"/.fake-*.pid; do [ -f "$f" ] && kill -KILL "$(cat "$f")" 2>/dev/null; done
  for rec in "$W"/.bespunky/run/*.json; do
    [ -f "$rec" ] || continue
    t="$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).tmp ?? ""))' "$rec" 2>/dev/null)"
    [[ "$t" =~ ^/tmp/bespunky-[0-9a-f]{12}$ ]] && rm -rf "$t"
  done
  [ -n "${KEEP:-}" ] && echo "kept $TMP" || rm -rf "$TMP"
}
trap cleanup EXIT

FAILED=0
ok() { if [ "$2" = 1 ]; then printf '  ok   %-78s\n' "$1"; else printf '  FAIL %-78s\n' "$1"; FAILED=1; fi }
alive() { [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null; }

mkdir -p "$TMP/bin" "$W/tools/seed"
cat > "$TMP/bin/firebase" <<'STUB'
#!/usr/bin/env bash
# A firebase-tools stand-in for `emulators:exec`: runs until stopped, with a child "JVM"; a SIGTERM ends both.
echo $$ > "$PWD/.fake-firebase.pid"
bash -c 'trap "exit 0" TERM; while :; do sleep 0.1; done' &
JVM=$!
echo "$JVM" > "$PWD/.fake-jvm.pid"
trap 'echo TERM >> "$PWD/.fake-firebase-signals"; kill -TERM "$JVM"; wait "$JVM"; exit 0' TERM
while :; do sleep 0.1; done
STUB
chmod +x "$TMP/bin/firebase"

( cd "$W" && git init -q . && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init )
node "$ROOT/tools/test-scaffold/render-engine.mjs" "$W"
[ -n "${SEED_ENGINE:-}" ] && { rm -rf "$W/tools/dev"; cp -r "$SEED_ENGINE" "$W/tools/dev"; }
node "$ROOT/tools/test-scaffold/emulator-tools.mjs" "$W"
printf '{ "emulators": { "auth": { "port": 9099 }, "firestore": { "port": 8080 }, "ui": { "enabled": true, "port": 4000 } } }\n' > "$W/firebase.json"
printf 'export const WORLDS = { default: {} };\n' > "$W/tools/seed/world.mjs"
sed -e 's|{{workspaceName}}|acme|g' "$TPL" > "$W/tools/seed/build-seeds.sh"

( cd "$W" && PATH="$TMP/bin:$PATH" DEV_OWNER=test setsid bash tools/seed/build-seeds.sh > out.log 2>&1 < /dev/null & echo $! > "$TMP/session" )
SESSION="$(cat "$TMP/session")"
for _ in $(seq 1 100); do alive "$W/.fake-jvm.pid" && break; sleep 0.1; done
ok "the seed build claimed its stack and started its suite" "$(alive "$W/.fake-jvm.pid" && grep -q 'own emulator stack seed-build@' "$W/out.log" && echo 1 || echo 0)"
OFFSET="$(sed -n 's/.*own emulator stack seed-build@\([0-9]*\) .*/\1/p' "$W/out.log")"

OUT="$(cd "$W" && DEV_OWNER=test timeout 30 node tools/dev/dev.mjs stop seed-build --offset="$OFFSET" 2>&1)"; CODE=$?
[ -n "${KEEP:-}" ] && printf '%s\n' "$OUT"
ok "dev stop seed-build: exit 0, ports confirmed free (got $CODE)" "$([ "$CODE" = 0 ] && grep -q 'ports free' <<<"$OUT" && echo 1 || echo 0)"
ok "…the suite was told to stop (firebase got its SIGTERM)" "$(grep -qx TERM "$W/.fake-firebase-signals" 2>/dev/null && echo 1 || echo 0)"
ok "…and nothing of it is left running: not firebase, not its JVM" "$(! alive "$W/.fake-firebase.pid" && ! alive "$W/.fake-jvm.pid" && echo 1 || echo 0)"
ok "…and the stack is released (record and lock gone)" "$([ ! -e "$W/.bespunky/run/seed-build@$OFFSET.json" ] && [ -z "$(ls -A "$W/.bespunky/run/locks" 2>/dev/null)" ] && echo 1 || echo 0)"

exit "$FAILED"
