# Sanity review — a4e487b8 + 7dd1b6e2 (skill pointers follow enablement)

Mode: fix · Budget: 5 agents · Scope: `git diff a4e487b8~1 7dd1b6e2`

## Frame
Goal: text the house generators write into a consumer project never tells Claude to use a toolkit skill/agent/command whose plugin the project does not ENABLE. Enablement = `.claude/settings.json` `enabledPlugins` (written only by the agent layer's claude-settings step, which runs before the other generators; house-doc runs last). Decisions (not findings): gate on enablement read from settings, not on layers' declared `claudePlugins`; house-doc via `plugin-<name>` flags; the other generators via one pointer table (`_utils/plugin-pointers.ts`) filled through each generator's existing substitution; seeded files already in existing projects are the project's own and are NOT migrated; operator-log messages from the upgrade are left alone; migrations 0.24.2 and 0.45.0 render current templates, so they fill the pointers. Verification: test-generators, test-layers, test-migrations, test-scaffold.

Tree note: `plugins/workflow/tsconfig.json` untracked, not in scope — not touched.

## Lenses (budget 5)
- R1 correctness + tests
- R2 completeness + architecture + reuse
- R3 prompt/doc design + clean code (rendered text both ways)
- V1 adversarial verifier over high/medium
- 1 spare (re-check if fixes are large)

## Status (closed)
- [x] R1 R2 R3 dispatched synchronously in one message; all returned
- [x] V1 verified F1-F7: F1, F3, F4, F6, F7 stand; F2, F5 partly stand
- [x] fixes applied (fix mode)
- [x] re-verify: test-generators 225/0 (27 skipped), test-layers 103/0, test-migrations 280/0, test-scaffold ok, check-descriptions ok
- spare agent unused: the fixes are template text, comments, one helper split and tests. No module was reshaped.

## Findings and outcomes
- F1 (high, stands): NEEDS DECISION. Per-app firebase-client renders environment.prod.ts before claude-settings exists. On `new`, NEW_APP_BLOCK runs before PLAN_RUN; on upgrade/add-layer, plan.ts emits per-app steps before workspace steps. The file is write-once, so a new Angular+Firebase project never gets the app-hosting pointer. This errs safe: it names nothing absent. Same class, rarer: migrations 0.24.2/0.45.0 read the settings as they were before the upgrade. The ordering is now documented in plugin-pointers.ts.
- F2 (medium, partly): NEEDS DECISION. Migration 0.50.0 correct-app-hosting-guidance writes `bespunky-house:firebase-app-hosting` unconditionally. In environment.prod.ts that is a new pointer; in apphosting.yaml it replaces an older one. Gating it means editing a released rung.
- F3 (medium, stands): FIXED. The nx plugin's `nx-generate` / `nx-workspace` / Nx MCP sentences in HOUSE.rules.md.tpl and HOUSE.md.tpl are now gated on plugin-nx, and test-layers checks them (NX_ONLY). Low: the two bespunky-browser-automation passages in HOUSE.md.tpl are now gated on their plugin.
- F4 (high, stands): FIXED. addCiLayerCommand / upgradeCommand off values now name the same means without the plugin (`house.sh add-layer ci .`, `house.sh upgrade .`), the layers' own hint wording. The tests assert the off text.
- F5 (partly): FIXED. The design-system/skill-pointers.ts comment no longer claims STRUCTURE.md is byte-identical.
- F6 (stands): FIXED. The welcome banner's token moved next to "Claude", so there is no double parenthetical.
- F7 (low, stands): FIXED. 0.45.0 treats a file as current if it matches the enablement render OR the all-on render, via the new pointerRendererFor in plugin-pointers.ts. A new case was added and proven to fail without the fix.
- Duplicate branchModelSkill / ci table inline (medium): FIXED. Moved to ci/skill-pointers.ts as throughBranchModelSkill.
- plugin-pointers.ts header overstated its rule (medium): FIXED. It now states the actionable-off rule and the ordering caveat.
- No repo-wide guard (medium): FIXED. test-layers fails any non-house-doc .tpl that types `bespunky-x:` or `/bespunky-x:` directly, and any pointer-table entry whose plugin is not the one its text names or is undeclared. The template sweep was proven to fail on a planted hit; the table check was not exercised against a planted mismatch.
- Lows FIXED: claude-settings-file.ts header wording; the firebase-client.ts long line now binds `pointers`.
- NEEDS DECISION: enabledPlugins strips `@marketplace` (a fork's same-named plugin counts); user-scope and settings.local.json are ignored; claude-settings forces declared plugins back to `true` over a project's `false`, which predates this change.
- NEEDS DECISION: a CLAUDE.md convention bullet for the pointer rule (not edited by the reviewer).
- Not applied (low, taste): tuple → named object for PluginPointers; renaming tokens to *Aside; designPhasePipeline carrying the `//` prefix.

## Not covered
Security, scalability, UX/visual: not relevant (generated text). The Angular design-system pointer cases are skipped locally (@nx/angular absent); CI --strict runs them. tsc typecheck is unavailable here (@types/node missing); the tests compile and execute the payload. End-to-end (house.sh new/upgrade, dogfood-consumer) is owed again by the session. Untracked plugins/workflow/tsconfig.json was not touched.
