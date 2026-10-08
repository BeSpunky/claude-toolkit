// WHAT A STEP ACTUALLY CHANGED — so a log line can tell the truth.
//
// A generator that re-asserts an owned file writes it every run, and devkit's Tree quietly records nothing when the
// bytes are identical. A log that says "Rewrote X" around such a write fires on every no-op upgrade, and a notice
// that fires when nothing changed is one everyone learns to ignore. So the claim is made from the evidence: the
// content before the step against the content after it.
import type { Tree } from '@nx/devkit';

/** Runs `step`, then returns which of `paths` existed before it and now hold different content. */
export function rewrittenBy<T>(tree: Tree, paths: string[], step: () => T): { result: T; rewritten: string[] } {
  const before = new Map(paths.map((path) => [path, tree.exists(path) ? tree.read(path, 'utf8') : null]));
  const result = step();
  const rewritten = paths.filter((path) => {
    const old = before.get(path);
    return old !== null && old !== undefined && (tree.exists(path) ? tree.read(path, 'utf8') : null) !== old;
  });
  return { result, rewritten };
}
