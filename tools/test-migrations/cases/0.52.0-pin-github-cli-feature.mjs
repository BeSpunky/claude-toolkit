// 0.52.0 — the bare github-cli feature gets a version.
//
// The shapes it meets: an owned devcontainer as 0.51.3 composed it (key, comment, lock pin), an owned one with a project
// option, an adopted one whose record holds the key, an adopted one with no record (before 0.41.0, or the project's own),
// one carrying the project's options, one under another tag, one declaring both, and none at all.
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
      name: "adopted with no record of it (the project's own, or before 0.41.0), and `{}`: nothing can depend on the missing tag, so it moves too",
      setup: (tree) => {
        tree.write(DC, owned());
        tree.write(MARKER, marker({ owned: false, adopted: { houseAdded: [] } }));
        tree.write(LOCK, JSON.stringify({ features: { [BARE]: OLD_PIN } }));
      },
      expect: (tree, t) => {
        t.ok(t.read(DC) === owned().replace(`"${BARE}"`, `"${PINNED}"`), `only the key changed:\n${t.read(DC)}`);
        t.equal(Object.keys(t.json(LOCK).features), [PINNED], 'the lock moved with it');
      },
    },
    {
      name: 'no marker at all, and `{}`: the same',
      setup: (tree) => tree.write(DC, owned()),
      expect: (tree, t) => t.has(DC, `"${PINNED}": {}`),
    },
    {
      name: 'adopted, and the project changed the value the house wrote: it is theirs now, left, and reported with the fix',
      setup: (tree) => {
        tree.write(DC, owned('{ "version": "2.60.0" }'));
        tree.write(MARKER, marker({ owned: false, adopted: { houseAdded: [{ path: ['features', BARE], value: {} }] } }));
      },
      expect: (tree, t, logs) => {
        t.ok(t.read(DC) === owned('{ "version": "2.60.0" }'), 'byte-identical');
        t.ok(logs.some((l) => l.includes('carries options') && l.includes(PINNED)), `reported: ${logs.join(' | ')}`);
      },
    },
    {
      name: "the project's own option in the string shorthand, with no record: left, and reported",
      setup: (tree) => {
        tree.write(DC, owned('"2.60.0"'));
        tree.write(MARKER, marker({ owned: false }));
      },
      expect: (tree, t, logs) => {
        t.ok(t.read(DC) === owned('"2.60.0"'), 'byte-identical');
        t.ok(logs.some((l) => l.includes('carries options')), `reported: ${logs.join(' | ')}`);
      },
    },
    {
      name: 'a major tag of the project\'s own floats: left, and reported',
      setup: (tree) => {
        tree.write(DC, owned().replace(`"${BARE}"`, `"${BARE}:1"`));
        tree.write(MARKER, marker({ owned: true }));
      },
      expect: (tree, t, logs) => {
        t.has(DC, `"${BARE}:1"`);
        t.ok(logs.some((l) => l.includes(`"${BARE}:1"`) && l.includes(PINNED)), `reported: ${logs.join(' | ')}`);
      },
    },
    {
      name: 'an exact tag of the project\'s own is pinned: nothing to do, and nothing to say',
      setup: (tree) => {
        tree.write(DC, owned().replace(`"${BARE}"`, `"${BARE}:1.1.0"`));
        tree.write(MARKER, marker({ owned: true }));
      },
      expect: (tree, t, logs) => {
        t.has(DC, `"${BARE}:1.1.0"`);
        t.ok(!logs.length, `nothing to say: ${logs.join(' | ')}`);
      },
    },
    {
      name: 'a lock with no pin for it gets one, so the next build has nothing to add',
      setup: (tree) => {
        tree.write(DC, owned());
        tree.write(MARKER, marker({ owned: true }));
        tree.write(LOCK, JSON.stringify({ features: { 'ghcr.io/aaa/other': { version: '1' } } }));
      },
      expect: (tree, t) => t.equal(Object.keys(t.json(LOCK).features), ['ghcr.io/aaa/other', PINNED], 'pinned, sorted'),
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
        t.equal(t.json(LOCK).features, { [PINNED]: { version: '1.1.3', resolved: `${BARE}@${DIGEST}`, integrity: DIGEST } }, 'its pin went, and the one it keeps is pinned');
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
