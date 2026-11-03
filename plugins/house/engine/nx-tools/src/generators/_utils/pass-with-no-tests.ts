// A library the house leaves with no spec, told that having none is not a failure.
//
// WHY. Vitest and Jest both exit 1 on "no tests found". Where the house removes a library's only spec (the demo a
// framework generator wrote, a shim's implementation), `nx test <lib>` and every `run-many -t test` go red from birth,
// and they stay red until someone writes a spec the library may not need. Both runners take `passWithNoTests` in their
// config file, and it is the config file because Nx infers these targets: the project.json has no `test` target to put
// an option on. Observed for real on Nx 24.0.3 (Vitest 4.1, Jest through @nx/angular's generator): exit 1 without,
// exit 0 with, and exit 1 again as soon as a spec fails. So it hides no suite: it only speaks while there is none.
//
// WHAT IT CANNOT REACH. @nx/angular:unit-test has no config file and no such option (adapters/angular/design-system).
//
// The edit is anchored on the line the generators write. Anything else is reported, not guessed at.
import type { Tree } from '@nx/devkit';

const RUNNER_CONFIGS = ['vitest', 'vite', 'jest'].flatMap((runner) =>
  ['mts', 'ts', 'cts', 'mjs', 'js', 'cjs'].map((extension) => `${runner}.config.${extension}`),
);
const ANY_SPEC = /\.(?:spec|test)\.[cm]?[jt]sx?$/;
/** Never walked: an install or build output is not the library's own spec. */
const SKIPPED_DIRS = new Set(['node_modules', 'dist']);
const OPTION = /^(?!\s*\/\/).*\bpassWithNoTests\s*:\s*(true|false)/m;
/** A config of several projects: the option is read per project, and which of them this is is not this edit's to say. */
const MULTI_PROJECT = /^\s*(?:projects|workspace)\s*:/m;
/** The line the option goes under: Vite's `test` block, or the object a Jest config exports. */
const VITE_ANCHOR = /^([ \t]*)test:\s*\{[ \t]*$/gm;
const JEST_ANCHOR = /^()(?:module\.exports\s*=|export default)\s*\{[ \t]*$/gm;
const NOTE = 'This library ships no spec of its own. A spec added later still runs, and still fails the target when it fails.';

export type PassWithNoTestsResult =
  /** The option was written to this file. */
  | { kind: 'stated'; file: string }
  /** The library has a spec, so it has nothing to pass without. */
  | { kind: 'has-spec'; spec: string }
  /** The config already says, either way. */
  | { kind: 'decided'; file: string; value: boolean }
  /** No runner config at the library's root: another runner, or none. */
  | { kind: 'no-config' }
  /** A config this edit does not recognise. */
  | { kind: 'unrecognised'; file: string; reason: string };

export function passWithNoTests(tree: Tree, root: string): PassWithNoTestsResult {
  const spec = firstSpec(tree, root);
  if (spec) return { kind: 'has-spec', spec };
  const configs = RUNNER_CONFIGS.filter((name) => tree.exists(`${root}/${name}`));
  if (configs.length === 0) return { kind: 'no-config' };
  const file = `${root}/${configs[0]}`;
  if (configs.length > 1) return { kind: 'unrecognised', file, reason: `it has several runner configs (${configs.join(', ')})` };

  const text = tree.read(file, 'utf8') ?? '';
  const decided = OPTION.exec(text);
  if (decided) return { kind: 'decided', file, value: decided[1] === 'true' };
  if (MULTI_PROJECT.test(text)) return { kind: 'unrecognised', file, reason: 'it declares several projects' };
  const jest = configs[0].startsWith('jest.');
  const anchors = [...text.matchAll(jest ? JEST_ANCHOR : VITE_ANCHOR)];
  if (anchors.length !== 1) {
    const expected = jest ? 'one `module.exports = {` or `export default {`' : 'one `test: {` block';
    return { kind: 'unrecognised', file, reason: `it does not have ${expected} on a line of its own` };
  }
  const end = anchors[0].index + anchors[0][0].length;
  const indent = /^[ \t]*(?=\S)/m.exec(text.slice(end + 1))?.[0];
  const inner = indent && indent.length > anchors[0][1].length ? indent : `${anchors[0][1]}  `;
  tree.write(file, `${text.slice(0, end)}\n${inner}// ${NOTE}\n${inner}passWithNoTests: true,${text.slice(end)}`);
  return { kind: 'stated', file };
}

/** Why the option could not be set on a library that needs it, or null when nothing is left to do. */
export function passWithNoTestsGap(result: PassWithNoTestsResult): string | null {
  if (result.kind === 'no-config') return 'it has no vite, vitest or jest config at its root';
  if (result.kind === 'unrecognised') return `${result.file}: ${result.reason}`;
  return null;
}

function firstSpec(tree: Tree, dir: string): string | null {
  for (const child of tree.children(dir)) {
    const path = `${dir}/${child}`;
    if (tree.isFile(path)) {
      if (ANY_SPEC.test(child)) return path;
    } else if (!SKIPPED_DIRS.has(child) && !child.startsWith('.')) {
      const found = firstSpec(tree, path);
      if (found) return found;
    }
  }
  return null;
}
