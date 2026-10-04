# Merge gate mod — brief

> "Let's add a mod that appears when Claude is done and is proposing to merge into development (or the integration branch). It will show a merge button along with other apropriate options (maybe push? promote to main? etc.)" — the user, 2026-10-04

## Design (as decided while building)

- **Trigger: an explicit signal from Claude, not a guess.** The mod registers a tool, `propose_move`
  (`mcp__bespunky-workflow__propose_move`). Claude calls it as the last act of a turn in which it proposes a
  move. Rejected: pattern-matching Claude's prose for "merge?" (fragile, false positives) and showing the gate
  whenever git state looks landable (it would nag mid-effort, when the work is not done — "done" is a
  judgement only Claude and the person make).
- **Options are derived, never assumed.** The engine (`branches.mjs status --json`) names the integration line,
  the chain and the remote; `plan promote <stage>` exiting 0 is what makes "promote" offerable; git says how far
  the branch is ahead. The tool refuses (and Claude falls back to asking in prose) when the model is not
  declared, the branch is protected or has nothing to land.
- **Buttons queue a prompt; the mod never executes.** Landing has judgement steps the skill owns (rebase and
  re-verify, DECISION.md status, keep-or-bin mocks). A press is the person's explicit signal, sent as their
  prompt; Claude runs `plan land` / `plan promote` from there. Same shape as `/standing`'s Resume.
- **Lifecycle:** shown only when the turn is over (hidden while Claude works), gone on the next prompt
  (a press, or anything typed), or on "Not yet".
- **Shared engine access.** `branch-status.ts` and the gate both read the engine, so the reading
  (`run`, `readModel`, `parseStatus`, `isProtected`) moved into `hooks/branch-engine.ts`.
