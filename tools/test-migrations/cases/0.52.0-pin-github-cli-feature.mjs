// 0.52.0 — the bare github-cli feature gets a version, where the house wrote it.
//
// The shapes it meets: an owned devcontainer as 0.51.3 composed it (key, comment, lock pin), an owned one with a project
// option, an adopted one whose record holds the key, an adopted one that adopted before the record (0.41.0) or whose
// project wrote it, one already tagged, one declaring both, and none at all.
const DC = '.devcontainer/devcontainer.json';
const LOCK = '.devcontainer/devcontainer-lock.json';
const MARKER = '.devcontainer/.bespunky-devcontainer.json';
const BARE = 'ghcr.io/devcontainers/features/github-cli';
const PINNED = `${BARE}:1.1.3`;
const DIGEST = 'sha256:bd7ab48a832228f633239277552c30b353867fef2e5b037e064b4e64f0b843f2';
const OLD_PIN = { version: '1.1.0', resolved: `${BARE}@sha256:d22f`, integrity: 'sha256:d22f' };
const owned = (value = '{}') => `{\n  "features": {\n    // The GitHub CLI.\n    "${BARE}": ${value},\n    "./features/bespunky-house-setup": {}\n  }\n}\n`;
const marker = (m) => JSON.stringify(m, null, 2) + '\n';
const features = (t) => Object.keys(JSON.parse(t.read(DC).replace(/^\s*\/\/.*$/gm, '')).features);

export default {
  name: '0.52.0 · pin-github-cli-feature',
  ladder: ['0.52.0/pin-github-cli-feature'],
  cases: [
    {
      name: 'owned: the key is renamed, its comment stays, the lock pin moves to the digest of the tag, in sorted order',
      setup: (tree) => {
        tree.write(DC, owned());
        tree.write(MARKER, marker({ owned: true }));
        tree.write(LOCK, JSON.stringify({ features: { [BARE]: OLD_PIN, 'ghcr.io/zzz/other': { version: '1' }, 'ghcr.io/aaa/other': { version: '1' } } }, null, 2));
      },
      expect: (tree, t) => {
        t.ok(t.read(DC) === owned().replace(`"${BARE}"`, `"${PINNED}"`), `only the key changed:\n${t.read(DC)}`);
        const lock = t.json(LOCK).features;
        t.equal(Object.keys(lock), ['ghcr.io/aaa/other', PINNED, 'ghcr.io/zzz/other'], 'old pin gone, new one sorted in');
        t.equal(lock[PINNED], { version: '1.1.3', resolved: `${BARE}@${DIGEST}`, integrity: DIGEST }, 'the pin is the tag');
      },
    },
    {
      name: "owned, with the project's option on it: the value is kept, and no lock is created",
      setup: (tree) => {
        tree.write(DC, owned('{ "version": "2.60.0" }'));
        tree.write(MARKER, marker({ owned: true }));
      },
      expect: (tree, t) => {
        t.has(DC, `"${PINNED}": { "version": "2.60.0" },`);
        t.missing(LOCK);
      },
    },
    {
      name: 'adopted, and the record says the house added it: renamed, and the record moves with it, so the generator still knows it',
      setup: (tree) => {
        tree.write(DC, owned());
        tree.write(MARKER, marker({ owned: false, adopted: { houseAdded: [{ path: ['features', BARE], value: {} }, { path: ['mounts'], member: 'x' }] } }));
      },
      expect: (tree, t) => {
        t.equal(features(t), [PINNED, './features/bespunky-house-setup'], 'renamed');
        t.equal(t.json(MARKER).adopted.houseAdded[0], { path: ['features', PINNED], value: {} }, 'the record follows');
        t.equal(t.json(MARKER).adopted.houseAdded[1], { path: ['mounts'], member: 'x' }, 'the rest of the record stays');
      },
    },
    {
      name: "adopted with no record of it (the project's own, or before 0.41.0): left, and reported with the fix",
      setup: (tree) => {
        tree.write(DC, owned());
        tree.write(MARKER, marker({ owned: false, adopted: { houseAdded: [] } }));
        tree.write(LOCK, JSON.stringify({ features: { [BARE]: OLD_PIN } }));
      },
      expect: (tree, t, logs) => {
        t.ok(t.read(DC) === owned(), 'byte-identical');
        t.ok(t.json(LOCK).features[BARE], 'the pin stays with it');
        t.ok(logs.some((l) => l.includes('was not written by the house') && l.includes(PINNED)), `reported: ${logs.join(' | ')}`);
      },
    },
    {
      name: 'adopted, and the project changed the value the house wrote: it is theirs now, and left',
      setup: (tree) => {
        tree.write(DC, owned('{ "version": "2.60.0" }'));
        tree.write(MARKER, marker({ owned: false, adopted: { houseAdded: [{ path: ['features', BARE], value: {} }] } }));
      },
      expect: (tree, t) => t.ok(t.read(DC) === owned('{ "version": "2.60.0" }'), 'byte-identical'),
    },
    {
      name: 'no marker at all: not known to be the house\'s, so left',
      setup: (tree) => tree.write(DC, owned()),
      expect: (tree, t) => t.ok(t.read(DC) === owned(), 'byte-identical'),
    },
    {
      name: 'a key with a tag already is pinned: nothing to do',
      setup: (tree) => {
        tree.write(DC, owned().replace(`"${BARE}"`, `"${BARE}:1"`));
        tree.write(MARKER, marker({ owned: true }));
      },
      expect: (tree, t, logs) => {
        t.has(DC, `"${BARE}:1"`);
        t.ok(!logs.length, `nothing to say: ${logs.join(' | ')}`);
      },
    },
    {
      name: 'owned and declared twice: the bare one goes, with its pin',
      setup: (tree) => {
        tree.write(DC, `{\n  "features": {\n    "${BARE}": {},\n    "${PINNED}": {}\n  }\n}\n`);
        tree.write(MARKER, marker({ owned: true }));
        tree.write(LOCK, JSON.stringify({ features: { [BARE]: OLD_PIN } }));
      },
      expect: (tree, t) => {
        t.equal(features(t), [PINNED], 'one key');
        t.ok(!t.json(LOCK).features[BARE], 'its pin went too');
      },
    },
    {
      name: 'an unreadable devcontainer.json is left and reported',
      setup: (tree) => tree.write(DC, `{ "features": { "${BARE}": {}, broken`),
      expect: (tree, t, logs) => {
        t.has(DC, 'broken');
        t.ok(logs.some((l) => l.includes('could not be read')), `reported: ${logs.join(' | ')}`);
      },
    },
  ],
};
