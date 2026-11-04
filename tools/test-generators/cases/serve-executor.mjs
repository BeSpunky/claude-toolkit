// THE SERVE EXECUTOR'S AGENT GUARD, on each host. Nx renders an agent's run as `summary`, which shows nothing of a serve until it
// ends, so `nx serve` is refused at once. Whether Nx has that renderer is read from the installed Nx, and a wrapper host keeps Nx
// in `.nx/installation`, not at the root: reading only the root made the guard silently never fire there.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { workspace } from '../workspaces.mjs';

const fakeWorkspace = (nxHome) => {
  const root = mkdtempSync(join(tmpdir(), 'serve-executor-'));
  mkdirSync(join(root, 'tools/dev'), { recursive: true });
  writeFileSync(join(root, 'tools/dev/dev.mjs'), 'process.exit(0);\n');
  const nx = join(root, nxHome, 'node_modules/nx');
  mkdirSync(join(nx, 'src/tasks-runner/life-cycles'), { recursive: true });
  writeFileSync(join(nx, 'package.json'), '{ "name": "nx", "version": "23.3.0" }\n');
  writeFileSync(join(nx, 'src/tasks-runner/life-cycles/summary-terminal-output-life-cycle.js'), '');
  return root;
};

const underAgent = async (ctx, nxHome, env = {}) => {
  const root = fakeWorkspace(nxHome);
  const names = ['CLAUDECODE', 'NX_STREAM_OUTPUT', 'NX_TUI', 'NX_DEFAULT_OUTPUT_STYLE'];
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  for (const name of names) delete process.env[name];
  Object.assign(process.env, { CLAUDECODE: '1' }, env);
  try {
    return await ctx.load('executors/serve/executor').default({ project: 'site', dryRun: false }, { root, projectName: 'site', targetName: 'serve', target: {} });
  } finally {
    for (const name of names) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
    rmSync(root, { recursive: true, force: true });
  }
};

const once = 'it spawns nothing on a Tree; the workspace is a throwaway directory';
const refused = (t, ctx) => t.ok(ctx.result?.success === false && ctx.logs.some((line) => line.includes('Refused: under an AI agent')), ctx.logs.join(' | '));

export default {
  name: 'serve executor · the agent guard, on each host',
  cases: [
    { name: 'a node host: refused', once, setup: () => workspace(), run: async (_t, ctx) => { ctx.result = await underAgent(ctx, '.'); }, expect: (_t, t, ctx) => refused(t, ctx) },
    { name: 'a wrapper host, Nx in .nx/installation: refused', once, setup: () => workspace(), run: async (_t, ctx) => { ctx.result = await underAgent(ctx, '.nx/installation'); }, expect: (_t, t, ctx) => refused(t, ctx) },
    {
      name: 'a wrapper host with a streaming default: not refused, the engine runs',
      once,
      setup: () => workspace(),
      run: async (_t, ctx) => { ctx.result = await underAgent(ctx, '.nx/installation', { NX_DEFAULT_OUTPUT_STYLE: 'stream' }); },
      expect: (_t, t, ctx) => {
        t.ok(!ctx.logs.some((line) => line.includes('Refused')), ctx.logs.join(' | '));
        t.ok(ctx.result?.success === true, 'the stand-in engine exited 0');
      },
    },
  ],
};
