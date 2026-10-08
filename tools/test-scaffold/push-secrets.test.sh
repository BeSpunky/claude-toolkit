#!/usr/bin/env bash
# What tools/push-secrets.sh sets in PRODUCTION's Secret Manager — exactly the values Firebase itself would read from
# `.secret.local`, through the one parser the emulator side uses (tools/emulator-secrets.cjs).
#
# WHY. It used to push the raw text after `=`: `KEY="v" # note` became the production secret `"v" # note`, and
# `export KEY=v` the secret named `export KEY`. Then it pushed Firebase's dotenv reading — and `DB_PASS=p@ss#w0rd`
# became `p@ss`. Both silent. Now a value whose reading differs from its text is refused, with the shape to write.
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

# ── What is written is what is pushed: bare when it can be, quoted (literally) when it must be ─────────────────
cat > "$W/$FN/.secret.local" <<'EOF2'
# production
PLAIN=sk_live_plain
HASHED="pa#ss"
SQ='p@ss#w0rd'
MULTI="-----BEGIN KEY-----
sk_live_line
-----END KEY-----"
PADDED='  sk_live_pad  '
APOS=it's sk_live
UNFILLED=PASTE_ME
EMPTY=
EOF2
out="$(push)"
ok 'plain value pushed as is'                    "$(pushed '["PLAIN","sk_live_plain"]')"
ok 'a # inside double quotes is the value'       "$(pushed '["HASHED","pa#ss"]')"
ok 'a # inside single quotes is the value'       "$(pushed '["SQ","p@ss#w0rd"]')"
ok 'a literal multi-line quoted value, newlines and all' "$(pushed '["MULTI","-----BEGIN KEY-----\nsk_live_line\n-----END KEY-----"]')"
ok 'edge whitespace kept when quoted'            "$(pushed '["PADDED","  sk_live_pad  "]')"
ok 'an inner apostrophe in a bare value is the value' "$(pushed '["APOS","it'"'"'s sk_live"]')"
ok 'unfilled values skipped, by name'            "$([ "$(grep -c 'UNFILLED\|EMPTY' "$TMP/pushed")" = 0 ] && [[ "$out" == *"skipping UNFILLED"* ]] && echo 1 || echo 0)"
ok 'exactly six secrets set'                     "$([ "$(wc -l < "$TMP/pushed")" = 6 ] && echo 1 || echo 0)"
ok 'no value appears in the output'              "$([[ "$out" != *sk_live* && "$out" != *w0rd* ]] && echo 1 || echo 0)"

out="$(push --dry-run)"
ok 'dry run sets nothing'                        "$([ ! -s "$TMP/pushed" ] && echo 1 || echo 0)"
ok 'dry run names every key, with a length class' "$([[ "$out" == *"would set PLAIN — 8–15 characters"* && "$out" == *"would set HASHED — under 8 characters"* && "$out" == *"would set MULTI — 32–63 characters"* && "$out" == *"6 secret(s) would be pushed to acme-prod"* ]] && echo 1 || echo 0)"
ok 'dry run shows no part of a value, no hash'   "$([[ "$out" != *sk_* && "$out" != *pa#* && "$out" != *'"pa'* && "$out" != *sha256* ]] && echo 1 || echo 0)"

# ── A value Firebase would read as something other than its text is REFUSED, never reinterpreted ──────────────
# Each alone in the file beside a good line: the whole push stops (nothing set), the key is named with why and the
# shape to write, and the value itself is never printed.
refused() {   # refused <label> <line(s)> <key> <reason needle> <shape needle>
  printf 'GOOD=sk_live_good\n%s\n' "$2" > "$W/$FN/.secret.local"
  local out rc
  set +e; out="$(push)"; rc=$?; set -e
  ok "refused: $1" "$([ "$rc" -eq 2 ] && [ ! -s "$TMP/pushed" ] && [[ "$out" == *"$3: $4"* && "$out" == *"$5"* && "$out" != *sk_live* && "$out" != *w0rd* ]] && echo 1 || echo 0)"
  [ "$rc" -eq 2 ] && [[ "$out" == *"$3: $4"* && "$out" == *"$5"* ]] || printf '%s\n' "$out" | sed 's/^/         /'
}
refused 'an unquoted # (p@ss#w0rd would push p@ss)' 'DB_PASS=p@ss#w0rd' DB_PASS 'an unquoted #' "DB_PASS='<value>'"
refused 'a # comment on the value line' 'COMMENTED=sk_live_c   # the live key' COMMENTED 'a # comment' 'COMMENTED=<value>'
refused 'a quoted value followed by a comment' 'QUOTED="sk_live_q" #x' QUOTED 'a # comment' 'QUOTED=<value>'
refused 'quotes Firebase strips' "SINGLE='sk_live_s'" SINGLE 'quotes Firebase strips' 'SINGLE=<value>'
refused '`export`' 'export EXPORTED=sk_live_e' EXPORTED '`export`' 'EXPORTED=<value>'
refused 'escapes Firebase decodes' 'ESCAPED="sk_live \"b\" c"' ESCAPED 'escape sequences' 'ESCAPED=<value>'
refused 'an escaped newline (literal or a line break?)' 'PEM="sk_live\nline"' PEM 'escape sequences' "PEM='<value>'"
refused 'an unbalanced quote (A="abc)' 'UNBAL="sk_live_abc' UNBAL 'a stray or unbalanced quote' "UNBAL='<value>'"

printf 'GOOD=v\nthis is not a pair\n' > "$W/$FN/.secret.local"
set +e; out="$(push)"; rc=$?; set -e
ok 'a malformed line refuses the whole push'     "$([ "$rc" -eq 2 ] && [ ! -s "$TMP/pushed" ] && [[ "$out" != *"not a pair"* ]] && echo 1 || echo 0)"
printf 'GOOD=v\nFIREBASE_TOKEN=x\nlower=y\n' > "$W/$FN/.secret.local"
set +e; out="$(push)"; rc=$?; set -e
ok 'a key Firebase refuses stops the push, named' "$([ "$rc" -eq 2 ] && [ ! -s "$TMP/pushed" ] && [[ "$out" == *FIREBASE_TOKEN*lower* ]] && echo 1 || echo 0)"

exit "$FAILED"
