# Brief — upstream fixes for the fallout of a consumer sync

**Opened:** 2026-07-31 · **Slug:** `sync-fallout` · **Branch:** `fix/sync-fallout`

## Where this came from

A consumer project (`shir-halili-coaching`) ran `scaffold.sh --sync` and moved from house
tooling **0.23.0 → 0.25.1**, running 9 migrations. The run reported `SYNC_OK`. It was not OK.

The user brought the run's report here to design the upstream fixes rather than re-revert the
same regressions on every future sync. The consumer project already reverted three generator
regressions locally; **those reverts make `/sync` unsafe in that project until this effort
ships**, because the next run reasserts two of them — including one that breaks SSR.

## What went wrong, in the order severity actually runs

1. **The sync's own git behaviour swept the user's in-flight work into a migration commit.**
   `nx migrate --run-migrations --create-commits` stages with `git add -A`; the tree was dirty;
   `libs/keeper`, three `libs/inquiry` domains, `apps/functions`, privacy/SEO/analytics edits and
   docs all landed inside `1051c1f chore: [nx migration] claim-legacy-devcontainer-ownership`.
   Silent, and correctly-shaped: nothing lied, the commit log just stopped meaning what it says.
2. **`provideAppFirebase()` was re-added to `app.config.ts`** four lines above a comment saying
   Firebase is deliberately not there — double-providing it and initialising Firebase during
   SSR/prerender.
3. **`tools/emulators.sh` lost the 30-line block** deriving `--only` from `firebase.json`, which
   exists because the App Hosting emulator has no dev script and takes the whole suite down.
   Separately, **emulators kept dying mid-run** when a second `nx serve` was started.
4. **A `//typecheck` documentation key in `project.json` was exploded** into a 555-key
   char-indexed object.
5. **`.bespunky-sync.lock/` was committed** then deleted, leaving two phantom deletions.
6. **`claim-legacy-devcontainer-ownership` claimed ownership silently**, arming the *next* sync
   to regenerate the devcontainer wholesale.
7. **`retire-inline-house-sections` refused, correctly, and can never succeed** in that project —
   its precondition is a `HOUSE.md` that only the `agent` layer produces.

## Scope

Fix all of it **upstream in `@bespunky/nx-tools` and `scaffold.sh`**, not in the consumer.
Item 5 landed independently while this was being designed (`dd87697`, project-starter 0.26.4)
and is out of scope here.

See [DECISION.md](DECISION.md) for what was decided on each and why.
