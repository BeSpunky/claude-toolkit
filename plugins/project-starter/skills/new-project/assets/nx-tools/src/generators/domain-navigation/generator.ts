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
// workspace's navigation library (found by its `type:navigation` tag). The developer fills in
// the real routes, entity and events.
// Generator-first / concentrate complexity.
import { type Tree, names, formatFiles, readJson } from '@nx/devkit';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { requireLayer } from '../../layers/registry';
import { resolveLibsDir } from '../_utils/workspace-layout';
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
  const kernel = navigationImportPath(tree);
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

/** The navigation kernel's import specifier — its package name, else the path alias pointing into it. */
function navigationImportPath(tree: Tree): string | null {
  const root = findNavigationLibrary(tree);
  if (!root) return null;
  if (tree.exists(`${root}/package.json`)) {
    const name = readJson<{ name?: string }>(tree, `${root}/package.json`).name;
    if (name) return name;
  }
  for (const tsconfig of ['tsconfig.base.json', 'tsconfig.json']) {
    if (!tree.exists(tsconfig)) continue;
    const paths = readJson<{ compilerOptions?: { paths?: Record<string, string[]> } }>(tree, tsconfig).compilerOptions?.paths ?? {};
    for (const [alias, targets] of Object.entries(paths)) if (targets.some((t) => t.startsWith(`${root}/`))) return alias;
  }
  return null;
}
