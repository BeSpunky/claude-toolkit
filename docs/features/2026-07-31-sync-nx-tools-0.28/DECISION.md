---
status: concluded
concluded: 2026-07-31
summary: Synced the toolkit repo to @bespunky/nx-tools 0.28.0 in an isolated worktree; the 0.25.0→0.28.0 ladder ran clean (both migrations no-op here), stamp + install committed, awaiting promotion to development.
tags: [sync, nx-tools, migration, dogfood, project-starter]
---

# DECISION — sync claude-toolkit to nx-tools 0.28.0

## Outcome: `SYNC_OK`

Ran `scaffold.sh --sync --yes .` inside the `chore/sync-nx-tools-0.28` worktree
(off `development`), because a direct run on `development` was refused by the
protected-branch gate. See [[BRIEF]] for the refusal and the worktree decision.

## The migration ladder — the irreversible part

```
[migrate] house tooling 0.25.0 -> 0.28.0
```

- Probe floor: **0.25.0** (older of `node_modules` and the `HOUSE.md` stamp).
- Installed: **`@bespunky/nx-tools@0.28.0`** (exact pin, no caret).
- `nx migrate` collected **2** migrations and ran both; **both made no changes**
  in this repo, so **0 migration commits** were created:
  - `convert-target-comment-keys` — no-op (this repo has no `//`-keys inside a
    `project.json` `targets` block; it carries only the `agent`/`js`/`nx` layers,
    no Angular apps).
  - `report-duplicate-house-providers` — no-op (no app configs / house providers
    here to duplicate).
- Nx made a **checkpoint commit** (`9beb27d`) before the ladder, which captured
  the dependency install only (`package.json` pin + `yarn.lock`). No in-flight
  work leaked into it — the BRIEF was committed first, so the tree was clean but
  for the install the sync itself had just done.

## What the generators wrote (committed after the ladder)

- `HOUSE.md` — regenerated; stamp advanced to
  `nx-tools=0.28.0 plugin=0.28.1 layers=agent,js,nx` (the `js` layer is now
  recorded; new house generators documented).
- `.devcontainer/.bespunky-devcontainer.json` — adoption record: the existing
  project-written `devcontainer.json` was merged additively, nothing needed
  adding, and the `name` key was left as the project's (recorded under `skipped`).
- Idempotent (no diff): `.claude/settings.json` (claude-settings) and
  `.vscode/settings.json` (window-identity kept the project's existing identity).

## Layers

- Detected: `nx, agent, js` · Ensured by this run: **none** (a plain sync ensures
  nothing) · Active union: `agent, js, nx`.

## Notes

- `.devcontainer/*` **did** change (the adoption record). That file is not part
  of the container image spec, so **no Dev Container rebuild is required** — the
  merge added nothing to `devcontainer.json` itself ("added: nothing — already
  complete").
- Backup restore point: `HEAD(d87af1c)` (the BRIEF commit), per the `BACKUP_OK`
  line — `git reset --hard d87af1c` unwinds the whole sync if ever needed.
- The generator `--name` args were derived from the worktree folder
  (`sync-nx-tools-0.28`), but every name-bearing generator adopted/kept existing
  values, so no stray "app name" was written anywhere.
