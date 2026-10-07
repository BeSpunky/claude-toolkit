#!/usr/bin/env bash
# WHICH PROJECT THE EMULATOR SUITE RUNS UNDER — tools/emulator-project.mjs, the suite's half of a decision the browser
# makes too (firebase.config.ts → emulatorProjectId: `environment.emulators.<service>.default === false` → the real id).
#
# WHAT THIS GUARDS. The suite used to READ environment.ts as text, and the text is not the values:
#   • a comment — `auth: true, // auth: false for real`, or a commented-out `// auth: false,` — moved the suite onto
#     the REAL project id (with the developer's login) while the browser stayed offline;
#   • a typed `const EMULATE: Record<string, boolean> = {…}`, or an app's own `auth: {…}` block earlier in the file,
#     hid a committed real service, so the suite ran offline under a browser on the real id.
# Now the file is EVALUATED (Node's type stripping) and asked the browser's question; a file that cannot be evaluated
# is exit 2, never a guess. Also: Storage data follows the project id even when environment.ts names no bucket.
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/text.sh"
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TPL_DIR="$ROOT/plugins/house/engine/nx-tools/src/generators/firebase-emulators"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
node "$ROOT/tools/test-scaffold/emulator-tools.mjs" "$TMP"
EP="$TMP/tools/emulator-project.mjs"
ENVS="$TMP/app/src/environments"
mkdir -p "$ENVS"
cp "$TPL_DIR/environment.interface.ts.tpl" "$ENVS/environment.interface.ts"
# Like an Angular workspace: a package.json that says nothing about module type.
printf '{ "name": "ws", "private": true }\n' > "$TMP/package.json"

FAILED=0
ok()   { printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; FAILED=1; }

# The generated environment.ts, for the workspace `acme`, with its projectId and EMULATE map rewritten.
generated() {   # generated <projectId> <EMULATE body>
  sed -e 's/{{workspaceName}}/acme/g' -e "s/projectId: 'demo-acme'/projectId: '$1'/" "$TPL_DIR/environment.ts.tpl" |
    node -e '
      const src = require("fs").readFileSync(0, "utf8");
      process.stdout.write(src.replace(/const EMULATE = \{[^}]*\};/, process.argv[1]));
    ' "$2"
}
resolve() {   # resolve <file> → "<EMU_PROJECT>|<EMU_REAL_SERVICES>", or "exit <n>"
  local out rc
  out="$(node "$EP" resolve "$1" demo-fallback 2>"$TMP/err")"; rc=$?
  [ "$rc" -eq 0 ] || { echo "exit $rc"; return; }
  ( eval "$out"; printf '%s|%s' "$EMU_PROJECT" "$EMU_REAL_SERVICES" )
}
expect() {   # expect <label> <file> <want>
  local got; got="$(resolve "$2")"
  if [ "$got" = "$3" ]; then ok "$1"; else fail "$1 — want [$3], got [$got]: $(cat "$TMP/err")"; fi
}

generated acme-prod 'const EMULATE = { auth: true, firestore: true, storage: true, functions: true };' > "$ENVS/all.ts"
expect 'everything emulated → the offline twin' "$ENVS/all.ts" 'demo-acme-prod|'

generated acme-prod 'const EMULATE = {
  auth: true, // auth: false for real Auth
  firestore: true,
  storage: true,
  functions: true,
};' > "$ENVS/trailing-comment.ts"
expect 'a trailing `// auth: false` comment is not a commitment' "$ENVS/trailing-comment.ts" 'demo-acme-prod|'

generated acme-prod 'const EMULATE = {
  auth: true,
  // auth: false,
  firestore: true,
  storage: true,
  functions: true,
};' > "$ENVS/commented-out.ts"
expect 'a commented-out `// auth: false,` is not a commitment' "$ENVS/commented-out.ts" 'demo-acme-prod|'

generated acme-prod 'const EMULATE: Record<"auth" | "firestore" | "storage" | "functions", boolean> = { auth: false, firestore: true, storage: true, functions: true };' > "$ENVS/typed.ts"
expect 'a TYPED EMULATE map committing auth real → the real id' "$ENVS/typed.ts" 'acme-prod|auth'

generated acme-prod 'const EMULATE = { auth: false, firestore: true, storage: false, functions: true };' > "$ENVS/partial.ts"
expect 'partial-real (auth + storage) → the real id, both named' "$ENVS/partial.ts" 'acme-prod|auth,storage'

# An app's own top-level `auth: {…}` and `google: { projectId }` blocks BEFORE the firebase/emulators ones.
cat > "$ENVS/app-fields.ts" <<'EOF'
import type { Environment } from './environment.interface';
const EMULATE = { auth: false, firestore: true };
export const environment: Environment & { auth: { providers: string[] }; google: { projectId: string } } = {
  auth: { providers: ['google'] },
  google: { projectId: 'calendar-proj' },
  production: false,
  firebase: { projectId: 'acme-prod', apiKey: 'k', appId: 'a' },
  emulators: {
    auth: { url: 'http://localhost:9099', default: EMULATE.auth },
    firestore: { host: 'localhost', port: 8080, default: EMULATE.firestore },
  },
};
EOF
expect 'earlier `auth: {…}` / `google: { projectId }` blocks do not shadow the real values' "$ENVS/app-fields.ts" 'acme-prod|auth'

# Values from an import (extensionless, as the app's build resolves it) and a computed default.
printf "export const PROJECT: string = 'acme-imported';\nexport const REAL = new Set(['functions']);\n" > "$ENVS/shared.ts"
cat > "$ENVS/imported.ts" <<'EOF'
import type { Environment } from './environment.interface';
import { PROJECT, REAL } from './shared';
const emulated = (service: string): boolean => !REAL.has(service);
export const environment: Environment = {
  production: false,
  firebase: { projectId: PROJECT, apiKey: 'k', appId: 'a' },
  emulators: { functions: { host: 'localhost', port: 5001, default: emulated('functions') } },
};
EOF
expect 'values from an extensionless import and a computed default are evaluated' "$ENVS/imported.ts" 'acme-imported|functions'

generated demo-acme 'const EMULATE = { auth: false, firestore: true, storage: true, functions: true };' > "$ENVS/demo-real.ts"
expect 'an id that is already demo- stays offline (as the browser decides)' "$ENVS/demo-real.ts" 'demo-acme|'

expect 'no environment file → the workspace fallback, offline' "$ENVS/absent.ts" 'demo-fallback|'

printf "import type { Environment } from './environment.interface';\nenum Mode { A }\nexport const environment = { firebase: { projectId: 'x' } };\n" > "$ENVS/enum.ts"
expect 'a file Node cannot evaluate (an enum) → exit 2' "$ENVS/enum.ts" 'exit 2'
in_text "$(cat "$TMP/err")" -q 'TypeScript enum' && ok '…naming the reason' || fail "…naming the reason: $(cat "$TMP/err")"

printf "import { x } from '@app/config';\nexport const environment = { firebase: { projectId: x } };\n" > "$ENVS/unresolvable.ts"
expect 'an import Node cannot resolve → exit 2' "$ENVS/unresolvable.ts" 'exit 2'

printf "export const somethingElse = 1;\n" > "$ENVS/no-env.ts"
expect 'no `environment` export → exit 2' "$ENVS/no-env.ts" 'exit 2'

# ── Storage follows the project id, with no storageBucket in environment.ts ─────────────────────────────────────
export_dir() {   # export_dir <dir> <bucket>… — one file per bucket
  local d="$1"; shift
  mkdir -p "$d/storage_export/metadata"
  node -e '
    const fs = require("fs"); const [dir, ...buckets] = process.argv.slice(1);
    fs.writeFileSync(`${dir}/storage_export/buckets.json`, JSON.stringify({ buckets: buckets.map((id) => ({ id })) }));
    buckets.forEach((b, i) => fs.writeFileSync(`${dir}/storage_export/metadata/f${i}.json`, JSON.stringify({ bucket: b, name: `f${i}` })));
  ' "$d" "$@"
}
vars="$(node "$EP" resolve "$ENVS/all.ts" x)"
others="$(eval "$vars"; printf '%s' "$EMU_OTHER_BUCKETS")"
to="$(eval "$vars"; printf '%s' "$EMU_BUCKET")"
[ "$others" = 'acme-prod.appspot.com,acme-prod.firebasestorage.app' ] && [ "$to" = 'demo-acme-prod.appspot.com' ] \
  && ok 'offline, no storageBucket: both real default buckets are the candidates' || fail "candidates [$others] → [$to]"
export_dir "$TMP/d1" acme-prod.firebasestorage.app
said="$(node "$EP" align-storage "$TMP/d1" "$others" "$to")"
in_text "$said" -q 'moved from bucket acme-prod.firebasestorage.app to demo-acme-prod.appspot.com' \
  && grep -q '"demo-acme-prod.appspot.com"' "$TMP/d1/storage_export/metadata/f0.json" \
  && ok 'data under the real project default (.firebasestorage.app) is moved to the offline bucket' || fail "align: $said"
export_dir "$TMP/d2" acme-prod.appspot.com acme-prod.firebasestorage.app
said="$(node "$EP" align-storage "$TMP/d2" "$others" "$to")"
in_text "$said" -q 'left as is' && grep -q '"acme-prod.appspot.com"' "$TMP/d2/storage_export/metadata/f0.json" \
  && ok 'two candidates holding files: nothing moves, and that is said' || fail "ambiguous align: $said"
export_dir "$TMP/d3" acme-prod.appspot.com
echo '{ not json' > "$TMP/d3/storage_export/metadata/f0.json"
said="$(node "$EP" align-storage "$TMP/d3" "$others" "$to" 2>&1)"; rc=$?
[ "$rc" -eq 1 ] && in_text "$said" -q 'could not align' && ok 'an unreadable export is reported, never swallowed' || fail "corrupt align (rc $rc): $said"
vars="$(node "$EP" resolve "$ENVS/typed.ts" x)"
( eval "$vars"; [ -z "$EMU_BUCKET" ] && [ "$EMU_STORAGE_BUCKET_UNSET" = 1 ] ) \
  && ok 'real, no storageBucket: no bucket is invented, the gap is flagged for the banner' || fail "real/no bucket: $vars"

exit "$FAILED"
