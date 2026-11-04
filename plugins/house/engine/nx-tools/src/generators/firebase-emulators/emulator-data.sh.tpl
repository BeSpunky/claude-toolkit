#!/usr/bin/env bash
# The emulator working-data lifecycle — the one place that owns the relationship between the **ephemeral, gitignored
# working dirs** the emulators import and export and the **pristine seeds** under tools/emulator-seeds/.
#
#   .emulator-data/              ← the base stack's cache: what a serve imports on start and writes back on a clean
#                                  exit (gitignored, ephemeral)
#   .emulator-data-<offset>/     ← the same, for an isolated stack (a worktree's, or any shifted block)
#   tools/emulator-seeds/<name>/ ← the seeds: known-good worlds, rebuilt by `nx run firebase:seed:build` (never written
#                                  here). Built artifacts, so a worktree may have none: it reads the main worktree's
#
# PORT_OFFSET names a stack, as everywhere in this toolkit: 0 or unset is the base stack.
#   dir             — where that stack's data lives. tools/emulators.sh asks here.
#   ensure          — prime that stack's dir from the default seed IF it is empty, so its first start (fresh clone, or
#                     just after a reset) is a known world instead of an error on a missing --import dir.
#   reset [<seed>]  — the on-call reset, to the named seed (default: default). With PORT_OFFSET, that stack. Without, every
#                     data dir of THIS tree, because which block a worktree's next stack lands on is the engine's call.
#                     REFUSED while a suite it would reset is running: that suite would export over the reset when it
#                     stops. Takes effect on the next start.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SEEDS_DIR="$ROOT/tools/emulator-seeds"
DEFAULT_SEED="default"
OFFSET="${PORT_OFFSET:-0}"
# A data dir is named by a number. Anything else (`auto` is the engine's to resolve) names no stack, and would "reset" a
# directory nothing ever reads.
case "$OFFSET" in
  *[!0-9]*) echo "[emulator-data] PORT_OFFSET must be a number, not '$OFFSET'." >&2; exit 2 ;;
esac

data_dir() { if [ "$1" = 0 ]; then printf '%s' "$ROOT/.emulator-data"; else printf '%s' "$ROOT/.emulator-data-$1"; fi; }

# An import dir is only usable to `firebase emulators:start --import` once it carries the export metadata firebase
# writes; its presence is our "primed" signal.
is_primed() { [ -f "$1/firebase-export-metadata.json" ]; }

# `|| true` under `set -euo pipefail`: outside a repository `git worktree list` exits 128, and that is ordinary here.
main_worktree() { git -C "$ROOT" worktree list --porcelain 2>/dev/null | sed -n 's/^worktree //p' | head -1 || true; }

# The seed, resolved. THIS TREE'S OWN SEEDS WIN: a worktree that builds or edits seeds does it in isolation and must get
# its own world back. One that has not has no seeds at all, and starting from an empty world would be a confusing
# morning, so it borrows the main tree's as a read-only BASE: primed by copy, so nothing it does reaches back.
seed_path() {   # seed_path <name> — echoes the path, or nothing when there is none
  local main
  if is_primed "$SEEDS_DIR/$1"; then
    printf '%s' "$SEEDS_DIR/$1"
    return
  fi
  main="$(main_worktree)"
  if [ -n "$main" ] && [ "$main" != "$ROOT" ] && is_primed "$main/tools/emulator-seeds/$1"; then
    printf '%s' "$main/tools/emulator-seeds/$1"
  fi
}

prime_from() {   # prime_from <seed name> <seed path> <dir>
  rm -rf "$3"
  cp -r "$2" "$3"
  case "$2" in
    "$ROOT"/*) echo "[emulator-data] $3 primed from this tree's '$1' seed." >&2 ;;
    *)         echo "[emulator-data] $3 primed from the main worktree's '$1' seed: $2" >&2 ;;
  esac
}

# The suites running from THIS tree (at <offset>, when given): `<key> — stop it with: <command>`, one per line. A stack
# holds a suite when it is one run on its own or a serve that started the fragment's `emulators` process. A seed build's
# private suite reads none of these dirs. Whatever state it is in, it may still export: finishing counts.
running_suites() {   # running_suites [<offset>]
  node "$ROOT/tools/dev/dev.mjs" ps --json | node -e '
    const { realpathSync } = require("node:fs");
    const real = (path) => { try { return realpathSync(path); } catch { return path; } };
    const [root, offset] = process.argv.slice(1);
    let text = "";
    process.stdin.on("data", (chunk) => (text += chunk)).on("end", () => {
      for (const s of JSON.parse(text)) {
        const suite = s.app === "firebase" || (s.processes ?? []).some((p) => p.id === "emulators");
        if (suite && real(s.tree) === real(root) && (offset === "" || String(s.offset) === offset)) {
          console.log(`${s.key} — stop it with: tools/dev/dev stop ${s.app} --offset=${s.offset} --worktree=${s.tree}`);
        }
      }
    });
  ' "$ROOT" "${1:-}"
}

reset() {
  local seed="$1" src running dir
  local targets=()
  src="$(seed_path "$seed")"
  if [ -z "$src" ]; then
    echo "[emulator-data] seed '$seed' not found in $SEEDS_DIR, or in the main worktree's." >&2
    echo "[emulator-data] build the seeds first:  yarn nx run firebase:seed:build" >&2
    return 1
  fi

  [ -f "$ROOT/tools/dev/dev.mjs" ] || { echo "[emulator-data] Nothing was reset: the dev engine (tools/dev) is missing, and it is how a running suite is found. Run the house upgrade." >&2; return 1; }
  if ! running="$(running_suites "${PORT_OFFSET:-}")"; then
    echo "[emulator-data] Nothing was reset: could not tell whether a suite is running (tools/dev/dev ps, above)." >&2
    return 1
  fi
  if [ -n "$running" ]; then
    echo "[emulator-data] Nothing was reset: a running suite exports over its data when it stops, so the reset would be undone." >&2
    printf '%s\n' "$running" | sed 's/^/[emulator-data]   /' >&2
    echo "[emulator-data] Stop it, then reset again." >&2
    return 1
  fi

  if [ -n "${PORT_OFFSET:-}" ]; then
    targets=("$(data_dir "$OFFSET")")
  else
    targets=("$(data_dir 0)")
    for dir in "$ROOT"/.emulator-data-*; do
      [[ "$dir" =~ /\.emulator-data-[0-9]+$ ]] && [ -d "$dir" ] && targets+=("$dir")
    done
  fi
  for dir in "${targets[@]}"; do prime_from "$seed" "$src" "$dir"; done
  echo "[emulator-data] reset to '$seed'. It takes effect on the next start." >&2
  if [ -z "${PORT_OFFSET:-}" ] && [ "$seed" != "$DEFAULT_SEED" ]; then
    echo "[emulator-data] A stack with no data yet still starts from '$DEFAULT_SEED'. To start one from '$seed': PORT_OFFSET=<its offset> bash tools/emulator-data.sh reset $seed" >&2
  fi
}

cmd="${1:-}"
case "$cmd" in
  dir)
    data_dir "$OFFSET"
    ;;
  ensure)
    # Already primed (your cached session) → leave it untouched. Empty → prime from the default seed if one exists; if
    # no seeds are built yet, stay empty and let emulators.sh start fresh (it only passes --import when the dir is primed).
    DIR="$(data_dir "$OFFSET")"
    is_primed "$DIR" && exit 0
    SRC="$(seed_path "$DEFAULT_SEED")"
    if [ -n "$SRC" ]; then
      prime_from "$DEFAULT_SEED" "$SRC" "$DIR"
    else
      echo "[emulator-data] no working data and no '$DEFAULT_SEED' seed yet — starting fresh." >&2
      echo "[emulator-data] build seeds anytime with:  yarn nx run firebase:seed:build" >&2
    fi
    ;;
  reset)
    reset "${2:-$DEFAULT_SEED}"
    ;;
  *)
    echo "usage: emulator-data.sh {dir | ensure | reset [<seed-name>]}" >&2
    exit 2
    ;;
esac
