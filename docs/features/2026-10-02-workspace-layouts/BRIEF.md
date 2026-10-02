# Workspace layouts — brief

> "Some Nx workspaces do a `apps`+`libs` layout, and some have a `packages` folder. Our toolkit should support both" — the user, 2026-10-02

## Where the toolkit stands (survey, 2026-10-02)

- **Libraries already have a layout concept**: `_utils/workspace-layout.ts` `resolveLibsDir` — `nx.json workspaceLayout.libsDir` → most common top-level dir among library projects (excl. `tools`) → `packages`. Every lib generator uses it.
- **Apps have none.** `apps/` is hardcoded in:
  - `scaffold.sh` app inference (`$TARGET/apps/*/project.json`, ~l.372) and the SYNC_OK summary (~l.2194) — on a `packages/` repo the sync can't find the app, so every per-app step is skipped (SYNC_PARTIAL for firebase).
  - `scaffold.sh` first-app creation (`apps/$APP`, ~l.1800).
  - `firebase-emulators` — `apps/functions`, `dist/apps/functions`, `../../tsconfig.base.json` (depth-2 assumption), `firebase-welcome.sh.tpl` glob `apps/*/src/environments/...`.
- **Docs** (HOUSE.md.tpl, CLAUDE.seed.md.tpl, layer hints, new-project SKILL.md, engineering refs) hardcode `apps/<app>` / `libs/<lib>`; CLAUDE.seed even disagrees with the generators.
- Today's default output is a hybrid: apps in `apps/`, libraries in `packages/`.
- Already layout-agnostic: `findAppRoots`, migration fallback scans, DS discovery by tag, angular `emittedProjectName`.

## Two meanings of "packages layout"

1. **Folder convention** — projects under `packages/`, still `project.json`-based. Pure layout; the gaps above.
2. **TS-solution workspace** — `package.json`-defined projects, npm `workspaces`, TS project references. Much deeper: `updateProjectConfiguration` throws without `project.json` (~12 call sites), libs are wired via `tsconfig.base.json` paths (wrong there), and `nx add @nx/angular` refuses project references outright (why `scaffold.sh` passes `--workspaces=false`).
