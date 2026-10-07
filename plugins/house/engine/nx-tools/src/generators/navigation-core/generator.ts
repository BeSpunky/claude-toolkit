// House generator: scaffold the self-contained `navigation-core` kernel — the reusable base that domain-specific
// navigation builds on (the engineering:typed-reactive-navigation pattern).
//
// The composer + auto-derived navigator are VENDORED VERBATIM from BeSpunky's navigation-x
// (@bespunky/angular-zen/router-x/navigation): routeConfigFor / provideRouterX / useNavigationX / RouteComposer /
// strong Router typing. On top sit BeSpunky reusable additions (extras/) navigation-x doesn't yet ship — the
// real-href link directive, the URL read-side, a typed event bus + binding, and middleware.
//
// A REAL LIBRARY, created through the Angular adapter's `libs` port (a workspace-internal library — buildable,
// linted, tested, and linked the way the workspace links: a path alias, or a workspace package) and tagged
// `type:navigation`, which is how the `navigation` layer finds it. It used to be loose files dropped at `libs/navigation-core/src` with no project, no tag and a hard-coded
// `libs/`: invisible to Nx, and found by the layer only if someone hand-made a project with exactly that name.
// The library lands where THIS workspace keeps libraries (resolveLibsDir).
//
// Re-runnable: an existing navigation library (found by its tag) gets the kernel rewritten in place — the files
// are vendored, so they are owned, byte-for-byte, never formatted.
import { type Tree, type GeneratorCallback, getProjects } from '@nx/devkit';
import { declareDependencies } from '../_utils/dependencies';
import { TYPESCRIPT_UTILS_VERSION } from '../_utils/versions';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { requireLayer } from '../../layers/registry';
import { NAVIGATION_TAG } from '../../layers/navigation';
import { adapter } from '../../adapters/registry';
import { resolveLibsDir, resolveWorkspaceScope } from '../_utils/workspace-layout';

interface NavigationCoreSchema {
  /** The library (and project) name. Default `navigation-core`. */
  name?: string;
  /** The library's directory. Default `<libs-dir>/<name>`. */
  directory?: string;
  /** The import path. Default `@<workspace-scope>/<name>`. */
  importPath?: string;
}

const noop: GeneratorCallback = () => {};

export default async function navigationCoreGenerator(
  tree: Tree,
  options: NavigationCoreSchema = {}
): Promise<GeneratorCallback> {
  // The kernel is Angular source (inject(), signals, Router): without the Angular layer it would compile nowhere,
  // and the failure would surface later, as a build error, far from the command that caused it.
  requireLayer(tree, 'angular', 'navigation-core');

  let root = findNavigationLibrary(tree);
  let callback = noop;
  if (!root) {
    const name = options.name ?? 'navigation-core';
    root = options.directory ?? `${resolveLibsDir(tree)}/${name}`;
    callback = await adapter('angular').libs!.create(tree, {
      name,
      directory: root,
      importPath: options.importPath ?? `@${resolveWorkspaceScope(tree)}/${name}`,
      publishable: false,
      style: 'none',
      tags: `${NAVIGATION_TAG},platform:web`,
    });
    // The base generator's demo component is not part of the kernel.
    if (tree.exists(`${root}/src/lib`)) tree.delete(`${root}/src/lib`);
  }

  const filesDir = join(__dirname, 'files');
  for (const abs of walk(filesDir)) {
    const rel = relative(filesDir, abs).replace(/\.tpl$/, '').split('\\').join('/');
    // Vendored verbatim — written byte-for-byte, never formatted.
    tree.write(`${root}/src/${rel}`, readFileSync(abs, 'utf8'));
  }

  // The vendored navigation-x kernel imports type utilities from this package.
  const install = declareDependencies(tree, 'navigation-core', { '@bespunky/typescript-utils': TYPESCRIPT_UTILS_VERSION });
  return () => {
    callback();
    install();
  };
}

/** The root of the workspace's navigation library — the project tagged `type:navigation` — or null. */
export function findNavigationLibrary(tree: Tree): string | null {
  for (const [, project] of getProjects(tree)) {
    if (project.tags?.includes(NAVIGATION_TAG)) return project.root;
  }
  return null;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.tpl')) out.push(p);
  }
  return out;
}
