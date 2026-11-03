// A library the house leaves with no spec, told that having none is not a failure.
//
// WHY. Vitest and Jest both exit 1 on "no tests found". Where the house removes a library's only spec (the demo a
// framework generator wrote, a shim's implementation), `nx test <lib>` and every `run-many -t test` go red from birth,
// and they stay red until someone writes a spec the library may not need. Both runners take `passWithNoTests` in their
// config file, and it is the config file because Nx infers these targets: the project.json has no `test` target to put
// an option on. Observed for real on Nx 24.0.3 (Vitest 4.1, Jest through @nx/angular's generator): exit 1 without,
// exit 0 with, and exit 1 again as soon as a spec fails. What it can hide is a spec outside what the runner is set to find
// (Analog's `{src,tests}/**`): that one reads as no tests, not as red, so it is only written to a library with no spec anywhere.
//
// WHAT IT CANNOT REACH. @nx/angular:unit-test has no config file and no such option (adapters/angular/design-system).
//
// The edit is anchored on the line the generators write, read with comments and strings blanked out, and stands only
// where nothing else could be meant. Anything else is reported, not guessed at.
//
// `statePassWithNoTests` is pure mechanics over values it is handed, so a migration shares it with its own frozen values.
import { type ProjectConfiguration, type Tree, getProjects } from '@nx/devkit';
import { filesOfLibrary, firstMatching, normalizedPath, otherProjectRoots, under } from './library-files';

export interface PassWithNoTestsValues {
  /** What reads the runner's own config file. No target at all is an inferred one, which runs the runner in the project's root. */
  configReadingExecutors: ReadonlySet<string>;
  /** The runner configs that can sit at a library's root. */
  runnerConfigs: readonly string[];
  /** The comment above the option. */
  note: string;
  /** Other projects' roots: a spec in one of them is not this library's. */
  stops: ReadonlySet<string>;
}

export type PassWithNoTestsResult =
  /** The option was written to this file. */
  | { kind: 'stated'; file: string }
  /** The library has a spec, so it has nothing to pass without. */
  | { kind: 'has-spec'; spec: string }
  /** The project already says, either way: `source` is who said it. */
  | { kind: 'decided'; source: string; value: boolean }
  /** A test target on an executor the option is not known to reach. */
  | { kind: 'other-runner'; executor: string | undefined }
  /** No runner config at the library's root: another runner, or none. */
  | { kind: 'no-config' }
  /** A config this edit does not recognise: `reason` is a whole clause. */
  | { kind: 'unrecognised'; reason: string };

const ANY_SPEC = /\.(?:spec|test)\.[cm]?[jt]sx?$/;
const OPTION = /\bpassWithNoTests\s*:\s*(\w*)/;
/** A config of several projects: the option is read per project, and which of them this is is not this edit's to say. */
const MULTI_PROJECT = /^\s*(?:projects|workspace)\s*:/m;
/** The line the option goes under: Vite's `test` block, or the object a Jest config exports. */
const VITE_ANCHOR = /^([ \t]*)test:\s*\{[ \t]*$/gm;
const ANY_VITE_TEST_KEY = /\btest\s*:/g;
const JEST_ANCHOR = /^()(?:module\.exports\s*=|export default)\s*\{[ \t]*$/gm;

export function statePassWithNoTests(tree: Tree, project: Pick<ProjectConfiguration, 'root' | 'targets'>, values: PassWithNoTestsValues): PassWithNoTestsResult {
  const root = normalizedPath(project.root);
  const spec = firstMatching(filesOfLibrary(tree, root, values.stops), ANY_SPEC);
  if (spec) return { kind: 'has-spec', spec };

  const target = project.targets?.test;
  if (target && !values.configReadingExecutors.has(target.executor ?? '')) return { kind: 'other-runner', executor: target.executor };
  const options = (target?.options ?? {}) as RunnerOptions;
  if (options.passWithNoTests !== undefined) return { kind: 'decided', source: 'its test target', value: options.passWithNoTests };

  const expand = (path: string) => normalizedPath(path.replace('{projectRoot}', root).replace(/^\{workspaceRoot\}\/?/, ''));
  for (const [name, configuration] of Object.entries((target?.configurations ?? {}) as Record<string, RunnerOptions>)) {
    if (configuration.passWithNoTests === false) return { kind: 'decided', source: `its test target's ${name} configuration`, value: false };
    const own = configuration.configFile ?? configuration.jestConfig;
    const base = options.configFile ?? options.jestConfig;
    if (own && (!base || expand(own) !== expand(base))) return { kind: 'unrecognised', reason: `its test target's ${name} configuration names ${own}, a config of its own` };
  }

  const named = options.configFile ?? options.jestConfig;
  if (named && !tree.exists(expand(named))) return { kind: 'unrecognised', reason: `its test target names ${named}, which is not a file here` };
  const configs = named ? [expand(named)] : values.runnerConfigs.map((config) => under(root, config)).filter((config) => tree.exists(config));
  if (configs.length === 0) return { kind: 'no-config' };
  if (configs.length > 1) return { kind: 'unrecognised', reason: `it has several runner configs (${configs.join(', ')})` };

  const file = configs[0];
  const jest = /jest/.test(target?.executor ?? file.slice(file.lastIndexOf('/') + 1));
  const text = tree.read(file, 'utf8') ?? '';
  const code = blankCommentsAndStrings(text);
  const decided = OPTION.exec(code);
  if (decided) {
    if (decided[1] === 'true' || decided[1] === 'false') return { kind: 'decided', source: file, value: decided[1] === 'true' };
    return { kind: 'unrecognised', reason: `${file} computes passWithNoTests` };
  }
  if (MULTI_PROJECT.test(code)) return { kind: 'unrecognised', reason: `${file} declares several projects` };
  const anchors = [...code.matchAll(jest ? JEST_ANCHOR : VITE_ANCHOR)];
  if (anchors.length !== 1 || (!jest && code.match(ANY_VITE_TEST_KEY)?.length !== 1)) {
    const expected = jest ? 'one `module.exports = {` or `export default {`' : 'one `test: {` block';
    return { kind: 'unrecognised', reason: `${file} does not have ${expected} on a line of its own` };
  }
  const end = anchors[0].index + anchors[0][0].length;
  const eol = text.startsWith('\r\n', end) ? '\r\n' : '\n';
  const indent = /^[ \t]*(?=\S)/m.exec(text.slice(end + eol.length))?.[0];
  const inner = indent && indent.length > anchors[0][1].length ? indent : `${anchors[0][1]}  `;
  tree.write(file, `${text.slice(0, end)}${eol}${inner}// ${values.note}${eol}${inner}passWithNoTests: true,${text.slice(end)}`);
  return { kind: 'stated', file };
}

interface RunnerOptions {
  passWithNoTests?: boolean;
  configFile?: string;
  jestConfig?: string;
}

/** `text` with what is inside comments and strings replaced by spaces, offsets and line breaks kept. */
function blankCommentsAndStrings(text: string): string {
  const out = text.split('');
  const blank = (from: number, to: number) => {
    for (let i = from; i < to; i += 1) if (text[i] !== '\n' && text[i] !== '\r') out[i] = ' ';
  };
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    let end = i + 1;
    if (char === '/' && text[i + 1] === '/') {
      end = text.indexOf('\n', i);
      if (end < 0) end = text.length;
      else if (text[end - 1] === '\r') end -= 1;
      blank(i, end);
    } else if (char === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      end = close < 0 ? text.length : close + 2;
      blank(i, end);
    } else if (char === "'" || char === '"' || char === '`') {
      end = i + 1;
      while (end < text.length && text[end] !== char && (char === '`' || text[end] !== '\n')) end += text[end] === '\\' ? 2 : 1;
      blank(i + 1, end);
      end += 1;
    }
    i = end;
  }
  return out.join('');
}

const RUNNER_CONFIGS = ['vitest', 'vite', 'jest'].flatMap((runner) =>
  ['mts', 'ts', 'cts', 'mjs', 'js', 'cjs'].map((extension) => `${runner}.config.${extension}`),
);
const CONFIG_READING_EXECUTORS = new Set(['@nx/vite:test', '@nx/vitest:test', '@nx/jest:jest']);
const NOTE = 'This library ships no spec of its own. A spec the runner is set to find still runs, and still fails the target when it fails.';

/** The generators' call: what the library at `root` needs, with today's values. */
export function passWithNoTests(tree: Tree, root: string): PassWithNoTestsResult {
  const projects = [...getProjects(tree).values()];
  const project = projects.find((candidate) => normalizedPath(candidate.root) === normalizedPath(root)) ?? { root };
  return statePassWithNoTests(tree, project, {
    configReadingExecutors: CONFIG_READING_EXECUTORS,
    runnerConfigs: RUNNER_CONFIGS,
    note: NOTE,
    stops: otherProjectRoots(projects, root),
  });
}

/** Why the option could not be set on a library that needs it, or null when nothing is left to do. */
export function passWithNoTestsGap(result: PassWithNoTestsResult): string | null {
  switch (result.kind) {
    case 'no-config':
      return 'it has no vite, vitest or jest config at its root';
    case 'unrecognised':
      return result.reason;
    case 'other-runner':
      return `its test target uses ${result.executor ?? 'a command'}, which this option is not known to reach`;
    case 'decided':
      return result.value ? null : `${result.source} says \`passWithNoTests: false\``;
    default:
      return null;
  }
}
