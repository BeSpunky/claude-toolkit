---
effort: merge-gate-mod
status: concluded
concluded: 2026-10-04
summary: Merge gate mod — Claude's propose_move call draws Land / Land & promote / Push / Not yet above the prompt; a press is sent as the person's prompt, the mod never runs git
tags: [workflow, mod, branch-and-release, landing]
---

# Decision

> "Let's add a mod that appears when Claude is done and is proposing to merge into development (or the integration branch). It will show a merge button along with other apropriate options (maybe push? promote to main? etc.)" — the user

Shipped in bespunky-workflow 0.11.0 (`hooks/merge-gate.tsx`). Design and roads not taken: [BRIEF.md](BRIEF.md).

- **Trigger is Claude's explicit `propose_move` call**, not prose matching nor git state (a landable branch is
  landable throughout an effort; "done" is a judgement).
- **Options derived from the engine**: integration, next stage, remote from `status --json`; promote offered only
  when `plan promote <stage>` exits 0; commit counts from git.
- **Buttons queue the person's prompt**; Claude executes via branch-and-release (landing has judgement steps).
- **Shared reading in `hooks/branch-engine.ts` is pure** — the mod validator forbids passing `$` across an import,
  so each mod keeps its own small `run`/`readModel`.

Left open: not yet observed in a live session at decision time (the session loaded the plugin from the main
checkout); the tool name `mcp__bespunky-workflow__propose_move` follows the documented pattern.
