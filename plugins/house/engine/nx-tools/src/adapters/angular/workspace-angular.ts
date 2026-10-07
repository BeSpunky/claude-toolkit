// THE WORKSPACE'S ANGULAR — and every choice the adapter makes that depends on its major, in ONE place.
//
// The Angular adapter does not create code for "Angular"; it creates it for the Angular THIS workspace runs, and some
// choices only exist from a given major on. Spread across call sites, each one silently assumed the newest: the
// design-system library asked @nx/angular for `vitest-angular` (Angular 21+), so `new --preset=angular --firebase` —
// which creates on Angular 20, the newest major with a stable @angular/fire — died half-built (0.50.0 review, R1-0).
// So the major is read here, once, and every major-dependent choice is a function of it here. Adding one: a function
// below, with the major it starts at and the source that says so.
import type { Tree } from '@nx/devkit';
import { declaredSpec } from '../../generators/_utils/dependencies';
import { majorOf } from './angularfire-judge';

export interface WorkspaceAngular {
  version: string;
  major: number;
  from: 'installed' | 'declared';
}

/**
 * The workspace's Angular version: the one installed, else the lowest the declared range allows — or null.
 * `prefer: 'declared'` reads the manifest first: what @nx/angular's own generators judge by (version-utils
 * `getInstalledAngularVersionInfo` reads the DECLARED @angular/core), so a choice it validates must be made on it too.
 */
export function workspaceAngular(
  tree: Tree,
  declared: (name: string) => string | undefined = (name) => declaredSpec(tree, name),
  prefer: 'installed' | 'declared' = 'installed',
): WorkspaceAngular | null {
  const fromInstalled = (): WorkspaceAngular | null => {
    const installed = installedVersion(tree, '@angular/core');
    return installed ? { version: installed, major: majorOf(installed), from: 'installed' } : null;
  };
  const fromDeclared = (): WorkspaceAngular | null => {
    const range = declared('@angular/core')?.match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
    if (!range) return null;
    const version = `${range[1]}.${range[2] ?? 0}.${range[3] ?? 0}`;
    return { version, major: majorOf(version), from: 'declared' };
  };
  return prefer === 'declared' ? fromDeclared() ?? fromInstalled() : fromInstalled() ?? fromDeclared();
}

/** The version of `name` resolved in the workspace's node_modules, or null. */
export function installedVersion(tree: Tree, name: string): string | null {
  const manifest = installedManifest(tree, name);
  return typeof manifest?.version === 'string' ? manifest.version : null;
}

/** `node_modules/<name>/package.json`, or null. */
export function installedManifest(
  tree: Tree,
  name: string,
): { version?: unknown; dependencies?: Record<string, string>; peerDependencies?: Record<string, string> } | null {
  try {
    return JSON.parse(tree.read(`node_modules/${name}/package.json`, 'utf8') ?? '');
  } catch {
    return null;
  }
}

/**
 * The unit-test runner for a new Angular LIBRARY. From Angular 21 the house runs Vitest, and WHICH Vitest is the build's:
 *   - `vitest-angular` (Angular's own `@angular/build:unit-test`, through @nx/angular:unit-test) needs Angular 21+ AND a
 *     library with a build — @nx/angular refuses it otherwise (library/lib/validate-options: "requires Angular v21 or
 *     higher", "requires the library to be buildable or publishable");
 *   - `vitest-analog` (AnalogJS's Vite plugin through @nx/vitest) for a library without one.
 * Below 21: undefined — @nx/angular's own default for that major (jest), its tested path. vitest-analog is ALLOWED there,
 * but on a publishable library its vite config imports vite / @analogjs / @nx/vite, which @nx/angular's lint setup does
 * not exempt from @nx/dependency-checks — the library would fail its own lint (observed in a real Angular 20 workspace).
 * Unknown Angular (nothing declared or installed yet): undefined as well — @nx/angular picks for what it installs.
 */
export function libraryUnitTestRunner(tree: Tree, buildable: boolean): 'vitest-angular' | 'vitest-analog' | undefined {
  const angular = workspaceAngular(tree, undefined, 'declared');
  if (!angular || angular.major < 21) return undefined;
  return buildable ? 'vitest-angular' : 'vitest-analog';
}
