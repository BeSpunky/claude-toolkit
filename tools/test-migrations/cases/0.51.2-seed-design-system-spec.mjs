// 0.51.2 — a house Angular design system gets a test target that runs every spec in the library, and the spec the target
// fails without.
//
// A rung that adds a test can swap one red target for another, so every skip is a case. Input: DsTheme exactly as the
// house shipped it (0.51.2-ds-theme-shapes/, from git: ed399a8d — unchanged in code through 8ec22591 —, a4ca72cb,
// 94f13d27, the {{tokenPrefix}} left for the fixture to render). The spec passing against each is checked by a real
// `nx test`, which a Tree cannot do; here the rung must recognise each one.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const { addProjectConfiguration, readJson, writeJson } = createRequire(import.meta.url)('@nx/devkit');

const SHAPES = join(dirname(fileURLToPath(import.meta.url)), '0.51.2-ds-theme-shapes');
const shape = (sha, prefix = 'ds') => readFileSync(join(SHAPES, `${sha}.ts.tpl`), 'utf8').split('{{tokenPrefix}}').join(prefix);
const LATEST = '94f13d27';

const ROOT = 'packages/design-system';
const SPEC = `${ROOT}/src/lib/ds-theme.service.spec.ts`;
const UNIT_TEST = { executor: '@nx/angular:unit-test', options: { watch: false } };
const INCLUDE = ['**/*.spec.ts', '**/*.test.ts', '../**/*.spec.ts', '../**/*.test.ts'];
const EXCLUDE = ['../**/node_modules/**', '../**/dist/**'];
const REACHED = { watch: false, include: INCLUDE, exclude: EXCLUDE };

function ds(tree, { test = UNIT_TEST, theme = shape(LATEST), tags = ['type:design-system', 'platform:web'], files = {}, name = 'design-system', root = ROOT } = {}) {
  addProjectConfiguration(tree, name, { root, projectType: 'library', tags, targets: { build: { executor: '@nx/angular:package' }, ...(test ? { test } : {}) } });
  if (theme !== null) tree.write(`${root}/src/lib/ds-theme.service.ts`, theme);
  for (const [path, text] of Object.entries(files)) tree.write(`${root}/${path}`, text);
}

const testTarget = (tree, root = ROOT) => readJson(tree, `${root}/project.json`).targets.test;

/** Left alone: no spec written, and the reason in the log. */
function leftAlone(reason, spec = SPEC) {
  return (tree, t, logs) => {
    t.ok(spec === null || !tree.exists(spec), 'no spec was written');
    if (logs) t.ok(logs.some((line) => reason.test(line)), `the reason is reported: ${logs.join(' | ')}`);
  };
}

export default {
  name: '0.51.2 · seed-design-system-spec',
  ladder: ['0.51.2/seed-design-system-spec'],
  cases: [
    ...['ed399a8d', 'a4ca72cb', '94f13d27'].map((sha) => ({
      name: `DsTheme as it shipped at ${sha}: the spec is added`,
      setup: (tree) => ds(tree, { theme: shape(sha) }),
      expect: (tree, t, logs) => {
        t.exists(SPEC);
        t.has(SPEC, "const MODE_ATTRIBUTE = 'data-ds-mode';");
        t.has(SPEC, "from './ds-theme.service'");
        t.equal(testTarget(tree).options, REACHED, 'the target runs every spec in the library');
        if (logs) t.ok(logs.some((line) => line.includes(`wrote ${SPEC}`)), `the write is reported: ${logs.join(' | ')}`);
      },
    })),
    {
      name: "the spec tests the library's own attribute, read from its DsTheme: a custom token prefix",
      setup: (tree) => ds(tree, { theme: shape(LATEST, 'acme') }),
      expect: (tree, t) => t.has(SPEC, "const MODE_ATTRIBUTE = 'data-acme-mode';"),
    },
    {
      name: 'the library is found by its tag, wherever it lives; what the project added to the target is untouched',
      setup: (tree) =>
        ds(tree, {
          name: 'ui',
          root: 'libs/ui',
          test: { executor: '@nx/angular:unit-test', dependsOn: ['^build'], options: { watch: false, coverage: true } },
        }),
      expect: (tree, t) => {
        t.exists('libs/ui/src/lib/ds-theme.service.spec.ts');
        t.equal(
          readJson(tree, 'libs/ui/project.json').targets.test,
          { executor: '@nx/angular:unit-test', dependsOn: ['^build'], options: { watch: false, coverage: true, include: INCLUDE, exclude: EXCLUDE } },
          'the target as the project left it, plus the reach',
        );
      },
    },
    {
      name: 'no test target: left, reported',
      setup: (tree) => ds(tree, { test: null }),
      expect: leftAlone(/Left design-system: its project config has no test target/),
    },
    {
      name: 'another executor (jest passes with no specs): left, reported',
      setup: (tree) => ds(tree, { test: { executor: '@nx/jest:jest', options: { passWithNoTests: true } } }),
      expect: (tree, t, logs) => {
        leftAlone(/Left design-system: its test target uses @nx\/jest:jest/)(tree, t, logs);
        t.equal(testTarget(tree).options, { passWithNoTests: true }, 'the target is untouched');
      },
    },
    {
      name: 'the same builder under its own name: left, reported as not judged, not as passing',
      setup: (tree) => ds(tree, { test: { executor: '@angular/build:unit-test' } }),
      expect: leftAlone(/this is for @nx\/angular:unit-test.*add a spec/),
    },
    {
      name: "a target with its own include: left, warned that neither a seeded spec nor the entry points' may run, and told the value",
      setup: (tree) => ds(tree, { test: { executor: '@nx/angular:unit-test', options: { include: ['src/app/**/*.spec.ts'] } } }),
      expect: (tree, t, logs) => {
        leftAlone(/Left design-system: its test target declares its own include\/exclude.*entry points.*\.\.\/\*\*\/\*\.spec\.ts/)(tree, t, logs);
        t.equal(testTarget(tree).options, { include: ['src/app/**/*.spec.ts'] }, 'the project\'s include stands');
      },
    },
    {
      name: 'a target with its own exclude: left, warned',
      setup: (tree) => ds(tree, { test: { executor: '@nx/angular:unit-test', options: { exclude: ['**/*.spec.ts'] } } }),
      expect: leftAlone(/declares its own include\/exclude/),
    },
    {
      name: 'an include in a configuration: left, warned',
      setup: (tree) => ds(tree, { test: { executor: '@nx/angular:unit-test', configurations: { ci: { include: ['x'] } }, defaultConfiguration: 'ci' } }),
      expect: leftAlone(/declares its own include\/exclude/),
    },
    {
      name: "a spec of the project's own under the source root: left, reported",
      setup: (tree) => ds(tree, { files: { 'src/lib/mine.spec.ts': "it('x', () => {});\n" } }),
      expect: leftAlone(/Left design-system: it already has a spec \(packages\/design-system\/src\/lib\/mine\.spec\.ts\)\.$/),
    },
    {
      name: 'a spec only in an entry point: the target now reaches it, so it is what the target runs, and nothing is seeded',
      setup: (tree) => ds(tree, { files: { 'button/src/button.spec.ts': "it('x', () => {});\n" } }),
      expect: (tree, t, logs) => {
        leftAlone(/already has a spec \(packages\/design-system\/button\/src\/button\.spec\.ts\)\.$/)(tree, t, logs);
        t.equal(testTarget(tree).options, REACHED, 'the target reaches it');
        if (logs) t.ok(logs.some((line) => /now runs every spec in the library/.test(line)), `the change is reported: ${logs.join(' | ')}`);
      },
    },
    {
      name: 'the include this rung writes is not "its own": no warning, and the spec is still seeded',
      setup: (tree) => ds(tree, { test: { executor: '@nx/angular:unit-test', options: REACHED } }),
      expect: (tree, t, logs) => {
        t.exists(SPEC);
        t.equal(testTarget(tree).options, REACHED, 'unchanged');
        if (logs) t.ok(!logs.some((line) => /declares its own/.test(line)), `no warning: ${logs.join(' | ')}`);
      },
    },
    {
      name: 'the include this rung writes with an exclude the project changed: its own, left',
      setup: (tree) => ds(tree, { test: { executor: '@nx/angular:unit-test', options: { ...REACHED, exclude: ['../legacy/**'] } } }),
      expect: leftAlone(/declares its own include\/exclude/),
    },
    {
      name: 'the include this rung writes, in a configuration: its own, left',
      setup: (tree) => ds(tree, { test: { executor: '@nx/angular:unit-test', options: REACHED, configurations: { ci: { include: INCLUDE } } } }),
      expect: leftAlone(/declares its own include\/exclude/),
    },
    {
      name: 'a source root deeper in the library: the globs climb out of where it is',
      setup: (tree) => {
        ds(tree);
        writeJson(tree, `${ROOT}/project.json`, { ...readJson(tree, `${ROOT}/project.json`), sourceRoot: `${ROOT}/src/public` });
      },
      expect: (tree, t) => {
        t.equal(testTarget(tree).options.include.at(-1), '../../**/*.test.ts', 'two levels up');
        t.equal(testTarget(tree).options.exclude, ['../../**/node_modules/**', '../../**/dist/**'], 'the exclude too');
      },
    },
    {
      name: 'a source root that is the library: the default already reaches everything, so the target is left as it is',
      setup: (tree) => {
        ds(tree);
        writeJson(tree, `${ROOT}/project.json`, { ...readJson(tree, `${ROOT}/project.json`), sourceRoot: ROOT });
      },
      expect: (tree, t) => {
        t.exists(SPEC);
        t.equal(testTarget(tree).options, { watch: false }, 'no include');
      },
    },
    {
      name: 'a source root outside the library: left, warned, `..` from there is not the library',
      setup: (tree) => {
        ds(tree);
        writeJson(tree, `${ROOT}/project.json`, { ...readJson(tree, `${ROOT}/project.json`), sourceRoot: 'elsewhere/src' });
      },
      expect: (tree, t, logs) => {
        leftAlone(/its source root elsewhere\/src is outside the library/)(tree, t, logs);
        t.equal(testTarget(tree).options, { watch: false }, 'no include');
      },
    },
    {
      name: 'what an earlier ds-component left in an entry: reported, nothing touched',
      setup: (tree) => ds(tree, { files: { 'button/src.ts': '// stray\n', 'button/src/index.ts': "export * from './button.component';\n", 'card/src/index.ts': "export * from './card';\n" } }),
      expect: (tree, t, logs) => {
        t.equal(tree.read(`${ROOT}/button/src.ts`, 'utf8'), '// stray\n', 'the stray file stays');
        t.has(`${ROOT}/button/src/index.ts`, './button.component');
        if (logs) {
          t.ok(logs.some((line) => /button\/src\.ts is what ds-component wrote before 0\.51\.2.*delete packages\/design-system\/button.*ds-component button/.test(line)), `reported: ${logs.join(' | ')}`);
          t.ok(!logs.some((line) => line.includes('card/src.ts')), 'a whole entry is not mentioned');
        }
      },
    },
    {
      name: 'a spec the runner does not match, under the source root: left, warned',
      setup: (tree) => ds(tree, { files: { 'src/lib/old.spec.js': '' } }),
      expect: leftAlone(/still fails/),
    },
    {
      name: "a declared source root is the runner's: a spec there counts, one under src does not",
      setup: (tree) => {
        ds(tree, { files: { 'lib/mine.spec.ts': '' } });
        const project = readJson(tree, `${ROOT}/project.json`);
        writeJson(tree, `${ROOT}/project.json`, { ...project, sourceRoot: `${ROOT}/lib` });
      },
      expect: leftAlone(/already has a spec \(packages\/design-system\/lib\/mine\.spec\.ts\)\.$/),
    },
    {
      name: 'a spec at the very path the rung would write: never overwritten',
      setup: (tree) => ds(tree, { files: { 'src/lib/ds-theme.service.spec.ts': '// mine\n' } }),
      expect: (tree, t, logs) => {
        t.equal(tree.read(SPEC, 'utf8'), '// mine\n', 'the project\'s spec is untouched');
        if (logs) t.ok(logs.some((line) => /already has a spec/.test(line)), `reported: ${logs.join(' | ')}`);
      },
    },
    {
      name: 'a spec in an install or build output does not count: the library still gets its own',
      setup: (tree) => ds(tree, { files: { 'node_modules/x/a.spec.ts': '', 'dist/a.spec.ts': '' } }),
      expect: (tree, t) => t.exists(SPEC),
    },
    {
      name: 'DsTheme deleted: left, warned that the target is still red',
      setup: (tree) => ds(tree, { theme: null }),
      expect: leftAlone(/Left design-system: there is no packages\/design-system\/src\/lib\/ds-theme\.service\.ts to test/),
    },
    ...[
      ['the mode signal renamed', (s) => s.replace('readonly mode = signal<DsMode>', 'readonly current = signal<DsMode>')],
      ['the attribute renamed', (s) => s.replaceAll('MODE_ATTRIBUTE', 'THEME_ATTRIBUTE')],
      ['the attribute computed', (s) => s.replace("const MODE_ATTRIBUTE = 'data-ds-mode'", 'const MODE_ATTRIBUTE = attributeOf()')],
      ["'dark' dropped from the modes", (s) => s.replace("'light' | 'dark' | 'system'", "'light' | 'system'")],
      ['a dependency TestBed would have to provide', (s) => s.replace('inject(DOCUMENT);', 'inject(DOCUMENT);\n  private readonly http = inject(HttpClient);')],
      ['not provided in root', (s) => s.replace("@Injectable({ providedIn: 'root' })", '@Injectable()')],
      ['a dependency with an explicit type', (s) => s.replace('inject(DOCUMENT);', 'inject(DOCUMENT);\n  private readonly http = inject<HttpClient>(HttpClient);')],
      ['a constructor-injected dependency', (s) => s.replace('constructor()', 'constructor(private readonly http: HttpClient)')],
      ['the attribute on another element', (s) => s.replace('const root = this.document.documentElement', 'const root = this.document.body')],
      ['the removal commented out', (s) => s.replace("if (mode === 'system') root.removeAttribute(MODE_ATTRIBUTE);\n      else root", "// if (mode === 'system') root.removeAttribute(MODE_ATTRIBUTE);\n      root")],
    ].map(([what, edit]) => ({
      name: `DsTheme reshaped (${what}): left, warned, never guessed at`,
      setup: (tree) => {
        const theme = edit(shape(LATEST));
        if (theme === shape(LATEST)) throw new Error(`the fixture edit did not apply: ${what}`);
        ds(tree, { theme });
      },
      expect: leftAlone(/no longer has the shape the house spec tests/),
    })),
    {
      name: 'a library without the tag or the name is not the design system: untouched and unmentioned',
      setup: (tree) => ds(tree, { tags: ['type:ui'], name: 'ui' }),
      expect: (tree, t, logs) => {
        t.ok(!tree.exists(SPEC), 'no spec');
        t.equal(logs, [], 'nothing to say');
      },
    },
    {
      name: 'a library named design-system with no tag is one (the generator tags it after this rung): the spec is added',
      setup: (tree) => ds(tree, { tags: [] }),
      expect: (tree, t) => t.exists(SPEC),
    },
    {
      name: 'an application named design-system is not one: untouched and unmentioned',
      setup: (tree) => {
        addProjectConfiguration(tree, 'design-system', { root: ROOT, projectType: 'application', targets: { test: UNIT_TEST } });
        tree.write(`${ROOT}/src/lib/ds-theme.service.ts`, shape(LATEST));
      },
      expect: (tree, t, logs) => {
        t.ok(!tree.exists(SPEC), 'no spec');
        t.equal(logs, [], 'nothing to say');
      },
    },
    ...[
      ['double-quoted, as prettier writes it without singleQuote', (s) => s.replaceAll("'", '"')],
      ['the decorator on several lines', (s) => s.replace("@Injectable({ providedIn: 'root' })", "@Injectable({\n  providedIn: 'root',\n})")],
      ['a token prefix with a dot', (s) => s.replace('data-ds-mode', 'data-a.b-mode')],
    ].map(([what, edit]) => ({
      name: `DsTheme reformatted, not reshaped (${what}): the spec is added`,
      setup: (tree) => ds(tree, { theme: edit(shape(LATEST)) }),
      expect: (tree, t) => t.exists(SPEC),
    })),
  ],
};
