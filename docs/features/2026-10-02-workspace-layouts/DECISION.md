# Workspace layouts — decision (draft, awaiting confirmation)

## Proposed design

**Model the missing concept: `WorkspaceLayout { appsDir, libsDir }`** — one resolver in `_utils/workspace-layout.ts`, replacing the libs-only `resolveLibsDir`:

1. `nx.json` `workspaceLayout` (Nx's own field — Nx's generators read it too, so writing it makes them agree with ours) →
2. inferred from existing projects (applications → appsDir, libraries → libsDir, excluding `tools/`) →
3. default.

**Named layouts** as data beside presets: `apps-libs` (`apps/`, `libs/`) and `packages` (`packages/`, `packages/`). `scaffold.sh --layout=<id>` picks one for a new project and the scaffold writes it into `nx.json` `workspaceLayout`; a sync never chooses, it only detects (same detect/ensure split as layers).

**Every hardcoded `apps/` goes through it:**
- `scaffold.sh` app discovery and first-app path → ask the package (`layers/cli.js`, the same seam the planner uses) instead of globbing `apps/*` in bash; discovery uses `findAppRoots`/project graph, layout-agnostic.
- `firebase-emulators` → `<appsDir>/functions`, `dist/<appsDir>/functions`, tsconfig depth via `offsetFromRoot`; welcome script globs the resolved apps dir.
- House docs render `{{appsDir}}` / `{{libsDir}}`; CLAUDE.seed stops contradicting the generators; SKILL.md + engineering refs describe the layout as a concept.

**Migrations question:** no on-disk shape changes for existing projects — nothing moves; resolution is inference-first, so an existing `apps/`+`packages/` hybrid keeps resolving to exactly what it has. Default for a new scaffold with no `--layout` stays today's output, so nothing changes for anyone who doesn't ask.

## Open scope question

TS-solution workspaces (package.json-defined projects, project references) — in or out of this effort?

## Scope settled — 2026-10-02

Offered: folder convention now, TS-solution as a follow-up (recommended). The user chose:

> "Support both"

So TS-solution workspaces (package.json-defined projects, npm workspaces, TS project references) are **in scope**. The folder-layout design above stands; TS-solution needs its own design (project-config writes, library linking, Angular's refusal) — researched next, confirmed before implementation.

## Combined design (proposed 2026-10-02, after research R1–R3 — see handoffs/*-fanout.md)

Two **orthogonal** workspace facts, each modelled once, each **detected** on sync and **chosen** only at scaffold:

| Concept | Values | Detected from |
| --- | --- | --- |
| **Layout** — where projects live | `apps-libs` (`apps/`,`libs/`) · `packages` (`packages/`) · today's hybrid by inference | nx.json `workspaceLayout` → existing projects → default |
| **Linking** — how projects reach each other | `paths` (project.json + tsconfig `paths`) · `workspaces` (TS-solution: package.json projects, PM workspaces, project references) | our own copy of Nx's `isUsingTsSolutionSetup` predicate (it's only exported from `@nx/js/internal`) |

**Linking is a strategy behind one port** (`_utils/linking/`): `link(lib → consumer)`, `resolve(importPath)`, `retarget`, `unlink`. `paths` = today's behaviour; `workspaces` = workspaces glob + root `references` + consumer `package.json` dependency (`workspace:*` / `*` by package manager) + `exports` with the custom condition. Replaces the 4 duplicated root-tsconfig picks and the "paths only" policy comments.

**Project config through one seam**: devkit's `updateProjectConfiguration` already writes the `nx` block of a package.json-only project. What's left: one `projectConfigFile()` helper replacing 4 duplicated copies and the hard-coded `project.json` writes (shared-browser, worktree-domains, firebase-emulators, design-system's `addProjectConfiguration`); `projectType` reads replaced by asking the stack adapter "is this your app?"; layer evidence (`layers/cli.ts`) scans package.json projects too.

**Angular in a TS-solution workspace = honest hybrid.** The Angular adapter calls `@nx/angular` init/application/library with `NX_IGNORE_UNSUPPORTED_TS_SETUP` set for that one call only (upstream's own opt-out). Angular projects are `project.json` islands that consume workspace packages through their `exports`; documented as such in HOUSE.md. `host`/`remote` stay refused. Risk: the env var is undocumented and could change in a minor — a fixture test (TS-solution + Angular app + typecheck/build) is the tripwire.

**Scaffold**: `--layout=apps-libs|packages`, `--linking=paths|workspaces`; defaults = today's output. App discovery leaves bash (`apps/*` glob) for the package (`layers/cli.js`), layout- and linking-agnostic.

**Migrations**: nothing to migrate — no existing project's shape changes; both facts are detected, and existing projects detect as exactly what they are. (Stated deliberately per the release rule.)
