# --- Pre-install the Claude Code plugins at project scope (agent) ---
# So house skills/agents are live the moment the container opens. The list is the SAME one
# .claude/settings.json enables — both are composed from this project's layers — so the two can't drift. If
# the CLI isn't reachable (offline rebuild, etc.) we don't fail the build: .claude/settings.json declares the
# marketplaces, so Claude offers a one-click install on first session instead.
#
# THE claude-toolkit SOURCE SELF-ADAPTS. A repo that IS the claude-toolkit marketplace must register its OWN
# WORKING TREE, never the published copy of itself: the whole point of developing there is that a skill edit
# is live in the next session with no publish round-trip, and pulling the released plugins over the top would
# silently shadow the very files being edited. Narrow on purpose — the marketplace must be claude-toolkit
# ITSELF, not merely "some marketplace": a repo that is a DIFFERENT marketplace still wants the BeSpunky
# plugins from GitHub.
# One `<marketplace name> <source>` pair per line.
HOUSE_MARKETPLACES="{{MARKETPLACES}}"
HOUSE_PLUGINS="{{PLUGINS}}"
if grep -q '"name"[[:space:]]*:[[:space:]]*"claude-toolkit"' "$WS/.claude-plugin/marketplace.json" 2>/dev/null; then
  echo "[post-create] this repo IS the claude-toolkit marketplace — registering the working tree (dogfooding), not the published copy"
  TOOLKIT_SELF=1
else
  TOOLKIT_SELF=0
fi
echo "[post-create] pre-installing Claude Code plugins"
plugins_ok=1
while read -r mp_name mp_source; do
  [ -n "$mp_name" ] || continue
  if [ "$mp_name" = "claude-toolkit" ] && [ "$TOOLKIT_SELF" = 1 ]; then mp_source="$WS"; fi
  claude plugin marketplace add "$mp_source" || plugins_ok=0
done <<HOUSE_MARKETPLACES_EOF
$HOUSE_MARKETPLACES
HOUSE_MARKETPLACES_EOF
if [ "$plugins_ok" = 1 ]; then
  for plugin in $HOUSE_PLUGINS; do
    claude plugin install "$plugin" --scope project || { plugins_ok=0; break; }
  done
fi
if [ "$plugins_ok" = 1 ]; then
  echo "[post-create] Claude Code plugins installed at project scope"
else
  echo "[post-create] NOTE: Claude plugin pre-install skipped; .claude/settings.json will offer install on first run"
fi
