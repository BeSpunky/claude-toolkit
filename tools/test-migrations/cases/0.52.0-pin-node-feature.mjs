// 0.52.0 — `node:1` moves to its exact tag. The mechanics are `pinHouseFeature`, shared with pin-github-cli-feature, whose case
// holds every shape; this one holds what is specific to this key: the project's Node major stays, and so does the install order.
const DC = '.devcontainer/devcontainer.json';
const LOCK = '.devcontainer/devcontainer-lock.json';
const MARKER = '.devcontainer/.bespunky-devcontainer.json';
const ID = 'ghcr.io/devcontainers/features/node';
const FROM = `${ID}:1`;
const TO = `${ID}:1.7.1`;
const DIGEST = 'sha256:8c0de46939b61958041700ee89e3493f3b2e4131a06dc46b4d9423427d06e5f6';
const composed = (key) => `{\n  "features": {\n    "${key}": { "version": "22" },\n    "./features/bespunky-house-setup": {}\n  },\n  "overrideFeatureInstallOrder": ["${ID}"]\n}\n`;

export default {
  name: '0.52.0 · pin-node-feature',
  ladder: ['0.52.0/pin-node-feature'],
  cases: [
    {
      name: "owned, as the agent layer composed it: the key moves; the project's major, the install order and the lock follow",
      setup: (tree) => {
        tree.write(DC, composed(FROM));
        tree.write(MARKER, JSON.stringify({ owned: true }));
        tree.write(LOCK, JSON.stringify({ features: { [FROM]: { version: '1.7.1', resolved: `${ID}@${DIGEST}`, integrity: DIGEST } } }));
      },
      expect: (tree, t) => {
        t.ok(t.read(DC) === composed(TO), `only the key changed:\n${t.read(DC)}`);
        t.equal(t.json(LOCK).features, { [TO]: { version: '1.7.1', resolved: `${ID}@${DIGEST}`, integrity: DIGEST } }, 'the pin moved');
      },
    },
    {
      name: "adopted, and the project's own `node:1` with its options: left, and reported",
      setup: (tree) => {
        tree.write(DC, composed(FROM));
        tree.write(MARKER, JSON.stringify({ owned: false, adopted: { houseAdded: [] } }));
      },
      expect: (tree, t, logs) => {
        t.ok(t.read(DC) === composed(FROM), 'byte-identical');
        t.ok(logs.some((l) => l.includes('carries options') && l.includes(TO)), `reported: ${logs.join(' | ')}`);
      },
    },
  ],
};
