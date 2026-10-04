// 0.40.0 — the claude-code devcontainer feature goes; ~/.local/bin leads remoteEnv.PATH.
//
// The shapes it meets: an OWNED devcontainer as 0.39 rendered it (the feature with its house comment between
// two other features, the node layer's PATH), an ADOPTED one the merge added the feature to (reported, kept —
// but the house PATH is still retargeted), a project PATH of its own (reported, untouched), a devcontainer
// that never had either, and none at all.
const DC = '.devcontainer/devcontainer.json';
const MARKER = '.devcontainer/.bespunky-devcontainer.json';
const FEATURE = 'ghcr.io/devcontainers-extra/features/claude-code';
const OLD_PATH = '${containerWorkspaceFolder}/node_modules/.bin:${containerEnv:PATH}';
const NEW_PATH = '${containerEnv:HOME}/.local/bin:${containerWorkspaceFolder}/node_modules/.bin:${containerEnv:PATH}';

const marker = (owned) => JSON.stringify({ generator: '@bespunky/nx-tools:devcontainer', owned, layers: ['nx', 'agent', 'node'] });

const OWNED = `// BeSpunky-standard devcontainer.
{
  "name": "demo",
  "features": {
    "ghcr.io/devcontainers/features/node:1": { "version": "22" },
    // Claude's permission posture is set once in .claude/settings.json (permissions.defaultMode: "auto")
    // — deliberately NOT a blanket skip here.
    "${FEATURE}": {},
    "ghcr.io/devcontainers/features/github-cli": {}
  },
  "remoteEnv": {
    "PATH": "${OLD_PATH}",
    "CHOKIDAR_USEPOLLING": "true"
  }
}
`;

const ADOPTED = `{
  // Our own container.
  "image": "ours:latest",
  "features": {
    "${FEATURE}": {}
  },
  "remoteEnv": { "PATH": "${OLD_PATH}" }
}
`;

const THEIR_PATH = `{
  "remoteEnv": {
    // Our own tools first.
    "PATH": "/opt/ours/bin:\${containerEnv:PATH}"
  }
}
`;

const BROKEN_FILE = `{\n  "features": { "${FEATURE}": {} },\n  "remoteEnv": { "PATH": "${OLD_PATH}" \n`;

export default {
  name: '0.40.0 · retire-claude-code-feature',
  ladder: ['0.40.0/retire-claude-code-feature'],
  cases: [
    {
      name: 'owned 0.39 devcontainer: the feature and its house comment go, neighbours stay, PATH retargeted',
      setup: (tree) => {
        tree.write(DC, OWNED);
        tree.write(MARKER, marker(true));
        tree.write('.devcontainer/devcontainer-lock.json', JSON.stringify({ features: { [FEATURE]: { version: '2.0.3' } } }, null, 2) + '\n');
      },
      expect: (tree, t) => {
        t.hasNot(DC, FEATURE);
        t.hasNot('.devcontainer/devcontainer-lock.json', FEATURE);
        t.hasNot(DC, "Claude's permission posture");
        t.hasNot(DC, 'deliberately NOT a blanket skip');
        t.has(DC, '"ghcr.io/devcontainers/features/node:1": { "version": "22" }');
        t.has(DC, '"ghcr.io/devcontainers/features/github-cli": {}');
        t.has(DC, '// BeSpunky-standard devcontainer.');
        t.has(DC, NEW_PATH);
        t.has(DC, '"CHOKIDAR_USEPOLLING": "true"');
      },
    },
    {
      name: 'adopted devcontainer: the feature is kept (and reported), the house PATH still retargeted',
      setup: (tree) => {
        tree.write(DC, ADOPTED);
        tree.write(MARKER, marker(false));
      },
      expect: (tree, t) => {
        t.has(DC, FEATURE);
        t.has(DC, '// Our own container.');
        t.has(DC, NEW_PATH);
      },
    },
    {
      name: 'owned, the feature LAST in the map: the comma before it goes too, the file still parses',
      setup: (tree) => {
        tree.write(DC, `{\n  "features": {\n    "ghcr.io/devcontainers/features/github-cli": {},\n    "${FEATURE}": {}\n  }\n}\n`);
        tree.write(MARKER, marker(true));
      },
      expect: (tree, t) => {
        t.hasNot(DC, FEATURE);
        const parsed = JSON.parse(tree.read(DC, 'utf8'));
        t.ok(Object.keys(parsed.features).join() === 'ghcr.io/devcontainers/features/github-cli', 'features left wrong');
      },
    },
    {
      name: 'no marker at all: never treated as owned',
      setup: (tree) => tree.write(DC, OWNED),
      expect: (tree, t) => {
        t.has(DC, FEATURE);
        t.has(DC, NEW_PATH);
      },
    },
    {
      name: "the project's own PATH is left in place (and reported)",
      setup: (tree) => {
        tree.write(DC, THEIR_PATH);
        tree.write(MARKER, marker(true));
      },
      expect: (tree, t) => t.ok(tree.read(DC, 'utf8') === THEIR_PATH, 'the file was changed'),
    },
    {
      name: 'unparseable devcontainer.json: left exactly as it is (and reported)',
      setup: (tree) => {
        tree.write(DC, BROKEN_FILE);
        tree.write(MARKER, marker(true));
      },
      expect: (tree, t) => t.ok(tree.read(DC, 'utf8') === BROKEN_FILE, 'a file that does not parse was edited'),
    },
    {
      name: 'no devcontainer: nothing to do',
      setup: () => {},
      expect: (tree, t) => t.missing(DC),
    },
  ],
};
