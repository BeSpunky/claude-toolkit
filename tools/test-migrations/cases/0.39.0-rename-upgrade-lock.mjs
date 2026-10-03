// 0.39.0 — the upgrade's lock is now `.bespunky-upgrade.lock/`.
//
// The shapes it meets: the `.gitignore` block exactly as the gitignore generator wrote it (other blocks around
// it), a project that spelled the line its own way, one where the new name is already ignored beside the old, a
// project with an old lock directory still present (an older run may hold it), and one that never had the line.
const G = '.gitignore';
const OLD_HEADING = "# The house sync's transient lock (machine-local; never committed)";
const NEW_HEADING = "# The house upgrade's transient lock (machine-local; never committed)";

const HOUSE = `node_modules

# Nx caches (machine-local; never committed)
.nx/cache
.nx/workspace-data

${OLD_HEADING}
.bespunky-sync.lock/

# Claude Code (local, never shared)
.claude/settings.local.json
`;

export default {
  name: '0.39.0 · rename-upgrade-lock',
  ladder: ['0.39.0/rename-upgrade-lock'],
  cases: [
    {
      name: 'the house block: heading and entry retargeted in place, everything else byte-identical',
      setup: (tree) => tree.write(G, HOUSE),
      expect: (tree, t) => {
        t.hasNot(G, '.bespunky-sync.lock');
        t.ok(
          tree.read(G, 'utf8') === HOUSE.replace(OLD_HEADING, NEW_HEADING).replace('.bespunky-sync.lock/', '.bespunky-upgrade.lock/'),
          'more than the heading and the entry changed',
        );
      },
    },
    {
      name: "the project's own spelling is kept, only the name changes",
      setup: (tree) => tree.write(G, 'dist\n/.bespunky-sync.lock\n'),
      expect: (tree, t) => t.ok(tree.read(G, 'utf8') === 'dist\n/.bespunky-upgrade.lock\n', `got ${JSON.stringify(tree.read(G, 'utf8'))}`),
    },
    {
      name: 'new name already ignored: the old line and its emptied heading are removed, nothing duplicated',
      setup: (tree) => tree.write(G, `${HOUSE}\n.bespunky-upgrade.lock/\n`),
      expect: (tree, t) => {
        t.hasNot(G, '.bespunky-sync.lock');
        t.hasNot(G, OLD_HEADING);
        t.occurrences(G, '.bespunky-upgrade.lock/', 1);
        t.has(G, '.nx/workspace-data\n\n# Claude Code');
      },
    },
    {
      name: 'an old lock directory is still there: it and its line are left (reported), never deleted',
      setup: (tree) => {
        tree.write(G, HOUSE);
        tree.write('.bespunky-sync.lock/pid', '4242\n');
      },
      expect: (tree, t) => {
        t.ok(tree.read(G, 'utf8') === HOUSE, '.gitignore was changed');
        t.exists('.bespunky-sync.lock/pid');
      },
    },
    {
      name: 'never had the line: nothing to do',
      setup: (tree) => tree.write(G, 'node_modules\n# mentions .bespunky-sync.lock in a comment\n'),
      expect: (tree, t) =>
        t.ok(tree.read(G, 'utf8') === 'node_modules\n# mentions .bespunky-sync.lock in a comment\n', 'the file was changed'),
    },
  ],
};
