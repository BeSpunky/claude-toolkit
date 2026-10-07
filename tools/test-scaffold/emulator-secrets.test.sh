#!/usr/bin/env bash
# What the Functions emulator is given as secrets — the guarantee that NOTHING RUN LOCALLY CAN REACH PRODUCTION.
#
# THE RULE. The emulator fetches a declared secret from the REAL Secret Manager whenever the bundle's
# `.secret.local` gives no non-empty value for it (firebase-tools `resolveSecretEnvs`). So tools/emulators.sh
# writes that file itself: an inert placeholder for every declared key by default; sandbox values only from
# a `.secret.sandbox.local` someone deliberately created in THIS tree; the production `.secret.local` never —
# not here, and not borrowed from the main worktree. Secret Manager itself is sunk for the emulator process.
#
# Every half of that fails SILENTLY if it regresses: a production value in the emulator looks exactly like a
# working local setup, right up until a function sends a real message.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TPL="$ROOT/plugins/house/engine/nx-tools/src/generators/firebase-emulators/emulators.sh.tpl"
[ -f "$TPL" ] || { echo "FATAL: emulators.sh.tpl not found at $TPL" >&2; exit 2; }

TMP="$(mktemp -d)"
trap 'git -C "$TMP/main" worktree remove --force "$TMP/wt" >/dev/null 2>&1; rm -rf "$TMP"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t

# A fake firebase that records what the real one would have been launched with.
mkdir -p "$TMP/bin"
cat > "$TMP/bin/firebase" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "${CLOUD_SECRET_MANAGER_URL:-}" > "$PWD/.fake-firebase-secret-manager"
exit 0
EOF
chmod +x "$TMP/bin/firebase"

FN=apps/functions
MAIN="$TMP/main"
mkdir -p "$MAIN/tools" "$MAIN/$FN/src" "$MAIN/dist/$FN"
sed -e 's/{{workspaceName}}/testws/g' -e 's|{{appEnvPath}}||g' \
    -e "s|{{functionsRoot}}|$FN|g" -e "s|{{functionsDist}}|dist/$FN|g" "$TPL" > "$MAIN/tools/emulators.sh"
node "$ROOT/tools/test-scaffold/render-engine.mjs" "$MAIN"   # the stack claim (tools/dev) every suite goes through
node "$ROOT/tools/test-scaffold/emulator-ports.mjs" "$MAIN"
printf '#!/usr/bin/env bash\nexit 0\n' > "$MAIN/tools/emulator-data.sh"
printf '{ "emulators": { "auth": { "port": 9099 }, "functions": { "port": 5001 } } }\n' > "$MAIN/firebase.json"
printf '# shape\nBOT_TOKEN=PASTE_BOT_TOKEN_HERE\n# MY_API_KEY=PASTE_MY_API_KEY_HERE\n' > "$MAIN/$FN/.secret.local.example"
printf 'BOT_TOKEN=prod-bot-token\nSTRIPE_KEY=sk_live_prod\n' > "$MAIN/$FN/.secret.local"
printf 'TELEGRAM_CHAT_ID=-100prod\n' > "$MAIN/$FN/.env"
git -C "$MAIN" init -q -b main
printf 'dist/\n%s/.secret.local\n%s/.secret.sandbox.local\n.fake-firebase-*\n' "$FN" "$FN" > "$MAIN/.gitignore"
git -C "$MAIN" add -A >/dev/null 2>&1
git -C "$MAIN" commit -qm init
git -C "$MAIN" worktree add -q "$TMP/wt" -b feat/x 2>/dev/null
WT="$TMP/wt"
mkdir -p "$WT/dist/$FN"

# The bundle declares one secret nobody documented — esbuild's CJS call shape.
printf 'const s = (0, import_params.defineSecret)("WEBHOOK_SECRET");\n' > "$MAIN/dist/$FN/main.js"
cp "$MAIN/dist/$FN/main.js" "$WT/dist/$FN/main.js"

FAILED=0
ok() { if [ "$2" = 1 ]; then printf '  ok   %-60s\n' "$1"; else printf '  FAIL %-60s\n' "$1"; FAILED=1; fi }
yes_if() { if eval "$1"; then echo 1; else echo 0; fi; }
launch() { ( cd "$1" && shift && env PATH="$TMP/bin:$PATH" "$@" bash tools/emulators.sh 2>&1 >/dev/null ); }
placed() { cat "$1/dist/$FN/.secret.local"; }

# ── Default: every declared key inert; production values never placed ──────────────────────────
out="$(launch "$MAIN")"
ok 'inert by default (banner says so)'            "$(yes_if '[[ "$out" == *"secrets: INERT"* ]]')"
ok 'documented key gets a placeholder'            "$(yes_if 'placed "$MAIN" | grep -qx "BOT_TOKEN=EMULATOR_INERT_BOT_TOKEN"')"
ok 'production-only key gets a placeholder'       "$(yes_if 'placed "$MAIN" | grep -qx "STRIPE_KEY=EMULATOR_INERT_STRIPE_KEY"')"
ok 'bundle-declared key gets a placeholder'       "$(yes_if 'placed "$MAIN" | grep -qx "WEBHOOK_SECRET=EMULATOR_INERT_WEBHOOK_SECRET"')"
ok 'commented example key is not declared'        "$(yes_if '! placed "$MAIN" | grep -q MY_API_KEY')"
ok 'no production value reaches the bundle'       "$(yes_if '! placed "$MAIN" | grep -q "prod"')"
ok 'undocumented bundle secret is called out'     "$(yes_if '[[ "$out" == *"declares WEBHOOK_SECRET"* ]]')"
ok 'Secret Manager is sunk for the emulator'      "$(yes_if 'grep -q "\.invalid" "$MAIN/.fake-firebase-secret-manager"')"
ok '.env without .env.local: says how to override' "$(yes_if '[[ "$out" == *".env.local (emulator-only)"* ]]')"

# ── A worktree never borrows the main tree's production file ────────────────────────────────────
out="$(launch "$WT")"
ok 'worktree: no main-worktree borrowing'         "$(yes_if '[[ "$out" != *"main worktree"* ]] && ! placed "$WT" | grep -q prod')"
ok 'worktree: bundle secret still inert'          "$(yes_if 'placed "$WT" | grep -qx "WEBHOOK_SECRET=EMULATOR_INERT_WEBHOOK_SECRET"')"

# ── Sandbox: the file is the opt-in; production-identical values are refused ───────────────────
printf 'BOT_TOKEN=sandbox-bot\nSTRIPE_KEY=sk_live_prod\n' > "$MAIN/$FN/.secret.sandbox.local"
out="$(launch "$MAIN")"
ok 'sandbox file arms the run, loudly'            "$(yes_if '[[ "$out" == *"secrets: SANDBOX"*"BOT_TOKEN"*"WILL reach real services"* ]]')"
ok 'sandbox value is placed'                      "$(yes_if 'placed "$MAIN" | grep -qx "BOT_TOKEN=sandbox-bot"')"
ok 'production-identical value refused'           "$(yes_if '[[ "$out" == *"REFUSED"*"STRIPE_KEY"* ]] && placed "$MAIN" | grep -qx "STRIPE_KEY=EMULATOR_INERT_STRIPE_KEY"')"
ok 'keys absent from sandbox stay inert'          "$(yes_if 'placed "$MAIN" | grep -qx "WEBHOOK_SECRET=EMULATOR_INERT_WEBHOOK_SECRET"')"
out="$(launch "$MAIN" EMULATOR_SECRETS=inert)"
ok 'EMULATOR_SECRETS=inert disarms the sandbox'   "$(yes_if '[[ "$out" == *"secrets: INERT"* ]] && placed "$MAIN" | grep -qx "BOT_TOKEN=EMULATOR_INERT_BOT_TOKEN"')"
ok 'the sandbox file is not borrowed by a worktree' "$(yes_if '! launch "$WT" | grep -q "secrets: SANDBOX" && ! placed "$WT" | grep -q sandbox-bot')"
set +e; launch "$WT" EMULATOR_SECRETS=sandbox >/dev/null; rc=$?; set -e
ok 'EMULATOR_SECRETS=sandbox without a file fails' "$(yes_if '[ "$rc" -ne 0 ]')"

# ── .env.local is reported (firebase.json configDir makes the emulator read it from source) ─────
printf 'TELEGRAM_CHAT_ID=-100test\n' > "$MAIN/$FN/.env.local"
out="$(launch "$MAIN")"
ok '.env.local overrides are named'               "$(yes_if '[[ "$out" == *".env.local overrides for the emulator: TELEGRAM_CHAT_ID"* ]]')"

# ── A focused run without functions stays quiet but still writes the placeholders ───────────────
out="$( cd "$MAIN" && PATH="$TMP/bin:$PATH" EMULATOR_SECRETS=inert bash tools/emulators.sh --only auth 2>&1 >/dev/null )"
ok 'auth-only run prints no secrets banner'       "$(yes_if '[[ "$out" != *"secrets:"* ]]')"

exit "$FAILED"
