// House generator: scaffold a domain's THIN typed, reactive navigation config —
// the per-domain layer of the `bespunky-engineering:typed-reactive-navigation` pattern. The
// reusable kernel (composer, auto-derived navigator, BsNavLink directive, RouteState,
// EventBus, middleware) lives in `navigation-core` (scaffold it once with
// `nx g @bespunky/nx-tools:navigation-core`); this generator emits only what is
// genuinely domain-specific, plugged into that kernel:
//   <fileName>.routes.ts            — the typed route tree (routeConfigFor<Entity>().route(... as const))
//   <fileName>.events.ts            — the entity + event union + a domain EventBus<Event> subclass
//   <fileName>.navigation.ts        — useNavigationX/useNavigationLinks wrappers + the pure
//                                     event->navigator mapper + the binding + provideX()
//   <fileName>-route.selectors.ts   — domain selectors extending RouteState
//   index.ts                        — barrel
//
// The directive, event bus, selectors base and composer are INHERITED from
// navigation-core — never regenerated. Reads its own bundled templates and substitutes
// the standard name tokens via @nx/devkit `names()`, and points the kernel import at the
// workspace's navigation library (found by its `type:navigation` tag) — and, when the domain lives in a
// project, links the kernel TO that project the workspace's way (`_utils/linking`: under `workspaces` that is
// the project's declared dependency on the kernel package; under `paths` the global alias already covers it).
// The developer fills in the real routes, entity and events.
// Generator-first / concentrate complexity.
import { type Tree, names, formatFiles, getProjects } from '@nx/devkit';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { requireLayer } from '../../layers/registry';
import { resolveLibsDir } from '../_utils/workspace-layout';
import { workspaceLinking } from '../_utils/linking';
import { findNavigationLibrary } from '../navigation-core/generator';

interface DomainNavigationSchema {
  name: string;
  directory?: string;
}

// template file -> output filename builder (given the kebab fileName)
const TEMPLATES: ReadonlyArray<readonly [string, (fileName: string) => string]> = [
  ['routes.ts.tpl', (f) => `${f}.routes.ts`],
  ['events.ts.tpl', (f) => `${f}.events.ts`],
  ['navigation.ts.tpl', (f) => `${f}.navigation.ts`],
  ['route.selectors.ts.tpl', (f) => `${f}-route.selectors.ts`],
  ['index.ts.tpl', () => `index.ts`],
];

export default async function domainNavigationGenerator(
  tree: Tree,
  options: DomainNavigationSchema
): Promise<void> {
  requireLayer(tree, 'angular', 'domain-navigation');

  if (!options.name) {
    throw new Error('domain-navigation generator requires --name (the domain name, e.g. orders).');
  }
  const n = names(options.name);
  // Where THIS workspace keeps libraries — never a hard-coded `libs/`.
  const baseDir = (options.directory ?? `${resolveLibsDir(tree)}/${n.fileName}/src/lib`).replace(/\/+$/, '');
  // The kernel's import path, when the workspace has the kernel: the templates import `@navigation-core`, a
  // placeholder the developer had to repoint by hand on every domain.
  const kernel = linkKernel(tree, baseDir);
  const target = `${baseDir}/navigation`;

  for (const [tpl, outName] of TEMPLATES) {
    const raw = readFileSync(join(__dirname, 'files', tpl), 'utf8');
    const content = raw
      .split('{{className}}')
      .join(n.className)
      .split('{{propertyName}}')
      .join(n.propertyName)
      .split('{{constantName}}')
      .join(n.constantName)
      .split('{{fileName}}')
      .join(n.fileName)
      .split("'@navigation-core'")
      .join(`'${kernel ?? '@navigation-core'}'`);
    tree.write(`${target}/${outName(n.fileName)}`, content);
  }

  await formatFiles(tree);
}

/**
 * The navigation kernel's import specifier — what this workspace imports it by (its linking's answer) — or null
 * when the workspace has no kernel. When the domain's files land inside a project, the kernel is linked to that
 * project as its consumer, so a package-based workspace declares the dependency the new imports need.
 */
function linkKernel(tree: Tree, domainDir: string): string | null {
  const kernelRoot = findNavigationLibrary(tree);
  if (!kernelRoot) return null;
  const linking = workspaceLinking(tree);
  const importPath = linking.importPathOf(tree, kernelRoot);
  if (!importPath) return null;
  const consumerRoot = projectContaining(tree, domainDir);
  if (consumerRoot && consumerRoot !== kernelRoot) linking.link(tree, { importPath, libRoot: kernelRoot, consumerRoot });
  return importPath;
}

/** The deepest project whose root contains `dir` (project roots nest), or undefined. The root project never counts. */
function projectContaining(tree: Tree, dir: string): string | undefined {
  return [...getProjects(tree).values()]
    .map((project) => project.root)
    .filter((root) => root !== '.' && root !== '' && (dir === root || dir.startsWith(`${root}/`)))
    .sort((a, b) => b.length - a.length)[0];
}
