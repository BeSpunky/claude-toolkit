# 06 — Review: migrations & the ladder (reviewer `mig`)

Scope: `src/migrations/**` (0.35.0 rungs, 0.24.0 fix), `migrations.json`, `tools/test-migrations/**`, scaffold.sh probe/migrate/--local.
Scratch: `scratchpad/review-mig/` (fixture copy `repo/`, real ladders `ladder/`). Agents spent: 1 (`mig-ladder`).

## Verified ladders (real, `--local`, reviewed tree)
- 0.29.0 Angular+Firebase+DS → 9 rungs (0.30.2, 0.33.0, 0.33.1, 0.34.0, 5×0.35.0), SYNC_OK, stamp 0.36.1, build shop/functions/design-system ✔, `serve --dry-run --port-offset=27000` → 31200 + proxyConfig + emulators, re-sync no-op.
- 0.24.6 → 13 rungs, no throw, SYNC_OK, build ✔, re-sync no-op.
- Wrapper host: pin exactly `0.36.1` in nx.json `installation.plugins`; `.nx/installation` gitignored; from stamp+install 0.34.0 the 5 rungs ran via `./nx migrate`, mount retargeted, pin exact afterwards; probe reads `.nx/installation` (installed=0.33.2 vs stamp 0.36.1 → floor 0.33.2).
- Fixtures: 46/46; release invariants hold. No owed-but-missing rung found: every other class-B delta checked (TUI move = same value set-if-absent; tooling `projectType` = owned project.json; DS keeps its binding; `@playwright/test` pinned by generator only when absent; removed options never persisted; `.claude/data/.gitkeep` was gitignored).

## Findings
1. **major (pre-existing, surfaced by ladder re-run)** — `src/migrations/0.33.0/split-firebase-service-providers.ts` ~L73–125: not idempotent across a ladder replay. First pass declines (no `provideAppFirebase()` call yet; 0.33.1 wires it); replayed from a lagging stamp (e.g. a sync that committed rungs then died before house-doc stamped) it adds `provideAppAuth/Firestore/Storage/Functions()` at the root app.config → +241 kB initial bundle. Evidence: A project, stamp reset to 0.29.0, re-sync → commit f4ba83b. Fix: decide "already migrated" from the 0.33.1-era shape (e.g. skip when the per-service config files exist and the call site was wired by 0.33.1), or stamp a migration floor per committed rung.
2. **minor** — `relocate-port-claim.ts` L33–37/L83: retargets every reference even when the old file is the project's own (unstamped, left in place), so its callers are repointed to a `tools/port-claim/` copy that a bare `nx migrate` never writes. Verified with an added fixture (scratch `zz-review-portclaim.mjs`: FAIL, "Re-pointed references … in: tools/shared-browser/shared-browser, scripts/x.sh"). Fix: only rewrite when a house file was moved (or `tools/port-claim/` exists). The same walk runs over the whole tree on every project (no `.venv`/`vendor`/`target`/`coverage` skip, rewrites past `docs/features` records) — gate it the same way.
3. **minor (documented known edge)** — `--local` checkpoint commit captures the temp `file:/tmp/…tgz` spec (package.json + yarn.lock on node host, nx.json pin on wrapper): A commit 4d47e1e, D commit a20f91e. FINALIZE_LOCAL corrects only the working tree afterwards. Dev-loop only, but every ladder commit is uninstallable. Fix: run the --local install's manifest write outside git's view (e.g. assume-unchanged / finalize before migrate collects) or amend.
4. **minor** — scaffold.sh ~L1372: the "this tree has uncommitted changes … in the backup tag" NOTE fires on every migrating sync of a clean tree; the dirt is the sync's own install. Fix: check status before the install (probe time) and carry the verdict.
5. **minor (design)** — `tag-navigation-library.ts:22` imports live `generators/_utils/app-roots` despite the self-contained rule stated in contracts/layers.md (0.33.x rungs do the same; behaviour currently identical).

## Suspicions (unverified)
- `declare-dev-processes.ts` `JSON.parse` of an existing `.bespunky/dev.json` is unguarded — a malformed file throws and aborts the ladder (only reachable after a hand edit between an interrupted sync and its re-run).
- Node host: yarn warns unmet peer `@nx/devkit@>=23` for nx-tools (resolved transitively); wrapper pins it explicitly.
- Production (registry) collection path untested — 0.36.1 unpublished.
