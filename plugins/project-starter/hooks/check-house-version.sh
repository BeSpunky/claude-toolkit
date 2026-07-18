#!/usr/bin/env bash
# SessionStart hook — "did the toolkit move out from under this project?"
#
# WHY THIS EXISTS. `scaffold.sh --repair` re-applies the house generators, so a project picks up new house
# tooling. But nothing was telling anyone to run it: Claude Code has NO plugin-install/update hook event, so
# `/plugin marketplace update` upgrades the plugin silently and the project quietly drifts a version behind —
# devcontainer, Claude settings, serve targets and HOUSE.md all frozen at whatever shipped the day it was
# scaffolded.
#
# WHY IT ONLY DETECTS. The obvious move — have a hook RUN the repair — is wrong, and deliberately not done.
# A repair needs a Docker daemon, pulls a base image, runs the house generators and several installs; it takes
# minutes, hard-fails without Docker, and tags the repo on a dirty tree. That is not something to ambush a
# session with. So this hook does the cheap half — a few small file reads — and hands Claude a statement of
# fact. Claude relays it; the human decides. Detection is automatic; execution stays consented.
#
# WHAT IT COMPARES, AND WHY ONLY THAT. `@bespunky/nx-tools` — the package the generators come from, and so the
# only thing that can change what a repair PRODUCES. Deliberately NOT the plugin version: the house convention
# bumps a plugin's version on ANY change (a SKILL.md typo, a README line), and demanding a multi-minute Docker
# repair for a change that regenerates nothing would train everyone to ignore this notice. The plugin version
# is still read and shown, for provenance.
#
# DIRECTION MATTERS. The stamp is a REPO fact (committed, travels with every clone); the installed plugin is a
# MACHINE fact. So "stamp newer than install" is an ordinary state — a teammate who hasn't run
# `/plugin marketplace update`, a second machine, a CI checkout — not an error. Reporting that as "you're
# behind, run --repair" would be a lie AND would push a repair that regenerates the project's house files with
# OLDER generators, re-stamping it backwards and re-arming the notice for the teammate who was up to date. So
# the versions are ORDERED, not merely compared, and each direction gets its own true sentence.
#
# Exits 0 in every path, silently, unless there is genuinely something to say — this runs at the start of every
# session in every project on the machine, so silence is the overwhelmingly common outcome and a false alarm is
# worse than a missed one.
set -uo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-}"

# Not invoked as a plugin hook (no plugin root to compare against) — nothing to say.
[ -n "$PLUGIN_ROOT" ] || exit 0

# Is this even a house project? HOUSE.md is the marker: generator-owned, present in every scaffolded project,
# absent everywhere else — including this toolkit repo itself, so developing the toolkit never trips its own
# hook. No HOUSE.md → somebody else's project; stay quiet.
HOUSE_DOC="$PROJECT_DIR/HOUSE.md"
[ -f "$HOUSE_DOC" ] || exit 0

# --- reading versions, defensively ---------------------------------------------------------------------------
# Everything below is read from files a REPO can control (HOUSE.md is checked in; a cloned repo can carry any
# HOUSE.md it likes), and whatever we print goes straight into Claude's context. So every value is validated
# against a strict version charset before it is ever echoed: a repo cannot smuggle a sentence — let alone an
# instruction — into the model's context through a version string. A value that fails validation is treated as
# absent, which lands in the "unstamped" branch rather than repeating the garbage back.
is_version() {
  case "$1" in
    '' | *[!0-9A-Za-z.+_-]*) return 1 ;;
  esac
  [ "${#1}" -le 32 ]
}

# Read a top-level "key": "value" out of a JSON file — no jq (hooks must run in a bare shell; this is the same
# grep/sed contract scaffold.sh already relies on to read its own versions).
json_value() {
  [ -f "$1" ] || return 1
  grep -m1 "\"$2\"" "$1" 2>/dev/null | sed -E "s/.*\"$2\"[[:space:]]*:[[:space:]]*\"([^\"]+)\".*/\1/"
}

# Read `key=value` out of HOUSE.md's stamp marker: <!-- @bespunky/house-tooling:stamp nx-tools=X plugin=Y -->
stamp_value() {
  grep -m1 '@bespunky/house-tooling:stamp' "$HOUSE_DOC" 2>/dev/null \
    | sed -nE "s/.*[[:space:]]$1=([^[:space:]]+).*/\1/p"
}

# Order two dotted-numeric versions. Echoes: "gt" (a>b), "lt" (a<b), "eq", or "unknown" (not purely numeric —
# e.g. a prerelease, or the literal 'unknown' a direct generator call stamps). Pure shell: `sort -V` is GNU
# coreutils and this has to run on macOS too.
version_cmp() {
  case "$1$2" in *[!0-9.]*) echo unknown; return ;; esac

  local IFS=.
  local -a x=($1) y=($2)
  local i n=${#x[@]}
  [ "${#y[@]}" -gt "$n" ] && n=${#y[@]}

  for ((i = 0; i < n; i++)); do
    local a=${x[i]:-0} b=${y[i]:-0}
    ((10#$a > 10#$b)) && { echo gt; return; }
    ((10#$a < 10#$b)) && { echo lt; return; }
  done
  echo eq
}

INSTALLED_NX="$(json_value "$PLUGIN_ROOT/skills/new-project/assets/nx-tools/package.json" version || true)"
INSTALLED_PLUGIN="$(json_value "$PLUGIN_ROOT/.claude-plugin/plugin.json" version || true)"
STAMPED_NX="$(stamp_value nx-tools || true)"

is_version "$INSTALLED_NX" || exit 0 # can't read what's installed → can't make a claim. Never guess.
is_version "$INSTALLED_PLUGIN" || INSTALLED_PLUGIN='?'
is_version "$STAMPED_NX" || STAMPED_NX=''

# Already current — the common case, and the reason this hook is a few greps instead of a Docker run.
[ "$STAMPED_NX" = "$INSTALLED_NX" ] && exit 0

# This developer already said "not now" for exactly this version. A refusal that evaporated at the end of the
# session would mean the same interruption at every single startup, forever — which is how a notice becomes
# noise that everyone learns to skip. The snooze is local-only and gitignored (house-doc writes the rule): one
# person's "not now" must never silence the notice for their teammates. A NEWER version un-snoozes itself,
# because that is a different question being asked.
SNOOZED="$(json_value "$PROJECT_DIR/.claude/house-snooze.json" declinedNxToolsVersion || true)"
[ "$SNOOZED" = "$INSTALLED_NX" ] && exit 0

# --- the notice ----------------------------------------------------------------------------------------------
# stdout on exit 0 is injected into Claude's context. Phrased as a STATEMENT OF FACT to relay, not an order to
# obey: a hook that commands the model to act is one compliant model away from doing the thing we deliberately
# refused to automate — and in a non-interactive run (`claude -p`, CI) there is no one to consent at all.
DIRECTION="$(version_cmp "$INSTALLED_NX" "${STAMPED_NX:-unknown}")"

case "$DIRECTION" in
  lt)
    # The PROJECT is ahead of this machine's plugin. A repair here would DOWNGRADE the project's generated
    # files and re-stamp it backwards. Say the true thing, and say plainly that a repair is the wrong move.
    cat <<EOF
[bespunky-project-starter] This machine's house tooling is OLDER than the project's.

  project was generated with : nx-tools@$STAMPED_NX
  installed on this machine  : nx-tools@$INSTALLED_NX (project-starter@$INSTALLED_PLUGIN)

The project is fine; the PLUGIN here is behind. Mention this to the user and suggest they update it:
\`/plugin marketplace update claude-toolkit\` (a git pull first, if they installed from a local clone).

Do NOT run \`scaffold.sh --repair\` in this state — it regenerates the project's house files with the OLDER
generators installed here, downgrading the project and stamping it backwards for everyone else on the team.
EOF
    ;;
  *)
    # gt (the toolkit moved on) — or an unorderable/absent stamp, which means the project predates stamping (or
    # was generated by a direct generator call). Both are resolved by the same action, so they share a branch;
    # only the wording differs, and it never claims an ordering it hasn't established.
    if [ "$DIRECTION" = "gt" ]; then
      FROM="nx-tools@$STAMPED_NX"
      HEADLINE="The installed house tooling is NEWER than this project's generated tooling."
    else
      FROM="an unrecorded version (generated before house stamping existed)"
      HEADLINE="This project's generated tooling predates house stamping, so it is behind by definition."
    fi

    cat <<EOF
[bespunky-project-starter] $HEADLINE

  project was generated with : $FROM
  installed on this machine  : nx-tools@$INSTALLED_NX (project-starter@$INSTALLED_PLUGIN)

So this project's generated house files (HOUSE.md, .claude/settings.json, the devcontainer, the serve /
worktree / design-system targets) are stale. Re-applying the house generators is what refreshes them: the
repair path of the bespunky-project-starter:new-project skill.

RELAY THIS TO THE USER — do not act on it. Mention it briefly at the start of your reply, before their task,
and offer the repair. The repair REFUSES to run unattended: it needs a human's yes, and passing its \`--yes\`
flag ASSERTS that the user has explicitly agreed in this conversation. Pass it only when that is true — never
to satisfy the gate, never on inferred consent, and never in a scripted or headless run (there, simply do
nothing). If they decline, record it so they are not asked again for this version — write
\`.claude/house-snooze.json\` (gitignored) in the project root, containing exactly:
{ "declinedNxToolsVersion": "$INSTALLED_NX" }
EOF
    ;;
esac
exit 0
