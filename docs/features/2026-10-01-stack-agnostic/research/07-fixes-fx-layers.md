# 07 — Fixes (fixer `fx-layers`, worktree sa-fix-layers)

Items from `handoffs/2026-10-02T00-review-fanout.md` → FX-layers. One entry per item, appended as it lands.

- **A1 (plan half) — fixed.** `layers/plan.ts` now computes the APPLIED set in one topological pass (a layer
  whose requirements are not all *applied* is skipped, so a skipped requirement takes its dependants down too)
  and runs every step through a context whose `active`/`ensured` are that set — so `devcontainer --layers`,
  `claude-settings --layers`, the new `gitignore --layers` and the `house-doc` stamp can only carry applied
  layers. The warning's remedy is per missing layer and per mode: `--ensure=<x>` only where this mode can ensure
  it, else the layer's own `ensureHint` (no more `--ensure=node` on a sync). Tests: test-layers
  "unmet layer (firebase without node, wrapper repo)…" and "a skipped requirement takes its dependants down".
  Consequence worth knowing: a present-but-unmet layer is now absent from the stamp, so the SessionStart hook
  reports it as drift (truthfully: its tooling was not applied); the notice is snoozable as before.
- **A2 — fixed.** New `gitignore` generator (floor concern) = the `nx` layer's workspace step, given the applied
  layers; `claude-settings` no longer writes `.gitignore`. Test: "an Nx node app without the agent layer still
  gets every applied layer's gitignore"; artifact tests now run `gitignore` beside `claude-settings`.
