// Where a test target stands against a library's entry points: why, in ./entry-point-specs. Apart from it, and importing
// nothing that reaches the layer registry, because the Angular adapter itself and a migration read this, and the registry
// loads the adapter: through ./entry-point-specs, whichever of them loads first finds the other half made.
import type { ProjectConfiguration, TargetConfiguration } from '@nx/devkit';
import { sameJson } from '../../generators/_utils/json-edits';
import { normalizedPath, under } from '../../generators/_utils/library-files';

export const UNIT_TEST_EXECUTORS: ReadonlySet<string> = new Set(['@nx/angular:unit-test', '@angular/build:unit-test']);

export type EntryPointReach =
  /** The source root is outside the library: `..` from there is not the library. */
  | { kind: 'outside'; sourceRoot: string }
  /** The target states an include or exclude of its own: what it tests is its decision. */
  | { kind: 'declared'; include: string[]; exclude: string[] }
  /** The target does not reach the entries, and this is what it takes. */
  | { kind: 'aim'; include: string[]; exclude: string[] }
  /** The target already reaches them. */
  | { kind: 'reached' };

/**
 * Where `target` stands. Pure mechanics over the globs it is handed, so a migration shares it with its own frozen ones. A
 * source root that IS the library needs no include: the runner's default walks everything in it.
 */
export function judgeEntryPointReach(
  project: Pick<ProjectConfiguration, 'root' | 'sourceRoot'>,
  target: TargetConfiguration,
  includeFrom: (up: string) => string[],
  excludeFrom: (up: string) => string[],
): EntryPointReach {
  const root = normalizedPath(project.root);
  const sourceRoot = normalizedPath(project.sourceRoot ?? under(root, 'src'));
  if (sourceRoot !== root && root && !sourceRoot.startsWith(`${root}/`)) return { kind: 'outside', sourceRoot };
  const levels = sourceRoot === root ? 0 : sourceRoot.slice(root ? root.length + 1 : 0).split('/').length;
  const up = '../'.repeat(levels);
  const include = [...new Set(includeFrom(up))];
  const exclude = excludeFrom(up);
  const ours = sameJson(target.options?.include, include) && sameJson(target.options?.exclude, exclude);
  const declared = [ours ? undefined : target.options, ...Object.values(target.configurations ?? {})].some((options) => options?.include || options?.exclude);
  if (declared) return { kind: 'declared', include, exclude };
  return ours || !levels ? { kind: 'reached' } : { kind: 'aim', include, exclude };
}
