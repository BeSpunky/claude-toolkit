// Shared generator util: WHERE does this workspace keep its projects — its apps, and its libraries?
//
// THE CONCEPT: a `WorkspaceLayout { appsDir, libsDir }`. It used to be modelled for libraries only
// (`resolveLibsDir`) while every app path said `apps/` outright — so a workspace that keeps everything under
// `packages/` got a library where it expected one and an app where it did not. Both halves are one fact about
// the workspace, so they are resolved together, by one rule, here.
//
// A house generator run against a CONSUMER'S existing repo must land a project where that repo already keeps
// them: an Nx workspace that uses `libs/` should not sprout a lone `packages/` folder the moment someone runs
// `--sync`. So the layout is DETECTED, never assumed, and each half independently, from the most authoritative
// signal to the safe fallback:
//
//   1. an explicit `--directory` (the caller's escape hatch — handled by the caller, not here);
//   2. `nx.json` -> `workspaceLayout.appsDir` / `.libsDir` — the workspace's own declared convention. It is
//      Nx's own field, so writing it (`writeWorkspaceLayout`, at scaffold) also makes Nx's generators agree
//      with ours;
//   3. INFERENCE from where existing projects actually live — the dominant top-level segment of every
//      application root (appsDir) and every library root (libsDir). Which is which is asked of the stack
//      adapters first (`projectRole`), so a package.json-defined project with no `projectType` still counts;
//   4. the house default, for a genuinely empty workspace: `apps/` + `packages/` — today's output, exactly.
//
// A scaffold CHOOSES a named layout (`LAYOUTS`) and records it; a sync never chooses, it only detects — the
// same detect/ensure split the layers keep.
import { type Tree, type ProjectConfiguration, getProjects, readJson, readNxJson, updateNxJson, logger } from '@nx/devkit';
import { projectRole, type ProjectRole } from '../../adapters/registry';

/** Where a workspace keeps its projects. Workspace-relative directories, no trailing slash, no project name. */
export interface WorkspaceLayout {
  appsDir: string;
  libsDir: string;
}

/**
 * The named layouts a NEW workspace can be scaffolded with (`scaffold.sh --layout=<id>`). Data, beside the
 * presets — adding one is one entry. Neither is the default: the default is `DEFAULT_LAYOUT`, which reproduces
 * what the house always produced, so nobody who doesn't ask sees a change.
 */
export const LAYOUTS = {
  /** Nx's classic integrated convention. */
  'apps-libs': { appsDir: 'apps', libsDir: 'libs' },
  /** One home for everything — the package-based / TS-solution convention. */
  packages: { appsDir: 'packages', libsDir: 'packages' },
} as const satisfies Record<string, WorkspaceLayout>;

export type LayoutId = keyof typeof LAYOUTS;

/** The house default when nothing is declared or inferable: apps under `apps/`, publishable packages under `packages/`. */
export const DEFAULT_LAYOUT: Readonly<WorkspaceLayout> = { appsDir: 'apps', libsDir: 'packages' };

/** The house default library home. Kept as its own export — callers predate the layout model. */
export const DEFAULT_LIBS_DIR = DEFAULT_LAYOUT.libsDir;

/** Which project role fills which half of the layout. */
const HALVES: ReadonlyArray<readonly [key: keyof WorkspaceLayout, role: ProjectRole, noun: [one: string, many: string]]> = [
  ['appsDir', 'application', ['application', 'applications']],
  ['libsDir', 'library', ['library', 'libraries']],
];

/**
 * This workspace's layout. Never throws: every half resolves to a usable segment, falling back to
 * `DEFAULT_LAYOUT`. An explicit `--directory` is the caller's concern and takes precedence over anything here.
 */
export function resolveWorkspaceLayout(tree: Tree): WorkspaceLayout {
  const declared = declaredLayout(tree);
  const inferred = inferredLayout(tree);
  const layout = { ...DEFAULT_LAYOUT };
  for (const [key, , [one, many]] of HALVES) {
    const fromNx = declared[key];
    const fromProjects = inferred[key];
    if (fromNx) layout[key] = fromNx;
    else if (fromProjects) {
      layout[key] = fromProjects.dir;
      logger.info(
        `[workspace-layout] ${key} is "${fromProjects.dir}/" — inferred from ${fromProjects.count} existing ` +
          `${fromProjects.count === 1 ? one : many}. Pass --directory to override.`,
      );
    }
  }
  return layout;
}

/** The workspace-relative directory this workspace keeps libraries in. Callers append `/<name>`. */
export function resolveLibsDir(tree: Tree): string {
  return resolveWorkspaceLayout(tree).libsDir;
}

/** The workspace-relative directory this workspace keeps applications in. Callers append `/<name>`. */
export function resolveAppsDir(tree: Tree): string {
  return resolveWorkspaceLayout(tree).appsDir;
}

/**
 * Record `layout` as the workspace's declared convention (nx.json `workspaceLayout`) — what a SCAFFOLD does
 * with the layout it was asked for, so every later run (ours and Nx's) resolves the same answer from step 2
 * instead of re-inferring it. Both halves are always written: a half left out would be inferred, and an empty
 * workspace infers the default, not the choice.
 */
export function writeWorkspaceLayout(tree: Tree, layout: WorkspaceLayout): void {
  const nxJson = readNxJson(tree) ?? {};
  nxJson.workspaceLayout = { ...nxJson.workspaceLayout, appsDir: clean(layout.appsDir)!, libsDir: clean(layout.libsDir)! };
  updateNxJson(tree, nxJson);
}

/** (2) What nx.json declares, half by half. */
function declaredLayout(tree: Tree): Partial<WorkspaceLayout> {
  if (!tree.exists('nx.json')) return {};
  const declared = readJson<{ workspaceLayout?: Partial<WorkspaceLayout> }>(tree, 'nx.json').workspaceLayout ?? {};
  return { appsDir: clean(declared.appsDir), libsDir: clean(declared.libsDir) };
}

/**
 * (3) Where existing projects live: per half, the dominant top-level path segment across the projects playing
 * that role. A repo whose libs sit under `libs/` gets `libs` with zero configuration.
 */
function inferredLayout(tree: Tree): Partial<Record<keyof WorkspaceLayout, { dir: string; count: number }>> {
  const counts: Record<keyof WorkspaceLayout, Map<string, number>> = { appsDir: new Map(), libsDir: new Map() };
  let projects: Map<string, ProjectConfiguration>;
  try {
    projects = getProjects(tree);
  } catch {
    return {}; // An unreadable workspace has nothing to infer from — the default is the honest answer.
  }
  for (const [name, project] of projects) {
    const role = projectRole(tree, name);
    const half = HALVES.find(([, r]) => r === role)?.[0];
    if (!half) continue;
    const top = project.root.split('/').filter((s) => s && s !== '.')[0];
    // `tools/` is EXCLUDED, and it has to be. The house's own scaffolding — worktree-domains, shared-browser —
    // lands there and, before 0.35.0, declared `projectType: 'library'` (projects synced from then on carry no
    // projectType at all: tooling is neither an app nor a library), and those generators run BEFORE the library
    // generators. So the inference was answering "where does this workspace keep its libraries?" with evidence
    // the house itself had just planted: a fresh scaffold put the design system at `tools/design-system`,
    // contradicting every document it generates in the same run (all of which say `packages/design-system`).
    //
    // Excluding it is not a special case for our own output — `tools/` is Nx's convention for workspace
    // TOOLING, never for the apps or libraries a project builds and ships, so it is never a truthful answer to
    // this question no matter who put a project there.
    if (top && top !== 'tools') counts[half].set(top, (counts[half].get(top) ?? 0) + 1);
  }

  const inferred: Partial<Record<keyof WorkspaceLayout, { dir: string; count: number }>> = {};
  for (const [half, tally] of Object.entries(counts) as Array<[keyof WorkspaceLayout, Map<string, number>]>) {
    for (const [dir, count] of tally) if (count > (inferred[half]?.count ?? 0)) inferred[half] = { dir, count };
  }
  return inferred;
}

/** A declared directory, normalized: no leading `./`, no trailing slash; empty means "not declared". */
function clean(dir: string | undefined): string | undefined {
  return dir?.trim().replace(/^\.\/+/, '').replace(/\/+$/, '') || undefined;
}

/**
 * The WORKSPACE'S npm scope, WITHOUT the leading `@` — what a library created here is published under when the
 * caller names no import path. Derived from the root package.json `name` (which `create-nx-workspace` sets to
 * the workspace name): an already-scoped name (`@acme/monorepo`) yields `acme`; otherwise the name itself.
 * Without a package.json (the Nx wrapper host) or a name, the workspace directory's name.
 *
 * Normalized to a VALID npm scope (lowercase, URL-safe): `create-nx-workspace` seeds the name from the project
 * dir, which a user may have called `My_App` — and `@My_App/x` is an illegal package name `npm publish` rejects.
 *
 * Never the toolkit's own `@bespunky`: that default once made every consumer's design system
 * `@bespunky/design-system`.
 */
export function resolveWorkspaceScope(tree: Tree): string {
  const rootName = tree.exists('package.json') ? readJson<{ name?: string }>(tree, 'package.json').name : undefined;
  const raw = rootName
    ? rootName.startsWith('@')
      ? rootName.slice(1).split('/')[0]
      : rootName
    : tree.root.replace(/\/+$/, '').split('/').pop() ?? '';
  return normalizeNpmScope(raw);
}

/** Coerce a scope to a valid npm scope name: lowercase; anything outside `a-z 0-9 - . ~` becomes `-`. */
export function normalizeNpmScope(scope: string): string {
  const normalized = scope.toLowerCase().replace(/[^a-z0-9\-.~]+/g, '-').replace(/^-+|-+$/g, '');
  if (normalized !== scope) {
    logger.info(`[workspace-layout] Normalized the npm scope "${scope}" -> "${normalized}" (npm names must be lowercase and URL-safe).`);
  }
  return normalized || 'workspace';
}
