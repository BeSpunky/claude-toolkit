#!/usr/bin/env bash
# SessionStart hook — "did the toolkit move out from under this project?"
#
# WHY THIS EXISTS. `scaffold.sh --sync` runs the house MIGRATIONS and re-applies the house generators, so a
# project picks up new house tooling — both the files the generators own and the one-way version deltas that
# reshape what they don't. But nothing was telling anyone to run it: Claude Code has NO plugin-install/update
# hook event, so
# `/plugin marketplace update` upgrades the plugin silently and the project quietly drifts a version behind —
# devcontainer, Claude settings, serve targets and HOUSE.md all frozen at whatever shipped the day it was
# scaffolded.
#
# WHY IT ONLY DETECTS, AND NEVER RUNS. The obvious move — have a hook RUN the sync — is wrong, and
# deliberately not done. A sync migrates, installs and regenerates; it takes minutes, tags the repo on a dirty
# tree, and its migrations are ONE-WAY. (It does NOT require Docker — inside a devcontainer it runs on the
# local Node natively; see scaffold.sh.) That is not something to ambush a session with. So this hook does the
# cheap half — a few small file reads — and hands Claude a statement of fact to RELAY. It never runs the sync
# and never orders the model to: a hook that commands action is one compliant model away from doing the thing
# we refused to automate, and in a headless run (`claude -p`, CI) there is no one there to consent at all.
# Detection is automatic; execution stays consented.
#
# WHAT IT COMPARES, AND WHY ONLY THAT. `@bespunky/nx-tools` — the package the generators come from, and so the
# only thing that can change what a sync PRODUCES. Deliberately NOT the plugin version: the house convention
# bumps a plugin's version on ANY change (a SKILL.md typo, a README line), and demanding a multi-minute
# sync for a change that regenerates nothing would train everyone to ignore this notice. The plugin version
# is still read and shown, for provenance.
#
# AND IT COMPARES THAT TWICE, against two different things. Against the INSTALLED plugin, the question is "has
# the toolkit moved out from under this project?". Against the project's own `@bespunky/nx-tools` — the version
# RESOLVED in its node_modules first, falling back to the base version its package.json declares — the question
# is "has this project's tooling moved out from under its own applied state?", which a floatable range makes
# possible without anyone running anything, and which the first comparison structurally cannot see.
#
# The resolved version is what settles it, and reading only the declared range cannot. Stripping `^` off
# `^0.23.0` leaves 0.23.0, which compares EQUAL to a 0.23.0 stamp — so the very case this is for (an ordinary
# install pulled node_modules forward to a newer published version, with no migration behind it) would never
# fire. What moved is what is resolved. The declared base is still compared, because a hand-bumped exact
# dependency is the same drift reached another way. Same stamp, two questions, each answered only where true.
#
# DIRECTION MATTERS. The stamp is a REPO fact (committed, travels with every clone); the installed plugin is a
# MACHINE fact. So "stamp newer than install" is an ordinary state — a teammate who hasn't run
# `/plugin marketplace update`, a second machine, a CI checkout — not an error. Reporting that as "you're
# behind, run --sync" would be a lie AND would push a sync that regenerates the project's house files with
# OLDER generators, re-stamping it backwards and re-arming the notice for the teammate who was up to date.
# Under migrations the hazard is sharper still: the ladder only walks FORWARD. There is no reverse migration,
# so a sync from an older machine cannot undo the deltas the project has already had applied — it would leave
# files migrated to a shape the older generators no longer expect, and stamp that state as current. So the
# versions are ORDERED, not merely compared, and each direction gets its own true sentence.
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
# ends that — the whole point is that `--sync` now runs on repos like the toolkit itself, which means the
# toolkit gets a HOUSE.md and would start tripping its own hook. And the comparison there is not merely
# noisy, it is MEANINGLESS: the marketplace is loaded from the working tree (`claude plugin marketplace
# add .`), so "installed version" and "the version I am editing right now" are the same file. Every edit to
# the payload's package.json would fire a notice telling the author to sync the repo they are mid-change in.
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
# against a strict version charset before it is ever echoed. Be honest about what that buys: no whitespace and
# at most 32 characters, which rules out prose, multi-line payloads and anything resembling a paragraph — but
# NOT every instruction. `IGNORE_ALL_PRIOR_INSTRUCTIONS` passes this filter and would be echoed verbatim. It
# is a real but PARTIAL mitigation; the load-bearing defence is the surrounding text, which frames every
# echoed value as a version being reported and never as something to act on. A value that fails validation is
# treated as absent, which lands in the "unstamped" branch rather than repeating the garbage back.
is_version() {
  case "$1" in
    '' | *[!0-9A-Za-z.+_-]*) return 1 ;;
  esac
  [ "${#1}" -le 32 ]
}

# Read a "key": "value" out of a JSON file — no jq (hooks must run in a bare shell; this is the same grep/sed
# contract scaffold.sh already relies on to read its own versions). Line-based, so a key nested one level down
# (a dependency inside devDependencies) reads exactly like a top-level one. The sed delimiter is `|` rather
# than `/` precisely so a key may CONTAIN a slash — a scoped package name like `@bespunky/nx-tools` would
# otherwise terminate the s/// expression and turn a lookup into a syntax error.
json_value() {
  [ -f "$1" ] || return 1
  grep -m1 "\"$2\"" "$1" 2>/dev/null | sed -E "s|.*\"$2\"[[:space:]]*:[[:space:]]*\"([^\"]+)\".*|\1|"
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
# VALIDATED like every other repo-controlled value, and it was the one that wasn't. HOUSE.md is committed, so
# a cloned repo chooses this string, and it is echoed verbatim into the model's context. `is_version` guards
# the version fields; `layers` had no check at all beyond stamp_value's whitespace split — which a hyphenated
# payload defeats trivially, giving an attacker an unbounded, un-truncated injection channel into a session
# that starts automatically. The value is a comma-separated list of known layer ids and nothing else, so
# anything containing a character outside that alphabet is discarded rather than repeated back.
case "$STAMPED_LAYERS" in
  '' | *[!a-z,-]*) STAMPED_LAYERS='' ;;
esac
[ "${#STAMPED_LAYERS}" -le 96 ] || STAMPED_LAYERS=''

has_layer() {
  case ",$STAMPED_LAYERS," in *",$1,"*) return 0 ;; esac
  return 1
}

# All project.json files, excluding the directories that make a repo scan expensive. Printed once and
# reused, so the cost is a single traversal no matter how many layers are probed.
# Does any project.json match this pattern?
#
# `find … -exec grep -l {} +` rather than collecting paths first. Two reasons, both learned the hard way:
# a plain `xargs` splits on whitespace, so `apps/my app/project.json` drops silently out of the scan; and
# collecting `-print0` output into a shell variable does NOT fix that, because command substitution strips
# NUL bytes (bash even warns), leaving one concatenated blob that matches nothing. `-exec … +` hands the
# paths over as arguments, so a space is a non-event and no intermediate representation exists to corrupt.
#
# Each probe re-traverses. That is fine and deliberate: the traversal is pruned, and — far more importantly
# — it happens only inside the guard below, so a project that cannot act on the answer never pays for it.
in_projects() {
  find "$PROJECT_DIR" \
    \( -name node_modules -o -name .git -o -name dist -o -name .nx -o -name .angular -o -name tmp \
       -o -name vendor -o -name target -o -name build -o -name out -o -name coverage -o -name .venv \) -prune -o \
    -name project.json -exec grep -l "$1" {} + 2>/dev/null | grep -q .
}

DRIFTED=''
note_drift() { DRIFTED="${DRIFTED:+$DRIFTED, }$1"; }

# THE GUARD COMES FIRST, and that ordering is the point rather than tidiness. Drift is only meaningful
# against a stamp that RECORDS layers: a project stamped before layers existed has an empty list, which is
# not evidence that it lacks them — treating it as such would fire this notice at every pre-layer project on
# the machine, every session, for a reason none of them can act on. Those are covered by the version branch
# below, whose sync re-stamps them WITH layers.
#
# Asking that question up front also means the probes — including the filesystem scan — never run for a
# project that could not act on their answer.
if [ -n "$STAMPED_LAYERS" ] && [ "$STAMPED_LAYERS" != "none" ]; then
  grep -q '"@angular/core"' "$PROJECT_DIR/package.json" 2>/dev/null && ! has_layer angular && note_drift angular
  grep -q '"@nx/js"'        "$PROJECT_DIR/package.json" 2>/dev/null && ! has_layer js      && note_drift js
  [ -f "$PROJECT_DIR/firebase.json" ] && ! has_layer firebase && note_drift firebase
  # `web` — a project with something to serve. The registry's own test is a `dev-server` or `serve` TARGET.
  in_projects '"dev-server"' && ! has_layer web && note_drift web
  # `design-system` — the tag is the key, exactly as the registry and design-system-styles use it.
  in_projects '"type:design-system"' && ! has_layer design-system && note_drift design-system
  # `navigation` — a project NAMED navigation-core (the registry matches on project name).
  in_projects '"name": *"navigation-core"' && ! has_layer navigation && note_drift navigation
fi

if [ -n "$DRIFTED" ]; then
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
  navigation    — nothing generated per-sync (its generators are on-demand), but HOUSE.md gains the
                  typed-navigation conventions, so the stamp is what makes the layer visible at all
  js            — the publishable-library and tool-extraction conventions in HOUSE.md
  firebase      — the emulator wiring, the JDK step, and the forwarded emulator ports

A sync adds them: the sync path of the bespunky-project-starter:new-project skill — or, in one step, the
\`/sync\` command, which updates the toolkit first and then syncs this project.

RELAY THIS TO THE USER — do not act on it. Offer the sync. It REFUSES to run unattended: it needs a human's
yes, and passing its \`--yes\` flag ASSERTS that the user has explicitly agreed in this conversation. Pass it
only when that is true — never to satisfy the gate, never on inferred consent, and never in a scripted or
headless run (there, simply do nothing). If they decline, record it so they are not asked again for this same
drift — MERGE this key into \`.claude/house-snooze.json\` (gitignored) in the project root, preserving any
keys already there (the other house notices snooze themselves in the same file, and overwriting it re-arms them):
{ "declinedLayers": "$DRIFTED" }
EOF
    exit 0
  fi
fi

# --- a floated dependency -------------------------------------------------------------------------------------
# A THIRD way a project goes stale, and the one that hides best. The toolkit now runs VERSIONED MIGRATIONS: a
# sync moves the project along a ladder of one-way deltas, from the version it has to the version being
# installed. So the `nx-tools=` stamp is not merely a label — it records WHICH state has actually been APPLIED
# to this project.
#
# Meanwhile the project's own `@bespunky/nx-tools` devDependency can say something different. Any project
# whose dependency is written as a FLOATABLE range — the caret the older scaffolder wrote, and which plenty of
# existing projects still carry — moves to a newer published version on an ordinary install, with no generator
# run and no migration behind it. (What today's scaffolder writes is not this check's business; the check
# exists for the projects that already have it, and costs one grep for the ones that don't.) The project then
# DECLARES a newer toolkit than the state applied to it, and nothing else in this hook can see it: the stamp
# may still match this machine's installed plugin exactly, which is the silent-exit case immediately below.
#
# BE HONEST ABOUT WHICH KIND OF FACT THIS ONE IS. The stamp is a repo fact, but the version RESOLVED in
# node_modules — the preferred input here — is a MACHINE fact: gitignored, produced by an install, absent on
# a fresh clone, and potentially different for each developer. So unlike the version comparison further down,
# this notice is NOT identical for everyone on the team: it fires for whoever ran the install that floated
# the dependency, and stays silent for a teammate who has not installed yet. That is the correct trade —
# the float is precisely a local event, and the declared range is compared too so a committed hand-bump is
# still caught everywhere — but it is a different guarantee, and treating it as a repo fact would be wrong.
#
# An absent stamp is deliberately NOT treated as "older than everything": that project is the unstamped case
# the version branch below already describes truthfully, and preempting it here would replace an accurate
# sentence with a confusing one.
#
# The declared value is a RANGE ("^0.23.0"), so the leading range operator is stripped before comparison, and
# whatever survives must still pass is_version before it is echoed — a repo must not be able to smuggle text
# into the model's context through a dependency string any more than through a stamp. Anything that does not
# survive (a `workspace:` or `file:` link, a compound range, a dist-tag) is treated as absent and says
# nothing, and version_cmp's `unknown` (a prerelease on either side) says nothing either: under-reporting
# stays the intended failure mode here exactly as it is for every probe above.
DEP_NX="$(json_value "$PROJECT_DIR/package.json" '@bespunky/nx-tools' || true)"
DEP_NX="$(printf '%s' "$DEP_NX" | sed -E 's/^[[:space:]]*[v^~>=<]+[[:space:]]*//')"
is_version "$DEP_NX" || DEP_NX=''

# THE RESOLVED VERSION IS THE ONE THAT PROVES THE FLOAT, and reading only the declared range cannot see it.
# Stripping `^` off `^0.23.0` leaves 0.23.0, which compares EQUAL to a 0.23.0 stamp — so the caret-float case
# this notice exists for (a plain install pulled node_modules forward to a newer published version, with no
# migration behind it) never fired. What actually moved is what is resolved in node_modules, so read that.
# The declared base is still worth comparing: a hand-bumped exact dependency is the same class of drift,
# reached a different way. Either being ahead of the stamp means migrations were most likely skipped.
RESOLVED_NX="$(json_value "$PROJECT_DIR/node_modules/@bespunky/nx-tools/package.json" version || true)"
is_version "$RESOLVED_NX" || RESOLVED_NX=''

AHEAD_NX=''
AHEAD_SRC=''
if [ -n "$RESOLVED_NX" ] && [ -n "$STAMPED_NX" ] && [ "$(version_cmp "$RESOLVED_NX" "$STAMPED_NX")" = gt ]; then
  AHEAD_NX="$RESOLVED_NX"; AHEAD_SRC="resolved in node_modules"
elif [ -n "$DEP_NX" ] && [ -n "$STAMPED_NX" ] && [ "$(version_cmp "$DEP_NX" "$STAMPED_NX")" = gt ]; then
  AHEAD_NX="$DEP_NX"; AHEAD_SRC="declared in package.json"
fi

# WILL A SYNC ACTUALLY FIX THIS? Only if this machine's toolkit is at or above where the project already is.
# A sync installs the version THIS machine ships, and the scaffolder refuses outright when the project is
# already above it (that would be a downgrade, and migrations do not walk backwards). Offering a sync that is
# guaranteed to abort is worse than saying nothing: the user consents, the command fails, and a model that has
# just been told to sync starts looking for a way around a guard that has none.
SYNC_CAVEAT=''
if [ -n "$AHEAD_NX" ] && [ "$(version_cmp "$AHEAD_NX" "$INSTALLED_NX")" = gt ]; then
  SYNC_CAVEAT="But NOT YET on this machine: the toolkit installed here is nx-tools@$INSTALLED_NX, which is OLDER
than the $AHEAD_NX this project already has. A sync would be a downgrade, and it will REFUSE to run rather than
walk the project backwards. Update the toolkit first — /plugin marketplace update claude-toolkit — and only
then sync. Do not offer the sync until that is done.
"
fi

if [ -n "$AHEAD_NX" ]; then
  # Same snooze courtesy as the other two notices: local-only, gitignored, and keyed to the version being
  # reported so a further float asks the question again rather than inheriting an old "not now".
  SNOOZED_DEP="$(json_value "$PROJECT_DIR/.claude/house-snooze.json" declinedNxToolsDependency || true)"
  if [ "$SNOOZED_DEP" != "$AHEAD_NX" ]; then
    cat <<EOF
[bespunky-project-starter] This project DEPENDS on newer house tooling than has been APPLIED to it.

  stamp records (state applied) : nx-tools@$STAMPED_NX
  ahead of it ($AHEAD_SRC) : nx-tools@$AHEAD_NX
  installed on this machine     : nx-tools@$INSTALLED_NX (project-starter@$INSTALLED_PLUGIN)

The house tooling this project is RUNNING is ahead of the state that was last APPLIED to it. That happens
without anyone doing anything wrong: the dependency was written as a floatable range by older versions of the
scaffolder, so an ordinary install can pull in a newer published version with no house generator running.
The house tooling ships VERSIONED MIGRATIONS — one-way deltas walked from
the state the stamp records — so a stamp behind the declared dependency means the migrations between those two
versions were most likely never applied: the project is running new tooling against files still shaped for the
old one.

A sync reconciles the two: it runs the migrations from the stamped version forward, re-applies the house
generators and re-stamps the project — the sync path of the bespunky-project-starter:new-project skill, or, in
one step, the \`/sync\` command, which updates the toolkit first and then syncs this project.
$SYNC_CAVEAT
RELAY THIS TO THE USER — do not act on it. Offer the sync. It REFUSES to run unattended: it needs a human's
yes, and passing its \`--yes\` flag ASSERTS that the user has explicitly agreed in this conversation. Pass it
only when that is true — never to satisfy the gate, never on inferred consent, and never in a scripted or
headless run (there, simply do nothing). If they decline, record it so they are not asked again for this same
gap — MERGE this key into \`.claude/house-snooze.json\` (gitignored) in the project root, preserving any keys
already there (the other house notices snooze themselves in the same file, and overwriting it re-arms them):
{ "declinedNxToolsDependency": "$AHEAD_NX" }
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
    # The PROJECT is ahead of this machine's plugin. A sync here would DOWNGRADE the project's generated
    # files and re-stamp it backwards. Say the true thing, and say plainly that a sync is the wrong move.
    cat <<EOF
[bespunky-project-starter] This machine's house tooling is OLDER than the project's.

  project was generated with : nx-tools@$STAMPED_NX
  installed on this machine  : nx-tools@$INSTALLED_NX (project-starter@$INSTALLED_PLUGIN)

The project is fine; the PLUGIN here is behind. Mention this to the user and suggest they update it:
\`/plugin marketplace update claude-toolkit\` (a git pull first, if they installed from a local clone).

Do NOT run \`scaffold.sh --sync\` in this state — it regenerates the project's house files with the OLDER
generators installed here, downgrading the project and stamping it backwards for everyone else on the team.
The house migrations only walk FORWARD, so nothing about that is undone by the next sync from an up-to-date
machine; it is simply a mess someone then has to unpick by hand.
EOF
    ;;
  *)
    # gt (the toolkit moved on) — or an unorderable/absent stamp, which means the project predates stamping (or
    # was generated by a direct generator call). Both are resolved by the same action, so they share a branch;
    # only the wording differs, and it never claims an ordering it hasn't established.
    # THREE cases here, not two. `unknown` from version_cmp conflates "there is no stamp" with "there is a
    # stamp I cannot ORDER" — a prerelease like 0.17.0-rc.1, which is_version deliberately admits. Saying
    # "predates house stamping" about a stamp that is sitting right there is simply false, and "behind by
    # definition" is a claim no comparison established. So the unorderable case gets its own honest
    # sentence: we can see your version, we cannot rank it, here are both — you decide.
    if [ "$DIRECTION" = "gt" ]; then
      FROM="nx-tools@$STAMPED_NX"
      HEADLINE="The installed house tooling is NEWER than this project's generated tooling."
    elif [ -n "$STAMPED_NX" ]; then
      FROM="nx-tools@$STAMPED_NX (not a plain numeric version, so it cannot be ordered against the installed one)"
      HEADLINE="This project's stamp and the installed house tooling DIFFER, but which is newer cannot be determined."
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
sync path of the bespunky-project-starter:new-project skill — or, in one step, the \`/sync\` command, which updates the
toolkit first and then syncs this project.

RELAY THIS TO THE USER — do not act on it. Mention it briefly at the start of your reply, before their task,
and offer the sync. The sync REFUSES to run unattended: it needs a human's yes, and passing its \`--yes\`
flag ASSERTS that the user has explicitly agreed in this conversation. Pass it only when that is true — never
to satisfy the gate, never on inferred consent, and never in a scripted or headless run (there, simply do
nothing). If they decline, record it so they are not asked again for this version — write
\`.claude/house-snooze.json\` (gitignored) in the project root, MERGING this key into whatever is already
there (the other house notices snooze themselves in the same file, and overwriting it re-arms them):
{ "declinedNxToolsVersion": "$INSTALLED_NX" }
EOF
    ;;
esac
exit 0
