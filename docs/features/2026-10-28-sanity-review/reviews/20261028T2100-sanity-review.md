# Sanity review — 71c7a09c (house docs are plugin-gated)

Mode: fix · Budget: 5 agents · Scope: `git diff 71c7a09c~1 71c7a09c`

## Frame
Goal: house-generated docs (HOUSE.rules.md, HOUSE.md, seeded CLAUDE.md) must never tell Claude to use a toolkit skill or agent whose plugin the project's layers do not enable. Decisions (not findings): whole HOUSE.rules.md sections gate on the plugin carrying their skill; HOUSE.md/CLAUDE seed gate only the sentences naming a skill; flags `plugin-<name>` derived from `claudePlugins(active)` (same list as .claude/settings.json); the CI IAM rule names no plugin, so it is its own always-shown (ci+firebase) section; nothing to migrate. Files: house-doc/{generator.ts, HOUSE.rules.md.tpl, HOUSE.md.tpl, CLAUDE.seed.md.tpl}, tools/test-layers/run.mjs, README.md. Verification: test-layers, test-generators, check-release-invariants.

Tree note: `plugins/workflow/tsconfig.json` untracked, not in scope — not touched.

## Lenses (budget 5)
- R1 correctness + tests (render matrix, template engine, test regex blind spots)
- R2 completeness + architecture/reuse (sweep of every generated text naming a skill; dangling cross-refs; README canonical mirror; derivation seam)
- R3 prompt & doc design (does each gated doc still read coherently with sections absent)
- V1 adversarial verifier over high/medium
- (1 spare: re-check if fixes large)

## Status (closed)
- [x] R1 R2 R3 dispatched synchronously in one message, all returned
- [x] V1 adversarial verifier over F1-F7: nothing refuted (F5 and F6 only partly)
- [x] fixes applied (fix mode)
- [x] re-verify: test-layers 103/0, test-generators 213/0 (25 skipped), release invariants ok, descriptions ok
- spare agent unused: the fixes are template text and one test, not a reshaped module

## Findings and outcomes
- F1 (high, stands): needs decision. Flags come from claudePlugins(active), but only the agent layer writes enabledPlugins (claude-settings, agents.ts:38). So nx+design-system, angular or nx without agent are still told to use design-system / angular / nx skills. The test shares the same derivation, so it cannot catch this. Options: (a) one enabledPlugins(active) helper that returns nothing without agent, used by both claude-settings and house-doc; (b) move claude-settings to the floor; (c) read .claude/settings.json enabledPlugins from the Tree.
- F2 (high, stands): FIXED. The firebase live-credentials prohibition was hidden inside the workflow-gated Local servers section. It is now its own always-shown {{#firebase}} section, "Local runs never reach live credentials (non-negotiable)", the same move as the CI rule.
- F3 (high, stands): FIXED. In HOUSE.md Branch & release parameters, the bare "the skill's plan / engine / change procedure / investigates" and the branches.mjs commands are now gated on workflow, each with a plain replacement ("ask the user", "by the user's decision", "investigate").
- F4 (medium-high, stands): FIXED. pointer.md.tpl now gates each listed directive on its plugin and always names generator-first, so the list is never empty.
- F5 (medium, partly): FIXED. The test now covers every layer subset closed under requires, with the model both declared and undeclared. It adds a workflow-free check for bare "the skill" and branches.mjs, a check that the pointer and HOUSE.rules headings agree, and a static check that every plugin-* gate in a template names a declared plugin (a typo is caught). The regex now allows digits. The shared derivation (F1) remains.
- F6 (medium, partly): needs decision. Owned artifacts of other generators still name skills a non-agent project lacks: design-system STRUCTURE.md (neutral :59, angular :191, alwaysRewrite); ci/generator.ts:187, which writes the branch-and-release skill into ci.json pending; firebase-deploy.mjs.tpl:126/128 and firebase-deploy-rules.mjs.tpl:77. Seeded ones: _tokens.scss.tpl, ds-theme.service.ts.tpl, environment.prod.ts, apphosting.yaml, firebase-welcome.sh.
- F7 (medium, stands): needs decision. Without workflow, a ci project has no permitted way to declare ci bindings (the always-on rule points at them, HOUSE.md says "by the user's decision"). Options: ci enables bespunky-workflow, ci requires agent, or document the hand-declaration path.
- Lows FIXED: seed comma (CLAUDE.seed.md.tpl); HOUSE.rules header now reads "Each rule that names a skill is its operational half … its skill carries the depth"; CI rule "Change *where* CI deploys"; "Designing the real visual system" replacement without product-ux; a stray blank line in the HOUSE.md CI list; README paragraph corrected (ports sentence, safety rules, test coverage).
- Low not fixed: plugin@marketplace is parsed in 3 places and closure() duplicates house.sh. The test now enumerates subsets instead, so there is no closure; the split('@') helper is left as is. Reuse nit, own judgement.

## Not covered
Security, scalability, UX/visual lenses: irrelevant (template text). The end-to-end house.sh upgrade is owed again by the session, after these fixes. The untracked plugins/workflow/tsconfig.json was not touched.
