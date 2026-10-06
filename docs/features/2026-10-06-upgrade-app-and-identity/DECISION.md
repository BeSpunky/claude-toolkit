---
effort: upgrade-app-and-identity
summary: Upgrade infers the app to refresh from .bespunky/dev.json and stamps the worktree tab label with the real project identity, not the worktree folder name
---

# Upgrade: the app to refresh, and who the project is — decision

Source: a handoff from backitup's upgrade (nx-tools 0.45.0 / bespunky-house 0.43.0) — an Nx monorepo with
`packages/{shared,daemon,ui,issuance-service}` and `tools/*`, upgraded (as the procedure requires) from a linked
worktree `house-upgrade-2026-10-05`. The user handed it over as "info and suggestions — do your own thinking".

## 1. The app to refresh wasn't inferred

`cli.js apps` returned four "client apps" (daemon, issuance-service, linux-fixtures, ui); more than one → inference
declined → fallback to the project name → `UPGRADE_PARTIAL`, every per-app step skipped.

**Root cause:** the graph cannot tell a Windows service, an HTTP API or a fixture tool from a browser app unless
someone tagged it `platform:server`, and the project's own declaration of what it serves (`.bespunky/dev.json`)
was never consulted.

**Decision:** `appsToRefresh` (renamed from `clientApps`, whose name now undersold it): the graph still produces
the candidates (applications, `platform:server` excluded); a dev.json that names any candidate narrows them to
those it names; a dev.json naming none (only non-Nx processes) or no dev.json leaves the graph's answer as before.
A declared fact outranks an inferred one. The engine's "can't infer" note now points at declaring the app in
dev.json.

**Considered and not done:** a sharper graph definition of "client app" (e.g. only apps a stack adapter owns as a
browser build). Every stack would have to classify client vs server, and a js-stack app can be either — the
declaration answers the question the graph can't, so the graph stays the fallback rather than growing a guess.

## 2. The worktree tab label named the worktree

`angular.ts` ran `worktree-tab-label` with only `--project`, so the generator fell back to `basename(tree.root)` —
the worktree's directory — and baked it as the main-tree sentinel: in exactly the setup the upgrade mandates, the
main tree got labelled and the worktree didn't.

**Root cause, as a class:** five places defaulted "who is this project" to `basename(tree.root)`:
worktree-tab-label, app (`workspaceName`), firebase-emulators, window-identity (after package.json), and the npm
scope (`resolveWorkspaceScope`, after package.json). All wrong from a linked worktree.

**Decision:**
- The angular layer passes the engine's resolved identity (`--workspaceName=${ctx.project}`), like the firebase
  layer already did — one source of truth for an upgrade.
- The default stays (a generator run by hand must still answer) but becomes **`workspaceIdentity(tree)`**
  (`_utils/workspace-identity.ts`): the same rule as the engine's `_project_identity` — the directory's name in the
  main worktree, via `git rev-parse --git-common-dir`; a subdirectory workspace or no git → its own name. Every one
  of the five sites uses it. The engine must answer before the package is installed, so two resolvers are
  inherent; a test-layers check runs both against the same fixtures (main, linked, subdirectory, no git) and fails
  if they ever disagree.

**Migrations:** nothing to migrate. `worktree-tab-label.ts` is generator-owned (rewritten every upgrade), so a
project carrying a worktree slug there heals on its next upgrade now that the app resolves; dev.json and the
inference change no on-disk shape.

**Noticed, not fixed (separate defect):** the tab label compares the hostname label to `WORKSPACE_NAME`
lowercased, while the dev loop serves the main tree at `toDnsLabel(name)` — a project named with `_` or `.`
(`my_app` → `my-app.localhost`) would still get its main tree labelled.
