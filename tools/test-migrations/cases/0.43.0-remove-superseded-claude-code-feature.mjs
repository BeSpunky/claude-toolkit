// 0.43.0 — the claude-code feature goes wherever the agent layer installs Claude Code natively, owned or adopted.
//
// The shapes it meets: this toolkit's own ADOPTED devcontainer (the feature hand-written first in the map, no
// comment of its own, a commented local feature after it), an adopted one whose project explained the line in a
// comment (the comment goes with it), a workspace WITHOUT the agent layer (the feature may be its only Claude
// Code — kept), and one that never had it.
const DC = '.devcontainer/devcontainer.json';
const MARKER = '.devcontainer/.bespunky-devcontainer.json';
const LOCK = '.devcontainer/devcontainer-lock.json';
const FEATURE = 'ghcr.io/devcontainers-extra/features/claude-code';
const adoptedMarker = JSON.stringify({ generator: '@bespunky/nx-tools:devcontainer', owned: false, layers: ['nx', 'agent', 'node'] });

const TOOLKIT = `// claude-toolkit devcontainer.
{
  "name": "claude-toolkit",
  "image": "mcr.microsoft.com/devcontainers/typescript-node:22",

  "features": {
    "${FEATURE}": {},
    "ghcr.io/devcontainers/features/github-cli": {},
    // A LOCAL feature.
    "./features/bespunky-house-setup": {}
  },
  "remoteUser": "node"
}
`;

const EXPLAINED = `{
  "features": {
    "ghcr.io/devcontainers/features/github-cli": {},
    // We want the Claude CLI in here.
    "${FEATURE}": {}
  }
}
`;

const BROKEN_FILE = `{\n  "features": {\n    "${FEATURE}": {},\n    "ghcr.io/devcontainers/features/github-cli": {}\n`;

export default {
  name: '0.43.0 · remove-superseded-claude-code-feature',
  ladder: ['0.43.0/remove-superseded-claude-code-feature'],
  cases: [
    {
      name: "adopted (this toolkit's own shape): the hand-written feature goes, everything else byte-identical",
      setup: (tree) => {
        tree.write(DC, TOOLKIT);
        tree.write(MARKER, adoptedMarker);
      },
      expect: (tree, t) => {
        t.ok(tree.read(DC, 'utf8') === TOOLKIT.replace(`    "${FEATURE}": {},\n`, ''), `unexpected file:\n${tree.read(DC, 'utf8')}`);
      },
    },
    {
      name: 'the pin in devcontainer-lock.json goes with it, the other pins stay',
      setup: (tree) => {
        tree.write(DC, TOOLKIT);
        tree.write(MARKER, adoptedMarker);
        tree.write(LOCK, JSON.stringify({ features: { [FEATURE]: { version: '2.0.3' }, 'ghcr.io/devcontainers/features/github-cli': { version: '1.1.0' } } }, null, 2) + '\n');
      },
      expect: (tree, t) => {
        t.hasNot(DC, FEATURE);
        t.hasNot(LOCK, FEATURE);
        t.ok(JSON.parse(tree.read(LOCK, 'utf8')).features['ghcr.io/devcontainers/features/github-cli'].version === '1.1.0', 'the other pin was lost');
      },
    },
    {
      name: "adopted, the project's comment explaining it: the comment goes with the line, the file still parses",
      setup: (tree) => {
        tree.write(DC, EXPLAINED);
        tree.write(MARKER, adoptedMarker);
      },
      expect: (tree, t) => {
        t.hasNot(DC, FEATURE);
        t.hasNot(DC, 'We want the Claude CLI');
        const parsed = JSON.parse(tree.read(DC, 'utf8'));
        t.ok(Object.keys(parsed.features).join() === 'ghcr.io/devcontainers/features/github-cli', 'features left wrong');
      },
    },
    {
      name: 'no agent layer: the feature may be the only Claude Code — kept (and said so)',
      setup: (tree) => tree.write(DC, EXPLAINED),
      expect: (tree, t) => t.ok(tree.read(DC, 'utf8') === EXPLAINED, 'the file was changed'),
    },
    {
      name: 'unparseable devcontainer.json: left exactly as it is (and reported)',
      setup: (tree) => {
        tree.write(DC, BROKEN_FILE);
        tree.write(MARKER, adoptedMarker);
      },
      expect: (tree, t) => t.ok(tree.read(DC, 'utf8') === BROKEN_FILE, 'a file that does not parse was edited'),
    },
    {
      name: 'never had it: nothing to do',
      setup: (tree) => {
        tree.write(DC, '{ "features": {} }\n');
        tree.write(MARKER, adoptedMarker);
      },
      expect: (tree, t) => t.ok(tree.read(DC, 'utf8') === '{ "features": {} }\n', 'the file was changed'),
    },
  ],
};
