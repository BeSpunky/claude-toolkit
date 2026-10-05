---
effort: consumer-generator-bugs
status: concluded
concluded: 2026-10-05
summary: Fixed the firebase.config.ts syntax error every Firebase app shipped with, and gave the design system's default mode a home ($default-mode in its tokens — 'system' or a fixed mode) instead of an owned block every upgrade overwrote; fixtures now fail on unparseable output and upgrades print UPGRADE_VERIFY.
tags: [nx-tools, firebase, design-system, migrations, upgrade, testing]
---

# Decision

Reported by the `our-journey` project's handoff (nx-tools 0.44.0): two generator bugs, and "the upgrade compiles,
lints and tests nothing it rewrites".

1. **firebase.config.ts.tpl** — an apostrophe inside a single-quoted literal (`this app's`) made every
   Firebase app's generator-owned config uncompilable; reproduced on a fresh 0.44.0 scaffold, whose `web` did not
   build. Reworded. Root cause of it surviving: every fixture read output as text. **Both payload harnesses now
   fail on any TS/JS/JSON file a run writes that does not parse** (shown failing on the old template first).
2. **Default theme mode** — see `NOTES-theme-mode.md`. `$default-mode` in the seeded `_tokens.scss`; the owned
   `ds.theme()` block takes no argument; the runtime reads `--<prefix>-default-mode` back. Migration 0.45.0
   carries existing choices and replaces stock mechanism files only. Road not taken: a generator option persisted
   in workspace config (the reporter's first suggestion) — it puts a design decision away from the tokens.
3. **Verification** — `UPGRADE_OK` is followed by `UPGRADE_VERIFY: … nx affected -t build lint test --base=<restore
   point>` on Node workspaces, and the upgrade command runs it before reporting.

User's words on (2): "Go with your recommendation".

Found, not fixed (out of scope): a fresh 0.44.0 angular + design-system scaffold fails `nx lint design-system`
(`@nx/dependency-checks`: `@angular/common` declared in its package.json but unused).
