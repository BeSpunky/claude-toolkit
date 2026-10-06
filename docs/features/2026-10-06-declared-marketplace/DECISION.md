---
effort: declared-marketplace
status: concluded
concluded: 2026-10-06
summary: Container setup adds each plugin marketplace from the source user/managed settings declare (Claude Code refuses any other), and one failing marketplace no longer skips every plugin install. nx-tools 0.49.2, bespunky-house 0.47.2.
tags: [house, devcontainer, plugins, marketplace]
---

# Plugin pre-install: the declared marketplace source wins

> "A project failed to install out toolkit on rebuild, after upgrade." — the user, with the log line:
> `✘ Failed to add marketplace: Cannot add marketplace "claude-toolkit": its source doesn't match its
> extraKnownMarketplaces entry in user or managed settings`

## Cause (reproduced with the real CLI, isolated config)
`claude plugin marketplace add` records the marketplace in USER settings by default, and afterwards refuses to add it
from any other source. A project whose persisted user settings declare claude-toolkit from elsewhere (a local
checkout, a branch) failed the house's `add BeSpunky/claude-toolkit` — and that one failure skipped every plugin
install (`plugins_ok=0`).

## Decisions
- The source managed settings (`/etc/claude-code/managed-settings.json`), then user settings
  (`$CLAUDE_CONFIG_DIR/settings.json`) declare WINS — the user's deliberate choice; the house source is the default
  only when nothing is declared. Spelled as `add` takes it (`owner/repo#ref`, URL `#ref`, path; `#ref` verified to
  round-trip to `{repo, ref}`). Without node, nothing is read and the default is used.
- Every plugin is attempted; failures are named in one line.
- Not changed: the house still adds at the CLI's default (user) scope — the declaration it writes is the source it
  used, so it never conflicts with itself.

## Verified
Real CLI: declared local source → added from it, both plugins installed and enabled; nothing declared → GitHub default,
installed. test-layers: declared directory, declared GitHub ref, a failing add (installs still attempted, reported).
Dogfood: this repo's declared source equals its own path, so its behaviour is unchanged.
