// THE DEV ENGINE'S GATE, AND A CAPABILITY WITH NOTHING SERVED.
//
// Any layer that lists the `dev` step may have the engine, and nothing in the generator names one: a new capability
// must get tools/dev by listing the step. And a capability with no served app must get the engine and NOTHING ELSE:
// `.bespunky/dev.json` is the `web` layer's evidence, so seeding one would silently make the project wear a layer it
// never asked for, which would pull in the shared browser and the dev-server tooling on the next upgrade.
//
// The stand-in capability is a real registered layer (`agent`, present on its evidence file) given the two things a
// capability declares, for the length of one case: its `dev` step and its `devFragment`.
import { requireFromRepo } from '../../test-support/payload.mjs';
import { workspace } from '../workspaces.mjs';

const { addProjectConfiguration } = requireFromRepo('@nx/devkit');

const DEV_JSON = '.bespunky/dev.json';
const SERVE = '@bespunky/nx-tools:serve';

/** A dependency, as a capability would contribute it. */
const database = {
  processes: [{ id: 'db', cmd: ['tools/db/launch'], ports: { db: 5432 }, dependency: true, ready: { cmd: 'test -f "${STACK_DIR}/ready"' }, exports: { DATABASE_URL: 'postgres://127.0.0.1:${PORT:db}/app' } }],
};

const AS_CAPABILITY = (ctx) => {
  const descriptor = ctx.load('layers/registry').layer('agent');
  const saved = { generators: descriptor.generators, devFragment: descriptor.devFragment };
  descriptor.generators = { ...descriptor.generators, workspace: [...(descriptor.generators?.workspace ?? []), { generator: 'dev' }] };
  descriptor.devFragment = () => database;
  return () => Object.assign(descriptor, saved);
};

/** Run the generator with the stand-in capability wired, whatever the outcome. */
const runAsCapability = async (tree, ctx) => {
  const restore = AS_CAPABILITY(ctx);
  try {
    await ctx.load('generators/dev/generator').default(tree);
    ctx.web = ctx.load('layers/registry').isPresent(tree, 'web');
  } finally {
    restore();
  }
};

const capabilityWorkspace = () => {
  const tree = workspace();
  tree.write('.vscode/.window-identity.json', '{}\n'); // the agent layer's evidence
  return tree;
};

export default {
  name: 'dev engine · the gate names no layer; a capability with nothing served seeds nothing',
  cases: [
    {
      name: 'a capability that lists the step, with no web and nothing served: the engine, and nothing else',
      setup: capabilityWorkspace,
      run: runAsCapability,
      expect: (tree, t, ctx) => {
        for (const file of ['dev', 'dev.mjs', 'lib/stack.mjs', 'lib/ready.mjs', 'lib/declaration.mjs']) t.ok(tree.exists(`tools/dev/${file}`), `tools/dev/${file} written`);
        t.ok(!tree.exists(DEV_JSON), `${DEV_JSON} is not created: it is the web layer's evidence`);
        t.ok(ctx.web === false, 'the project does not start wearing web');
        t.ok(ctx.logs.join('\n').includes('nothing here is served'), `says what it did not do: ${ctx.logs.join(' | ')}`);
      },
    },
    {
      name: 'with a served app: the capability attaches as a dependency, and the app stays the primary',
      setup: () => {
        const tree = capabilityWorkspace();
        addProjectConfiguration(tree, 'site', {
          root: 'apps/site',
          targets: { serve: { executor: SERVE }, 'dev-server': { executor: 'nx:run-commands', options: { command: 'x', port: 4300 } } },
        });
        return tree;
      },
      run: runAsCapability,
      expect: (tree, t) => {
        const { processes } = JSON.parse(tree.read(DEV_JSON, 'utf8')).apps.site;
        t.equal(processes.map((p) => p.id), ['app', 'db'], 'both declared');
        t.ok(processes[0].primary === true && !processes[1].primary, 'the app stays the primary');
        t.equal(processes[1], database.processes[0], 'the dependency is seeded as declared, whole');
      },
    },
    {
      name: 'a workspace with no layer that lists the step is refused, naming what would bring it',
      once: 'it throws: there is no second state to compare',
      setup: () => workspace(),
      run: async (tree, ctx) => {
        try {
          await ctx.load('generators/dev/generator').default(tree);
        } catch (error) {
          ctx.error = error.message;
        }
      },
      expect: (tree, t, ctx) => {
        t.ok(/\[dev\] needs a layer that brings the dev engine \(.*web.*\)/.test(ctx.error ?? ''), `refused: ${ctx.error}`);
        t.ok(ctx.error.includes('add web with:'), 'with what to do about it');
        t.ok(!tree.exists('tools/dev/dev.mjs'), 'nothing written');
      },
    },
    {
      name: 'the layers that list it today still get it: a project that declares what it serves (web)',
      setup: () => {
        const tree = workspace();
        tree.write(DEV_JSON, '{ "apps": { "site": { "processes": [{ "id": "app", "cmd": "x", "ports": { "app": 8000 } }] } } }\n');
        return tree;
      },
      run: async (tree, ctx) => ctx.load('generators/dev/generator').default(tree),
      expect: (tree, t) => t.ok(tree.exists('tools/dev/dev.mjs'), 'written'),
    },
    {
      name: 'the layers that list it today still get it: a backend-only firebase, seeding nothing',
      setup: () => {
        const tree = workspace();
        tree.write('firebase.json', '{ "emulators": { "auth": { "port": 9099 } } }\n');
        return tree;
      },
      run: async (tree, ctx) => ctx.load('generators/dev/generator').default(tree),
      expect: (tree, t) => {
        t.ok(tree.exists('tools/dev/dev.mjs'), 'written');
        t.ok(!tree.exists(DEV_JSON), 'nothing served, so nothing declared');
      },
    },
  ],
};
