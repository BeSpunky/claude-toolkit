# Sync claude-toolkit to `@bespunky/nx-tools` 0.28.0

**Slug:** `sync-nx-tools-0.28` · **Branch/worktree:** `chore/sync-nx-tools-0.28` · **Opened:** 2026-07-31

## What & why

The user ran `/sync` on the toolkit repo itself (dogfooding). The preflight found:

- Probe: this project's `@bespunky/nx-tools` resolves at **0.25.0** (the older of `node_modules` and the `HOUSE.md` stamp).
- This checkout's scaffolder (plugin `0.28.1`, payload `0.28.0`) would install **0.28.0** and run the versioned one-way migration ladder **0.25.0 → 0.28.0**.

So the sync is *not* a no-op — it carries a multi-version migration ladder that rewrites every project in the workspace. That is real, irreversible work and must land as an isolated, per-migration commit ladder.

## Why a worktree (the decision)

Running `--sync --yes .` on `development` was **refused** by the pre-write gate:

```
SYNC_REFUSED: protected-branch
[preflight] NOTHING HAS BEEN WRITTEN — the project is exactly as it was.
[preflight] This run would have migrated 0.25.0 -> 0.28.0.
```

HEAD was on `development` and the house branch model is adopted, so the migration ladder would have committed directly onto an integration branch. The user chose the house answer:

> **"Worktree + sync (Recommended)"** — Open a feature worktree off `development`, run the sync there so the migration ladder commits in isolation, then promote it into `development`.

## Plan

1. Worktree off `development`, install deps (done at open).
2. Re-run `/sync` from the top inside the worktree (per the command: re-run rather than resume mid-way).
3. Read the `[migrate]` outcome + the per-migration commit ladder; verify layers/stamp.
4. On success, settle this package's `DECISION.md` and promote `chore/sync-nx-tools-0.28` → `development` (human-gated).

## Notes / caveats

- The plugin-update step of `/sync` is a no-op here: the marketplace source is this working tree, so the installed cache (0.28.0) can lag the source (0.28.1) with no fetchable copy to pull. The scaffolder that runs is the working-tree file at 0.28.1 — the newest — so there is no downgrade risk.
