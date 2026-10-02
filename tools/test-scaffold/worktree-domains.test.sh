#!/usr/bin/env bash
# tools/worktree-domains/worktree-domains — the route registry every co-served worktree writes into.
#
# WHAT THIS GUARDS. Both failures here are silent by construction:
#   - CONCURRENT REGISTERS. Every route change is a read-modify-write of routes.json. Unserialised, two serves
#     registering at once each read the old table and the second write dropped the first's route — 12 parallel
#     registers left 9 routes, and every one of them reported success. The symptom is a `<slug>.localhost`
#     that 404s for one worktree, nowhere near the cause.
#   - RECONCILE'S SLUG RULE. A route is kept only while some tree still answers to its slug. The engine
#     REGISTERS one slug rule (tools/dev/lib/worktrees.mjs); a second copy in reconcile disagreed on branches
#     like `fix/Foo--bar` and dropped live routes as "worktree gone". There is now one rule, and this asserts
#     that what the engine would register is what reconcile keeps.
#
# Runs the shipped templates as a project would have them, against a throwaway repo, a private WD_RUNTIME and a
# random high proxy port — nothing touches :80 or this workspace, and everything started is torn down.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GEN="$ROOT/plugins/project-starter/skills/new-project/assets/nx-tools/src/generators"

for bin in node git flock ss setsid; do
  command -v "$bin" >/dev/null 2>&1 || { echo "  skip  $bin unavailable"; exit 0; }
done

TMP="$(mktemp -d)"
PIDS=()
WD=""
cleanup() {
  [ -n "$WD" ] && WD_RUNTIME="$TMP/rt" WD_PORT="$PROXY_PORT" bash "$WD" stop >/dev/null 2>&1
  for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null; done
  rm -rf "$TMP"
}
trap cleanup EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t

FAILED=0
ok()   { printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; FAILED=1; }
free_port() { node -e "const s=require('net').createServer().listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})"; }
listen() {   # listen <port> — hold a real listener in the background
  node -e "require('net').createServer().listen(Number(process.argv[1]),'127.0.0.1')" "$1" &
  PIDS+=("$!")
  for _ in $(seq 50); do ss -ltn | grep -q ":$1 " && return 0; sleep 0.1; done
}

# ── the project: the engine + worktree-domains, as the web layer writes them ─────────────────────────────────
REPO="$TMP/shop"
mkdir -p "$REPO/tools/worktree-domains" "$REPO/tools/dev/lib"
cp "$GEN/worktree-domains/worktree-domains.tpl" "$REPO/tools/worktree-domains/worktree-domains"
cp "$GEN/worktree-domains/proxy.mjs.tpl" "$REPO/tools/worktree-domains/proxy.mjs"
for f in "$GEN"/dev/files/lib/*.tpl; do cp "$f" "$REPO/tools/dev/lib/$(basename "${f%.tpl}")"; done
git -C "$REPO" init -q -b main
git -C "$REPO" add -A && git -C "$REPO" commit -qm init
git -C "$REPO" worktree add -q -b 'fix/Foo--bar' "$TMP/wt-a"
git -C "$REPO" worktree add -q -b "feat/$(printf 'x%.0s' $(seq 70))" "$TMP/wt-b"

WD="$REPO/tools/worktree-domains/worktree-domains"
PROXY_PORT="$(free_port)"
export WD_RUNTIME="$TMP/rt" WD_PORT="$PROXY_PORT"

# ── 12 registers at once: every route must land ──────────────────────────────────────────────────────────────
for i in $(seq 1 12); do bash "$WD" register "par-$i" "$((30000 + i))" >"$TMP/reg-$i.log" 2>&1 & done
wait
n="$(node -e "console.log(Object.keys(JSON.parse(require('fs').readFileSync('$TMP/rt/routes.json','utf8'))).filter(k=>k.startsWith('par-')).length)")"
[ "$n" = 12 ] && ok "12 concurrent registers → 12 routes" || fail "12 concurrent registers → $n routes (lost writes)"

# ── reconcile keeps exactly what the engine registers ────────────────────────────────────────────────────────
for i in $(seq 1 12); do bash "$WD" unregister "par-$i" >/dev/null 2>&1; done
slugs="$(cd "$REPO" && node --input-type=module -e "
  const { collectWorktrees, servedSlug } = await import('./tools/dev/lib/worktrees.mjs');
  const t = collectWorktrees(process.cwd());
  console.log(t.map((w) => servedSlug(w, t)).join(' '));")"
for s in $slugs; do
  p="$(free_port)"; listen "$p"
  bash "$WD" register "$s" "$p" >/dev/null 2>&1 || fail "register $s"
done
p="$(free_port)"; listen "$p"
bash "$WD" register gone-tree "$p" >/dev/null 2>&1
out="$(cd "$REPO" && bash "$WD" reconcile 2>&1)"
kept="$(bash "$WD" list)"
all_kept=1
for s in $slugs; do printf '%s' "$kept" | grep -q " $s.localhost " || { all_kept=0; fail "reconcile dropped the live route $s ($out)"; }; done
[ "$all_kept" = 1 ] && ok "reconcile keeps every live tree's route ($(printf '%s' "$slugs" | tr ' ' ','))"
printf '%s' "$out" | grep -q 'dropped gone-tree.localhost.*worktree gone' \
  && ok "reconcile drops a route no tree answers to" || fail "reconcile kept a dead slug: $out"

# ── stop really stops ───────────────────────────────────────────────────────────────────────────────────────
pid="$(cat "$TMP/rt/proxy.pid" 2>/dev/null || true)"
bash "$WD" stop >/dev/null 2>&1 && ! kill -0 "${pid:-0}" 2>/dev/null \
  && ok "stop: the proxy is gone" || fail "stop: the proxy (pid ${pid:-?}) survived"

exit "$FAILED"
