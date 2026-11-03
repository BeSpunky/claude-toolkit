# Sanity review — release follow-ups (nx-tools 0.51.2)

Mode: fix. Scope: `git diff origin/development...HEAD` on chore/release-followups. Budget: 4 agents.

## Frame
Clears 0.51.x leftovers: (1) `nx test design-system` exits 1 on new Angular projects (no spec) → a real DsTheme spec seeded at creation only, plus a 0.51.2 rung for existing design systems, skipping and reporting no test target, another executor, own include/exclude, any existing spec, DsTheme missing or reshaped; (2) a standalone publishable Angular lib fails lint on an unused peer → prune moved into the Angular library port; deliberately NO rung; (3) stale Firebase bundle figures; (4) zoneless wording. `passWithNoTests` does not exist (decided, not a finding).

## Lenses
- R1 correctness: merge resolution, peers, rung, spec on real shapes
- R2 architecture + clean code + reuse
- R3 completeness + tests + docs (bundle figures, zoneless, dogfood gate)
- V1 adversarial verifier
- Session-run: real `new --local` and consumer upgrade through tools/dogfood-consumer from a scratch clone bumped to 0.51.2

## Findings

Verified by one adversarial verifier (real runs in copies of the kept consumers); low ones checked at the anchor.

### Fixed
- Rung reported a spec outside the source root as fine while the target stayed red: now warns. The skip itself is kept (user decision: "any existing spec").
- Rung detection was tag-only, silently missing a library named design-system that the generator tags minutes later: frozen tag-or-name rule.
- Shape check accepted shapes the spec fails on (constructor DI, inject<T>, another root element, commented-out removal) and refused reformatted ones (double quotes, multi-line decorator, dotted prefix).
- An include/exclude in a configuration was not seen.
- Rung messages and comments claimed jest and @angular/build:unit-test pass with no specs; reworded.
- Peer judgement ran before the demo was pruned: pruneGenerated judges again. Peers now asserted on a real DS (--strict).
- tools/dogfood-consumer branch-model seed could not run against 0.50.0+: the consumer road was unreachable. Seeds { note }.
- new/SKILL.md verify row said "two theming files"; a real DS holds five.
- HOUSE.md.tpl names the 500 kB budget warning. Stale comments, libRoot hoist, dogfood header text. DECISION.md supersession appended.

### Needs decision
- N1 entry-point specs never run; a green target hides them, and a DS with only such specs stays red.
- N2 navigation-core: `nx test` exits 1, same class, no fix or rung.
- N3 ds-component produces a library that does not build (pre-existing, outside the diff).
- N4 brand-lib seed: post-upgrade lint FAIL on web:lint, in the baseline too, so the gate exits 1.
- N5 Angular 20 + Nx 24 jest road may be red (read, not run).

### Rejected or not applied
- creationTemplates argument narrowing: taste; the project's target is what it judges.
- Moving pruneUnusedPeers out of library-peers.ts: two production callers now.
- historicalShapes for the rung: no release shipped the skip marker.
- RUNTIME_FILES dead guard: pre-existing, out of scope.
- run.mjs zero-tasks PASS, and the gate not running publishable-lib / navigation / ds-component: tied to N2 and N3, reported.
- 0.33.x rungs importing the live firebaseProvidersNote: pre-existing, reported.

### Owed by the session
- CLAUDE.md:111 and :144 still say the dogfood builds and lints; add test. Not edited here.

## Verification
test-migrations 316 ok; test-generators 240 ok, 30 skipped; test-generators --strict with @nx/angular 23.1 270 ok; test-layers 103 ok; test-scaffold ok; check-descriptions ok.
Scratch clone bumped to 0.51.2, tools/dogfood-consumer --only=consumer,new-angular: 38 pass, 1 FAIL (N4). Baseline design-system:test failed, post-upgrade test passes after the rung's commit. new-angular-firebase ran only before the fixes.
