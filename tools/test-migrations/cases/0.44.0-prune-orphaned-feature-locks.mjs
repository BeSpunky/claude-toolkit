// 0.44.0 — pins for features devcontainer.json no longer declares leave devcontainer-lock.json.
//
// The shapes it meets: this repo after 0.43.0 (the claude-code pin orphaned, github-cli in use), a lock with
// nothing orphaned (byte-identical), a devcontainer.json it cannot read (no way to tell an orphan — untouched),
// and a project with no lock at all.
const DC = '.devcontainer/devcontainer.json';
const LOCK = '.devcontainer/devcontainer-lock.json';
const CLAUDE = 'ghcr.io/devcontainers-extra/features/claude-code';
const GH = 'ghcr.io/devcontainers/features/github-cli';
const lock = (ids) => JSON.stringify({ features: Object.fromEntries(ids.map((id) => [id, { version: '1.0.0', resolved: `${id}@sha256:abc`, integrity: 'sha256:abc' }])) }, null, 2) + '\n';
const declaring = (ids) => `{\n  // Ours.\n  "features": {\n${ids.map((id) => `    "${id}": {}`).join(',\n')}\n  }\n}\n`;

export default {
  name: '0.44.0 · prune-orphaned-feature-locks',
  ladder: ['0.44.0/prune-orphaned-feature-locks'],
  cases: [
    {
      name: 'after 0.43.0: the orphaned claude-code pin goes, the github-cli pin stays exactly',
      setup: (tree) => {
        tree.write(DC, declaring([GH, './features/bespunky-house-setup']));
        tree.write(LOCK, lock([CLAUDE, GH]));
      },
      expect: (tree, t) => t.ok(tree.read(LOCK, 'utf8') === lock([GH]), `lock:\n${tree.read(LOCK, 'utf8')}`),
    },
    {
      name: 'nothing orphaned: byte-identical',
      setup: (tree) => {
        tree.write(DC, declaring([GH]));
        tree.write(LOCK, lock([GH]));
      },
      expect: (tree, t) => t.ok(tree.read(LOCK, 'utf8') === lock([GH]), 'the lock was changed'),
    },
    {
      name: 'devcontainer.json unreadable: no way to tell an orphan — untouched',
      setup: (tree) => {
        tree.write(DC, '{ "features": { broken');
        tree.write(LOCK, lock([CLAUDE, GH]));
      },
      expect: (tree, t) => t.ok(tree.read(LOCK, 'utf8') === lock([CLAUDE, GH]), 'the lock was changed'),
    },
    {
      name: 'no lock: nothing to do',
      setup: (tree) => tree.write(DC, declaring([GH])),
      expect: (tree, t) => t.missing(LOCK),
    },
  ],
};
