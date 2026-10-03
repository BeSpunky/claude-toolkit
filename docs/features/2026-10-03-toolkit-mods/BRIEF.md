# Toolkit mods

Surface state the toolkit already computes as live Claude Code UI (mods: panes, bands,
status lines, toasts) instead of — or beside — text relayed through the model.

> "Review our toolkit and suggest mods" → seven suggestions → "Send an agent for each"

## Units (one sub-branch each, off feat/toolkit-mods)
| id | mod | plugin(s) |
|---|---|---|
| U1 | branch-model status line (+ protected-line warning, verify badge) | workflow |
| U2 | project-standing pane (packages by status, latest handoff, dismiss = snooze) | workflow |
| U3 | "sync available" band (house-version check; button asks Claude, never runs sync) | project-starter |
| U4 | toasts: auto-checkpoint on PreCompact; one-time window-identity hint | workflow, bespunky-vscode-identity |
| U5 | shared-browser status entry (noVNC link, hostVerified warning) | browser-automation |
| U6 | voice engine health in the existing voice band | voice |
| U7 | spinner tips via a mod instead of writing the user's settings file | bespunky |

## Decisions taken at dispatch
- Mods ship inside the existing plugins as `modules` in `hooks/hooks.json` — precedent: `plugins/voice/hooks/band.tsx`.
- Additive this pass: existing SessionStart model-relay hooks are NOT removed; each unit reports whether retiring its relay is safe.
- Unit agents do not bump versions; bumps happen once, at integration on feat/toolkit-mods.
