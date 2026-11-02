// 0.51.2 — a house Angular design system gets the spec its @nx/angular:unit-test target fails without.
//
// A rung that adds a test can swap one red target for another, so every skip is a case. Input: DsTheme exactly as the
// house shipped it (0.51.2-ds-theme-shapes/, from git: ed399a8d — unchanged in code through 8ec22591 —, a4ca72cb,
// 94f13d27, the {{tokenPrefix}} left for the fixture to render). The spec passing against each is checked by a real
// `nx test`, which a Tree cannot do; here the rung must recognise each one.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const { addProjectConfiguration, readJson } = createRequire(import.meta.url)('@nx/devkit');

const SHAPES = join(dirname(fileURLToPath(import.meta.url)), '0.51.2-ds-theme-shapes');
const shape = (sha, prefix = 'ds') => readFileSync(join(SHAPES, `${sha}.ts.tpl`), 'utf8').split('{{tokenPrefix}}').join(prefix);
const LATEST = '94f13d27';

const ROOT = 'packages/design-system';
const SPEC = `${ROOT}/src/lib/ds-theme.service.spec.ts`;
const UNIT_TEST = { executor: '@nx/angular:unit-test', options: { watch: false } };

function ds(tree, { test = UNIT_TEST, theme = shape(LATEST), tags = ['type:design-system', 'platform:web'], files = {}, name = 'design-system', root = ROOT } = {}) {
  addProjectConfiguration(tree, name, { root, projectType: 'library', tags, targets: { build: { executor: '@nx/angular:package' }, ...(test ? { test } : {}) } });
  if (theme !== null) tree.write(`${root}/src/lib/ds-theme.service.ts`, theme);
  for (const [path, text] of Object.entries(files)) tree.write(`${root}/${path}`, text);
}

/** Left alone: no spec written, every file as it was, and the reason in the log. */
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
          { executor: '@nx/angular:unit-test', dependsOn: ['^build'], options: { watch: false, coverage: true } },
          'the target as the project left it',
        );
      },
    },
    {
      name: 'no test target: left, reported',
      setup: (tree) => ds(tree, { test: null }),
      expect: leftAlone(/Left design-system: it has no test target/),
    },
    {
      name: 'another executor (jest passes with no specs): left, reported',
      setup: (tree) => ds(tree, { test: { executor: '@nx/jest:jest', options: { passWithNoTests: true } } }),
      expect: leftAlone(/Left design-system: its test target uses @nx\/jest:jest/),
    },
    {
      name: 'a target with its own include: left, warned, a seeded spec might not run',
      setup: (tree) => ds(tree, { test: { executor: '@nx/angular:unit-test', options: { include: ['src/app/**/*.spec.ts'] } } }),
      expect: leftAlone(/Left design-system: its test target declares its own include\/exclude/),
    },
    {
      name: 'a target with its own exclude: left, warned',
      setup: (tree) => ds(tree, { test: { executor: '@nx/angular:unit-test', options: { exclude: ['**/*.spec.ts'] } } }),
      expect: leftAlone(/declares its own include\/exclude/),
    },
    {
      name: 'a spec of the project\'s own, elsewhere in the library: left, reported',
      setup: (tree) => ds(tree, { files: { 'button/src/button.spec.ts': "it('x', () => {});\n" } }),
      expect: leftAlone(/Left design-system: it already has a spec \(packages\/design-system\/button\/src\/button\.spec\.ts\)/),
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
      name: 'a library without the tag is not the design system: untouched and unmentioned',
      setup: (tree) => ds(tree, { tags: ['type:ui'] }),
      expect: (tree, t, logs) => {
        t.ok(!tree.exists(SPEC), 'no spec');
        t.equal(logs, [], 'nothing to say');
      },
    },
  ],
};
