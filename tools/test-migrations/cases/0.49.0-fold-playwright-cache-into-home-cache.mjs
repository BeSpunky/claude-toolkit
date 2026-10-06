// 0.49.0 — the house-written `<folder>-playwright-cache` mount goes (~/.cache is now one persisted volume); a project's
// own stays.
//
// The shapes it meets: an OWNED web devcontainer as 0.48 rendered it (the mount, its house comment above, a project
// mount after it), an adopted one whose mount the house added and recorded, an adopted one whose identical-looking
// mount the project wrote (no record), a workspace without the agent layer, and an unparseable file.
const DC = '.devcontainer/devcontainer.json';
const MARKER = '.devcontainer/.bespunky-devcontainer.json';
const OLD = 'source=${localWorkspaceFolderBasename}-playwright-cache,target=/home/node/.cache/ms-playwright,type=volume';
const marker = (owned, houseAdded) =>
  JSON.stringify({ generator: '@bespunky/nx-tools:devcontainer', owned, layers: ['nx', 'agent', 'node', 'web'], ...(owned ? {} : { adopted: { skipped: [], houseAdded } }) });

const OWNED = `{
  "name": "shop",
  "mounts": [
    // Claude Code's state.
    "source=\${localWorkspaceFolder}/.claude/data,target=/home/node/.claude,type=bind,consistency=cached",
    // Playwright browser binaries (~150 MB Chromium) on a per-workspace volume, so rebuilds reuse them.
    "${OLD}",
    // ours
    "source=mydata,target=/data,type=volume"
  ]
}
`;
const OWNED_AFTER = `{
  "name": "shop",
  "mounts": [
    // Claude Code's state.
    "source=\${localWorkspaceFolder}/.claude/data,target=/home/node/.claude,type=bind,consistency=cached",
    // ours
    "source=mydata,target=/data,type=volume"
  ]
}
`;
const LAST = `{\n  "mounts": [\n    "source=mydata,target=/data,type=volume",\n    "${OLD}"\n  ]\n}\n`;

export default {
  name: '0.49.0 · fold-playwright-cache-into-home-cache',
  ladder: ['0.49.0/fold-playwright-cache-into-home-cache'],
  cases: [
    {
      name: 'owned: the mount and its house comment go; neighbours and their comments byte-identical',
      setup: (tree) => {
        tree.write(DC, OWNED);
        tree.write(MARKER, marker(true));
      },
      expect: (tree, t) => t.ok(tree.read(DC, 'utf8') === OWNED_AFTER, `unexpected file:\n${tree.read(DC, 'utf8')}`),
    },
    {
      name: 'owned, the mount LAST in the array: removed, the trailing comma before it too',
      setup: (tree) => {
        tree.write(DC, LAST);
        tree.write(MARKER, marker(true));
      },
      expect: (tree, t) => t.ok(tree.read(DC, 'utf8').replace(/\s+/g, '') === '{"mounts":["source=mydata,target=/data,type=volume"]}', `unexpected file:\n${tree.read(DC, 'utf8')}`),
    },
    {
      name: 'adopted, the house ADDED it and recorded it: removed',
      setup: (tree) => {
        tree.write(DC, LAST);
        tree.write(MARKER, marker(false, [{ path: ['mounts'], member: OLD }]));
      },
      expect: (tree, t) => t.hasNot(DC, 'playwright-cache'),
    },
    {
      name: "adopted, the project's own (no record): left exactly as it is (reported)",
      setup: (tree) => {
        tree.write(DC, LAST);
        tree.write(MARKER, marker(false, []));
      },
      expect: (tree, t) => t.ok(tree.read(DC, 'utf8') === LAST, 'a project mount was removed'),
    },
    {
      name: 'no agent layer: untouched',
      setup: (tree) => tree.write(DC, OWNED),
      expect: (tree, t) => t.ok(tree.read(DC, 'utf8') === OWNED, 'the file was changed'),
    },
    {
      name: 'unparseable devcontainer.json: left exactly as it is (reported)',
      setup: (tree) => {
        tree.write(DC, `{\n  "mounts": ["${OLD}",\n`);
        tree.write(MARKER, marker(true));
      },
      expect: (tree, t) => t.ok(tree.read(DC, 'utf8') === `{\n  "mounts": ["${OLD}",\n`, 'a file that does not parse was edited'),
    },
  ],
};
