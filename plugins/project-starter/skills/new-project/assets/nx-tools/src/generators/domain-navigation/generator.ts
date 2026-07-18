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
// the standard name tokens via @nx/devkit `names()`. The developer fills in the real
// routes, entity, events, and points the `@navigation-core` import at their lib.
// Generator-first / concentrate complexity.
import { type Tree, names, formatFiles } from '@nx/devkit';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
  if (!options.name) {
    throw new Error('domain-navigation generator requires --name (the domain name, e.g. orders).');
  }
  const n = names(options.name);
  const baseDir = (options.directory ?? `libs/${n.fileName}/src/lib`).replace(/\/+$/, '');
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
      .join(n.fileName);
    tree.write(`${target}/${outName(n.fileName)}`, content);
  }

  await formatFiles(tree);
}
