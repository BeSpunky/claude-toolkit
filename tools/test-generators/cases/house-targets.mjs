// HOUSE TARGETS ARE SHARED GROUND — an upgrade re-asserts the house's targets by a three-way merge against a record
// of what it last wrote (_utils/house-targets.ts). The promise these cases hold it to: a developer's (or Claude's)
// edit inside a house target survives every upgrade that does not change the same key, and an upgrade that does
// replace one SAYS SO. Before this, a hand-added input or `args` on `functions:deploy` vanished silently.
import { requireFromRepo } from '../../test-support/payload.mjs';
import { workspace } from '../workspaces.mjs';

const { getProjects } = requireFromRepo('@nx/devkit');
const RECORD = '.bespunky/house-targets.json';

const HOUSE = {
  deploy: {
    executor: 'nx:run-commands',
    dependsOn: ['build', 'lint'],
    inputs: ['default', '{workspaceRoot}/firebase.json'],
    options: { command: 'firebase deploy --only functions', cwd: '{workspaceRoot}' },
  },
};

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

export default {
  name: 'house targets · the three-way merge',
  cases: [
    pure(
      'no record: a value the last record-less release (0.49.2) wrote is the house\'s own — replaced silently; a hand value is still reported',
      (merge) => {
        const before = { deploy: { executor: 'nx:run-commands', options: { command: 'firebase deploy --only functions', cwd: '{workspaceRoot}' } } };
        const now = { deploy: { executor: 'nx:run-commands', options: { command: 'node tools/firebase-deploy.mjs', cwd: '{workspaceRoot}' } } };
        const stock = JSON.parse(JSON.stringify(before));
        const edited = { deploy: { ...stock.deploy, options: { ...stock.deploy.options, cwd: 'apps/functions' } } };
        return { stock: merge(stock, now, undefined, before), blind: merge(stock, now, undefined), edited: merge(edited, now, undefined, before) };
      },
      (t, { stock, blind, edited }) => {
        t.equal(stock.overrides, [], 'the house\'s own old value: no report');
        t.equal(stock.targets.deploy.options.command, 'node tools/firebase-deploy.mjs', 'and it is replaced');
        t.equal(blind.overrides.length, 1, 'without the 0.49.2 base it WOULD cry wolf (the regression this guards)');
        t.equal(edited.overrides.map((o) => o.key), ['options.cwd'], 'exactly the hand edit is reported');
      },
    ),
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
          HOUSE,
        ),
      (t, { targets, overrides }) => {
        t.equal(targets.deploy.inputs, [...HOUSE.deploy.inputs, '{workspaceRoot}/firestore.rules'], 'the added input');
        t.equal(targets.deploy.options.args, '--force', 'the added option');
        t.equal(targets.deploy.configurations, { staging: { args: '-P staging' } }, 'the added configuration');
        t.ok(targets.mine, 'the project\'s own target');
        t.equal(overrides, [], 'nothing replaced');
      },
    ),
    pure(
      'an edit the house did not change is kept; one the house also changed takes the house\'s value — reported',
      (merge) =>
        merge(
          { deploy: { ...HOUSE.deploy, options: { command: 'my deploy', cwd: 'mine' } } },
          { deploy: { ...HOUSE.deploy, options: { ...HOUSE.deploy.options, command: 'firebase deploy --only functions --force' } } },
          HOUSE,
        ),
      (t, { targets, overrides }) => {
        t.equal(targets.deploy.options.cwd, 'mine', 'cwd: edited by the project only — kept');
        t.equal(targets.deploy.options.command, 'firebase deploy --only functions --force', 'command: both changed — the house wins');
        t.equal(
          overrides.map((o) => [o.target, o.key, o.was, o.conflict]),
          [['deploy', 'options.command', 'my deploy', true]],
          'the conflict is reported, with the value it replaced',
        );
      },
    ),
    pure(
      'the house drops a key nobody touched → gone; a set element the project removed stays removed; a new one arrives',
      (merge) =>
        merge(
          { deploy: { ...HOUSE.deploy, dependsOn: ['build'] } },
          {
            deploy: {
              executor: 'nx:run-commands',
              dependsOn: ['build', 'lint', 'typecheck'],
              inputs: HOUSE.deploy.inputs,
              options: { command: HOUSE.deploy.options.command },
            },
          },
          HOUSE,
        ),
      (t, { targets, overrides }) => {
        t.ok(!('cwd' in targets.deploy.options), `the dropped cwd is gone: ${JSON.stringify(targets.deploy.options)}`);
        t.equal(targets.deploy.dependsOn, ['build', 'typecheck'], 'lint stays removed, typecheck arrives');
        t.equal(overrides, [], 'nothing replaced');
      },
    ),
    pure(
      'no record: house-declared keys take the house\'s value (said aloud), undeclared keys are kept',
      (merge) =>
        merge(
          { deploy: { executor: 'nx:run-commands', dependsOn: ['build'], inputs: ['{workspaceRoot}/x'], options: { command: 'old', cwd: '{workspaceRoot}', args: 'a' } } },
          HOUSE,
          undefined,
        ),
      (t, { targets, overrides }) => {
        t.equal(targets.deploy.options, { command: HOUSE.deploy.options.command, cwd: '{workspaceRoot}', args: 'a' }, 'options');
        t.equal(targets.deploy.dependsOn, ['build', 'lint'], 'dependsOn: the house\'s set, nothing removed without a record');
        t.equal(targets.deploy.inputs, ['{workspaceRoot}/x', ...HOUSE.deploy.inputs], 'inputs: the project\'s entry kept, in its place; the house\'s arrive after');
        t.equal(overrides.map((o) => [o.key, o.was, o.conflict]), [['options.command', 'old', false]], 'reported, as unknowable');
      },
    ),
    ...['paths', 'workspaces-npm'].map((link) => ({
      name: `${link}: hand edits to a house target survive an upgrade, silently — and the record is kept`,
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
        t.equal(t.json(RECORD)?.projects?.functions, HOUSE, 'the record holds what the house wrote, not the merge');
        t.equal(ctx.logs, [], 'nothing replaced, nothing said');
      },
    })),
    {
      name: 'the first upgrade with no record replaces a differing house value and SAYS so; keeps the project\'s keys',
      setup: () => {
        const tree = workspace();
        tree.write(
          'apps/functions/project.json',
          JSON.stringify({
            name: 'functions',
            root: 'apps/functions',
            targets: { deploy: { executor: 'nx:run-commands', dependsOn: ['build'], options: { command: 'hand-fixed deploy', cwd: '{workspaceRoot}', args: '-P prod' } } },
          }),
        );
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
          ctx.logs.some((l) => l.startsWith('[warn]') && l.includes('functions:deploy') && l.includes('options.command') && l.includes('hand-fixed deploy')),
          `the replacement is reported: ${ctx.logs}`,
        );
        t.exists(RECORD);
      },
    },
  ],
};
