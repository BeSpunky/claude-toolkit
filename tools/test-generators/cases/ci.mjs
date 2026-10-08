// THE `ci` LAYER — continuous deployment from the branch model. What would break silently:
//   - a workflow written for a model nobody declared (a guessed production branch deploys from the wrong line);
//   - a binding on an UNPROTECTED line (hotfix, tag), a maintained release pattern, or two lines in one environment
//     wired anyway from a hand-edited projection — unreviewed code deployed, or an environment rolled back;
//   - a provider's arguments reaching a deploy target that is not the provider's (another stack's deploy reading
//     `--project=prod`);
//   - a job that installs dependencies, or a tag-pinned action, holding `id-token: write`;
//   - a second deploy workflow beside the project's own (two deploys on one push);
//   - a file the house did not write overwritten, or one it no longer needs left behind;
//   - the cloud identity's conditions drifting from the branch model without a human being told to re-run setup,
//     and a removed binding orphaning a live cloud identity (and deleting the tool that would undo it).
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
const ci = (environment, firebase) => ({ environment, providers: { firebase } });
const BOUND = {
  ...PROJECTION,
  deploys: [
    { kind: 'line', line: 'main', ci: ci('production', 'default') },
    { kind: 'pattern', line: 'release/*', ci: ci('uat', 'uat') },
    { kind: 'line', line: 'development', ci: ci('dev', 'dev') },
  ],
};
const declare = (tree, projection) => tree.write(MODEL, JSON.stringify({ schema: 1, projection }, null, 2));
const deployTarget = (command) => ({ executor: 'nx:run-commands', options: { command, cwd: '{workspaceRoot}' } });
const fixture = (projection) => () => {
  const tree = workspace({ pm: 'yarn-berry' });
  tree.write('.nvmrc', '22\n');
  tree.write('firebase.json', '{}');
  // The Firebase provider's two deploy targets, and a deploy target of another stack's.
  tree.write('apps/functions/project.json', JSON.stringify({ name: 'functions', root: 'apps/functions', targets: { deploy: deployTarget('node tools/firebase-deploy.mjs --only functions') } }));
  tree.write('firebase/project.json', JSON.stringify({ name: 'firebase', root: 'firebase', targets: { deploy: deployTarget('node tools/firebase-deploy-rules.mjs') } }));
  tree.write('apps/docs/project.json', JSON.stringify({ name: 'docs', root: 'apps/docs', targets: { deploy: deployTarget('vercel deploy') } }));
  if (projection) declare(tree, projection);
  return tree;
};
const run = (layers = ['nx', 'node', 'firebase', 'ci'], extra = {}) => async (tree, ctx) => {
  await ctx.load('generators/ci/generator').default(tree, { layers, ...extra });
};
const WF = '.github/workflows/deploy.yml';
const SCRIPT = 'tools/setup-gcp.sh';
const configurations = (t, path) => t.json(path).targets.deploy.configurations;
/** The lines of one job of the rendered workflow. */
const job = (t, name) => {
  const text = t.read(WF);
  const start = text.indexOf(`\n  ${name}:\n`);
  const rest = text.slice(start + 1);
  const end = rest.slice(1).search(/\n {2}[a-z]+:\n/);
  return (end < 0 ? rest : rest.slice(0, end + 1)).replace(/^\s*#.*$/gm, '').replace(/ # .*$/gm, '');
};

export default {
  name: 'ci layer',
  cases: [
    {
      name: 'undeclared model: no workflow, no script — the marker keeps the layer on and says why',
      setup: fixture(null),
      run: run(),
      expect: (tree, t, ctx) => {
        t.missing(WF);
        t.missing(SCRIPT);
        t.ok(/not declared/.test(t.json('.bespunky/ci.json')?.pending ?? ''), 'pending says the model is undeclared');
        t.ok(ctx.logs.some((l) => /No deploy workflow/.test(l)), 'the run says so');
      },
    },
    {
      name: 'declared, nothing bound: no workflow, and the binding to add is named',
      setup: fixture(PROJECTION),
      run: run(),
      expect: (tree, t) => {
        t.missing(WF);
        t.ok(/"ci": \{ "environment"/.test(t.json('.bespunky/ci.json')?.pending ?? ''), 'pending shows the binding shape');
      },
    },
    {
      name: 'bound lines: triggers, one resolve rule for every matcher, pattern lines deploy in full, setup per environment',
      setup: fixture(BOUND),
      run: run(),
      expect: (tree, t, ctx) => {
        t.exists(WF);
        for (const needle of [
          "      - 'main'",
          "      - 'release/*'",
          "      - 'development'",
          `if bound '^refs/heads/main$'; then`,
          'environment=production; full=false',
          `elif bound '^refs/heads/release/[^/]+$'; then`,
          'environment=uat; full=true',
          'node-version-file: .nvmrc',
          'yarn install --immutable',
          'yarn nx show projects --affected --with-target deploy --base="$NX_BASE" --head="$NX_HEAD"',
          'yarn nx show projects --with-target deploy',
          'yarn nx run-many -t deploy --projects="$PROJECTS" --configuration="$CONFIGURATION" --outputStyle=static',
          'CONFIGURATION: ci-${{ needs.resolve.outputs.environment }}',
        ]) t.has(WF, needle);
        t.ok(t.read(WF).indexOf("'^refs/heads/main$'") < t.read(WF).indexOf('release/[^/]+'), 'exact names before globs');
        t.has(SCRIPT, "production\tdefault\tmain\tassertion.ref.matches('^refs/heads/main$')\tactive");
        t.has(SCRIPT, "uat\tuat\trelease/*\tassertion.ref.matches('^refs/heads/release/[^/]+$')\tactive");
        t.has(SCRIPT, "WORKFLOW='.github/workflows/deploy.yml'");
        t.has(SCRIPT, "VAR_PROVIDER='GCP_WORKLOAD_IDENTITY_PROVIDER'");
        t.hasNot(SCRIPT, '__');
        t.has(SCRIPT, 'A HUMAN RUNS THIS');
        t.equal(Object.keys(t.json('.bespunky/ci.json').cloud.firebase), ['production', 'uat', 'dev'], 'the rendered environments are recorded');
        t.equal(ctx.logs.filter((l) => l.includes('HUMAN_STEP: ! bash tools/setup-gcp.sh --environment')).length, 3, 'one human step per environment');
      },
    },
    {
      name: 'least privilege in the workflow: id-token only on the deploy job, every action pinned by SHA, concurrency per environment',
      setup: fixture(BOUND),
      run: run(),
      expect: (tree, t) => {
        const prepare = job(t, 'prepare');
        const deploy = job(t, 'deploy');
        t.ok(!/id-token/.test(prepare) && /yarn install --immutable/.test(prepare) && /nx-set-shas/.test(prepare), 'install and nx-set-shas run without id-token');
        t.ok(/actions: read/.test(job(t, 'prepare')), "prepare keeps nx-set-shas' actions: read");
        t.ok(/id-token: write/.test(deploy) && !/(yarn|npm|pnpm) (install|ci)\b/.test(deploy) && !/nx-set-shas/.test(deploy), 'deploy holds id-token and runs no install');
        t.ok(/fail-on-cache-miss: true/.test(deploy), 'deploy restores what prepare installed, or stops');
        t.ok(!/id-token/.test(job(t, 'resolve')), 'resolve has no id-token');
        t.ok(/group: deploy-\$\{\{ needs\.resolve\.outputs\.environment \}\}/.test(deploy) && /cancel-in-progress: false/.test(deploy), 'one deploy per environment, never cancelled');
        const usesLines = t.read(WF).split('\n').filter((l) => /^\s*- uses: /.test(l));
        t.ok(usesLines.length >= 6, `actions found: ${usesLines.length}`);
        for (const line of usesLines) t.ok(/@[0-9a-f]{40} # v\d+\.\d+\.\d+$/.test(line), `pinned by SHA: ${line.trim()}`);
        t.has(WF, 'google-github-actions/auth@');
      },
    },
    {
      name: 'provider args reach provider targets only: a ci-<environment> configuration on the Firebase deploy targets, none elsewhere',
      setup: fixture(BOUND),
      run: run(),
      expect: (tree, t) => {
        const functions = configurations(t, 'apps/functions/project.json');
        t.equal(Object.keys(functions).sort(), ['ci-dev', 'ci-production', 'ci-uat'], 'functions:deploy');
        t.equal(functions['ci-production'], { args: '--project=default --non-interactive' }, 'the provider target, as Firebase args');
        t.equal(Object.keys(configurations(t, 'firebase/project.json')).sort(), ['ci-dev', 'ci-production', 'ci-uat'], 'firebase:deploy');
        t.equal(configurations(t, 'apps/docs/project.json'), undefined, "another stack's deploy target is never handed Firebase's flags");
        t.equal(t.json('.bespunky/ci.json').configurations['functions:deploy'], ['ci-dev', 'ci-production', 'ci-uat'], 'recorded');
        t.hasNot(WF, '--project=');
      },
    },
    {
      name: "a project's own ci-<environment> configuration on a provider target is left alone",
      setup: () => {
        const tree = fixture(BOUND)();
        tree.write('firebase/project.json', JSON.stringify({ name: 'firebase', root: 'firebase', targets: { deploy: { ...deployTarget('node tools/firebase-deploy-rules.mjs'), configurations: { 'ci-production': { args: '--project=mine' } } } } }));
        return tree;
      },
      run: run(),
      expect: (tree, t, ctx) => {
        t.equal(configurations(t, 'firebase/project.json')['ci-production'], { args: '--project=mine' }, 'theirs kept');
        t.ok(ctx.logs.some((l) => /firebase:deploy already has a "ci-production" configuration the house did not write/.test(l)), 'reported');
        t.equal(t.json('.bespunky/ci.json').configurations['firebase:deploy'], ['ci-dev', 'ci-uat'], 'not recorded as the house\'s');
      },
    },
    {
      name: 'defence in depth: hotfix, tag and maintained-release bindings and a second line on one environment are never wired',
      setup: fixture({
        ...PROJECTION,
        productionPatterns: ['release/*'],
        deploys: [
          { kind: 'line', line: 'main', ci: ci('production', 'default') },
          { kind: 'line', line: 'development', ci: ci('production', 'default') },
          { kind: 'pattern', line: 'release/*', ci: ci('lts', 'lts') },
          { kind: 'pattern', line: 'hotfix/*/*', ci: ci('hot', 'default') },
          { kind: 'tag', line: 'v*', ci: ci('tagged', 'default') },
        ],
      }),
      run: run(),
      expect: (tree, t, ctx) => {
        t.has(WF, "      - 'main'");
        for (const branch of ['development', 'release/*', 'hotfix/*/*', 'v*']) t.hasNot(WF, `      - '${branch}'`);
        const notes = ctx.logs.join('\n');
        t.ok(/development: its `ci` binding is NOT wired — environment "production" is already bound by main/.test(notes), 'one line per environment');
        t.ok(/release\/\*: its `ci` binding is NOT wired — release\/\* are maintained release lines/.test(notes), 'maintained releases');
        t.ok(/hotfix\/\*\/\*: its `ci` binding is NOT wired — hotfix\/\*\/\* is not a protected line/.test(notes), 'hotfix lines');
        t.ok(/v\*: its `ci` binding is NOT wired — tags v\* are not a protected line/.test(notes), 'tags');
        t.equal(Object.keys(t.json('.bespunky/ci.json').cloud.firebase), ['production'], 'only the wired environment gets a cloud identity');
      },
    },
    {
      name: 'a re-run with the same model asks the human nothing; a changed binding asks again for that environment only',
      once: 'three runs with a model change before the last',
      setup: fixture(BOUND),
      run: async (tree, ctx) => {
        await run()(tree, ctx);
        await run()(tree, ctx);
        declare(tree, { ...BOUND, deploys: BOUND.deploys.map((d) => (d.line === 'development' ? { ...d, ci: ci('dev', 'dev2') } : d)) });
        await run()(tree, ctx);
      },
      expect: (tree, t, ctx) => {
        const steps = ctx.logs.filter((l) => l.includes('HUMAN_STEP:'));
        t.equal(steps.length, 4, 'three on the first run, none on the unchanged re-run, one after the change');
        t.ok(steps[3]?.includes('--environment dev '), steps[3]);
        t.equal(configurations(t, 'apps/functions/project.json')['ci-dev'], { args: '--project=dev2 --non-interactive' }, 'the configuration follows the binding');
      },
    },
    {
      name: 'the project already deploys from its own workflow: no second one, the script still written, the switch named',
      setup: () => {
        const tree = fixture(BOUND)();
        tree.write('.github/workflows/deploy-backend.yml', 'on: push\njobs:\n  d:\n    steps:\n      - run: npx nx affected -t deploy\n');
        return tree;
      },
      run: run(),
      expect: (tree, t) => {
        t.missing(WF);
        t.exists(SCRIPT);
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
      run: run(),
      expect: (tree, t, ctx) => {
        t.has(WF, 'name: theirs');
        t.ok(ctx.logs.some((l) => /deploy\.yml exists and the house did not write it/.test(l)), 'reported');
      },
    },
    {
      name: 'every binding removed, no setup ever recorded: workflow, script and configurations go with them',
      once: 'two runs with a model change between them',
      setup: fixture(BOUND),
      run: async (tree, ctx) => {
        await run()(tree, ctx);
        declare(tree, PROJECTION);
        await run()(tree, ctx);
      },
      expect: (tree, t, ctx) => {
        t.missing(WF);
        t.missing(SCRIPT);
        t.equal(t.json('.bespunky/ci.json').files, [], 'nothing owned');
        t.equal(configurations(t, 'apps/functions/project.json'), undefined, 'the house configurations are removed');
        t.ok(ctx.logs.some((l) => /no line deploys into "production" any more, and no setup is recorded for it/.test(l)), 'said');
      },
    },
    {
      name: 'a binding removed whose setup IS recorded: the environment stays in the script as retired, and the rollback step is printed until it is done',
      once: 'runs across a model change and a rollback',
      setup: fixture(BOUND),
      run: async (tree, ctx) => {
        await run()(tree, ctx);
        tree.write('.bespunky/gcp/dev.tsv', 'project\tdev-123\n');
        declare(tree, { ...BOUND, deploys: BOUND.deploys.filter((d) => d.line !== 'development') });
        await run()(tree, ctx);
        ctx.mark = ctx.logs.length;
        await run()(tree, ctx);
      },
      expect: (tree, t, ctx) => {
        t.has(SCRIPT, 'dev\tdev\tdevelopment\tassertion.ref.matches(\'^refs/heads/development$\')\tretired');
        t.hasNot(WF, "      - 'development'");
        t.equal(t.json('.bespunky/ci.json').cloud.firebase.dev, { target: 'dev', branches: ['development'], retired: true }, 'kept as retired');
        t.equal(configurations(t, 'apps/functions/project.json')['ci-dev'], undefined, 'a retired environment deploys nothing');
        const steps = ctx.logs.filter((l) => l.includes('HUMAN_STEP: ! bash tools/setup-gcp.sh --rollback --environment dev'));
        t.equal(steps.length, 2, 'printed on every upgrade until the rollback lands');
      },
    },
    {
      name: 'a retired environment rolled back (its record gone) is dropped from the script',
      once: 'runs across a model change and a rollback',
      setup: fixture(BOUND),
      run: async (tree, ctx) => {
        await run()(tree, ctx);
        tree.write('.bespunky/gcp/dev.tsv', 'project\tdev-123\n');
        declare(tree, { ...BOUND, deploys: BOUND.deploys.filter((d) => d.line !== 'development') });
        await run()(tree, ctx);
        tree.delete('.bespunky/gcp/dev.tsv');
        await run()(tree, ctx);
      },
      expect: (tree, t, ctx) => {
        t.hasNot(SCRIPT, '\tretired');
        t.equal(Object.keys(t.json('.bespunky/ci.json').cloud.firebase), ['production', 'uat'], 'dropped');
        t.ok(ctx.logs.some((l) => /"dev" was rolled back/.test(l)), 'said');
      },
    },
    {
      name: 'no provider layer: a plain deploy workflow — no cloud auth, no script, no configurations',
      setup: fixture({ ...PROJECTION, deploys: [{ kind: 'line', line: 'main', ci: { environment: 'production', providers: {} } }] }),
      run: run(['nx', 'node', 'ci']),
      expect: (tree, t) => {
        t.exists(WF);
        t.hasNot(WF, 'google-github-actions');
        t.missing(SCRIPT);
        t.equal(configurations(t, 'apps/functions/project.json'), undefined, 'nothing configured');
      },
    },
    {
      name: 'the resolved projection handed in wins over the working copy (the upgrade path)',
      setup: fixture(PROJECTION),
      run: run(undefined, { branchProjection: JSON.stringify(BOUND) }),
      expect: (tree, t) => t.exists(WF),
    },
  ],
};
