// Shared generator util: where does THIS workspace keep its libraries?
//
// The house default is `packages/` (BeSpunky ships publishable packages), but a house generator run
// against a CONSUMER'S existing repo must land a new library where that repo already keeps libraries —
// an Nx workspace that uses `libs/` should not sprout a lone `packages/` folder the moment someone runs
// `--sync`. So the library home is DETECTED, not assumed.
//
// This models the missing concept — "the workspace's library home" — as a single resolved value, rather
// than hardcoding `packages/<name>` at every call site. Resolution is deliberately ordered from the most
// authoritative signal to the safe fallback:
//
//   1. an explicit `--directory` (the caller's escape hatch — handled by the caller, not here);
//   2. `nx.json` -> `workspaceLayout.libsDir`, the workspace's own declared convention when it sets one;
//   3. INFERENCE from where existing libraries actually live — the dominant top-level segment of every
//      `projectType === 'library'` root (so a repo full of `libs/*` libs gets `libs`, with no config);
//   4. the house default `packages`, for a genuinely empty workspace with nothing to infer from.
import { type Tree, getProjects, readJson, logger } from '@nx/devkit';

/** The house default library home when nothing else is declared or inferable. */
export const DEFAULT_LIBS_DIR = 'packages';

/**
 * The workspace-relative directory this workspace keeps libraries in (e.g. `packages` or `libs`),
 * WITHOUT a trailing slash and WITHOUT the library name. Callers append `/<name>`.
 *
 * Never throws: every branch resolves to a usable segment, falling back to `packages`. An explicit
 * `--directory` is the caller's concern and takes precedence over anything decided here.
 */
export function resolveLibsDir(tree: Tree): string {
  // (2) The workspace's declared convention, when it sets one.
  if (tree.exists('nx.json')) {
    const declared = readJson<{ workspaceLayout?: { libsDir?: string } }>(tree, 'nx.json')
      .workspaceLayout?.libsDir;
    const cleaned = declared?.trim().replace(/^\.\/+/, '').replace(/\/+$/, '');
    if (cleaned) return cleaned;
  }

  // (3) Infer from where existing libraries already live: the dominant top-level path segment across
  //     every library project. A repo whose libs sit under `libs/` gets `libs` with zero configuration.
  const topSegmentCounts = new Map<string, number>();
  for (const [, project] of getProjects(tree)) {
    if (project.projectType !== 'library') continue;
    const top = project.root.split('/').filter((s) => s && s !== '.')[0];
    // `tools/` is EXCLUDED, and it has to be. The house's own scaffolding — worktree-domains, shared-browser
    // — lands there and, before 0.35.0, declared `projectType: 'library'` (projects synced from then on carry
    // no projectType at all: tooling is neither an app nor a library), and those generators run BEFORE this one. So the
    // inference was answering "where does this workspace keep its libraries?" with evidence the house itself
    // had just planted: a fresh scaffold put the design system at `tools/design-system`, contradicting every
    // document it generates in the same run (all of which say `packages/design-system`).
    //
    // Excluding it is not a special case for our own output — `tools/` is Nx's convention for workspace
    // TOOLING, never for the libraries a project builds and publishes, so it is never a truthful answer to
    // this question no matter who put a project there.
    if (top && top !== 'tools') topSegmentCounts.set(top, (topSegmentCounts.get(top) ?? 0) + 1);
  }

  let inferred: string | undefined;
  let best = 0;
  for (const [dir, count] of topSegmentCounts) {
    if (count > best) {
      best = count;
      inferred = dir;
    }
  }
  if (inferred) {
    logger.info(`[workspace-layout] Placing the library under "${inferred}/" — inferred from ${best} existing librar${best === 1 ? 'y' : 'ies'}. Pass --directory to override.`);
    return inferred;
  }

  // (4) Nothing declared, nothing to infer from: the house default.
  return DEFAULT_LIBS_DIR;
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
