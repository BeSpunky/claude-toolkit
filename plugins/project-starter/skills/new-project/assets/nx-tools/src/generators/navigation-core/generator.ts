// House generator: scaffold the self-contained `navigation-core` kernel — the
// reusable base that domain-specific navigation builds on (the engineering:
// typed-reactive-navigation pattern).
//
// The composer + auto-derived navigator are VENDORED VERBATIM from BeSpunky's
// navigation-x (@bespunky/angular-zen/router-x/navigation): routeConfigFor /
// provideRouterX / useNavigationX / RouteComposer / strong Router typing. On top sit
// BeSpunky reusable additions (extras/) navigation-x doesn't yet ship — the real-href
// link directive, the URL read-side, a typed event bus + binding, and middleware.
//
// The kernel is domain-agnostic, so the files carry NO `{{tokens}}` — they are copied
// byte-for-byte (no formatting) to preserve fidelity with upstream navigation-x.
import { type Tree, addDependenciesToPackageJson } from '@nx/devkit';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

interface NavigationCoreSchema {
  directory?: string;
}

export default async function navigationCoreGenerator(
  tree: Tree,
  options: NavigationCoreSchema
): Promise<void> {
  const target = (options.directory ?? 'libs/navigation-core/src').replace(/\/+$/, '');
  const filesDir = join(__dirname, 'files');

  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walk(p));
      else if (p.endsWith('.tpl')) out.push(p);
    }
    return out;
  }

  for (const abs of walk(filesDir)) {
    const rel = relative(filesDir, abs).replace(/\.tpl$/, '').split('\\').join('/');
    // Vendored verbatim — written byte-for-byte, never formatted.
    tree.write(`${target}/${rel}`, readFileSync(abs, 'utf8'));
  }

  // The vendored navigation-x kernel imports type utilities from this package.
  addDependenciesToPackageJson(tree, { '@bespunky/typescript-utils': 'latest' }, {});
}
