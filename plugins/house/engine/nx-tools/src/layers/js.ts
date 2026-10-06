// `js` — TypeScript/JavaScript libraries (publishable libs, tool extraction).
//
// Detected by the @nx/js PLUGIN, a project built by one of its executors, or — the refinement — a project the
// `js` stack OWNS: never by "any library project". `projectType: library` says nothing about the language: the
// house's own tooling projects once declared it (switching this layer on in every web workspace), and a Python
// or Go library in an Nx workspace declares it just as legitimately.
//
// The refinement exists for the TS-solution workspace, whose libraries declare NO executor: the
// `@nx/js/typescript` plugin infers their build from tsconfig.lib.json, and inferred targets are invisible to a
// Tree. Asking the stack adapter ("is this yours?") is the one rule that already knows both shapes, so the layer
// and every generator agree on what a JS library is. (The shell projection cannot run it; there, the root
// `@nx/js` dependency — which that inference plugin needs installed — is the evidence that carries the hook.)
import { type Tree, getProjects } from '@nx/devkit';
import type { LayerDescriptor } from './descriptor';
import { adapter, adapterOf } from '../adapters/registry';
import { CHROMIUM_OS_PACKAGE_GROUP } from '../generators/_utils/playwright';

/** Does the `js` stack own any project here? (Precedence respected: an Angular-built library is Angular's.) */
const ownsAnyProject = (tree: Tree): boolean =>
  tree.exists('nx.json') && [...getProjects(tree).keys()].some((name) => adapterOf(tree, name)?.id === 'js');

export const js: LayerDescriptor = {
  id: 'js',
  title: 'TypeScript/JavaScript libraries',
  requires: ['nx'],
  evidence: { dependencies: ['@nx/js'], executors: adapter('js').executors },
  detect: ownsAnyProject,
  ensurable: { new: false, upgrade: false },
  ensureHint: '`nx add @nx/js` (or `nx g @bespunky/nx-tools:publishable-lib <name> --stack=js`)',
  brings: 'the publishable-library and tool-extraction conventions in HOUSE.md, @playwright/test (pinned)',
  generators: {
    // @playwright/test as a pinned devDependency — a JS project's own browser tests. (The shared browser no
    // longer leans on it: it carries its own runtime, so a non-JS project serves and co-drives just the same.)
    workspace: [{ generator: 'playwright' }],
  },
  docSections: ['js', 'monorepo'],
  // Nx writes every JS build to `dist/` (create-nx-workspace ignores it as `dist`, the spelling used here so the
  // substring check sees an existing house workspace as covered; `nx init` on an existing repo does not ignore it).
  // A layer that brings a build owns ignoring its output — or the first build leaves an untracked tree behind.
  gitignore: [{ heading: 'Build output (Nx writes builds to dist/)', entries: ['dist'] }],
  // The project's OWN browser tests: Chromium for @playwright/test, when it is declared (self-adapting piece) — its
  // OS libraries in the image (the `playwright` generator pins @playwright/test in every js workspace).
  devcontainer: { osPackages: [CHROMIUM_OS_PACKAGE_GROUP], postCreate: [{ phase: 'provision', piece: 'playwright' }] },
};
