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
FEATURES="$PROJECT_DIR/docs/features"
[ -d "$FEATURES" ] || exit 0

# --- is the user actively working here? then say nothing -----------------------------------------------------
# Recent = a live-tier doc edited within STALE_DAYS, OR a commit within STALE_DAYS. Either means "not dormant".
# ! -path keeps the archive tier out of the check (portable; avoids GNU-only -not/-printf).
recent_doc="$(find "$FEATURES" -type f ! -path "$FEATURES/archive/*" -mtime -"$STALE_DAYS" -print -quit 2>/dev/null || true)"

now="$(date +%s 2>/dev/null || echo 0)"
last_commit="$(git -C "$PROJECT_DIR" log -1 --format=%ct 2>/dev/null || echo 0)"
case "$last_commit" in '' | *[!0-9]*) last_commit=0 ;; esac
commit_age_days=$(( (now - last_commit) / 86400 ))

[ -n "$recent_doc" ] && exit 0                       # a doc was touched recently → active → quiet
[ "$commit_age_days" -lt "$STALE_DAYS" ] && exit 0   # a commit landed recently → active → quiet

# --- collect the in-flight efforts (validated; nothing untrusted reaches Claude's context) -------------------
# A live-tier package is IN-FLIGHT unless its DECISION.md carries a closing `status:`. Slugs come from directory
# names — a repo could craft a hostile one — so every slug is validated against a strict charset before it is
# ever echoed. A name that fails validation is skipped, not repeated back: a repo cannot smuggle a sentence
# (let alone an instruction) into the model's context through a folder name.
inflight=""
count=0
for d in "$FEATURES"/*/; do
  base="$(basename "$d")"
  [ "$base" = "archive" ] && continue
  # Require the feature-package name shape: <YYYY-MM-DD>-<slug>, slug in [a-z0-9-], bounded length.
  case "$base" in
    [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]-[a-z0-9]*) ;;
    *) continue ;;
  esac
  slug="${base#????-??-??-}"
  case "$slug" in '' | *[!a-z0-9-]*) continue ;; esac
  [ "${#base}" -le 80 ] || continue

  dec="$d/DECISION.md"
  if [ -f "$dec" ] && grep -qiE '^status:[[:space:]]*(concluded|abandoned|superseded)\b' "$dec" 2>/dev/null; then
    continue   # has a closing conclusion → not in-flight
  fi

  count=$((count + 1))
  [ "$count" -le 8 ] && inflight="$inflight  • docs/features/$base/
"
done

[ "$count" -gt 0 ] || exit 0   # concluded / empty repo → nothing to relay

# --- snooze: don't re-nag every session start during the same dormant stretch --------------------------------
# The fingerprint is the last-commit epoch — stable across a dormant period, and it changes the moment the user
# does new work (which also makes the repo "active" above, so this hook falls silent anyway). Local-only under
# .claude/ (where per-machine state lives): one person's "seen it" must not silence teammates.
SNOOZE="$PROJECT_DIR/.claude/.standing-snooze"
if [ -f "$SNOOZE" ] && [ "$(cat "$SNOOZE" 2>/dev/null)" = "$last_commit" ]; then
  exit 0
fi
mkdir -p "$PROJECT_DIR/.claude" 2>/dev/null && printf '%s' "$last_commit" > "$SNOOZE" 2>/dev/null || true

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
