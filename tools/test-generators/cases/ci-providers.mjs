// THE `ci` LAYER'S PROVIDER SEAM — exercised by a second provider, because one provider cannot show what a seam
// assumes. What would break silently:
//   - adding a provider to a line that deploys today: the line dropped from the workflow, or the whole workflow removed
//     with its last line, and a human told to roll back the identity of the line that just stopped;
//   - a project's own `<provider> deploy` pipeline going unseen, so a second deploying workflow lands beside it;
//   - code deploying before its schema, or after its schema failed;
//   - a schema credential reaching a code deploy's environment;
//   - a token-based deploy job still able to mint a cloud token.
//
// The generated bash is RUN (`bash --noprofile --norc -eo pipefail`, what `shell: bash` runs on GitHub), against a stub
// package manager that records the deploys, so order and failure are observed rather than read off the text.
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { requireFromRepo } from '../../test-support/payload.mjs';
import { workspace } from '../workspaces.mjs';

const MODEL = '.bespunky/branches.json';
const WF = '.github/workflows/deploy.yml';
const SCRIPT = 'tools/setup-gcp.sh';
const PROJECTION = {
  schema: 1,
  integration: 'development',
  production: ['main'],
  productionPatterns: [],
  chain: ['development', 'main'],
  protected: ['development', 'main'],
  protectedPatterns: [],
  workBase: 'development',
  summary: 'development → main',
};
const lines = (...entries) => ({
  ...PROJECTION,
  deploys: entries.map(([line, environment, providers]) => ({ kind: 'line', line, ci: { environment, providers } })),
});
const declare = (tree, projection) => tree.write(MODEL, JSON.stringify({ schema: 1, projection }, null, 2));

const deployTarget = (command) => ({ executor: 'nx:run-commands', options: { command, cwd: '{workspaceRoot}' } });
const fixture = (projection) => () => {
  const tree = workspace({ pm: 'yarn-berry' });
  tree.write('.nvmrc', '22\n');
  tree.write('firebase.json', '{}');
  tree.write('apps/functions/project.json', JSON.stringify({ name: 'functions', root: 'apps/functions', targets: { deploy: deployTarget('a') } }));
  tree.write('firebase/project.json', JSON.stringify({ name: 'firebase', root: 'firebase', targets: { deploy: deployTarget('b') } }));
  tree.write('apps/docs/project.json', JSON.stringify({ name: 'docs', root: 'apps/docs', targets: { deploy: deployTarget('c') } }));
  tree.write('db/project.json', JSON.stringify({ name: '@acme/db', root: 'db', targets: { deploy: deployTarget('d') } }));
  if (projection) declare(tree, projection);
  return tree;
};

/** A second provider: a database, token-authenticated, deploying its schema first. Every new field is set. */
const fakedb = {
  id: 'fakedb',
  title: 'A fake database',
  targetLabel: 'fakedb project ref',
  deploySignals: [/\bfakedb\s+push\b/],
  deployStage: 'schema',
  deployEnv: { FAKEDB_URL: '${{ secrets.FAKEDB_URL }}' },
  deployTargets: () => [{ project: '@acme/db', target: 'deploy' }],
  deployOptions: (target) => ({ args: `--ref=${target}` }),
  authSteps: () => '- name: Check the token\n  run: test -n "$FAKEDB_URL"\n',
};

/** Run the generator with `fakedb` contributed by a layer (no production seam exists for this, and none should). */
const withFake = (layers, provider = fakedb) => async (tree, ctx) => {
  const js = ctx.load('layers/registry').layer('js');
  js.ciDeploy = provider;
  try {
    await ctx.load('generators/ci/generator').default(tree, { layers });
  } finally {
    delete js.ciDeploy;
  }
};
const BOTH = ['nx', 'node', 'js', 'firebase', 'ci'];
const FAKE_ONLY = ['nx', 'node', 'js', 'ci'];
const FIREBASE_ONLY = ['nx', 'node', 'firebase', 'ci'];

/** The body of one `run: |` block in the rendered workflow: of the named step, or of the step with this `id`. */
function script(text, step) {
  const all = text.split('\n');
  const at = all.findIndex((l) => l === `      - name: ${step}` || l === `      - id: ${step}`);
  if (at < 0) throw new Error(`no step "${step}" in the workflow`);
  const run = all.findIndex((l, i) => i > at && l === '        run: |');
  const body = [];
  for (let i = run + 1; i < all.length && (all[i].startsWith('          ') || all[i] === ''); i++) body.push(all[i].slice(10));
  return body.join('\n');
}

/** Run generated bash as `shell: bash` does, with `yarn` stubbed to record its arguments (and fail on `failOn`). */
function runBash(body, env = {}, { failOn } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ci-providers-'));
  try {
    writeFileSync(join(dir, 'yarn'), `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "${dir}/calls"\n${failOn ? `[[ "$*" == *${failOn}* ]] && exit 3\n` : ''}exit 0\n`);
    chmodSync(join(dir, 'yarn'), 0o755);
    writeFileSync(join(dir, 'calls'), '');
    writeFileSync(join(dir, 'output'), '');
    const result = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', body], {
      env: { PATH: `${dir}:${process.env.PATH}`, GITHUB_OUTPUT: join(dir, 'output'), ...env },
      encoding: 'utf8',
    });
    return { status: result.status, out: result.stdout + result.stderr, calls: readFileSync(join(dir, 'calls'), 'utf8').trim().split('\n').filter(Boolean), output: readFileSync(join(dir, 'output'), 'utf8') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Every step's env block, read as text: `name` → the block's lines. */
const stepText = (text, name) => {
  const start = text.indexOf(`      - name: ${name}\n`);
  return text.slice(start, text.indexOf('run: |', start));
};

/** Deploy a selection through a workflow's two stage steps, in the order they are rendered, stopping on failure. */
function deployStages(text, selection, opts) {
  const env = { PROJECTS: selection, CONFIGURATION: 'ci-production', STAGE_PROJECTS: '@acme/db', EARLIER_PROJECTS: '@acme/db' };
  const schema = runBash(script(text, 'Deploy schema'), env, opts);
  if (schema.status !== 0) return { schema };
  return { schema, code: runBash(script(text, 'Deploy'), env, opts) };
}

export default {
  name: 'ci layer · the provider seam',
  cases: [
    {
      name: 'a provider added to a line that deploys today: the workflow stays, that line fails loudly, and nothing is told to roll back',
      once: 'two runs across adding a provider',
      setup: fixture(lines(['main', 'production', { firebase: 'default' }])),
      run: async (tree, ctx) => {
        await withFake(FIREBASE_ONLY)(tree, ctx);
        tree.write('.bespunky/gcp/production.tsv', 'project\tp-123\n');
        ctx.mark = ctx.logs.length;
        await withFake(BOTH)(tree, ctx);
      },
      expect: (tree, t, ctx) => {
        const text = t.read(WF);
        t.has(WF, "      - 'main'");
        const resolved = runBash(script(text, 'binding'), { GITHUB_REF: 'refs/heads/main', GITHUB_REF_NAME: 'main' });
        t.equal(resolved.status, 1, 'the push fails');
        t.ok(/::error::main deploys nothing until its `ci` binding names a target for fakedb/.test(resolved.out), `says so: ${resolved.out}`);
        t.ok(resolved.out.includes('"fakedb": "<fakedb project ref>"'), 'with the targetLabel of what to add');
        t.equal(resolved.output, '', 'and resolves no environment, so nothing downstream runs');
        const after = ctx.logs.slice(ctx.mark);
        t.ok(after.some((l) => /HUMAN_STEP: main deploys nothing until/.test(l)), 'the upgrade relays it as a human step');
        t.ok(!after.some((l) => /--rollback/.test(l)), 'never a rollback of the identity of the line that is blocked');
        t.ok(after.some((l) => /deploys nothing yet/.test(l)), 'the summary does not claim a deploy');
        t.equal(t.json('apps/functions/project.json').targets.deploy.configurations['ci-production'], { args: '--project=default --non-interactive' }, "firebase's configuration stays");
        t.equal(t.json('db/project.json').targets.deploy.configurations, undefined, 'the unbound provider gets none');
        t.has(SCRIPT, "production\tdefault\tmain\tassertion.ref.matches('^refs/heads/main$')\tactive");
        t.equal(Object.keys(t.json('.bespunky/ci.json').cloud), ['firebase'], 'only the bound provider is recorded');
      },
    },
    {
      name: 'blocked is per line: a fully bound line still deploys, and binding the provider unblocks the other',
      once: 'two runs across completing a binding',
      setup: fixture(lines(['main', 'production', { firebase: 'default' }], ['development', 'dev', { firebase: 'dev', fakedb: 'dev-ref' }])),
      run: async (tree, ctx) => {
        await withFake(BOTH)(tree, ctx);
        ctx.first = tree.read(WF, 'utf8');
        declare(tree, lines(['main', 'production', { firebase: 'default', fakedb: 'prod-ref' }], ['development', 'dev', { firebase: 'dev', fakedb: 'dev-ref' }]));
        await withFake(BOTH)(tree, ctx);
      },
      expect: (tree, t, ctx) => {
        const first = script(ctx.first, 'binding');
        t.equal(runBash(first, { GITHUB_REF: 'refs/heads/main' }).status, 1, 'main fails');
        const dev = runBash(first, { GITHUB_REF: 'refs/heads/development' });
        t.equal(dev.status, 0, 'development resolves');
        t.ok(dev.output.includes('environment=dev'), dev.output);
        const main = runBash(script(t.read(WF), 'binding'), { GITHUB_REF: 'refs/heads/main' });
        t.equal(main.status, 0, 'main resolves once bound');
        t.ok(main.output.includes('environment=production'), main.output);
        t.equal(t.json('db/project.json').targets.deploy.configurations['ci-production'], { args: '--ref=prod-ref' }, 'the new provider is configured');
      },
    },
    {
      name: 'order: the schema stage deploys first, only what prepare selected, and its failure stops the code stage',
      setup: fixture(lines(['main', 'production', { firebase: 'default', fakedb: 'ref' }])),
      run: withFake(BOTH),
      expect: (tree, t) => {
        const text = t.read(WF);
        t.ok(text.indexOf('- name: Deploy schema') < text.indexOf('- name: Deploy\n'), 'rendered in order');
        t.has(WF, "STAGE_PROJECTS: '@acme/db'");
        t.has(WF, "EARLIER_PROJECTS: '@acme/db'");

        const both = deployStages(text, 'functions,@acme/db,docs');
        t.equal(both.schema.calls, ['nx run-many -t deploy --projects=@acme/db --configuration=ci-production --outputStyle=static'], 'schema: just its project');
        t.equal(both.code.calls, ['nx run-many -t deploy --projects=docs,functions --configuration=ci-production --outputStyle=static'], "code: the rest, a project's own included");

        const codeOnly = deployStages(text, 'functions');
        t.equal(codeOnly.schema.calls, [], 'schema not selected: nothing runs in its stage');
        t.equal(codeOnly.schema.status, 0, 'and that is not a failure');
        t.equal(codeOnly.code.calls.length, 1, 'code still deploys');

        const schemaOnly = deployStages(text, '@acme/db');
        t.equal(schemaOnly.code.calls, [], 'code not selected: nothing runs in its stage');
        t.equal(schemaOnly.code.status, 0, 'and that is not a failure');

        const failed = runBash(script(text, 'Deploy schema'), { PROJECTS: 'functions,@acme/db', CONFIGURATION: 'c', STAGE_PROJECTS: '@acme/db' }, { failOn: '@acme/db' });
        t.equal(failed.status, 3, "a failed schema deploy fails its step, which GitHub's default stops the next on");
        t.ok(!/continue-on-error|if: always|if: failure/.test(text), 'and nothing in the workflow overrides that');
      },
    },
    {
      name: 'deployEnv: on the step of the provider\'s stage only, never in a committed configuration',
      setup: fixture(lines(['main', 'production', { firebase: 'default', fakedb: 'ref' }])),
      run: withFake(BOTH),
      expect: (tree, t) => {
        const text = t.read(WF);
        t.ok(stepText(text, 'Deploy schema').includes('FAKEDB_URL: ${{ secrets.FAKEDB_URL }}'), 'on the schema step');
        t.ok(!stepText(text, 'Deploy').includes('FAKEDB_URL'), 'never on the code step');
        t.hasNot('db/project.json', 'FAKEDB_URL');
        t.hasNot('.bespunky/ci.json', 'FAKEDB_URL');
      },
    },
    {
      name: 'deployEnv: two providers in one step claiming one name, or a provider claiming a step variable, is refused',
      once: 'asserts the refusal, which writes nothing',
      setup: fixture(lines(['main', 'production', { firebase: 'default', fakedb: 'ref' }])),
      run: async (tree, ctx) => {
        ctx.refused = [];
        for (const name of ['PROJECTS', 'STAGE_PROJECTS']) {
          try {
            await withFake(BOTH, { ...fakedb, deployEnv: { [name]: 'x' } })(tree, ctx);
          } catch (error) {
            ctx.refused.push(error.message);
          }
        }
      },
      expect: (tree, t, ctx) => {
        t.equal(ctx.refused.length, 2, 'both refused');
        t.ok(ctx.refused.every((m) => /both declare the deploy env var/.test(m)), ctx.refused.join(' | '));
      },
    },
    {
      name: 'oidc: id-token only when an active provider asks, with its reason; a token-based deploy job cannot mint one',
      setup: fixture(lines(['main', 'production', { fakedb: 'ref' }])),
      run: withFake(FAKE_ONLY),
      expect: (tree, t) => {
        t.hasNot(WF, 'id-token: write');
        t.hasNot(WF, 'google-github-actions');
      },
    },
    {
      name: 'oidc: one active provider asking is enough, and its reason is what the workflow says',
      setup: fixture(lines(['main', 'production', { firebase: 'default', fakedb: 'ref' }])),
      run: withFake(BOTH),
      expect: (tree, t) => {
        t.has(WF, "id-token: write # keyless cloud auth: GitHub's OIDC token, exchanged by Workload Identity Federation");
      },
    },
    {
      name: 'no provider active: no id-token, one plain deploy step, and the message offers no provider',
      setup: fixture(lines(['main', 'production', {}])),
      run: withFake(['nx', 'node', 'ci']),
      expect: (tree, t) => {
        t.hasNot(WF, 'id-token: write');
        t.hasNot(WF, 'STAGE_PROJECTS');
        t.hasNot(WF, 'EARLIER_PROJECTS');
      },
    },
    {
      name: 'the "add a binding" message is built from the active providers',
      setup: fixture(PROJECTION),
      run: withFake(FAKE_ONLY),
      expect: (tree, t) => {
        const pending = t.json('.bespunky/ci.json').pending;
        t.ok(pending.includes('"providers": { "fakedb": "<fakedb project ref>" }'), pending);
        t.ok(!/firebase/.test(pending), `names no provider this project does not wear: ${pending}`);
      },
    },
    {
      name: 'the marker no longer names one provider\'s setup script',
      setup: fixture(lines(['main', 'production', { fakedb: 'ref' }])),
      run: withFake(FAKE_ONLY),
      expect: (tree, t) => {
        t.ok(!/setup-gcp/.test(t.json('.bespunky/ci.json').about), t.json('.bespunky/ci.json').about);
      },
    },
    {
      name: "a project's own pipeline deploying through a worn provider's command is seen: no second workflow",
      setup: () => {
        const tree = fixture(lines(['main', 'production', { firebase: 'default', fakedb: 'ref' }]))();
        tree.write('.github/workflows/db.yml', 'on: push\njobs:\n  d:\n    steps:\n      - run: fakedb  push --all\n');
        return tree;
      },
      run: withFake(BOTH),
      expect: (tree, t) => {
        t.missing(WF);
        t.ok(/db\.yml/.test(t.json('.bespunky/ci.json').pending ?? ''), 'pending names the existing pipeline');
      },
    },
    {
      name: 'and through a provider the project does NOT wear: having a pipeline does not depend on wearing the layer',
      setup: () => {
        const tree = fixture(lines(['main', 'production', {}]))();
        tree.write('.github/workflows/db.yml', 'on: push\njobs:\n  d:\n    steps:\n      - run: fakedb push\n');
        tree.write('.github/workflows/fb.yml', 'on: push\njobs:\n  d:\n    steps:\n      - run: firebase deploy\n');
        return tree;
      },
      run: withFake(['nx', 'node', 'ci']),
      expect: (tree, t) => {
        t.missing(WF);
        const pending = t.json('.bespunky/ci.json').pending ?? '';
        t.ok(/db\.yml/.test(pending) && /fb\.yml/.test(pending), pending);
      },
    },
    {
      name: 'a signal in a comment is not a pipeline',
      setup: () => {
        const tree = fixture(lines(['main', 'production', { fakedb: 'ref' }]))();
        tree.write('.github/workflows/db.yml', 'on: push\njobs:\n  d:\n    steps:\n      # fakedb push, one day\n      - run: echo hi\n');
        return tree;
      },
      run: withFake(FAKE_ONLY),
      expect: (tree, t) => t.exists(WF),
    },
    {
      name: 'a blocked binding beside a pipeline of the project\'s own: nothing of the house\'s stopped, so it is a note',
      setup: () => {
        const tree = fixture(lines(['main', 'production', { firebase: 'default' }]))();
        tree.write('.github/workflows/mine.yml', 'on: push\njobs:\n  d:\n    steps:\n      - run: firebase deploy\n');
        return tree;
      },
      run: withFake(BOTH),
      expect: (tree, t, ctx) => {
        t.missing(WF);
        t.ok(!ctx.logs.some((l) => /HUMAN_STEP: main deploys nothing/.test(l)), 'no human step');
        t.ok(ctx.logs.some((l) => /\[ci\] main deploys nothing until/.test(l)), 'a note');
      },
    },
    {
      name: 'the rendered workflow with stages and a blocked line is still valid YAML of the shape GitHub reads',
      needs: ['yaml'],
      setup: fixture(lines(['main', 'production', { firebase: 'default' }], ['development', 'dev', { firebase: 'dev', fakedb: 'ref' }])),
      run: withFake(BOTH),
      expect: (tree, t, ctx) => {
        const parsed = requireFromRepo('yaml').parse(t.read(WF));
        const names = parsed.jobs.deploy.steps.map((s) => s.name).filter(Boolean);
        t.ok(names.indexOf('Deploy schema') >= 0 && names.indexOf('Deploy schema') < names.indexOf('Deploy'), names.join(', '));
        const schema = parsed.jobs.deploy.steps.find((s) => s.name === 'Deploy schema');
        t.equal(schema.env.STAGE_PROJECTS, '@acme/db', 'a scoped project name survives as a string');
        t.ok(parsed.jobs.resolve.steps[0].run.includes('::error::main deploys nothing'), 'the failure is in resolve');
        execFileSync('bash', ['-n'], { input: script(t.read(WF), 'binding') });
        execFileSync('bash', ['-n'], { input: script(t.read(WF), 'Deploy schema') });
      },
    },
  ],
};
