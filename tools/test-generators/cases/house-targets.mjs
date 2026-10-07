// HOUSE TARGETS ARE SHARED GROUND — an upgrade re-asserts the house's targets by a three-way merge against a record
// of what it last wrote (_utils/house-targets.ts). The promises these cases hold it to:
//   - a developer's (or Claude's) edit inside a house target survives every upgrade that does not change the same
//     key, and an upgrade that does replace one REPORTS it — onto the upgrade's attention list, not only a log line;
//   - what a target RUNS (executor + command/commands) is one value: a house `command` never lands beside a
//     project's `commands` (Nx lets `command` win, so the project's deploy silently stopped running);
//   - a target the house introduces that the project already defines is the project's, whole, and stays so;
//   - the deploy contract (cache, parallelism, dependsOn: build) is re-asserted, and a project value that differed
//     is reported;
//   - with no record at all, nothing is decided silently: every replaced value and every set member put back is said.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { requireFromRepo } from '../../test-support/payload.mjs';
import { workspace } from '../workspaces.mjs';

const { getProjects, writeJson } = requireFromRepo('@nx/devkit');
const RECORD = '.bespunky/house-targets.json';

const HOUSE = {
  deploy: {
    executor: 'nx:run-commands',
    dependsOn: ['build', 'lint'],
    inputs: ['default', '{workspaceRoot}/firebase.json'],
    options: { command: 'firebase deploy --only functions', cwd: '{workspaceRoot}' },
  },
};
const RECORDED = { kind: 'recorded', targets: HOUSE };
const UNKNOWN = { kind: 'unknown' };
const clone = (value) => JSON.parse(JSON.stringify(value));

/** Edit the project's own definition file the way a developer would. */
function handEdit(tree, P, root, edit) {
  const file = P.projectDefinitionFile(tree, root);
  const json = JSON.parse(tree.read(file.path, 'utf8'));
  edit((file.kind === 'package.json' ? json.nx : json).targets);
  tree.write(file.path, JSON.stringify(json, null, 2) + '\n');
}

const pure = (name, run, expect) => ({
  name,
  once: 'it asserts a pure function — there is no tree operation to repeat',
  setup: () => workspace(),
  run: (tree, ctx) => (ctx.result = run(ctx.load('generators/_utils/house-targets').mergeHouseTargets)),
  expect: (tree, t, ctx) => expect(t, ctx.result),
});
const said = (findings) => findings.map((f) => [f.target, f.key, f.kind]);

export default {
  name: 'house targets · the three-way merge',
  cases: [
    pure(
      'the project\'s additions inside a house target are kept (options, configurations, inputs, its own targets)',
      (merge) =>
        merge(
          {
            deploy: {
              ...HOUSE.deploy,
              inputs: [...HOUSE.deploy.inputs, '{workspaceRoot}/firestore.rules'],
              options: { ...HOUSE.deploy.options, args: '--force' },
              configurations: { staging: { args: '-P staging' } },
            },
            mine: { command: 'mine' },
          },
          HOUSE,
          RECORDED,
        ),
      (t, { targets, findings }) => {
        t.equal(targets.deploy.inputs, [...HOUSE.deploy.inputs, '{workspaceRoot}/firestore.rules'], 'the added input');
        t.equal(targets.deploy.options.args, '--force', 'the added option');
        t.equal(targets.deploy.configurations, { staging: { args: '-P staging' } }, 'the added configuration');
        t.ok(targets.mine, 'the project\'s own target');
        t.equal(findings, [], 'nothing replaced');
      },
    ),
    pure(
      'an edit the house did not change is kept; one the house also changed takes the house\'s value — reported as a conflict',
      (merge) =>
        merge(
          { deploy: { ...HOUSE.deploy, options: { command: 'my deploy', cwd: 'mine' } } },
          { deploy: { ...HOUSE.deploy, options: { ...HOUSE.deploy.options, command: 'firebase deploy --only functions --force' } } },
          RECORDED,
        ),
      (t, { targets, findings }) => {
        t.equal(targets.deploy.options.cwd, 'mine', 'cwd: edited by the project only — kept');
        t.equal(targets.deploy.options.command, 'firebase deploy --only functions --force', 'what it runs: both changed — the house wins');
        t.equal(findings.map((f) => [f.target, f.key, f.kind, f.was?.command]), [['deploy', 'runs', 'conflict', 'my deploy']], 'reported, with the value it replaced');
      },
    ),
    pure(
      'the house drops a key nobody touched → gone; a set element the project removed stays removed; a new one arrives',
      (merge) =>
        merge(
          { deploy: { ...HOUSE.deploy, dependsOn: ['build'] } },
          { deploy: { executor: 'nx:run-commands', dependsOn: ['build', 'lint', 'typecheck'], inputs: HOUSE.deploy.inputs, options: { command: HOUSE.deploy.options.command } } },
          RECORDED,
        ),
      (t, { targets, findings }) => {
        t.ok(!('cwd' in targets.deploy.options), `the dropped cwd is gone: ${JSON.stringify(targets.deploy.options)}`);
        t.equal(targets.deploy.dependsOn, ['build', 'typecheck'], 'lint stays removed, typecheck arrives');
        t.equal(findings, [], 'nothing replaced');
      },
    ),
    pure(
      'R5-2: what a target runs is ONE value — a project that switched to `commands` keeps them, and never gets a `command` beside them',
      (merge) => {
        const theirs = { deploy: { ...clone(HOUSE.deploy), options: { commands: ['firebase deploy --only firestore,storage,hosting'], cwd: '{workspaceRoot}' } } };
        const unchanged = merge(theirs, HOUSE, RECORDED);
        const changed = merge(theirs, { deploy: { ...HOUSE.deploy, options: { ...HOUSE.deploy.options, command: 'node tools/firebase-deploy.mjs --only functions' } } }, RECORDED);
        return { unchanged, changed };
      },
      (t, { unchanged, changed }) => {
        t.equal(unchanged.targets.deploy.options, { commands: ['firebase deploy --only firestore,storage,hosting'], cwd: '{workspaceRoot}' }, 'the house did not change it: the project\'s commands, alone');
        t.equal(unchanged.findings, [], 'and nothing to say');
        t.equal(changed.targets.deploy.options, { cwd: '{workspaceRoot}', command: 'node tools/firebase-deploy.mjs --only functions' }, 'the house changed it too: the house\'s command, and NO commands left beside it');
        t.equal(said(changed.findings), [['deploy', 'runs', 'conflict']], 'reported as one conflict');
      },
    ),
    pure(
      'a project running its own executor keeps it — the house\'s options (for another executor) stay out of it',
      (merge) => merge({ deploy: { ...clone(HOUSE.deploy), executor: '@acme/deploy:run', options: { target: 'prod' } } }, HOUSE, RECORDED),
      (t, { targets, findings }) => {
        t.equal([targets.deploy.executor, targets.deploy.options], ['@acme/deploy:run', { target: 'prod' }], `kept, alone: ${JSON.stringify(targets.deploy)}`);
        t.equal(findings, [], 'the house did not change what it runs: nothing to say');
      },
    ),
    pure(
      'R5-2: a target the house INTRODUCES that the project already defines is the project\'s, whole — kept, reported, not recorded',
      (merge) => {
        const own = { deploy: { executor: 'nx:run-commands', options: { commands: ['firebase deploy --only firestore,storage,hosting'] } }, emulators: { command: 'x' } };
        const owned = { ...HOUSE, emulators: { command: 'x' } };
        return {
          introduced: merge(own, owned, { kind: 'recorded', targets: { emulators: { command: 'x' } } }),
          never: merge(own, owned, { kind: 'never' }),
          equal: merge({ deploy: clone(HOUSE.deploy) }, HOUSE, { kind: 'never' }),
        };
      },
      (t, { introduced, never, equal }) => {
        for (const [label, r] of [['a later release introduces it', introduced], ['the house never wrote this project', never]]) {
          t.equal(r.targets.deploy, { executor: 'nx:run-commands', options: { commands: ['firebase deploy --only firestore,storage,hosting'] } }, `${label}: the project's target, untouched`);
          t.equal(said(r.findings), [['deploy', undefined, 'own-target']], `${label}: reported`);
          t.ok(!('deploy' in r.recorded) && 'emulators' in r.recorded, `${label}: the project's target is not recorded as the house's`);
        }
        t.equal([equal.findings, Object.keys(equal.recorded)], [[], ['deploy']], 'identical to the house\'s: nothing to say, and it is the house\'s from now on');
      },
    ),
    pure(
      'the contract is re-asserted — cache, parallelism, dependsOn: build — and every difference reported; dropping lint is the project\'s call',
      (merge) =>
        merge(
          { deploy: { ...clone(HOUSE.deploy), dependsOn: ['typecheck'], cache: true, parallelism: true } },
          { deploy: { ...HOUSE.deploy, cache: false, parallelism: false } },
          { kind: 'recorded', targets: { deploy: { ...HOUSE.deploy, cache: false, parallelism: false } } },
          { deploy: { cache: false, parallelism: false, dependsOn: ['build'] } },
        ),
      (t, { targets, findings }) => {
        t.equal([targets.deploy.cache, targets.deploy.parallelism], [false, false], 'cache and parallelism re-asserted');
        t.equal(targets.deploy.dependsOn, ['typecheck', 'build'], 'build is back; lint stays out (the project removed it)');
        t.equal(said(findings).sort(), [['deploy', 'cache', 'contract'], ['deploy', 'dependsOn', 'contract'], ['deploy', 'parallelism', 'contract']], 'each reported');
      },
    ),
    pure(
      'no record: house-declared keys take the house\'s value, undeclared keys are kept — and every replacement and put-back member is SAID (R5-5)',
      (merge) =>
        merge(
          { deploy: { executor: 'nx:run-commands', dependsOn: ['build'], inputs: ['{workspaceRoot}/x'], options: { command: 'old', cwd: '{workspaceRoot}', args: 'a' } } },
          HOUSE,
          UNKNOWN,
        ),
      (t, { targets, findings }) => {
        t.equal(targets.deploy.options, { command: HOUSE.deploy.options.command, cwd: '{workspaceRoot}', args: 'a' }, 'options');
        t.equal(targets.deploy.dependsOn, ['build', 'lint'], 'dependsOn: nothing is known to be removed, so lint comes back…');
        t.equal(targets.deploy.inputs, ['{workspaceRoot}/x', ...HOUSE.deploy.inputs], 'inputs: the project\'s entry kept, in its place; the house\'s arrive after');
        t.equal(said(findings), [['deploy', 'runs', 'unknown'], ['deploy', 'dependsOn', 'unknown'], ['deploy', 'inputs', 'unknown']], '…and every one of those is reported, as unknowable');
      },
    ),
    ...['paths', 'workspaces-npm'].map((link) => ({
      name: `${link}: hand edits to a house target survive an upgrade, silently — and the record is kept, by canonical name`,
      setup: (ctx) => {
        const tree = workspace({ link });
        const P = ctx.load('generators/_utils/project-files');
        P.ensureHouseProject(tree, 'test', P.houseProjectHome(tree, 'functions', 'apps/functions'), { tags: ['t'], targets: HOUSE });
        handEdit(tree, P, 'apps/functions', (targets) => {
          targets.deploy.inputs.push('{workspaceRoot}/firestore.rules');
          targets.deploy.options.args = '--non-interactive';
          targets.deploy.configurations = { staging: { args: '-P staging' } };
        });
        return tree;
      },
      run: (tree, ctx) => {
        const P = ctx.load('generators/_utils/project-files');
        P.ensureHouseProject(tree, 'test', P.houseProjectHome(tree, 'functions', 'apps/functions'), { tags: ['t'], targets: HOUSE });
      },
      expect: (tree, t, ctx) => {
        const deploy = getProjects(tree).get('functions')?.targets?.deploy;
        t.ok(deploy?.inputs?.includes('{workspaceRoot}/firestore.rules'), `input kept: ${deploy?.inputs}`);
        t.equal(deploy?.options?.args, '--non-interactive', 'args kept');
        t.equal(deploy?.configurations, { staging: { args: '-P staging' } }, 'configuration kept');
        t.equal(t.json(RECORD)?.projects?.functions, { project: 'functions', root: 'apps/functions', targets: HOUSE }, 'the record holds what the house wrote, not the merge');
        t.equal(ctx.logs, [], 'nothing replaced, nothing said');
      },
    })),
    {
      name: 'a conflict reaches the upgrade\'s attention list (BESPUNKY_UPGRADE_REPORT), not only the log',
      once: 'it reads a file outside the tree that the first run appended to',
      setup: (ctx) => {
        const tree = workspace();
        const P = ctx.load('generators/_utils/project-files');
        P.ensureHouseProject(tree, 'test', P.houseProjectHome(tree, 'functions', 'apps/functions'), { tags: [], targets: HOUSE });
        handEdit(tree, P, 'apps/functions', (targets) => (targets.deploy.options.command = 'my deploy'));
        return tree;
      },
      run: (tree, ctx) => {
        const dir = mkdtempSync(join(tmpdir(), 'bespunky-report-'));
        process.env.BESPUNKY_UPGRADE_REPORT = join(dir, 'report');
        try {
          const P = ctx.load('generators/_utils/project-files');
          P.ensureHouseProject(tree, 'test', P.houseProjectHome(tree, 'functions', 'apps/functions'), {
            tags: [],
            targets: { deploy: { ...HOUSE.deploy, options: { ...HOUSE.deploy.options, command: 'node tools/firebase-deploy.mjs --only functions' } } },
          });
          ctx.report = readFileSync(join(dir, 'report'), 'utf8');
        } finally {
          delete process.env.BESPUNKY_UPGRADE_REPORT;
          rmSync(dir, { recursive: true, force: true });
        }
      },
      expect: (tree, t, ctx) => {
        const lines = ctx.report.trim().split('\n');
        t.equal(lines.length, 1, `one line: ${ctx.report}`);
        t.ok(lines[0].startsWith('[test] functions:deploy — runs') && lines[0].includes('my deploy'), `names the target and the replaced value: ${lines[0]}`);
      },
    },
    {
      name: 'R5-7: the record follows a renamed house project (keyed by its canonical name) and forgets one that is gone',
      setup: (ctx) => {
        const tree = workspace();
        const P = ctx.load('generators/_utils/project-files');
        P.ensureHouseProject(tree, 'test', P.houseProjectHome(tree, 'functions', 'apps/functions'), { tags: [], targets: HOUSE });
        P.ensureHouseProject(tree, 'test', P.houseProjectHome(tree, 'shared-browser', 'tools/shared-browser'), { tags: [], targets: { up: { command: 'up' } } });
        // Rename functions → api (same root), hand-edit inside it; remove the shared-browser project entirely.
        const file = JSON.parse(tree.read('apps/functions/project.json', 'utf8'));
        file.name = 'api';
        file.targets.deploy.options.args = '--mine';
        tree.write('apps/functions/project.json', JSON.stringify(file, null, 2));
        tree.delete('tools/shared-browser/project.json');
        return tree;
      },
      run: (tree, ctx) => {
        const P = ctx.load('generators/_utils/project-files');
        P.ensureHouseProject(tree, 'test', P.houseProjectHome(tree, 'functions', 'apps/functions'), { tags: [], targets: HOUSE });
      },
      expect: (tree, t, ctx) => {
        t.equal(getProjects(tree).get('api')?.targets?.deploy?.options?.args, '--mine', 'the edit inside the renamed project survives');
        t.equal(ctx.logs.filter((l) => l.startsWith('[warn]')), [], 'its provenance was found: nothing reported');
        t.equal(Object.keys(t.json(RECORD).projects), ['functions'], 'the gone project is pruned');
        t.equal(t.json(RECORD).projects.functions.project, 'api', 'the entry names the project as it is now');
      },
    },
    {
      name: 'no record at all (deleted): the house\'s value replaces a different one and SAYS so; the project\'s keys stay',
      setup: () => {
        const tree = workspace();
        writeJson(tree, 'apps/functions/project.json', {
          name: 'functions',
          root: 'apps/functions',
          targets: { deploy: { executor: 'nx:run-commands', dependsOn: ['build'], options: { command: 'hand-fixed deploy', cwd: '{workspaceRoot}', args: '-P prod' } } },
        });
        return tree;
      },
      run: (tree, ctx) => {
        const P = ctx.load('generators/_utils/project-files');
        P.ensureHouseProject(tree, 'test', P.houseProjectHome(tree, 'functions', 'apps/functions'), { tags: [], targets: HOUSE });
      },
      expect: (tree, t, ctx) => {
        const deploy = t.json('apps/functions/project.json')?.targets?.deploy;
        t.equal(deploy?.options, { command: HOUSE.deploy.options.command, cwd: '{workspaceRoot}', args: '-P prod' }, 'options');
        t.ok(
          ctx.logs.some((l) => l.startsWith('[warn]') && l.includes('functions:deploy') && l.includes('runs') && l.includes('hand-fixed deploy')),
          `the replacement is reported: ${ctx.logs}`,
        );
        t.exists(RECORD);
      },
    },
  ],
};
