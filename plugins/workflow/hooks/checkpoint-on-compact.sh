#!/usr/bin/env bash
# PreCompact hook — leave a breadcrumb before the session's context is summarized away.
#
# WHY THIS EXISTS. Good state is DISTILLED by the model — only it can tell a conclusion from a transcript. But
# the model won't volunteer a handoff at the one moment it matters most: a bloated session about to compact. And
# in a headless / auto-compaction run there may be no model turn at all to volunteer one. So reliable capture
# cannot depend on the model choosing to act.
#
# WHAT IT GUARANTEES vs. WHAT IT ASKS FOR. This hook does the DETERMINISTIC half itself: it writes a mechanical
# checkpoint — branch, HEAD, and the list of UNCOMMITTED files at compaction time (the genuinely perishable bit;
# git already preserves everything committed) — into the current effort's package. That file gets written even
# when nobody is watching. It then ASKS the model (stdout) to enrich it into a proper distilled baton. If that
# ask is honored, great; if not, the mechanical checkpoint still stands. Worst case is a thin baton, never none.
#
# WHY WRITING A FILE IS ALLOWED HERE. The rule the project-starter hook earned is "a hook may drive a CHEAP,
# ADDITIVE, REVERSIBLE action; never a heavy, irreversible one." Appending a timestamped markdown file is the
# cheap-additive class — and headless is the CASE FOR it, not against: an unattended agent most needs the
# breadcrumb, and an append needs no consent. (A Docker sync or a delete would be the other class — banned.)
#
# SCOPE. It writes ONLY when the current branch is a feature effort with an existing package — so checkpoints
# accrue exactly where wanted and never litter a protected line (per the declared branch model) or a throwaway branch. No package → it only nudges.
set -uo pipefail

# PreCompact delivers a JSON payload on stdin; we only care about the trigger (auto|manual), read best-effort.
STDIN="$(cat 2>/dev/null || true)"
TRIGGER="$(printf '%s' "$STDIN" | sed -nE 's/.*"trigger"[[:space:]]*:[[:space:]]*"([a-z]+)".*/\1/p' | head -1)"
case "$TRIGGER" in auto | manual) ;; *) TRIGGER="unknown" ;; esac

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}"
git -C "$PROJECT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

# Current effort = the branch's slug, its last path segment (feat/gift-picker → gift-picker; a hotfix line
# hotfix/main/fix-login → fix-login). Detached or on a protected line → no single effort to checkpoint; stay out.
branch="$(git -C "$PROJECT_DIR" branch --show-current 2>/dev/null || true)"
[ -n "$branch" ] || exit 0
slug="${branch##*/}"

# --- which lines are protected? the DECLARED branch model, never a hard-coded list -----------------------------
# The model lives in .bespunky/branches.json; readers like this one parse ONLY its derived `projection` block
# (names + globs), and refuse a schema major they don't know rather than guess. The copy on the integration
# line's tip is authoritative (the working tree's copy names that line); when that ref can't be resolved, the
# working-tree copy stands in; when the file is absent from the tip, the repo is undeclared.
# Undeclared (or no node to read JSON with — the toolkit's other hooks already rely on node) → the protective
# fallback: every name the toolkit ever forced, plus gitflow's.
UNDECLARED_PROTECTED="main master development develop staging"
DECL="$PROJECT_DIR/.bespunky/branches.json"
names="$UNDECLARED_PROTECTED"
globs=""
if [ -f "$DECL" ] && command -v node >/dev/null 2>&1; then
  model="$(node - "$PROJECT_DIR" "$DECL" <<'NODE' 2>/dev/null
const fs = require('fs'), cp = require('child_process');
const [dir, file] = process.argv.slice(2);
const fail = (msg) => { console.log('ERROR\t' + msg); process.exit(0); };
const read = (text, where) => {
  let doc; try { doc = JSON.parse(text); } catch { fail(where + ' is not valid JSON'); }
  const p = doc && doc.projection;
  if (!p || typeof p !== 'object') fail(where + ' has no projection block');
  if (p.schema !== 1) fail(where + ' has projection.schema ' + JSON.stringify(p.schema) + '; this plugin reads only schema 1 (update bespunky-workflow)');
  return p;
};
let p = read(fs.readFileSync(file, 'utf8'), 'the working-tree .bespunky/branches.json');
const integ = String(p.integration || '');
const git = (args) => cp.execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
let resolved = true;
try { git(['rev-parse', '--verify', '--quiet', integ + '^{commit}']); } catch { resolved = false; }
if (resolved) {
  let tip; try { tip = git(['show', integ + ':.bespunky/branches.json']); } catch { console.log('UNDECLARED'); process.exit(0); }
  p = read(tip, integ + ':.bespunky/branches.json');
}
for (const n of p.protected || []) console.log('NAME\t' + n);
for (const g of p.protectedPatterns || []) console.log('GLOB\t' + g);
NODE
)"
  case "$model" in
    ERROR*)
      # Refuse, don't guess: say why once and skip the checkpoint, since we can't tell a work branch from a line.
      printf '[bespunky-workflow] Skipped the pre-compaction checkpoint: %s.\n' "${model#ERROR	}"
      exit 0 ;;
    UNDECLARED | '') ;;
    *)
      names="$(printf '%s\n' "$model" | sed -n 's/^NAME	//p')"
      globs="$(printf '%s\n' "$model" | sed -n 's/^GLOB	//p')" ;;
  esac
fi
for n in $names; do [ "$branch" = "$n" ] && exit 0; done
while IFS= read -r g; do
  [ -n "$g" ] || continue
  # shellcheck disable=SC2254 # the glob is meant to match
  case "$branch" in $g) exit 0 ;; esac
done <<EOF_GLOBS
$globs
EOF_GLOBS

case "$slug" in '' | *[!a-z0-9-]*) exit 0 ;; esac
[ "${#slug}" -le 64 ] || exit 0

# Newest package for this slug (feature-package's own lookup). None yet → we can't place a checkpoint; nudge only.
pkg="$(ls -d "$PROJECT_DIR"/docs/features/*-"$slug" 2>/dev/null | tail -1 || true)"
if [ -z "$pkg" ] || [ ! -d "$pkg" ]; then
  cat <<EOF
[bespunky-workflow] Context is about to compact and there is no feature package for \`$slug\` yet. If a live
effort is in progress, capture it now before detail is lost: create the package and write a baton via the
\`bespunky-workflow:session-handoff\` skill (CAPTURE mode). Do this before continuing.
EOF
  exit 0
fi

# --- write the mechanical checkpoint (the guaranteed half) ---------------------------------------------------
stamp="$(date -u +%Y-%m-%dT%H%MZ 2>/dev/null || echo unknown)"
head_sha="$(git -C "$PROJECT_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"
dirty="$(git -C "$PROJECT_DIR" status --porcelain 2>/dev/null || true)"
[ -n "$dirty" ] || dirty="(working tree clean)"

mkdir -p "$pkg/handoffs" 2>/dev/null || true
file="$pkg/handoffs/${stamp}-auto.md"

{
  echo "---"
  echo "kind: auto-checkpoint"
  echo "trigger: precompact-$TRIGGER"
  echo "as-of: $stamp"
  echo "branch: $branch"
  echo "head: $head_sha"
  echo "---"
  echo
  echo "# Auto-checkpoint (context compaction)"
  echo
  echo "Written automatically by the PreCompact hook — a mechanical breadcrumb, **not** a curated baton."
  echo "The perishable bit is the uncommitted working state below; everything committed is in \`git log\`."
  echo
  echo "## Uncommitted at compaction"
  echo '```'
  printf '%s\n' "$dirty"
  echo '```'
  echo
  echo "## To promote"
  echo "Distill this into a real baton with the \`bespunky-workflow:session-handoff\` CAPTURE format"
  echo "(goal · state · next action · decisions · corrections · verification), then this file can be dropped."
} > "$file" 2>/dev/null || exit 0

# --- ask the model to distill (the enrich half; harmless if the turn never comes) ----------------------------
cat <<EOF
[bespunky-workflow] Context is about to compact. A mechanical checkpoint was written to:
  $file
Before detail is lost, distill it into a proper handoff baton for the \`$slug\` effort using the
\`bespunky-workflow:session-handoff\` CAPTURE format (goal, current state, next action, decisions &
roads-not-taken, corrections, verification state), in the same \`handoffs/\` folder — then the auto file
can be removed. If no effort is genuinely in progress, ignore this.
EOF
exit 0
