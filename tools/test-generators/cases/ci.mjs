// THE `ci` LAYER — continuous deployment from the branch model. What would break silently:
//   - a workflow written for a model nobody declared (a guessed production branch deploys from the wrong line);
//   - a second deploy workflow beside the project's own (two deploys on one push);
//   - a file the house did not write overwritten, or one it no longer needs left behind;
//   - the cloud identity's conditions drifting from the branch model without a human being told to re-run setup.
import { workspace } from '../workspaces.mjs';

const MODEL = '.bespunky/branches.json';
const PROJECTION = {
  schema: 1,
  integration: 'development',
  production: ['main'],
  productionPatterns: [],
  chain: ['development', 'main'],
  protected: ['development', 'main'],
  protectedPatterns: ['release/*'],
  workBase: 'development',
  summary: 'development → main',
};
const BOUND = {
  ...PROJECTION,
  deploys: [
    { kind: 'line', line: 'main', ci: { environment: 'production', providers: { firebase: 'default' } } },
    { kind: 'pattern', line: 'release/*', ci: { environment: 'production', providers: { firebase: 'default' } } },
    { kind: 'line', line: 'development', ci: { environment: 'dev', providers: { firebase: 'dev' } } },
    { kind: 'tag', line: 'v*', ci: { environment: 'production', providers: { firebase: 'default' } } },
  ],
};
const declare = (tree, projection) => tree.write(MODEL, JSON.stringify({ schema: 1, projection }, null, 2));
const fixture = (projection) => () => {
  const tree = workspace({ pm: 'yarn-berry' });
  tree.write('.nvmrc', '22\n');
  tree.write('firebase.json', '{}');
  if (projection) declare(tree, projection);
  return tree;
};
const ci = (layers = ['nx', 'node', 'firebase', 'ci'], extra = {}) => async (tree, ctx) => {
  await ctx.load('generators/ci/generator').default(tree, { layers, ...extra });
};
const WF = '.github/workflows/deploy.yml';

export default {
  name: 'ci layer',
  cases: [
    {
      name: 'undeclared model: no workflow, no script — the marker keeps the layer on and says why',
      setup: fixture(null),
      run: ci(),
      expect: (tree, t, ctx) => {
        t.missing(WF);
        t.missing('tools/setup-gcp.sh');
        t.ok(/not declared/.test(t.json('.bespunky/ci.json')?.pending ?? ''), 'pending says the model is undeclared');
        t.ok(ctx.logs.some((l) => /No deploy workflow/.test(l)), 'the run says so');
      },
    },
    {
      name: 'declared, nothing bound: no workflow, and the binding to add is named',
      setup: fixture(PROJECTION),
      run: ci(),
      expect: (tree, t) => {
        t.missing(WF);
        t.ok(/"ci": \{ "environment"/.test(t.json('.bespunky/ci.json')?.pending ?? ''), 'pending shows the binding shape');
      },
    },
    {
      name: 'bound lines: triggers, environments, provider args, keyless auth, setup script, HUMAN_STEP per environment',
      setup: fixture(BOUND),
      run: ci(),
      expect: (tree, t, ctx) => {
        t.exists(WF);
        for (const needle of [
          "      - 'main'",
          "      - 'release/*'",
          "      - 'development'",
          "'main') echo \"environment=production\"; echo \"args=--project=default --non-interactive\" ;;",
          "release/*) echo \"environment=production\"",
          "'development') echo \"environment=dev\"; echo \"args=--project=dev --non-interactive\" ;;",
          'group: deploy-${{ github.ref }}',
          'cancel-in-progress: false',
          'node-version-file: .nvmrc',
          'yarn install --immutable',
          'nrwl/nx-set-shas@v4',
          'google-github-actions/auth@v2',
          'id-token: write',
          'environment: ${{ needs.resolve.outputs.environment }}',
          'yarn nx affected -t deploy --base="$NX_BASE" --head="$NX_HEAD" --outputStyle=static $DEPLOY_ARGS',
          'yarn nx run-many -t deploy --outputStyle=static $DEPLOY_ARGS',
        ]) t.has(WF, needle);
        t.hasNot(WF, "- 'v*'");
        t.ok(t.read(WF).indexOf("'main')") < t.read(WF).indexOf('release/*)'), 'exact names before globs');
        t.exists('tools/setup-gcp.sh');
        t.has('tools/setup-gcp.sh', "production\tdefault\tmain,release/*\tassertion.ref == 'refs/heads/main' || assertion.ref.matches('^refs/heads/release/[^/]+$')");
        t.has('tools/setup-gcp.sh', "dev\tdev\tdevelopment\tassertion.ref == 'refs/heads/development'");
        t.has('tools/setup-gcp.sh', 'A HUMAN RUNS THIS');
        t.equal(Object.keys(t.json('.bespunky/ci.json').cloud.firebase), ['production', 'dev'], 'the rendered environments are recorded');
        t.equal(ctx.logs.filter((l) => l.includes('HUMAN_STEP: ! bash tools/setup-gcp.sh --environment')).length, 2, 'one human step per environment');
        t.ok(ctx.logs.some((l) => /tags v\* is not wired/.test(l)), 'the tag binding is reported, not silently dropped');
      },
    },
    {
      name: 'a re-run with the same model asks the human nothing; a changed binding asks again for that environment only',
      once: 'three runs with a model change before the last',
      setup: fixture(BOUND),
      run: async (tree, ctx) => {
        await ci()(tree, ctx);
        await ci()(tree, ctx);
        declare(tree, { ...BOUND, deploys: BOUND.deploys.map((d) => (d.line === 'development' ? { ...d, ci: { environment: 'dev', providers: { firebase: 'dev2' } } } : d)) });
        await ci()(tree, ctx);
      },
      expect: (tree, t, ctx) => {
        const steps = ctx.logs.filter((l) => l.includes('HUMAN_STEP:'));
        t.equal(steps.length, 3, 'two on the first run, none on the unchanged re-run, one after the change');
        t.ok(steps[2]?.includes('--environment dev '), steps[2]);
      },
    },
    {
      name: 'the project already deploys from its own workflow: no second one, the script still written, the switch named',
      setup: () => {
        const tree = fixture(BOUND)();
        tree.write('.github/workflows/deploy-backend.yml', 'on: push\njobs:\n  d:\n    steps:\n      - run: npx nx affected -t deploy\n');
        return tree;
      },
      run: ci(),
      expect: (tree, t) => {
        t.missing(WF);
        t.exists('tools/setup-gcp.sh');
        t.ok(/deploy-backend\.yml/.test(t.json('.bespunky/ci.json').pending ?? ''), 'pending names the existing pipeline');
      },
    },
    {
      name: 'a deploy.yml the house did not write is never overwritten',
      setup: () => {
        const tree = fixture(BOUND)();
        tree.write(WF, 'name: theirs\non: workflow_dispatch\njobs: {}\n');
        return tree;
      },
      run: ci(),
      expect: (tree, t, ctx) => {
        t.has(WF, 'name: theirs');
        t.ok(ctx.logs.some((l) => /deploy\.yml exists and the house did not write it/.test(l)), 'reported');
      },
    },
    {
      name: 'a binding removed: the owned workflow and script are removed with it',
      once: 'two runs with a model change between them',
      setup: fixture(BOUND),
      run: async (tree, ctx) => {
        await ci()(tree, ctx);
        declare(tree, PROJECTION);
        await ci()(tree, ctx);
      },
      expect: (tree, t) => {
        t.missing(WF);
        t.missing('tools/setup-gcp.sh');
        t.equal(t.json('.bespunky/ci.json').files, [], 'nothing owned');
      },
    },
    {
      name: 'no provider layer: a plain deploy workflow — no cloud auth, no script, no args',
      setup: fixture({ ...PROJECTION, deploys: [{ kind: 'line', line: 'main', ci: { environment: 'production', providers: {} } }] }),
      run: ci(['nx', 'node', 'ci']),
      expect: (tree, t) => {
        t.exists(WF);
        t.hasNot(WF, 'google-github-actions');
        t.missing('tools/setup-gcp.sh');
      },
    },
    {
      name: 'the resolved projection handed in wins over the working copy (the upgrade path)',
      setup: fixture(PROJECTION),
      run: ci(undefined, { branchProjection: JSON.stringify(BOUND) }),
      expect: (tree, t) => t.exists(WF),
    },
  ],
};
