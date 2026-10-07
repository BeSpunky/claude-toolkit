#!/usr/bin/env bash
# What tools/push-secrets.sh sets in PRODUCTION's Secret Manager — exactly the values Firebase itself would read from
# `.secret.local`, through the one parser the emulator side uses (tools/emulator-secrets.cjs).
#
# WHY. It used to push the raw text after `=`: `KEY="v" # note` became the production secret `"v" # note`, and
# `export KEY=v` the secret named `export KEY`. Silent — the push succeeds, and production breaks later.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TPL="${PUSH_SECRETS_TPL:-$ROOT/plugins/house/engine/nx-tools/src/generators/firebase-emulators/push-secrets.sh.tpl}"
[ -f "$TPL" ] || { echo "FATAL: push-secrets.sh.tpl not found at $TPL" >&2; exit 2; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FN=apps/functions
W="$TMP/ws"
mkdir -p "$W/tools" "$W/$FN" "$TMP/bin"
sed -e "s|{{functionsRoot}}|$FN|g" -e 's|{{functionsProject}}|functions|g' -e 's|{{appEnvProdPath}}||g' "$TPL" > "$W/tools/push-secrets.sh"
node "$ROOT/tools/test-scaffold/emulator-tools.mjs" "$W"
# A fake firebase: records each `secrets:set` as KEY<TAB>value-from-stdin (one JSON line, so any value is exact).
cat > "$TMP/bin/firebase" <<'STUB'
#!/usr/bin/env bash
value="$(cat; printf x)"; value="${value%x}"
node -e 'console.log(JSON.stringify([process.argv[1], process.argv[2]]))' -- "$2" "$value" >> "$PUSHED_LOG"
STUB
chmod +x "$TMP/bin/firebase"

FAILED=0
ok() { if [ "$2" = 1 ]; then printf '  ok   %-64s\n' "$1"; else printf '  FAIL %-64s\n' "$1"; FAILED=1; fi }
push() { : > "$TMP/pushed"; ( cd "$W" && PATH="$TMP/bin:$PATH" PUSHED_LOG="$TMP/pushed" FIREBASE_PROJECT=acme-prod bash tools/push-secrets.sh "$@" 2>&1 ); }
pushed() { grep -Fxq -- "$1" "$TMP/pushed" && echo 1 || echo 0; }

cat > "$W/$FN/.secret.local" <<'EOF2'
# production
PLAIN=sk_live_plain
COMMENTED=sk_live_c   # the live key
QUOTED="sk_live_q" #x
SINGLE='sk_live_s'
export EXPORTED=sk_live_e
ESCAPED="a \"b\" c"
HASHED="pa#ss"
UNFILLED=PASTE_ME
EMPTY=
EOF2
out="$(push)"
ok 'plain value pushed as is'                    "$(pushed '["PLAIN","sk_live_plain"]')"
ok 'inline comment is not part of the value'     "$(pushed '["COMMENTED","sk_live_c"]')"
ok 'double quotes and a trailing comment stripped' "$(pushed '["QUOTED","sk_live_q"]')"
ok 'single quotes stripped'                      "$(pushed '["SINGLE","sk_live_s"]')"
ok '`export KEY=` pushes KEY'                    "$(pushed '["EXPORTED","sk_live_e"]')"
ok 'escapes in double quotes decoded'            "$(pushed '["ESCAPED","a \"b\" c"]')"
ok 'a # inside quotes is the value'              "$(pushed '["HASHED","pa#ss"]')"
ok 'unfilled values skipped, by name'            "$([ "$(grep -c 'UNFILLED\|EMPTY' "$TMP/pushed")" = 0 ] && [[ "$out" == *"skipping UNFILLED"* ]] && echo 1 || echo 0)"
ok 'exactly seven secrets set'                   "$([ "$(wc -l < "$TMP/pushed")" = 7 ] && echo 1 || echo 0)"
ok 'no value appears in the output'              "$([[ "$out" != *sk_live* ]] && echo 1 || echo 0)"

out="$(push --dry-run)"
ok 'dry run sets nothing'                        "$([ ! -s "$TMP/pushed" ] && echo 1 || echo 0)"
ok 'dry run names every key it would push'       "$([[ "$out" == *"would set QUOTED — 9 chars"* && "$out" == *"would set EXPORTED"* && "$out" == *"7 secret(s) would be pushed to acme-prod"* ]] && echo 1 || echo 0)"
ok 'dry run shows edges, never the whole value'  "$([[ "$out" == *'"sk_"…"_q"'* && "$out" != *sk_live_q* ]] && echo 1 || echo 0)"

printf 'GOOD=v\nthis is not a pair\n' > "$W/$FN/.secret.local"
set +e; out="$(push)"; rc=$?; set -e
ok 'a malformed line refuses the whole push'     "$([ "$rc" -eq 2 ] && [ ! -s "$TMP/pushed" ] && [[ "$out" != *"not a pair"* ]] && echo 1 || echo 0)"
printf 'GOOD=v\nFIREBASE_TOKEN=x\nlower=y\n' > "$W/$FN/.secret.local"
set +e; out="$(push)"; rc=$?; set -e
ok 'a key Firebase refuses stops the push, named' "$([ "$rc" -eq 2 ] && [ ! -s "$TMP/pushed" ] && [[ "$out" == *FIREBASE_TOKEN*lower* ]] && echo 1 || echo 0)"

exit "$FAILED"
