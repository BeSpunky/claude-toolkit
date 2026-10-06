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
#
# A SOURCE ALREADY DECLARED WINS. `claude plugin marketplace add` records its source in the user's settings (or an
# organisation declares one in managed settings), and the CLI then refuses to add that marketplace from any OTHER
# source — which failed this whole step, every plugin with it, whenever the user had once added claude-toolkit from
# elsewhere (a local checkout, a branch). That declaration is the user's deliberate choice, so it is the source used;
# the house's own is only the default when nothing is declared.
#
# One `<marketplace name> <source>` pair per line.
HOUSE_MARKETPLACES="{{MARKETPLACES}}"
HOUSE_PLUGINS="{{PLUGINS}}"
if grep -q '"name"[[:space:]]*:[[:space:]]*"claude-toolkit"' "$WS/.claude-plugin/marketplace.json" 2>/dev/null; then
  echo "[post-create] this repo IS the claude-toolkit marketplace — registering the working tree (dogfooding), not the published copy"
  TOOLKIT_SELF=1
else
  TOOLKIT_SELF=0
fi
# The source managed or user settings DECLARE for a marketplace, spelled the way `marketplace add` takes it (a GitHub
# `owner/repo[#ref]`, a git or https URL `[#ref]`, a local path) — nothing when none is declared or node is absent.
declared_marketplace_source() {
  node -e '
    const { readFileSync } = require("fs"), { join } = require("path"), { homedir } = require("os");
    const config = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
    for (const file of ["/etc/claude-code/managed-settings.json", join(config, "settings.json")]) {
      let settings;
      try { settings = JSON.parse(readFileSync(file, "utf8")); } catch { continue; }
      const src = settings?.extraKnownMarketplaces?.[process.argv[1]]?.source;
      if (!src) continue;
      const base = src.source === "github" ? src.repo : src.url ?? src.path;
      if (base) { process.stdout.write(src.ref ? `${base}#${src.ref}` : base); break; }
    }' "$1" 2>/dev/null || true
}
echo "[post-create] pre-installing Claude Code plugins"
plugins_failed=""
while read -r mp_name mp_source; do
  [ -n "$mp_name" ] || continue
  if [ "$mp_name" = "claude-toolkit" ] && [ "$TOOLKIT_SELF" = 1 ]; then mp_source="$WS"; fi
  declared="$(declared_marketplace_source "$mp_name")"
  if [ -n "$declared" ] && [ "$declared" != "$mp_source" ]; then
    echo "[post-create] marketplace $mp_name: using the source your settings declare ($declared), not the house default ($mp_source)"
    mp_source="$declared"
  fi
  claude plugin marketplace add "$mp_source" || plugins_failed="$plugins_failed $mp_name(marketplace)"
done <<HOUSE_MARKETPLACES_EOF
$HOUSE_MARKETPLACES
HOUSE_MARKETPLACES_EOF
# Every plugin is attempted: one that cannot install (its marketplace failed, say) must not take the rest with it.
for plugin in $HOUSE_PLUGINS; do
  claude plugin install "$plugin" --scope project || plugins_failed="$plugins_failed $plugin"
done
if [ -z "$plugins_failed" ]; then
  echo "[post-create] Claude Code plugins installed at project scope"
else
  echo "[post-create] NOTE: not pre-installed:$plugins_failed — .claude/settings.json offers them on first run"
fi
