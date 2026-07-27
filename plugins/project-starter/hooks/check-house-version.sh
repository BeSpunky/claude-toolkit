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
# A repair re-runs the house generators and several package installs; it takes minutes and tags the repo on a
# dirty tree. (It does NOT require Docker — inside a devcontainer it runs the generators on the local Node
# natively; see scaffold.sh.) That is not something to ambush a session with. So this hook does the cheap
# half — a few small file reads — and hands Claude a statement of fact. Claude relays it; the human decides.
# Detection is automatic; execution stays consented.
#
# WHAT IT COMPARES, AND WHY ONLY THAT. `@bespunky/nx-tools` — the package the generators come from, and so the
# only thing that can change what a repair PRODUCES. Deliberately NOT the plugin version: the house convention
# bumps a plugin's version on ANY change (a SKILL.md typo, a README line), and demanding a multi-minute
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

# Is this even a house project? HOUSE.md is the marker: generator-owned, present in every scaffolded project.
# No HOUSE.md → somebody else's project; stay quiet.
HOUSE_DOC="$PROJECT_DIR/HOUSE.md"
[ -f "$HOUSE_DOC" ] || exit 0

# IS THE PLUGIN THIS PROJECT'S OWN SOURCE? Then there is nothing to compare and never anything to say.
#
# This used to be free: HOUSE.md was absent from the toolkit repo, so the check above exited first. Layering
# ends that — the whole point is that `--repair` now runs on repos like the toolkit itself, which means the
# toolkit gets a HOUSE.md and would start tripping its own hook. And the comparison there is not merely
# noisy, it is MEANINGLESS: the marketplace is loaded from the working tree (`claude plugin marketplace
# add .`), so "installed version" and "the version I am editing right now" are the same file. Every edit to
# the payload's package.json would fire a notice telling the author to repair the repo they are mid-change in.
#
# Detected by CONTAINMENT rather than by name: the plugin root living inside the project means this session's
# plugin IS this repo's source, whatever the repo is called or wherever it is checked out. Covers the toolkit,
# a fork of it, and any project that vendors the plugin — all the same fact, one test.
case "$PLUGIN_ROOT/" in
  "$PROJECT_DIR"/*) exit 0 ;;
esac

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

# --- layer drift ----------------------------------------------------------------------------------------------
# A SECOND way a project goes stale, and one that version comparison structurally cannot see: the project grew
# a LAYER. Somebody ran `nx add @nx/angular`, or added firebase.json, and the house tooling for that layer —
# the devcontainer ports, the emulator wiring, the Angular editor extensions — was never applied. The stamp is
# current, the toolkit hasn't moved, and the project is still missing house files it should now have.
#
# EVERY layer is detected, but only by facts a hook can afford. `angular`, `js` and `firebase` are a single
# grep on one known file. `web`, `design-system` and `navigation` live in project.json files, so they need a
# scan — bounded to a shallow depth and with the heavy directories pruned, which keeps it in the milliseconds
# a session-start hook may spend. It deliberately does NOT load the Nx project graph (a Node process and
# seconds); the greps below approximate it, and where they can't tell they say nothing.
#
# Under-reporting stays the intended failure mode throughout: a missed notice costs a stale layer, a false
# one costs everyone's trust in the notice. So every probe below is written to be quiet when unsure.
STAMPED_LAYERS="$(stamp_value layers || true)"

has_layer() {
  case ",$STAMPED_LAYERS," in *",$1,"*) return 0 ;; esac
  return 1
}

# All project.json files, excluding the directories that make a repo scan expensive. Printed once and
# reused, so the cost is a single traversal no matter how many layers are probed.
project_files() {
  find "$PROJECT_DIR" \
    \( -name node_modules -o -name .git -o -name dist -o -name .nx -o -name .angular -o -name tmp \) -prune -o \
    -name project.json -print 2>/dev/null | head -200
}
PROJECT_FILES="$(project_files)"

# Does any project.json match this pattern? Quiet (and false) when there are none to search.
in_projects() {
  [ -n "$PROJECT_FILES" ] || return 1
  printf '%s\n' "$PROJECT_FILES" | xargs grep -l "$1" 2>/dev/null | grep -q .
}

DRIFTED=''
note_drift() { DRIFTED="${DRIFTED:+$DRIFTED, }$1"; }

grep -q '"@angular/core"' "$PROJECT_DIR/package.json" 2>/dev/null && ! has_layer angular && note_drift angular
grep -q '"@nx/js"'        "$PROJECT_DIR/package.json" 2>/dev/null && ! has_layer js      && note_drift js
[ -f "$PROJECT_DIR/firebase.json" ] && ! has_layer firebase && note_drift firebase
# `web` — a project with something to serve. The registry's own test is a `dev-server` or `serve` TARGET.
in_projects '"dev-server"' && ! has_layer web && note_drift web
# `design-system` — the tag is the key, exactly as the registry and design-system-styles use it.
in_projects '"type:design-system"' && ! has_layer design-system && note_drift design-system
# `navigation` — a project NAMED navigation-core (the registry matches on project name).
in_projects '"name": *"navigation-core"' && ! has_layer navigation && note_drift navigation

# Only speak about drift when the stamp actually RECORDS layers. A project stamped before layers existed has
# an empty list, which is not evidence that it lacks them — treating it as such would fire this notice at
# every pre-layer project on the machine, every session, for a reason none of them can act on. Those projects
# are already covered by the version branch below, whose repair re-stamps them WITH layers.
if [ -n "$DRIFTED" ] && [ -n "$STAMPED_LAYERS" ] && [ "$STAMPED_LAYERS" != "none" ]; then
  SNOOZED_LAYERS="$(json_value "$PROJECT_DIR/.claude/house-snooze.json" declinedLayers || true)"
  if [ "$SNOOZED_LAYERS" != "$DRIFTED" ]; then
    cat <<EOF
[bespunky-project-starter] This project has grown a layer its house tooling was never applied for.

  present in the workspace but not in the stamp : $DRIFTED
  stamp records                                 : layers=$STAMPED_LAYERS

So the house files for that layer are missing. What each one brings:
  angular       — the Angular editor extensions, the dev-server leaf, the Angular CLI MCP + agent skills
  web           — the serve composer, worktree domains, the shared co-driven browser, Playwright, :80
  design-system — the design-system config, STRUCTURE.md, and every app's sass/provider wiring
  navigation    — nothing generated per-repair (its generators are on-demand), but HOUSE.md gains the
                  typed-navigation conventions, so the stamp is what makes the layer visible at all
  js            — the publishable-library and tool-extraction conventions in HOUSE.md
  firebase      — the emulator wiring, the JDK step, and the forwarded emulator ports

Re-applying the house generators adds them: the repair path of the
bespunky-project-starter:new-project skill.

RELAY THIS TO THE USER — do not act on it. Offer the repair; it needs a human's yes (see the repair's \`--yes\`
gate) and must never run in a scripted or headless session. If they decline, record it so they are not asked
again for this same drift — write \`.claude/house-snooze.json\` (gitignored) in the project root, containing:
{ "declinedLayers": "$DRIFTED" }
EOF
    exit 0
  fi
fi

# Already current — the common case, and the reason this hook is a few greps instead of a full generator run.
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
