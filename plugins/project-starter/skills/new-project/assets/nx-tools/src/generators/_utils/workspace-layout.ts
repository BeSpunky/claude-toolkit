// Shared generator util: where does THIS workspace keep its libraries?
//
// The house default is `packages/` (BeSpunky ships publishable packages), but a house generator run
// against a CONSUMER'S existing repo must land a new library where that repo already keeps libraries —
// an Nx workspace that uses `libs/` should not sprout a lone `packages/` folder the moment someone runs
// `--repair`. So the library home is DETECTED, not assumed.
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
    if (top) topSegmentCounts.set(top, (topSegmentCounts.get(top) ?? 0) + 1);
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
