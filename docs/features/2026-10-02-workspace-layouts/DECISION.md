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
