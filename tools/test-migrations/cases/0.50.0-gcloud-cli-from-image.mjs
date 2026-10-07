// 0.50.0 — gcloud moves from the unpinned jajera feature into a pinned archive in the image's package layer. The shapes: OWNED
// (the feature, its comment and its lock pin go), ADOPTED with the merge's record (goes), ADOPTED by the project's own
// hand (stays, reported), and a workspace without Firebase (nothing).
import { createRequire } from 'node:module';

const { writeJson, readJson } = createRequire(import.meta.url)('@nx/devkit');

const DC = '.devcontainer/devcontainer.json';
const MARKER = '.devcontainer/.bespunky-devcontainer.json';
const LOCK = '.devcontainer/devcontainer-lock.json';
const FEATURE = 'ghcr.io/jajera/features/gcloud-cli';
const GH = 'ghcr.io/devcontainers/features/github-cli:1';

const DEVCONTAINER = `{
  "features": {
    "${GH}": {},
    // Google Cloud CLI.
    "${FEATURE}": {}
  }
}
`;
const firebase = (tree) => writeJson(tree, 'firebase.json', {});
const lock = (tree) => tree.write(LOCK, `${JSON.stringify({ features: { [FEATURE]: { version: '1.0.1' }, [GH]: { version: '1.1.0' } } }, null, 2)}\n`);

export default {
  name: '0.50.0 · gcloud-cli-from-image',
  ladder: ['0.50.0/gcloud-cli-from-image'],
  cases: [
    {
      name: 'owned: the feature, its comment and its lock pin go — nothing else',
      setup: (tree) => {
        firebase(tree);
        tree.write(DC, DEVCONTAINER);
        writeJson(tree, MARKER, { owned: true });
        lock(tree);
      },
      expect: (tree, t) => {
        t.ok(tree.read(DC, 'utf8') === DEVCONTAINER.replace(`,\n    // Google Cloud CLI.\n    "${FEATURE}": {}`, ''), `devcontainer.json:\n${tree.read(DC, 'utf8')}`);
        t.ok(JSON.stringify(readJson(tree, LOCK).features) === JSON.stringify({ [GH]: { version: '1.1.0' } }), 'the lock pin goes, the other stays');
      },
    },
    {
      name: 'adopted, the merge recorded it: it goes',
      setup: (tree) => {
        firebase(tree);
        tree.write(DC, DEVCONTAINER);
        writeJson(tree, MARKER, { owned: false, adopted: { houseAdded: [{ path: ['features', FEATURE], value: {} }] } });
      },
      expect: (tree, t) => t.ok(!tree.read(DC, 'utf8').includes(FEATURE), 'feature still declared'),
    },
    {
      name: 'adopted, the project wrote it: it stays, with its lock pin',
      setup: (tree) => {
        firebase(tree);
        tree.write(DC, DEVCONTAINER);
        writeJson(tree, MARKER, { owned: false });
        lock(tree);
      },
      expect: (tree, t) => {
        t.ok(tree.read(DC, 'utf8') === DEVCONTAINER, 'untouched');
        t.ok(readJson(tree, LOCK).features[FEATURE], 'its pin kept');
      },
    },
    {
      name: 'no firebase.json: nothing',
      setup: (tree) => {
        tree.write(DC, DEVCONTAINER);
        writeJson(tree, MARKER, { owned: true });
      },
      expect: (tree, t) => t.ok(tree.read(DC, 'utf8') === DEVCONTAINER, 'untouched'),
    },
  ],
};
