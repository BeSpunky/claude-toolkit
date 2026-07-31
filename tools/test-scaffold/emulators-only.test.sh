#!/usr/bin/env bash
# `tools/emulators.sh` — what it actually hands to `firebase emulators:start`.
#
# WHAT THIS GUARDS. Two silent failures, both of which have already happened in a real project:
#
#   1. NO --only. `firebase emulators:start` starts what it INFERS is applicable, not what firebase.json
#      declares. A root `apphosting.yaml` — which the house generator writes, for deploys — makes it bring up
#      the App Hosting emulator, whose job is to run `yarn dev`. There is no such script in a house workspace,
#      so it exits 1 and firebase-tools takes the whole suite with it, surfacing as an unrelated
#      `TIMEOUT: Port 5002`.
#   2. --only WITHOUT persistence. Passing `--only` is what used to flip export-on-exit off, because it meant
#      "a partial run". Now that every run passes a derived `--only`, conflating the two would silently stop
#      every serve from saving its emulator data — signups and seeded state gone, with nothing in the output
#      to say so. That is a worse bug than the one being fixed, introduced by fixing it.
#   3. A SILENT EXIT BEFORE STARTING. The fixtures below are deliberately NOT git repositories, which is how
#      this suite found a live one: `git worktree list` exits 128 outside a repo, `2>/dev/null` hides the
#      output but not the status, and under `set -euo pipefail` that killed the script one line before it
#      would have launched the suite — no message, exit 128. Keep the fixtures non-git; the coverage is free.
#
# HOW. The template is rendered into a temp workspace with stub `reap-emulators.sh` / `emulator-data.sh`, and a
# fake `firebase` on PATH that records its arguments instead of starting anything. So this asserts the real
# shipped script's real command line, without Java, firebase-tools, or a network.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TPL="$ROOT/plugins/project-starter/skills/new-project/assets/nx-tools/src/generators/firebase-emulators/emulators.sh.tpl"

[ -f "$TPL" ] || { echo "FATAL: emulators.sh.tpl not found at $TPL" >&2; exit 2; }
# Never pass vacuously: if the template stops containing the derivation, this suite must fail loudly rather
# than keep asserting against a script that no longer does the thing.
grep -q 'EXPLICIT_ONLY' "$TPL" || {
  echo "FATAL: emulators.sh.tpl no longer mentions EXPLICIT_ONLY — the derivation moved or was removed." >&2
  exit 2
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Fake firebase: record argv, exit clean. The template `exec`s it, so this is the end of the run.
mkdir -p "$TMP/bin"
cat > "$TMP/bin/firebase" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" > "$FIREBASE_ARGS_FILE"
exit 0
STUB
chmod +x "$TMP/bin/firebase"

# Render the template: substitute the two placeholders the generator fills in.
render() {   # render <workspace dir>
  sed -e 's/{{workspaceName}}/testws/g' -e 's|{{appEnvPath}}|apps/demo/src/environments/environment.ts|g' \
    "$TPL" > "$1/tools/emulators.sh"
  chmod +x "$1/tools/emulators.sh"
}

# A workspace with the given `emulators` block, plus the stubs the script chains to.
mkworkspace() {   # mkworkspace <name> <emulators json>
  local d="$TMP/$1"
  mkdir -p "$d/tools"
  printf '{ "emulators": %s }\n' "$2" > "$d/firebase.json"
  printf '#!/usr/bin/env bash\nexit 0\n' > "$d/tools/reap-emulators.sh"
  printf '#!/usr/bin/env bash\nexit 0\n' > "$d/tools/emulator-data.sh"
  chmod +x "$d/tools/reap-emulators.sh" "$d/tools/emulator-data.sh"
  render "$d"
  echo "$d"
}

run() {   # run <dir> [args...] -> the argv the script handed to firebase
  local d="$1"; shift
  export FIREBASE_ARGS_FILE="$d/.firebase-args"
  rm -f "$FIREBASE_ARGS_FILE"
  ( cd "$d" && PATH="$TMP/bin:$PATH" bash tools/emulators.sh "$@" >/dev/null 2>&1 )
  cat "$FIREBASE_ARGS_FILE" 2>/dev/null || echo '<never invoked firebase>'
}

FAILED=0
expect() {   # expect <label> <needle> <haystack>  — needle must be present
  case "$3" in
    *"$2"*) printf '  ok   %-40s\n' "$1" ;;
    *) printf '  FAIL %-40s missing:[%s] in:[%s]\n' "$1" "$2" "$3"; FAILED=1 ;;
  esac
}
refute() {   # refute <label> <needle> <haystack> — needle must be absent
  case "$3" in
    *"$2"*) printf '  FAIL %-40s unexpected:[%s] in:[%s]\n' "$1" "$2" "$3"; FAILED=1 ;;
    *) printf '  ok   %-40s\n' "$1" ;;
  esac
}

# ── A full run derives the list from firebase.json, and still persists ──────────────────────────────────────
# This emulator set is the one from the project where the bug was found.
d="$(mkworkspace full '{
  "auth": { "host": "0.0.0.0", "port": 9099 },
  "firestore": { "host": "0.0.0.0", "port": 8080 },
  "storage": { "host": "0.0.0.0", "port": 9199 },
  "functions": { "host": "0.0.0.0", "port": 5001 },
  "ui": { "enabled": true, "host": "0.0.0.0", "port": 4000 },
  "singleProjectMode": true
}')"
out="$(run "$d")"
expect 'full run passes a derived --only' '--only auth,firestore,storage,functions,ui' "$out"
refute 'singleProjectMode is not an emulator' 'singleProjectMode' "$out"
expect 'full run still exports (persistence)' '--export-on-exit' "$out"

# ── Infrastructure entries are never selectable ─────────────────────────────────────────────────────────────
d="$(mkworkspace infra '{
  "auth": { "port": 9099 },
  "hub": { "port": 4400 },
  "logging": { "port": 4500 }
}')"
out="$(run "$d")"
expect 'hub/logging excluded from --only' '--only auth' "$out"
refute 'hub not passed as an emulator' 'hub' "$out"
refute 'logging not passed as an emulator' 'logging' "$out"

# ── An explicit --only is a PARTIAL run: honoured, and persistence off ──────────────────────────────────────
d="$(mkworkspace focused '{ "auth": { "port": 9099 }, "firestore": { "port": 8080 }, "ui": { "port": 4000 } }')"
out="$(run "$d" --only auth,ui)"
expect 'explicit --only is honoured verbatim' '--only auth,ui' "$out"
refute 'explicit --only does NOT export' '--export-on-exit' "$out"

# ── No emulator block: warn rather than silently fall back into the broken default ──────────────────────────
d="$(mkworkspace empty '{}')"
export FIREBASE_ARGS_FILE="$d/.firebase-args"
warn="$( cd "$d" && PATH="$TMP/bin:$PATH" bash tools/emulators.sh 2>&1 >/dev/null )"
expect 'empty emulators block warns' 'no emulators found in firebase.json' "$warn"
out="$(cat "$d/.firebase-args" 2>/dev/null || echo '')"
refute 'empty block passes no --only' '--only' "$out"

exit "$FAILED"
