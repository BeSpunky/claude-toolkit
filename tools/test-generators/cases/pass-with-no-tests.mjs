// PASS-WITH-NO-TESTS — the seam behind every generator that leaves a library with no spec. It may only ever be written
// where it cannot hide a suite, and anything it does not recognise comes back as a gap the caller reports.
import { requireFromRepo } from '../../test-support/payload.mjs';

const { createTreeWithEmptyWorkspace } = requireFromRepo('@nx/devkit/testing');
const { addProjectConfiguration } = requireFromRepo('@nx/devkit');
const seam = (ctx) => ctx.load('generators/_utils/pass-with-no-tests');
const VITE = "export default defineConfig(() => ({\n  test: {\n    watch: false,\n  },\n}));\n";
const JEST = "module.exports = {\n  displayName: 'x',\n};\n";

const withFiles = (files) => () => {
  const tree = createTreeWithEmptyWorkspace();
  for (const [path, text] of Object.entries(files)) tree.write(`lib/${path}`, text);
  return tree;
};
const run = async (tree, ctx) => {
  ctx.result = seam(ctx).passWithNoTests(tree, 'lib');
  ctx.gap = seam(ctx).passWithNoTestsGap(ctx.result);
};

export default {
  name: 'pass-with-no-tests · the seam',
  cases: [
    {
      name: 'a Vite config: inside the test block, on an indent of its own',
      setup: withFiles({ 'vite.config.mts': VITE }),
      run,
      expect: (tree, t) => {
        t.has('lib/vite.config.mts', '  test: {\n    // This library ships no spec of its own.');
        t.has('lib/vite.config.mts', 'when it fails.\n    passWithNoTests: true,\n    watch: false,');
      },
    },
    {
      name: 'a Jest config: the first key of what it exports',
      setup: withFiles({ 'jest.config.cts': JEST }),
      run,
      expect: (tree, t) => t.has('lib/jest.config.cts', "when it fails.\n  passWithNoTests: true,\n  displayName: 'x',"),
    },
    {
      name: 'an empty test block gets an indent of its own',
      setup: withFiles({ 'vite.config.ts': 'export default {\n  test: {\n  },\n};\n' }),
      run,
      expect: (tree, t) => t.has('lib/vite.config.ts', '    passWithNoTests: true,\n  },'),
    },
    {
      name: 'the config already says true: nothing to do, no gap',
      setup: withFiles({ 'vite.config.mts': VITE.replace('watch: false', 'passWithNoTests: true') }),
      run,
      expect: (tree, t, ctx) => {
        t.equal(ctx.result.kind, 'decided', 'result');
        t.equal(ctx.gap, null, 'no gap');
      },
    },
    {
      name: 'a commented-out option is no decision',
      setup: withFiles({ 'vite.config.mts': VITE.replace('watch: false', '// passWithNoTests: false,\n    watch: false') }),
      run,
      expect: (tree, t) => t.has('lib/vite.config.mts', 'when it fails.\n    passWithNoTests: true,'),
    },
    {
      name: "a test target on another executor: the option does not reach it, whichever config lies around",
      setup: () => {
        const tree = withFiles({ 'vite.config.mts': VITE })();
        addProjectConfiguration(tree, 'lib', { root: 'lib', targets: { test: { executor: '@nx/angular:unit-test' } } });
        return tree;
      },
      run,
      expect: (tree, t, ctx) => {
        t.equal(tree.read('lib/vite.config.mts', 'utf8'), VITE, 'config');
        t.ok(/@nx\/angular:unit-test/.test(ctx.gap ?? ''), `gap: ${ctx.gap}`);
      },
    },
    {
      name: 'a spec anywhere in the library: untouched',
      setup: withFiles({ 'vite.config.mts': VITE, 'src/deep/a.spec.ts': '' }),
      run,
      expect: (tree, t, ctx) => {
        t.equal(ctx.result, { kind: 'has-spec', spec: 'lib/src/deep/a.spec.ts' }, 'result');
        t.equal(ctx.gap, null, 'no gap');
        t.equal(tree.read('lib/vite.config.mts', 'utf8'), VITE, 'config');
      },
    },
    ...[
      ['no config', {}, /no vite, vitest or jest config/],
      ['two configs', { 'vite.config.mts': VITE, 'jest.config.ts': JEST }, /several runner configs/],
      ['no test block', { 'vite.config.mts': 'export default {};\n' }, /one `test: \{` block/],
      ['several projects', { 'vite.config.mts': `${VITE}const a = {\n  projects: [],\n};\n` }, /several projects/],
      ['the anchor only in a comment', { 'vite.config.mts': 'export default {\n  /*\n  test: {\n  */\n};\n' }, /one `test: \{` block/],
      ['the config says false', { 'vite.config.mts': VITE.replace('watch: false', 'passWithNoTests: false') }, /says `passWithNoTests: false`/],
    ].map(([what, files, reason]) => ({
      name: `${what}: a gap the caller reports`,
      setup: withFiles(files),
      run,
      expect: (tree, t, ctx) => t.ok(reason.test(ctx.gap ?? ''), `gap: ${ctx.gap}`),
    })),
  ],
};
