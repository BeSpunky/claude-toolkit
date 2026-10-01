// 0.35.0 — the house's whole-folder `.nx` volume becomes `.nx/cache` + `.nx/workspace-data`.
//
// The shapes it meets: an OWNED devcontainer as the 0.34 template rendered it (comments around the mounts,
// the .nx volume in the middle), an ADOPTED one the merge appended to (the project's own mounts and comments
// all around), one where the project mounts `.nx` its own way (reported, untouched), and one where a sync has
// already added the new volumes beside the old one.
const DC = '.devcontainer/devcontainer.json';
const OLD = 'source=${localWorkspaceFolderBasename}-nx,target=${containerWorkspaceFolder}/.nx,type=volume';
const CACHE = 'source=${localWorkspaceFolderBasename}-nx-cache,target=${containerWorkspaceFolder}/.nx/cache,type=volume';
const DATA = 'source=${localWorkspaceFolderBasename}-nx-workspace-data,target=${containerWorkspaceFolder}/.nx/workspace-data,type=volume';

const OWNED = `// BeSpunky-standard devcontainer.
{
  "name": "demo",
  "mounts": [
    "source=\${localWorkspaceFolder}/.claude/data,target=/home/node/.claude,type=bind,consistency=cached",
    "source=\${localWorkspaceFolderBasename}-node_modules,target=\${containerWorkspaceFolder}/node_modules,type=volume",
    "${OLD}",
    "source=\${localWorkspaceFolderBasename}-angular,target=\${containerWorkspaceFolder}/.angular,type=volume",
    // Playwright browser binaries (~150 MB Chromium).
    "source=\${localWorkspaceFolderBasename}-playwright-cache,target=/home/node/.cache/ms-playwright,type=volume",
  ]
}
`;

const ADOPTED = `{
  // Our own container.
  "image": "ours:latest",
  "mounts": [
    // Our datasets, read-only.
    "source=/data,target=/data,type=bind,readonly",
    "${OLD}"
  ]
}
`;

const THEIRS = `{
  "mounts": [
    // We keep Nx's state on a volume of our own.
    "source=my-nx,target=\${containerWorkspaceFolder}/.nx,type=volume"
  ]
}
`;

const BOTH = `{
  "mounts": [
    "${OLD}",
    "${CACHE}",
    "${DATA}"
  ]
}
`;

export default {
  name: '0.35.0 · retarget-nx-cache-volume',
  ladder: ['0.35.0/retarget-nx-cache-volume'],
  cases: [
    {
      name: 'owned 0.34 devcontainer: the .nx volume is replaced in place, neighbours and comments intact',
      setup: (tree) => tree.write(DC, OWNED),
      expect: (tree, t) => {
        t.hasNot(DC, OLD);
        t.occurrences(DC, CACHE, 1);
        t.occurrences(DC, DATA, 1);
        t.has(DC, '// Playwright browser binaries (~150 MB Chromium).');
        t.has(DC, '-angular,target=');
        const text = tree.read(DC, 'utf8');
        t.ok(text.indexOf('node_modules,type=volume') < text.indexOf(CACHE), 'the new volumes take the old one\'s position');
        t.ok(text.indexOf(DATA) < text.indexOf('-angular,target='), 'the second volume follows the first');
      },
    },
    {
      name: 'adopted devcontainer: the house value goes, the project\'s mounts and comments stay',
      setup: (tree) => tree.write(DC, ADOPTED),
      expect: (tree, t) => {
        t.hasNot(DC, OLD);
        t.has(DC, CACHE);
        t.has(DC, DATA);
        t.has(DC, '// Our own container.');
        t.has(DC, '// Our datasets, read-only.');
        t.has(DC, 'source=/data,target=/data,type=bind,readonly');
      },
    },
    {
      name: "the project's own whole-.nx mount is left in place (and reported)",
      setup: (tree) => tree.write(DC, THEIRS),
      expect: (tree, t) => {
        t.ok(tree.read(DC, 'utf8') === THEIRS, 'the file was changed');
      },
    },
    {
      name: 'new volumes already present (a sync ran first): the old one is removed, nothing duplicated',
      setup: (tree) => tree.write(DC, BOTH),
      expect: (tree, t) => {
        t.hasNot(DC, OLD);
        t.occurrences(DC, CACHE, 1);
        t.occurrences(DC, DATA, 1);
      },
    },
    {
      name: 'no devcontainer: nothing to do',
      setup: () => {},
      expect: (tree, t) => t.missing(DC),
    },
  ],
};
