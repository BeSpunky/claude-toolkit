#!/usr/bin/env bash
# SessionStart hook — "did I walk away from something in this repo?"
#
# WHY THIS EXISTS. The bespunky-workflow:project-standing skill can reconstruct where a project stands after a
# gap — but a skill only fires when the model judges it relevant, and on a cold open with a vague first prompt
# ("ok what was I doing here") it may not. So this hook does the cheap half: it NOTICES that in-flight work has
# gone dormant and hands Claude a statement of fact pointing at the skill. Detection is automatic; the actual
# orientation (model judgment) stays in the skill.
#
# WHY IT ONLY DETECTS-AND-RELAYS. Same rule the project-starter hook earned: a hook that COMMANDS the model to
# act is one compliant model away from doing the thing you didn't consent to. This one only relays — it never
# reconstructs the standing itself (that's the skill's job) and never runs anything.
#
# WHY IT STAYS SILENT ALMOST ALWAYS. This runs at the start of every session in every project on the machine, so
# a false alarm is worse than a missed one. It speaks ONLY when there is genuinely-dormant in-flight work — an
# unconcluded feature package that nobody has touched in STALE_DAYS. During active work (recent commit or recent
# doc edit) it is silent, so it never nags you about the thing you're in the middle of.
set -uo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}"
STALE_DAYS="${BESPUNKY_STANDING_STALE_DAYS:-14}"
case "$STALE_DAYS" in '' | *[!0-9]*) STALE_DAYS=14 ;; esac

# A git repo with a feature-package convention, or there's nothing to reason about.
git -C "$PROJECT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

# Legacy snooze location (see the snooze section below). Removed HERE, before any early exit: the dormancy checks
# exit on every active session, so cleanup placed after them would wait for the next dormant stretch to run.
rm -f "$PROJECT_DIR/.claude/.standing-snooze" 2>/dev/null || true

# --- the derivation: ONE engine, shared with the /standing pane ---------------------------------------------
# Which packages exist, which are in flight, and how recently anything moved are DERIVED by the project-standing
# skill's engine (`standing.mjs`), the same one the /standing pane draws from — so the notice and the pane can
# never disagree about what is in flight. `--tsv` carries no free text: validated package names and enums only.
# The engine validates every slug against the feature-package shape and SKIPS a name that fails, so a repo
# cannot smuggle a sentence (let alone an instruction) into the model's context through a folder name.
# No node, a missing engine, a crash → say nothing (a missed notice beats a false one).
ENGINE="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}/skills/project-standing/scripts/standing.mjs"
command -v node >/dev/null 2>&1 && [ -f "$ENGINE" ] || exit 0
facts="$(CLAUDE_PROJECT_DIR="$PROJECT_DIR" BESPUNKY_STANDING_STALE_DAYS="$STALE_DAYS" node "$ENGINE" --tsv 2>/dev/null)" || exit 0

# repo<TAB>hasFeatures<TAB>hasRecentDoc<TAB>lastCommit<TAB>commitAgeDays, then pkg<TAB>dir<TAB>status<TAB>state<TAB>baton<TAB>worktree
IFS="$(printf '\t')" read -r tag has_features recent_doc last_commit commit_age_days <<EOF_REPO
$(printf '%s\n' "$facts" | head -n 1)
EOF_REPO
[ "$tag" = "repo" ] || exit 0
[ "$has_features" = "1" ] || exit 0
case "$last_commit" in '' | *[!0-9]*) last_commit=0 ;; esac
case "$commit_age_days" in '' | *[!0-9-]*) exit 0 ;; esac

# --- is the user actively working here? then say nothing -----------------------------------------------------
# Recent = a live-tier doc edited within STALE_DAYS, OR a commit within STALE_DAYS. Either means "not dormant".
[ "$recent_doc" = "1" ] && exit 0                     # a doc was touched recently → active → quiet
[ "$commit_age_days" -lt "$STALE_DAYS" ] && exit 0   # a commit landed recently → active → quiet

# --- the in-flight efforts: an unconcluded package (no closing `status:` in its DECISION.md) ------------------
# The engine scans every worktree, so a package may live in another checkout: its 6th column names that
# worktree (empty for this one), and the path printed is where the package actually is. Parsed with awk, not
# `read`: a tab is IFS whitespace, so an empty baton column would collapse and shift the worktree into its place.
paths="$(printf '%s\n' "$facts" | awk -F '\t' '$1 == "pkg" && $3 == "in-flight" { print ($6 == "" ? "" : $6 "/") "docs/features/" $2 "/" }')"
count=0
[ -n "$paths" ] && count="$(printf '%s\n' "$paths" | wc -l | tr -d ' ')"
inflight="$(printf '%s\n' "$paths" | head -n 8 | sed 's/^/  • /')
"

[ "$count" -gt 0 ] || exit 0   # concluded / empty repo → nothing to relay

# --- snooze: don't re-nag every session start during the same dormant stretch --------------------------------
# The fingerprint is the last-commit epoch — stable across a dormant period, and it changes the moment the user
# does new work (which also makes the repo "active" above, so this hook falls silent anyway). It lives INSIDE the
# git dir: local to this clone by construction (one person's "seen it" must not silence teammates), and never a
# candidate for a commit — so no project needs a .gitignore line for it. It used to live at .claude/.standing-snooze,
# which nothing ignored, so it surfaced as an untracked file in every project the plugin ran in; that copy is
# removed near the top of this script.
SNOOZE="$(git -C "$PROJECT_DIR" rev-parse --path-format=absolute --git-path bespunky-standing-snooze 2>/dev/null || true)"
if [ -n "$SNOOZE" ]; then
  if [ -f "$SNOOZE" ] && [ "$(cat "$SNOOZE" 2>/dev/null)" = "$last_commit" ]; then
    exit 0
  fi
  printf '%s' "$last_commit" > "$SNOOZE" 2>/dev/null || true
fi

# --- the notice: a fact to relay, not an order to obey -------------------------------------------------------
plural=""; [ "$count" -gt 1 ] && plural="s"
cat <<EOF
[bespunky-workflow] This project has $count in-flight effort$plural and hasn't been touched in ~$commit_age_days days:
$inflight
The freshest state for each is the newest baton in its \`handoffs/\` folder. Before starting new work here,
reconstruct where things stand by running the \`bespunky-workflow:project-standing\` skill (default "orient"
scope) — it derives the full standing from git + these packages.

RELAY this to the user briefly, before their task; do not act on it unless they ask to be caught up.
EOF
exit 0
