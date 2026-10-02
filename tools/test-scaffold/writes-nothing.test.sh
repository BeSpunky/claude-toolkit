#!/usr/bin/env bash
# "NOTHING HAS BEEN WRITTEN" must be true — of a refused sync, and of a --print-inner that "runs nothing".
#
# WHAT THIS GUARDS. preflight-gate.test.sh proves the gate REFUSES; this proves that by the time it does, the
# project is untouched. Both used to be false in the same way: the outer shell wrote BEFORE the rendered program
# (and its preflight) ever ran — it tagged a dirty tree, and deleted a tracked stray yarn.lock — so a refusal that
# printed "NOTHING HAS BEEN WRITTEN" had already written, and listed its own deletion as the user's dirty change.
# --print-inner did the same while promising to run nothing. The symptom is a stray tag and a missing lockfile in
# someone's repo, discovered later, with nothing pointing back here.
#
# Also: the parent directory is not a name and is never validated, so it must reach the program as data. A
# parent named O'Brien used to close the rendered quote and run the rest of the line as shell.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCAFFOLD="$ROOT/plugins/project-starter/skills/new-project/assets/scaffold.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t

FAILED=0
ok()   { printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; FAILED=1; }

# An npm project (declared), with a TRACKED stray yarn.lock — the case the lockfile cleanup deletes — on a
# feature branch of a repo that has adopted the branch model, under a parent directory with a quote in it.
P="$TMP/o'brien/shop"
mkdir -p "$P"
git -C "$P" init -q -b main
printf '{ "name": "shop", "private": true, "packageManager": "npm@10.9.0" }\n' > "$P/package.json"
printf '{}\n' > "$P/package-lock.json"
printf '# yarn lockfile v1\n' > "$P/yarn.lock"
printf '{}\n' > "$P/nx.json"
git -C "$P" add -A && git -C "$P" commit -qm init
git -C "$P" branch development && git -C "$P" checkout -q -b feat/x
snapshot() { { git -C "$P" status --porcelain -uall; git -C "$P" tag; git -C "$P" rev-parse HEAD; ls -A "$P"; } 2>&1; }

# ── --print-inner runs nothing, and the quoted parent is data, not code ────────────────────────────────────────
before="$(snapshot)"
prog="$(bash "$SCAFFOLD" --sync --yes --print-inner "$P" 2>"$TMP/render.err")"; rc=$?
if [ "$rc" -ne 0 ] && grep -q 'docker' "$TMP/render.err"; then
  echo "  skip  neither a Node 22.18+ nor docker here — the render needs one of them"
  exit 0
fi
if [ "$rc" -ne 0 ] || [ -z "$prog" ]; then
  fail "--print-inner did not render (rc=$rc): $(tail -3 "$TMP/render.err")"
  exit 1
fi
[ "$(snapshot)" = "$before" ] && ok "--print-inner wrote nothing (no tag, yarn.lock still there)" \
  || fail "--print-inner changed the project: $(snapshot)"
printf '%s\n' "$prog" | bash -n /dev/stdin 2>/dev/null && ok "the program parses with a quote in the parent path" \
  || fail "the program does not parse with a quote in the parent path"
printf '%s\n' "$prog" | grep -q "o'brien" && fail "the parent path is spelled INTO the program (it must arrive as environment)" \
  || ok "the parent path is not spelled into the program"

# ── a refused sync writes nothing ─────────────────────────────────────────────────────────────────────────────
# Only on the native runtime: the refusal is reached by RUNNING the program, and a Docker run is not a unit test.
node_ok() { command -v node >/dev/null && command -v npm >/dev/null && node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)'; }
if node_ok; then
  printf 'in flight\n' > "$P/wip.txt"
  before="$(snapshot)"
  out="$(env -u CI bash "$SCAFFOLD" --sync --yes "$P" 2>&1)"; rc=$?
  printf '%s' "$out" | grep -q '^SYNC_REFUSED: dirty-tree' && [ "$rc" -ne 0 ] && ok "a dirty tree is refused" \
    || fail "a dirty tree was not refused (rc=$rc)"
  [ "$(snapshot)" = "$before" ] && ok "…and the refusal wrote nothing (no tag, yarn.lock kept, only wip.txt dirty)" \
    || fail "the refused sync changed the project: $(snapshot)"
  printf '%s' "$out" | grep -qE 'SYNC_FAILED|reset --hard|restore +:' && fail "a refusal printed failure/restore advice" \
    || ok "…and printed no SYNC_FAILED or restore advice on top of its own verdict"
else
  echo "  skip  the refusal half needs Node 22.18+ (the native runtime)"
fi

exit "$FAILED"
