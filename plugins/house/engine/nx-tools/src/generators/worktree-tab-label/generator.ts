// House generator: the dev-only worktree tab label — the ANGULAR adapter's half of the worktree dev loop.
//
// When several worktrees are served at once they share one browser and open as look-alike tabs. On a
// `<slug>.localhost` worktree domain this prefixes the tab title with `[slug]` and tints the favicon by a hue
// hashed from the slug. The mechanism is plain DOM, but the way it gets INTO an app is a framework's: here, an
// Angular environment initializer wired into `app.config.ts`, tree-shaken from prod via ngDevMode.
//
// It used to be written by the `serve` generator — the generic composer — which is how an Angular source file
// came to be gated inside a framework-agnostic generator. It is the Angular adapter's now (the `angular`
// layer's per-app step, and the house `app` generator for a new app).
//
// Two writes, two classes:
//   - worktree-tab-label.ts — generator-owned glue, rewritten every run.
//   - the provider in app.config.ts — app.config.ts is SEEDED, never owned: wired only with --wireProviders
//     (when the layer is being created), never on a detect-only sync.
// No app.config.ts (not an Angular application) → nothing to do.
import { type Tree, formatFiles, logger, readProjectConfiguration } from '@nx/devkit';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { requireLayer } from '../../layers/registry';
import { wireProvider } from '../_utils/wire-provider';
import { workspaceIdentity } from '../_utils/workspace-identity';
import { toDnsLabel } from '../_utils/dns-label';

interface WorktreeTabLabelSchema {
  project: string;
  /** Wire provideWorktreeTabLabel() into app.config.ts — a BASELINE act, never a sync-time one. */
  wireProviders?: boolean;
  /** The workspace's name; the main tree is served at `<toDnsLabel(workspaceName)>.localhost`. Defaults to the workspace identity. */
  workspaceName?: string;
}

export default async function worktreeTabLabelGenerator(tree: Tree, options: WorktreeTabLabelSchema): Promise<void> {
  requireLayer(tree, 'angular', 'worktree-tab-label');
  const workspaceName = options.workspaceName ?? workspaceIdentity(tree);
  const appRoot = readProjectConfiguration(tree, options.project).root;
  const appConfigPath = `${appRoot}/src/app/app.config.ts`;
  if (!tree.exists(appConfigPath)) return;

  tree.write(
    `${appRoot}/src/app/worktree-tab-label.ts`,
    readFileSync(join(__dirname, 'files', 'worktree-tab-label.ts.tpl'), 'utf8').split('{{mainTreeSlug}}').join(toDnsLabel(workspaceName)),
  );

  const current = tree.read(appConfigPath, 'utf8') ?? '';
  const wired = wireProvider(current, appConfigPath, {
    providerFn: 'provideWorktreeTabLabel',
    importFrom: './worktree-tab-label',
    ensuring: options.wireProviders === true,
  });
  if (wired && wired !== current) {
    tree.write(appConfigPath, wired);
  } else if (wired === null) {
    logger.warn(
      `[worktree-tab-label] Could not auto-wire ${appConfigPath}. Add ` +
        `\`import { provideWorktreeTabLabel } from './worktree-tab-label';\` and include ` +
        `\`provideWorktreeTabLabel()\` in your providers array manually (dev-only tab label).`,
    );
  }
  await formatFiles(tree);
}
