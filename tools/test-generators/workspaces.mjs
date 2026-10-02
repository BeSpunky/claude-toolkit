/**
 * The WORKSPACE SHAPES the generator fixtures run against — built once here, so every case speaks the same
 * vocabulary and the matrix is one list, not a convention each case file re-derives.
 *
 * Two orthogonal facts (docs/features/2026-10-02-workspace-layouts/DECISION.md):
 *
 *   layout   where projects live      apps-libs (apps/, libs/) · packages (packages/) · hybrid — nothing declared,
 *                                     the house default (apps/ + packages/), which is what every project scaffolded
 *                                     before layouts existed resolves to
 *   linking  how projects reach       paths (project.json + tsconfig `paths`) · workspaces (TS-solution: package.json
 *            each other               projects, package-manager workspaces, project references) — under npm and pnpm,
 *                                     the two that declare membership and depend on a member differently
 *
 * A TS-solution fixture is what `create-nx-workspace --preset=ts --workspaces` produces, reduced to the facts the
 * generators read: a `packages/*` glob (so a layout that keeps projects elsewhere has to EARN membership), a
 * solution tsconfig.json referencing nothing, a composite base with a workspace-unique custom condition, and the
 * `@nx/js/typescript` inference plugin.
 */
import { requireFromRepo } from '../test-support/payload.mjs';

const { createTreeWithEmptyWorkspace } = requireFromRepo('@nx/devkit/testing');
const { updateJson, writeJson } = requireFromRepo('@nx/devkit');

export const SCOPE = 'acme';

/** The layouts, as nx.json would declare them. `hybrid` declares nothing — resolution falls to the default. */
export const LAYOUTS = {
  'apps-libs': { appsDir: 'apps', libsDir: 'libs' },
  packages: { appsDir: 'packages', libsDir: 'packages' },
  hybrid: null,
};

/** What each layout RESOLVES to — the hybrid one included (the house default). */
export const RESOLVED = {
  'apps-libs': { appsDir: 'apps', libsDir: 'libs' },
  packages: { appsDir: 'packages', libsDir: 'packages' },
  hybrid: { appsDir: 'apps', libsDir: 'packages' },
};

/** The linkings, each with the package manager that decides how a member is declared and depended on. */
export const LINKINGS = {
  paths: { linking: 'paths', pm: 'npm' },
  'workspaces-npm': { linking: 'workspaces', pm: 'npm' },
  'workspaces-pnpm': { linking: 'workspaces', pm: 'pnpm' },
};

/** Every layout × every linking — `{ layout, link, label }`. */
export const MATRIX = Object.keys(LAYOUTS).flatMap((layout) =>
  Object.keys(LINKINGS).map((link) => ({ layout, link, label: `${layout} × ${link}` })),
);

/** The range a consumer declares on a workspace member, per linking (what `workspaceDependencySpec` writes). */
export const LINK_RANGE = { paths: undefined, 'workspaces-npm': '*', 'workspaces-pnpm': 'workspace:*' };

/**
 * A fresh workspace of the given shape.
 * @param {{ layout?: keyof LAYOUTS, link?: keyof LINKINGS, pm?: 'npm'|'pnpm'|'yarn-berry' }} shape
 */
export function workspace({ layout = 'hybrid', link = 'paths', pm } = {}) {
  const tree = createTreeWithEmptyWorkspace();
  const { linking, pm: defaultPm } = LINKINGS[link];
  const manager = pm ?? defaultPm;

  updateJson(tree, 'package.json', (json) => ({ ...json, name: `@${SCOPE}/source` }));
  if (LAYOUTS[layout]) updateJson(tree, 'nx.json', (json) => ({ ...json, workspaceLayout: { ...LAYOUTS[layout] } }));

  if (manager === 'npm') tree.write('package-lock.json', '{}');
  if (manager === 'pnpm') tree.write('pnpm-lock.yaml', 'lockfileVersion: 9.0\n');
  if (manager === 'yarn-berry') {
    updateJson(tree, 'package.json', (json) => ({ ...json, packageManager: 'yarn@4.5.0' }));
    tree.write('yarn.lock', '__metadata:\n  version: 8\n');
  }

  if (linking === 'workspaces') {
    tree.delete('tsconfig.base.json');
    writeJson(tree, 'tsconfig.base.json', {
      compilerOptions: { composite: true, declaration: true, module: 'nodenext', moduleResolution: 'nodenext', customConditions: [`@${SCOPE}/source`] },
    });
    writeJson(tree, 'tsconfig.json', { extends: './tsconfig.base.json', files: [], references: [] });
    if (manager === 'pnpm') tree.write('pnpm-workspace.yaml', 'packages:\n  - "packages/*"\n');
    else updateJson(tree, 'package.json', (json) => ({ ...json, workspaces: ['packages/*'] }));
    updateJson(tree, 'nx.json', (json) => ({ ...json, plugins: [...(json.plugins ?? []), { plugin: '@nx/js/typescript', options: {} }] }));
  }
  return tree;
}

/** The workspaces globs, whichever file declares them. */
export function workspaceGlobs(tree) {
  if (tree.exists('pnpm-workspace.yaml')) {
    return [...(tree.read('pnpm-workspace.yaml', 'utf8') ?? '').matchAll(/^\s*-\s*"?([^"\n]+)"?\s*$/gm)].map((m) => m[1]);
  }
  return JSON.parse(tree.read('package.json', 'utf8')).workspaces ?? [];
}

/** The solution tsconfig.json's reference paths. */
export function references(tree) {
  return tree.exists('tsconfig.json') ? (JSON.parse(tree.read('tsconfig.json', 'utf8')).references ?? []).map((r) => r.path) : [];
}

/** The root tsconfig's path aliases (paths linking). */
export function aliases(tree) {
  return JSON.parse(tree.read('tsconfig.base.json', 'utf8')).compilerOptions?.paths ?? {};
}

/**
 * An Angular-built application, the way @nx/angular writes one — enough for the angular stack adapter to own it
 * (its build executor) and for the `styles` port to read its global stylesheet — WITHOUT @nx/angular installed.
 * The capabilities only ever reach an app through its adapter's ports, which read config, never the plugin.
 */
export function angularApp(tree, root, name = root.split('/').pop()) {
  writeJson(tree, `${root}/project.json`, {
    name,
    root,
    sourceRoot: `${root}/src`,
    projectType: 'application',
    tags: [],
    targets: {
      build: { executor: '@angular/build:application', options: { outputPath: `dist/${root}`, styles: [`${root}/src/styles.scss`] } },
    },
  });
  tree.write(`${root}/src/styles.scss`, '/* app styles */\n');
  return name;
}

/**
 * A workspace that wears the Angular stack (its evidence: @nx/angular + @angular/core declared) — for the cases that
 * create through @nx/angular itself, and so declare `needs: ['@nx/angular']`.
 */
export function angularWorkspace(shape) {
  const tree = workspace(shape);
  updateJson(tree, 'package.json', (json) => ({
    ...json,
    dependencies: { ...json.dependencies, '@angular/core': '~21.0.0', '@angular/common': '~21.0.0' },
    devDependencies: { ...json.devDependencies, '@nx/angular': '23.1.0', '@nx/js': '23.1.0' },
  }));
  return tree;
}
