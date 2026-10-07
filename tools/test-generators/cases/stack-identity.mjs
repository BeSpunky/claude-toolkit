// STACK IDENTITY — where a running dev stack's identity lives in Nx, and the port table its runtime reads.
//
// Silent if wrong: a continuous dev-server leaf or emulator target makes a second stack of one tree WAIT on the first
// (Nx shares one continuous task per workspace); a composer without its preflight lets a second `nx serve` wait and
// then report a success it never had; a runtime port module that disagrees with the generator's table shifts the
// suite onto ports the engine never checked.
import { requireFromRepo } from '../../test-support/payload.mjs';
import { workspace } from '../workspaces.mjs';

const { addProjectConfiguration, readProjectConfiguration } = requireFromRepo('@nx/devkit');

export default {
  name: 'stack identity · one level of continuity, the preflight, the runtime port table',
  cases: [
    {
      name: 'the composer is continuous and depends on its preflight; a stack leaf is not continuous',
      setup: () => {
        const tree = workspace();
        addProjectConfiguration(tree, 'site', { root: 'apps/site', targets: { 'dev-server': { executor: 'nx:run-commands', options: { command: 'x', port: 4300 } } } });
        return tree;
      },
      run: async (tree, ctx) => {
        await ctx.load('generators/serve/generator').default(tree, { project: 'site' });
      },
      expect: (tree, t) => {
        const targets = readProjectConfiguration(tree, 'site').targets;
        t.ok(targets.serve.continuous === true, 'the composer stays continuous (e2e shares the running stack)');
        t.equal(targets.serve.dependsOn, [{ target: 'serve-preflight', params: 'forward' }], 'serve depends on its preflight, flags forwarded');
        t.equal(targets['serve-preflight'], { executor: '@bespunky/nx-tools:serve-preflight', cache: false }, 'the preflight target');
      },
    },
    {
      name: 'the emulator targets are not continuous; tools/emulator-ports.mjs carries the generator’s table',
      setup: () => workspace(),
      run: async (tree, ctx) => {
        await ctx.load('generators/firebase-emulators/generator').default(tree, { workspaceName: 'acme' });
        ctx.ports = ctx.load('generators/firebase-emulators/emulator-ports');
      },
      expect: async (tree, t, ctx) => {
        const targets = readProjectConfiguration(tree, 'firebase').targets;
        for (const name of ['emulators', 'emulators:auth', 'emulators:functions']) t.ok(targets[name].continuous === undefined, `${name} is not continuous`);
        const src = t.read('tools/emulator-ports.mjs');
        t.ok(!src.includes('{{SUITE}}'), 'the table is projected in');
        const mod = await import(`data:text/javascript,${encodeURIComponent(src)}`);
        t.equal(mod.SUITE.defaults.hub, 4400, 'the runtime reads the same defaults');
        const fb = t.json('firebase.json');
        const runtime = Object.values(mod.suitePorts(fb.emulators)).sort();
        const generator = Object.values(ctx.ports.emulatorPorts(tree)).sort();
        t.equal(runtime, generator, 'runtime and generator agree on every occupied port');
        const shifted = mod.shiftConfig(fb, 6000);
        t.equal(Object.values(mod.suitePorts(shifted.emulators)).sort(), generator.map((p) => p + 6000).sort(), 'the shift moves exactly those ports');
      },
    },
    {
      name: 'serve-preflight: silent with no holder, attaches on a plain repeat, refuses a different stack',
      setup: () => workspace(),
      run: async (tree, ctx) => {
        ctx.preflight = ctx.load('executors/serve-preflight/executor').preflight;
      },
      expect: (tree, t, ctx) => {
        const holder = { key: 'web@0', app: 'web', offset: 0, pid: 42, owner: 'user:node', url: 'http://localhost:4200/', tree: '/repo', treeLabel: 'main [main]', startedAt: 'now', state: 'live', nxRoot: '/repo' };
        t.ok(ctx.preflight('web', {}, []) === null, 'nothing running: silent');
        const attach = ctx.preflight('web', {}, [holder]);
        t.ok(attach && !attach.refuse && /ATTACHES/.test(attach.message) && attach.message.includes('pid 42'), `plain repeat attaches: ${attach?.message}`);
        t.ok(!ctx.preflight('web', { portOffset: 'auto' }, [holder]).refuse, 'auto is not a different stack');
        t.ok(!ctx.preflight('web', { portOffset: 0 }, [holder]).refuse, 'the same offset attaches');
        const other = ctx.preflight('web', { portOffset: 3000 }, [holder]);
        t.ok(other.refuse && other.message.includes('tools/dev/dev serve web --port-offset=3000') && other.message.includes('tools/dev/dev stop web --offset=0'), `a different offset is refused with both commands: ${other.message}`);
        t.ok(ctx.preflight('web', { worktree: 'feat/x' }, [holder]).refuse, 'another worktree is refused');
      },
    },
  ],
};
