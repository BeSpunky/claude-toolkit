// 0.48.0 — a house-written `image` goes (the generator composes `build` from house.Dockerfile in the same upgrade);
// a project's own `image` stays.
//
// The shapes it meets: an OWNED devcontainer the house composed (its `image` with the house's comment above it), an
// ADOPTED one whose image is the project's (this toolkit's own shape), an adopted one whose `image` the house ADDED
// and recorded, one already building, a workspace without the agent layer, and an unparseable file.
const DC = '.devcontainer/devcontainer.json';
const MARKER = '.devcontainer/.bespunky-devcontainer.json';
const IMAGE = 'mcr.microsoft.com/devcontainers/typescript-node:22';
const marker = (owned, houseAdded) =>
  JSON.stringify({ generator: '@bespunky/nx-tools:devcontainer', owned, layers: ['nx', 'agent', 'node'], ...(owned ? {} : { adopted: { skipped: [], houseAdded } }) });

const OWNED = `// house header
{
  "name": "shop",
  // A Node project: the image carries Node.
  "image": "${IMAGE}",
  "features": {
    "ghcr.io/devcontainers/features/github-cli": {}
  },
  "remoteUser": "node"
}
`;

const ADOPTED = `// claude-toolkit devcontainer.
{
  "name": "claude-toolkit",
  "image": "${IMAGE}",

  "features": {}
}
`;

export default {
  name: '0.48.0 · build-from-house-dockerfile',
  ladder: ['0.48.0/build-from-house-dockerfile'],
  cases: [
    {
      name: 'owned: the house image goes with the comment above it, everything else byte-identical',
      setup: (tree) => {
        tree.write(DC, OWNED);
        tree.write(MARKER, marker(true));
      },
      expect: (tree, t) => {
        const expected = OWNED.replace(`  // A Node project: the image carries Node.\n  "image": "${IMAGE}",\n`, '');
        t.ok(tree.read(DC, 'utf8') === expected, `unexpected file:\n${tree.read(DC, 'utf8')}`);
      },
    },
    {
      name: "adopted, the project's own image (this toolkit's shape): left exactly as it is",
      setup: (tree) => {
        tree.write(DC, ADOPTED);
        tree.write(MARKER, marker(false, []));
      },
      expect: (tree, t) => t.ok(tree.read(DC, 'utf8') === ADOPTED, 'the project image was touched'),
    },
    {
      name: 'adopted, an image the house ADDED and recorded: removed',
      setup: (tree) => {
        tree.write(DC, `{\n  "name": "x",\n  "image": "${IMAGE}"\n}\n`);
        tree.write(MARKER, marker(false, [{ path: ['image'], value: IMAGE }]));
      },
      expect: (tree, t) => t.hasNot(DC, '"image"'),
    },
    {
      name: 'already building (no image): nothing to do',
      setup: (tree) => {
        tree.write(DC, '{\n  "build": { "dockerfile": "house.Dockerfile", "context": "." }\n}\n');
        tree.write(MARKER, marker(true));
      },
      expect: (tree, t) => t.ok(tree.read(DC, 'utf8') === '{\n  "build": { "dockerfile": "house.Dockerfile", "context": "." }\n}\n', 'the file was changed'),
    },
    {
      name: 'no agent layer: not this rung’s business — untouched',
      setup: (tree) => tree.write(DC, OWNED),
      expect: (tree, t) => t.ok(tree.read(DC, 'utf8') === OWNED, 'the file was changed'),
    },
    {
      name: 'unparseable devcontainer.json: left exactly as it is (and reported)',
      setup: (tree) => {
        tree.write(DC, `{\n  "image": "${IMAGE}",\n`);
        tree.write(MARKER, marker(true));
      },
      expect: (tree, t) => t.ok(tree.read(DC, 'utf8') === `{\n  "image": "${IMAGE}",\n`, 'a file that does not parse was edited'),
    },
  ],
};
