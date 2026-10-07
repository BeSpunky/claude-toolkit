#!/usr/bin/env bash
# What a local emulator run can reach — the project id it runs under, and what the Functions emulator is given as
# secrets.
#
# THE RULE. The suite runs under the OFFLINE `demo-` twin of the app's project id unless environment.ts commits a
# service to the real backend (tools/emulator-project.mjs): under it, every Google API call names a project that
# cannot exist. Around that, defence in depth (tools/emulator-secrets.cjs): the bundle's `.secret.local` holds an
# inert placeholder for every declared key — written by the functions BUILD (an esbuild plugin) and rewritten at
# launch; sandbox values only from a `.secret.sandbox.local` someone deliberately created in THIS tree, and never one
# equal to a production value; the production `.secret.local` never; every file read with firebase-tools' own
# dotenv rules; the placed file checked before launch (exit 2, never a silent launch without it); Secret Manager sunk.
#
# Every half of that fails SILENTLY if it regresses: a production value in the emulator looks exactly like a
# working local setup, right up until a function sends a real message.
set -euo pipefail
# A human runs these: under an AI agent (CLAUDECODE=1) the engine never takes the base ports.
unset CLAUDECODE

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
printf '%s\n' "$*" > "$PWD/.fake-firebase-args"
exit 0
EOF
chmod +x "$TMP/bin/firebase"

FN=apps/functions
ENV=apps/web/src/environments/environment.ts
MAIN="$TMP/main"
mkdir -p "$MAIN/tools" "$MAIN/$FN/src" "$MAIN/dist/$FN" "$(dirname "$MAIN/$ENV")"
sed -e 's/{{workspaceName}}/testws/g' -e "s|{{appEnvPath}}|$ENV|g" \
    -e "s|{{functionsRoot}}|$FN|g" -e "s|{{functionsDist}}|dist/$FN|g" "$TPL" > "$MAIN/tools/emulators.sh"
node "$ROOT/tools/test-scaffold/render-engine.mjs" "$MAIN"   # the stack claim (tools/dev) every suite goes through
node "$ROOT/tools/test-scaffold/emulator-tools.mjs" "$MAIN"
printf '#!/usr/bin/env bash\nexit 0\n' > "$MAIN/tools/emulator-data.sh"
printf '{ "emulators": { "auth": { "port": 9099 }, "functions": { "port": 5001 } } }\n' > "$MAIN/firebase.json"
cat > "$MAIN/$ENV" <<'EOF'
const EMULATE = {
  auth: true,
  firestore: true,
  storage: true,
  functions: true,
};
export const environment = {
  production: false,
  firebase: {
    projectId: 'acme-prod',
    apiKey: 'AIza-real',
    appId: '1:2:web:3',
    storageBucket: 'acme-prod.firebasestorage.app',
  },
  emulators: {
    auth: { url: 'http://localhost:9099', default: EMULATE.auth },
    firestore: { host: 'localhost', port: 8080, default: EMULATE.firestore },
    storage: { host: 'localhost', port: 9199, default: EMULATE.storage },
    functions: { host: 'localhost', port: 5001, default: EMULATE.functions },
  },
};
EOF
printf '# shape\nBOT_TOKEN=PASTE_BOT_TOKEN_HERE\n# MY_API_KEY=PASTE_MY_API_KEY_HERE\nlegacy_key=PASTE\n' > "$MAIN/$FN/.secret.local.example"
printf 'BOT_TOKEN=prod-bot-token\nSTRIPE_KEY=sk_live_prod\nFIREBASE_SERVICE_ACCOUNT=sa-json\n' > "$MAIN/$FN/.secret.local"
printf 'TELEGRAM_CHAT_ID=-100prod\n' > "$MAIN/$FN/.env"
git -C "$MAIN" init -q -b main
printf 'dist/\n%s/.secret.local\n%s/.secret.sandbox.local\n.fake-firebase-*\n.bespunky/\n' "$FN" "$FN" > "$MAIN/.gitignore"
git -C "$MAIN" add -A >/dev/null 2>&1
git -C "$MAIN" commit -qm init
git -C "$MAIN" worktree add -q "$TMP/wt" -b feat/x 2>/dev/null
WT="$TMP/wt"
mkdir -p "$WT/dist/$FN"

# The bundle declares secrets nobody documented — esbuild's CJS call shape, and the string form of `secrets: [...]`.
printf 'const s = (0, import_params.defineSecret)("WEBHOOK_SECRET");\nexports.f = onRequest({ secrets: ["TG_TOKEN", %s] }, h);\n' "'PAY_KEY'" > "$MAIN/dist/$FN/main.js"
cp "$MAIN/dist/$FN/main.js" "$WT/dist/$FN/main.js"

FAILED=0
ok() { if [ "$2" = 1 ]; then printf '  ok   %-64s\n' "$1"; else printf '  FAIL %-64s\n' "$1"; FAILED=1; fi }
yes_if() { if eval "$1"; then echo 1; else echo 0; fi; }
launch() { ( cd "$1" && shift && env PATH="$TMP/bin:$PATH" "$@" bash tools/emulators.sh 2>&1 >/dev/null ) || true; }
rc_of() { ( cd "$1" && shift && env PATH="$TMP/bin:$PATH" "$@" bash tools/emulators.sh >/dev/null 2>&1; echo $? ) || true; }
placed() { cat "$1/dist/$FN/.secret.local"; }
# The placed file, as firebase reads it: the port of its parser (checked against the real one by test-firebase-tools).
parsed() { node -e 'const s=require(process.argv[1]); process.stdout.write(JSON.stringify(s.parseStrict(require("fs").readFileSync(process.argv[2],"utf8"))))' "$MAIN/tools/emulator-secrets.cjs" "$1/dist/$FN/.secret.local"; }
value_of() { parsed "$1" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>process.stdout.write(String(JSON.parse(d)[process.argv[1]] ?? "<absent>")))' "$2"; }

# ── The project id: the offline twin by default ─────────────────────────────────────────────────────
out="$(launch "$MAIN")"
ok 'offline by default: --project=demo-<app id>'       "$(yes_if 'grep -q -- "--project=demo-acme-prod" "$MAIN/.fake-firebase-args"')"
ok 'the banner says OFFLINE'                            "$(yes_if '[[ "$out" == *"demo-acme-prod — OFFLINE"* ]]')"

# ── Default: every declared key inert; production values never placed ──────────────────────────
ok 'inert by default (banner says so)'                  "$(yes_if '[[ "$out" == *"secrets: INERT"* ]]')"
ok 'documented key gets a placeholder'                  "$(yes_if '[ "$(value_of "$MAIN" BOT_TOKEN)" = EMULATOR_INERT_BOT_TOKEN ]')"
ok 'production-only key gets a placeholder'             "$(yes_if '[ "$(value_of "$MAIN" STRIPE_KEY)" = EMULATOR_INERT_STRIPE_KEY ]')"
ok 'defineSecret key gets a placeholder'                "$(yes_if '[ "$(value_of "$MAIN" WEBHOOK_SECRET)" = EMULATOR_INERT_WEBHOOK_SECRET ]')"
ok 'string-form secrets: [...] keys get placeholders'   "$(yes_if '[ "$(value_of "$MAIN" TG_TOKEN)" = EMULATOR_INERT_TG_TOKEN ] && [ "$(value_of "$MAIN" PAY_KEY)" = EMULATOR_INERT_PAY_KEY ]')"
ok 'commented example key is not declared'              "$(yes_if '! placed "$MAIN" | grep -q MY_API_KEY')"
ok 'no production value reaches the bundle'             "$(yes_if '! placed "$MAIN" | grep -q "prod\|sa-json"')"
ok 'undocumented bundle secret is called out'           "$(yes_if '[[ "$out" == *"declares"*"WEBHOOK_SECRET"* ]]')"
ok 'Secret Manager is sunk for the emulator'            "$(yes_if 'grep -q "\.invalid" "$MAIN/.fake-firebase-secret-manager"')"
ok '.env without .env.local: says how to override'      "$(yes_if '[[ "$out" == *".env.local (emulator-only)"* ]]')"

# ── R2-2: a key firebase refuses never sinks the whole file ─────────────────────────────────────────
ok 'firebase-refused keys are not written'              "$(yes_if '! placed "$MAIN" | grep -q "legacy_key\|FIREBASE_SERVICE_ACCOUNT"')"
ok '…the placed file passes firebase'"'"'s strict parse'  "$(yes_if 'parsed "$MAIN" >/dev/null')"
ok '…and each refused key is named'                     "$(yes_if '[[ "$out" == *"NOT GIVEN"*"FIREBASE_SERVICE_ACCOUNT"*"legacy_key"* ]]')"

# ── A worktree never borrows the main tree's production file ────────────────────────────────────
out="$(launch "$WT")"
ok 'worktree: no main-worktree borrowing'               "$(yes_if '! placed "$WT" | grep -q prod')"
ok 'worktree: bundle secret still inert'                "$(yes_if '[ "$(value_of "$WT" WEBHOOK_SECRET)" = EMULATOR_INERT_WEBHOOK_SECRET ]')"

# ── Sandbox: the file is the opt-in; production-equal values are refused ─────────────────────────
# R2-1: an inline comment, other quoting, or a production value under ANOTHER key are all still production's.
cat > "$MAIN/$FN/.secret.sandbox.local" <<'EOF'
BOT_TOKEN=sandbox-bot   # the test bot
STRIPE_KEY="sk_live_prod" #x
PAY_KEY='prod-bot-token'
TG_TOKEN="tg \"quoted\" # not a comment"
EOF
out="$(launch "$MAIN")"
ok 'sandbox file arms the run, loudly'                  "$(yes_if '[[ "$out" == *"secrets: SANDBOX"*"BOT_TOKEN"*"WILL reach real services"* ]]')"
ok 'sandbox value is placed, as firebase parses it'     "$(yes_if '[ "$(value_of "$MAIN" BOT_TOKEN)" = sandbox-bot ]')"
ok 'quoted value with escapes round-trips'              "$(yes_if '[ "$(value_of "$MAIN" TG_TOKEN)" = "tg \"quoted\" # not a comment" ]')"
ok 'quoted + commented production copy refused'         "$(yes_if '[[ "$out" == *"REFUSED"*"STRIPE_KEY"* ]] && [ "$(value_of "$MAIN" STRIPE_KEY)" = EMULATOR_INERT_STRIPE_KEY ]')"
ok 'production value under another key refused'         "$(yes_if '[[ "$out" == *"REFUSED"*"PAY_KEY"* ]] && [ "$(value_of "$MAIN" PAY_KEY)" = EMULATOR_INERT_PAY_KEY ]')"
ok 'keys absent from sandbox stay inert'                "$(yes_if '[ "$(value_of "$MAIN" WEBHOOK_SECRET)" = EMULATOR_INERT_WEBHOOK_SECRET ]')"
ok 'the refusal says it catches exact copies only'      "$(yes_if '[[ "$out" == *"Only exact copies"* ]]')"
out="$(launch "$MAIN" EMULATOR_SECRETS=inert)"
ok 'EMULATOR_SECRETS=inert disarms the sandbox'         "$(yes_if '[[ "$out" == *"secrets: INERT"* ]] && [ "$(value_of "$MAIN" BOT_TOKEN)" = EMULATOR_INERT_BOT_TOKEN ]')"
ok 'the sandbox file is not borrowed by a worktree'     "$(yes_if '! launch "$WT" | grep -q "secrets: SANDBOX" && ! placed "$WT" | grep -q sandbox-bot')"
ok 'EMULATOR_SECRETS=sandbox without a file fails'      "$(yes_if '[ "$(rc_of "$WT" EMULATOR_SECRETS=sandbox)" -ne 0 ]')"

# R2-1: in a worktree (no production file of its own) the MAIN tree's production values are still refused.
printf 'STRIPE_KEY=sk_live_prod\nBOT_TOKEN=wt-sandbox\n' > "$WT/$FN/.secret.sandbox.local"
out="$(launch "$WT")"
ok 'worktree: main tree'"'"'s production value refused'   "$(yes_if '[[ "$out" == *"REFUSED"*"STRIPE_KEY"* ]] && [ "$(value_of "$WT" STRIPE_KEY)" = EMULATOR_INERT_STRIPE_KEY ]')"
ok 'worktree: its own sandbox value is placed'          "$(yes_if '[ "$(value_of "$WT" BOT_TOKEN)" = wt-sandbox ]')"
rm -f "$WT/$FN/.secret.sandbox.local" "$MAIN/$FN/.secret.sandbox.local"

# ── .env.local is reported (firebase.json configDir makes the emulator read it from source) ─────
printf 'TELEGRAM_CHAT_ID=-100test\n' > "$MAIN/$FN/.env.local"
out="$(launch "$MAIN")"
ok '.env.local overrides are named'                     "$(yes_if '[[ "$out" == *".env.local overrides for the emulator: TELEGRAM_CHAT_ID"* ]]')"

# ── A focused run without functions stays quiet but still writes the placeholders ───────────────
out="$( cd "$MAIN" && PATH="$TMP/bin:$PATH" EMULATOR_SECRETS=inert bash tools/emulators.sh --only auth 2>&1 >/dev/null )"
ok 'auth-only run prints no secrets banner'             "$(yes_if '[[ "$out" != *"secrets:"* ]]')"

# ── The installed firebase-tools is checked, not assumed ───────────────────────────────────────────
FT="$MAIN/node_modules/firebase-tools"
mkdir -p "$FT/lib/functions"
fake_ft() {   # fake_ft <version> <secretManagerOrigin expr> <parseStrict body>
  printf '{ "name": "firebase-tools", "version": "%s" }\n' "$1" > "$FT/package.json"
  printf 'exports.secretManagerOrigin = () => %s;\n' "$2" > "$FT/lib/api.js"
  printf 'exports.parseStrict = (d) => { %s };\n' "$3" > "$FT/lib/functions/env.js"
}
SINK_OK='process.env.CLOUD_SECRET_MANAGER_URL || "https://secretmanager.googleapis.com"'
REAL_PARSE='return require(process.cwd() + "/tools/emulator-secrets.cjs").parseStrict(d);'
fake_ft 15.32.1 "$SINK_OK" "$REAL_PARSE"
ok 'a firebase-tools that honours the sink: launches'   "$(yes_if '[ "$(rc_of "$MAIN")" -eq 0 ]')"
fake_ft 15.32.1 "$SINK_OK" 'throw new Error("Validation failed");'
ok 'placed file fails firebase'"'"'s own parse: exit 2'    "$(yes_if '[ "$(rc_of "$MAIN")" -eq 2 ]')"
fake_ft 15.32.1 "$SINK_OK" 'return {};'
ok 'placed file does not round-trip: exit 2'            "$(yes_if '[ "$(rc_of "$MAIN")" -eq 2 ]')"
fake_ft 15.20.0 "$SINK_OK" "$REAL_PARSE"
ok 'firebase-tools below configDir support: exit 2'     "$(yes_if '[ "$(rc_of "$MAIN")" -eq 2 ] && [[ "$(launch "$MAIN")" == *"functions.configDir"* ]]')"
fake_ft 15.32.1 '"https://secretmanager.googleapis.com"' "$REAL_PARSE"
out="$(launch "$MAIN")"
ok 'sink ignored, offline: launches, says so'           "$(yes_if '[ "$(rc_of "$MAIN")" -eq 0 ] && [[ "$out" == *"ignores CLOUD_SECRET_MANAGER_URL"* ]]')"

# ── Committing a real service: the suite runs under the REAL id, and then the sink is load-bearing ──
sed -i 's/^  auth: true,/  auth: false,/' "$MAIN/$ENV"
out="$(launch "$MAIN")"
ok 'sink ignored under the real id: exit 2'             "$(yes_if '[ "$(rc_of "$MAIN")" -eq 2 ]')"
fake_ft 15.32.1 "$SINK_OK" "$REAL_PARSE"
out="$(launch "$MAIN")"
ok 'EMULATE auth:false: --project=<real id>'            "$(yes_if 'grep -q -- "--project=acme-prod " "$MAIN/.fake-firebase-args" || grep -q -- "--project=acme-prod$" "$MAIN/.fake-firebase-args"')"
ok '…and the banner says REAL, and why'                 "$(yes_if '[[ "$out" == *"acme-prod — REAL"*"commits auth"* ]]')"
sed -i 's/^  auth: false,/  auth: true,/' "$MAIN/$ENV"
rm -rf "$MAIN/node_modules"

# ── The build output: the esbuild plugin writes the inert file into every build ──────────────────
mkdir -p "$TMP/build"
printf 'x((0, p.defineSecret)("BUILD_ONLY"));\n' > "$TMP/build/main.js"
node -e '
  const { inertSecretsPlugin } = require(process.argv[1]);
  let onEnd;
  inertSecretsPlugin({ source: process.argv[2] }).setup({ initialOptions: { outfile: process.argv[3] + "/main.js" }, onEnd: (f) => (onEnd = f) });
  onEnd({ errors: [] });
' "$MAIN/tools/emulator-secrets.cjs" "$MAIN/$FN" "$TMP/build" 2>/dev/null
ok 'build: inert file written beside the bundle'        "$(yes_if 'grep -qx "BUILD_ONLY=\"EMULATOR_INERT_BUILD_ONLY\"" "$TMP/build/.secret.local" && grep -qx "BOT_TOKEN=\"EMULATOR_INERT_BOT_TOKEN\"" "$TMP/build/.secret.local"')"
ok 'build: no production key name (not a build input)'  "$(yes_if '! grep -q STRIPE_KEY "$TMP/build/.secret.local"')"
ok 'build: firebase-refused keys left out'              "$(yes_if '! grep -q legacy_key "$TMP/build/.secret.local"')"

# ── Storage data follows the project id: an export saved under the real bucket is moved, never hidden ──
D="$MAIN/.emulator-data"
mkdir -p "$D/storage_export/metadata" "$D/storage_export/blobs"
printf '{"version":"x"}\n' > "$D/firebase-export-metadata.json"
printf '{"buckets":[{"id":"acme-prod.firebasestorage.app"}]}\n' > "$D/storage_export/buckets.json"
printf '{"name":"f.txt","bucket":"acme-prod.firebasestorage.app"}\n' > "$D/storage_export/metadata/u1.json"
out="$(launch "$MAIN")"
ok 'storage: moved to the offline id'"'"'s default bucket' "$(yes_if 'grep -q "demo-acme-prod.appspot.com" "$D/storage_export/buckets.json" && grep -q "demo-acme-prod.appspot.com" "$D/storage_export/metadata/u1.json"')"
ok 'storage: …and said so'                              "$(yes_if '[[ "$out" == *"Storage data moved"* ]]')"

exit "$FAILED"
