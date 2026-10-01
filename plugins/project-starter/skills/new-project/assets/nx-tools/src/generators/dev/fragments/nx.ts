// The Nx adapter's fragment: a project's `dev-server` TARGET, run through the workspace's own nx.
//
// The process drives the target by NAME and never learns what produced it — Angular's dev-server, Vite's, any
// executor that takes `--port`. Its base port is the target's own `port` option, else 4200 (the Angular and
// Nx dev-server default, which is what every house app has been served on).
//
// The two env vars are the Nx adapter's, not the engine's: NX_WORKSPACE_ROOT_PATH pins nx to the SERVED tree
// (the daemon caches one workspace root across trees and would otherwise serve the main tree's source), and
// NX_DAEMON=false stops that daemon cross-talking between trees.
//
// On a Node host the fragment also declares how a fresh worktree is installed (worktrees start without
// node_modules) — decided once, here, from the workspace's own package manager, instead of guessed per serve.
import { type Tree, readProjectConfiguration } from '@nx/devkit';
import { detectPackageManager } from '../../_utils/package-manager';
import type { DevFragment } from '../declaration';

/** The Angular / Nx dev-server default — the base an app is served on when its target names no port. */
export const DEFAULT_DEV_SERVER_PORT = 4200;
export const DEV_SERVER_TARGET = 'dev-server';

/**
 * How this workspace invokes nx: through its own node_modules on a Node host, through the `./nx` wrapper when
 * Nx is hosted by `.nx/installation` (no package.json).
 */
export function nxInvocation(tree: Tree): { bin: string; nodeHost: boolean } {
  const nxJson = tree.exists('nx.json') ? (JSON.parse(tree.read('nx.json', 'utf8') ?? '{}') as { installation?: unknown }) : {};
  const wrapper = !tree.exists('package.json') || (Boolean(nxJson.installation) && tree.exists('.nx/nxw.js'));
  return wrapper ? { bin: './nx', nodeHost: false } : { bin: 'node_modules/.bin/nx', nodeHost: true };
}

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
  const base = Number.isInteger(declared) && declared > 0 ? declared : DEFAULT_DEV_SERVER_PORT;
  const { bin, nodeHost } = nxInvocation(tree);
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
    install: nodeHost ? { cmd: [detectPackageManager(tree), 'install'], creates: 'node_modules' } : undefined,
  };
}
