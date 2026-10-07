// STACK IDENTITY — where a running dev stack's identity lives in Nx, and the port table its runtime reads.
//
// Silent if wrong: a continuous `serve`, dev-server leaf or emulator target makes a second stack of one tree WAIT on
// the first (Nx shares one continuous task per workspace) — and a continuous `serve` reports a dead stack as
// succeeded; an ABSENT `continuous` is filled by Nx from targetDefaults or the executor schema, so it must be written
// `false`; a runtime port module that disagrees with the generator's table shifts the suite onto ports the engine
// never checked.
import { requireFromRepo } from '../../test-support/payload.mjs';
import { workspace } from '../workspaces.mjs';

const { addProjectConfiguration, readProjectConfiguration } = requireFromRepo('@nx/devkit');

export default {
  name: 'stack identity · serve is its own stack, dev-stack the shared one, the runtime port table',
  cases: [
    {
      // serve-options must reach BOTH engine targets: `serve` (what is typed) and `dev-stack` (what e2e depends on).
      name: 'serve-options puts host on the dev-server leaf, serve and dev-stack',
      setup: () => {
        const tree = workspace();
        addProjectConfiguration(tree, 'site', { root: 'apps/site', targets: { 'dev-server': { executor: 'nx:run-commands', options: { command: 'x', port: 4300 } } } });
        return tree;
      },
      run: async (tree, ctx) => {
        await ctx.load('generators/serve/generator').default(tree, { project: 'site' });
        await ctx.load('generators/serve-options/generator').default(tree, { project: 'site', host: '0.0.0.0' });
      },
      expect: (tree, t) => {
        const targets = readProjectConfiguration(tree, 'site').targets;
        t.equal([targets['dev-server'].options.host, targets.serve.options?.host, targets['dev-stack'].options?.host], ['0.0.0.0', '0.0.0.0', '0.0.0.0'], 'host on the leaf, serve and dev-stack');
      },
    },
    {
      name: 'serve is the engine, explicitly NOT continuous; dev-stack its continuous twin; both mirror the leaf, no dependsOn',
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
        const mirror = { options: targets['dev-server'].options };
        t.equal(targets.serve, { continuous: false, executor: '@bespunky/nx-tools:serve', cache: false, ...mirror }, 'serve: the engine, continuous: false written out, uncached');
        t.equal(targets['dev-stack'], { continuous: true, executor: '@bespunky/nx-tools:serve', ...mirror }, 'dev-stack: the same, continuous (e2e shares the running stack)');
        t.ok(!('serve-preflight' in targets), 'no preflight target');
      },
    },
    {
      name: 'the emulator targets are explicitly not continuous; tools/emulator-ports.mjs carries the generator’s table',
      setup: () => workspace(),
      run: async (tree, ctx) => {
        await ctx.load('generators/firebase-emulators/generator').default(tree, { workspaceName: 'acme' });
        ctx.ports = ctx.load('generators/firebase-emulators/emulator-ports');
      },
      expect: async (tree, t, ctx) => {
        const targets = readProjectConfiguration(tree, 'firebase').targets;
        for (const name of ['emulators', 'emulators:auth', 'emulators:functions']) t.ok(targets[name].continuous === false, `${name} is continuous: false`);
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
        // D9: an UNDECLARED websocketPort is firebase-tools' 9150, not a floating port — every shifted suite sat on it.
        t.ok(fb.emulators.firestore.websocketPort === undefined && generator.includes(9150), 'the undeclared Firestore websocket (9150) is an occupied port');
        t.ok(shifted.emulators.firestore.websocketPort === 9150 + 6000, `a shifted suite pins it shifted (got ${shifted.emulators.firestore.websocketPort})`);
      },
    },
  ],
};
