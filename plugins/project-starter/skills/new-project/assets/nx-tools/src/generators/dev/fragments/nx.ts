// The Nx face of the dev loop: a project's `dev-server` TARGET, run through the workspace's own nx.
//
// The process drives the target by NAME and never learns what produced it — Angular's dev-server, Vite's, any
// executor that takes `--port`. Its base port is the target's own `port` option, else the default of the stack
// that owns the project (`DevServerPort.basePort` — Angular's 4200). A dev-server neither names a port nor
// belongs to a stack the house knows has no base port anyone could state honestly, so it is REPORTED, not
// declared on a guessed number: the project declares it in `.bespunky/dev.json` (or sets the target's `port`).
//
// The two env vars are the Nx adapter's, not the engine's: NX_WORKSPACE_ROOT_PATH pins nx to the SERVED tree
// (the daemon caches one workspace root across trees and would otherwise serve the main tree's source), and
// NX_DAEMON=false stops that daemon cross-talking between trees.
//
// On a Node host the fragment also declares how a fresh worktree is installed (worktrees start without
// node_modules) — decided once, here, from the workspace's own package manager, instead of guessed per serve.
import { type Tree, readProjectConfiguration } from '@nx/devkit';
import { PACKAGE_MANAGERS } from '../../_utils/package-manager';
import { nxInvocation } from '../../_utils/nx-host';
import { adapterOf } from '../../../adapters/registry';
import type { DevFragment } from '../declaration';

export const DEV_SERVER_TARGET = 'dev-server';

export const NX_TREE_ENV = { NX_DAEMON: 'false', NX_WORKSPACE_ROOT_PATH: '${TREE}' };

export function nxDevServerFragment(tree: Tree, project: string): DevFragment {
  let target: { options?: { port?: unknown } } | undefined;
  try {
    target = readProjectConfiguration(tree, project).targets?.[DEV_SERVER_TARGET];
  } catch {
    return { processes: [] };
  }
  if (!target || typeof target !== 'object') return { processes: [] };

  const declared = Number(target.options?.port);
  const base = Number.isInteger(declared) && declared > 0 ? declared : adapterOf(tree, project)?.devServer?.basePort;
  if (base === undefined) {
    return {
      processes: [],
      skipped:
        `NOT declaring ${project}'s dev-server: its \`${DEV_SERVER_TARGET}\` target names no \`port\` and no registered ` +
        `stack owns it, so its base port is unknown. Set \`port\` on the target, or declare the app in .bespunky/dev.json.`,
    };
  }
  const { bin, nodeHost, packageManager } = nxInvocation(tree);
  return {
    processes: [
      {
        id: 'app',
        cmd: [bin, 'run', `${project}:${DEV_SERVER_TARGET}`, '--port=${PORT:app}'],
        env: { ...NX_TREE_ENV },
        ports: { app: base },
        primary: true,
        ready: { http: '/' },
      },
    ],
    install:
      nodeHost && packageManager
        ? { cmd: PACKAGE_MANAGERS[packageManager].install.split(' '), creates: 'node_modules' }
        : undefined,
  };
}
