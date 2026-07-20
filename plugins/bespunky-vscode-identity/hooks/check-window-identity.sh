#!/usr/bin/env bash
# SessionStart hook — "this project's window colour is still the scaffold placeholder, but it now has a
# design system to derive a real one from."
#
# WHY THIS EXISTS. window-identity gives every project a NAME-HASH colour at scaffold time, before it has a
# design system. Once the project grows one — real brand tokens — the colour should snap to the brand. But
# nothing re-runs on its own: the design phase happens whenever it happens, and the placeholder colour would
# otherwise linger forever because no one remembers to upgrade it.
#
# WHY IT ONLY DETECTS (the project-starter hook's lesson). Re-deriving means reading tokens and rewriting
# files — a real action with a colour choice attached. So this does the cheap half — a few file reads — and
# hands Claude a statement of fact to relay. Claude offers; the human decides; the window-identity SKILL does
# the actual re-derive (and it, not this hook, validates that the design-system primary is real and not still
# a placeholder). Detection is automatic; the change stays consented.
#
# WHAT IT TAKES TO FIRE, AND WHY ONLY THEN. All three must hold, or there is genuinely nothing to say:
#   1. an identity marker exists          → window-identity was applied here (else this isn't our concern)
#   2. its source is exactly `name-hash`  → still the placeholder (design-system / manual are already resolved)
#   3. a design system exists             → there is something real to upgrade the colour TO
# This runs at the start of every session in every project on the machine, so silence is the common outcome
# and a false alarm is worse than a missed one.
set -uo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-}"

# Not invoked as a plugin hook — nothing to compare against.
[ -n "$PLUGIN_ROOT" ] || exit 0

MARKER="$PROJECT_DIR/.vscode/.window-identity.json"

# (1) No identity here → not this feature's business. Stay quiet (covers every non-house, non-applied project).
[ -f "$MARKER" ] || exit 0

# Read a top-level "key": "value" — no jq (hooks run in a bare shell; same grep/sed contract the sibling
# project-starter hook uses).
json_value() {
  [ -f "$1" ] || return 1
  grep -m1 "\"$2\"" "$1" 2>/dev/null | sed -E "s/.*\"$2\"[[:space:]]*:[[:space:]]*\"([^\"]+)\".*/\1/"
}

# (2) Only the name-hash placeholder is upgradable. A design-system or manual colour is already resolved;
# a garbled/absent source is treated as "not name-hash" and left alone (never guess an upgrade).
SOURCE="$(json_value "$MARKER" source || true)"
[ "$SOURCE" = "name-hash" ] || exit 0

# (3) Is there a design system to upgrade TO? The design system is marked by its Nx tag `type:design-system`
# (the same key the generators detect it by — not a path, which --directory can move). Cheap, bounded scan of
# project config files only; node_modules/dist/.git excluded. No design system → nothing to offer yet.
if ! grep -rlqF 'type:design-system' \
      --include='project.json' --include='package.json' \
      --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git \
      "$PROJECT_DIR" 2>/dev/null; then
  exit 0
fi

# This developer already declined the upgrade. A refusal that evaporated at session end would nag at every
# startup, which is how a notice becomes noise. The snooze is local-only and gitignored — one person's "not
# now" must not silence it for teammates. Boolean, because this hook can't tell a real primary from a
# placeholder; a user who declines can still run the skill by hand anytime (which re-checks the tokens).
if [ "$(json_value "$PROJECT_DIR/.claude/window-identity-snooze.json" declinedNameHashUpgrade || true)" = "true" ]; then
  exit 0
fi

# --- the notice ----------------------------------------------------------------------------------------------
# stdout on exit 0 is injected into Claude's context. A STATEMENT OF FACT to relay, not an order to obey: a
# hook that commands the model to act is one compliant model away from doing the thing we deliberately left to
# consent — and in a headless run there is no one to agree.
cat <<'EOF'
[bespunky-vscode-identity] This project's window colour is still the scaffold-time placeholder.

  window identity source : name-hash (a colour hashed from the project name)
  design system          : present in this workspace

So the window band could now be re-derived from the project's real design-system primary colour, instead of
the name-hash placeholder it was given before the design system existed.

RELAY THIS TO THE USER — do not act on it. Mention it briefly at the start of your reply, before their task,
and offer to upgrade it via the bespunky-vscode-identity:window-identity skill (which reads the design-system
primary and, if it's a real brand colour rather than a seeded placeholder, re-runs the generator with it).
If they decline, record it so they aren't asked again — write `.claude/window-identity-snooze.json`
(gitignored) in the project root, containing exactly:
{ "declinedNameHashUpgrade": true }
EOF
exit 0
