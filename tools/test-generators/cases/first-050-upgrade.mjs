// THE FIRST 0.50 UPGRADE LEAVES NO RETIRED KEY BEHIND. 0.50.0 made house targets a three-way merge against a record
// (`.bespunky/house-targets.json`) — and every existing project meets it WITHOUT a record, where a key the house no
// longer declares cannot be told from one the project added, so it is kept. Every key a 0.50 change DROPPED from a
// house-owned shape is therefore only gone if the generator's re-assertion removes it or a 0.50.0 rung does:
//   - `continuous` on firebase:emulators* (and the dev-server leaf)  → rung stack-owned-dev-processes
//   - functions:build's `.env` asset (configDir reads params in place) → rung read-functions-params-in-place
//   - firebase.json functions[0].predeploy (Nx builds through deploy) → the generator (the block is re-asserted whole)
// This case builds the 0.49 shape (current output + every retired key, no record), runs the 0.50.0 rungs and then
// the generator — the upgrade's own order — and asserts none of them survives.
import { requireFromRepo } from '../../test-support/payload.mjs';
import { workspace, SCOPE } from '../workspaces.mjs';

const { readProjectConfiguration, updateProjectConfiguration, updateJson } = requireFromRepo('@nx/devkit');
const RECORD = '.bespunky/house-targets.json';
const RUNGS = ['migrations/0.50.0/stack-owned-dev-processes', 'migrations/0.50.0/read-functions-params-in-place'];
const generate = (tree, ctx) => ctx.load('generators/firebase-emulators/generator').default(tree, { workspaceName: SCOPE });

/** A project exactly as 0.49.2 left it: its house targets are the frozen 0.49.2 output, and there is no record. */
const stock0492 = async (ctx, handEdit = () => undefined) => {
  const tree = workspace();
  await generate(tree, ctx); // the files a 0.49 project has
  tree.delete(RECORD);
  const { HOUSE_TARGETS_AS_OF_0_49_2: before } = ctx.load('generators/_utils/house-targets-0.49.2');
  for (const name of ['functions', 'firebase']) {
    const config = readProjectConfiguration(tree, name);
    config.targets = JSON.parse(JSON.stringify(before[name]));
    updateProjectConfiguration(tree, name, config);
  }
  handEdit(tree);
  return tree;
};
const upgrade = async (tree, ctx) => {
  for (const rung of RUNGS) await ctx.load(rung).default(tree);
  await generate(tree, ctx);
};
/** What the house-targets merge reported as replaced (describeOverride's two forms). */
const overrides = (logs) => logs.filter((line) => line.startsWith('[warn]') && /the house's (?:new |value is )/.test(line));

export default {
  name: 'the first 0.50 upgrade · retired keys in house-owned shapes',
  cases: [
    {
      name: 'a 0.49 Firebase project with no record: continuous, the .env asset and predeploy are all gone',
      setup: () => workspace(),
      run: async (tree, ctx) => {
        if (!ctx.aged) {
          await generate(tree, ctx);
          // Age it to the 0.49 shape: no record, and every key 0.50 retired.
          tree.delete(RECORD);
          const suite = readProjectConfiguration(tree, 'firebase');
          for (const [name, target] of Object.entries(suite.targets)) {
            if (String(target.options?.command ?? '').includes('tools/emulators.sh')) target.continuous = true;
          }
          updateProjectConfiguration(tree, 'firebase', suite);
          const functions = readProjectConfiguration(tree, 'functions');
          functions.targets.build.options.assets = [{ glob: '.env', input: functions.root, output: '.' }];
          updateProjectConfiguration(tree, 'functions', functions);
          updateJson(tree, 'firebase.json', (json) => {
            json.functions[0].predeploy = ['npx --no-install nx build functions'];
            return json;
          });
          ctx.aged = true;
        }
        for (const rung of RUNGS) await ctx.load(rung).default(tree);
        await generate(tree, ctx);
      },
      expect: (tree, t) => {
        const suite = readProjectConfiguration(tree, 'firebase').targets;
        const launchers = Object.entries(suite).filter(([, target]) => String(target.options?.command ?? '').includes('tools/emulators.sh'));
        t.ok(launchers.length > 0, 'the suite has launchers');
        t.ok(launchers.every(([, target]) => target.continuous === undefined), `continuous survived: ${launchers.filter(([, x]) => x.continuous).map(([n]) => n)}`);
        const build = readProjectConfiguration(tree, 'functions').targets.build;
        t.ok(!('assets' in build.options), `the .env asset survived: ${JSON.stringify(build.options.assets)}`);
        const fn = t.json('firebase.json').functions[0];
        t.ok(!('predeploy' in fn), `predeploy survived: ${JSON.stringify(fn)}`);
        t.ok(typeof fn.configDir === 'string', 'configDir is declared');
        t.exists(RECORD);
      },
    },
    {
      name: 'a STOCK 0.49.2 project upgraded once: every value the house changed is its own — no override reported',
      setup: (ctx) => stock0492(ctx),
      run: upgrade,
      expect: (tree, t, ctx) => {
        t.equal(overrides(ctx.logs), [], 'no false alarm');
        t.exists(RECORD);
      },
    },
    {
      name: 'the same project with ONE real hand edit: exactly that one is reported',
      setup: (ctx) =>
        stock0492(ctx, (tree) => {
          const functions = readProjectConfiguration(tree, 'functions');
          functions.targets.deploy.options.cwd = 'apps/functions';
          updateProjectConfiguration(tree, 'functions', functions);
        }),
      run: upgrade,
      expect: (tree, t, ctx) => {
        const said = overrides(ctx.logs);
        t.equal(said.length, 1, `one report: ${said}`);
        t.ok(said[0]?.includes('functions:deploy') && said[0]?.includes('options.cwd') && said[0]?.includes('apps/functions'), `the hand edit: ${said}`);
      },
    },
  ],
};
