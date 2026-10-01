// `js` — TypeScript/JavaScript libraries (publishable libs, tool extraction).
//
// Detected by the @nx/js PLUGIN or a project built by one of its executors — never by "any library project".
// `projectType: library` says nothing about the language: the house's own tooling projects once declared it
// (switching this layer on in every web workspace), and a Python or Go library in an Nx workspace declares it
// just as legitimately.
import type { LayerDescriptor } from './descriptor';

export const js: LayerDescriptor = {
  id: 'js',
  title: 'TypeScript/JavaScript libraries',
  requires: ['nx'],
  evidence: { dependencies: ['@nx/js'], executors: ['@nx/js:'] },
  ensurable: { scaffold: false, sync: false },
  ensureHint: '`nx add @nx/js` (or `nx g @bespunky/nx-tools:publishable-lib <name> --stack=js`)',
  brings: 'the publishable-library and tool-extraction conventions in HOUSE.md, @playwright/test (pinned)',
  generators: {
    // @playwright/test as a pinned devDependency — a JS project's own browser tests. (The shared browser no
    // longer leans on it: it carries its own runtime, so a non-JS project serves and co-drives just the same.)
    workspace: [{ generator: 'playwright' }],
  },
  docSections: ['js', 'monorepo'],
};
