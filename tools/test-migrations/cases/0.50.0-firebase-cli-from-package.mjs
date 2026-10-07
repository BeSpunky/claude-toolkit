// 0.50.0 — the Firebase CLI moves from an unpinned image feature to the project's exact firebase-tools devDependency.
// The shapes: an OWNED devcontainer (the feature, its comment and its lock pin go), an ADOPTED one whose merge RECORDED
// the feature (goes), an adopted one where the project wrote it (stays, reported), a project's own firebase-tools pin
// (kept), a `latest` one (pinned to what is installed), and a workspace without Firebase (nothing).
import { createRequire } from 'node:module';

const { writeJson, readJson } = createRequire(import.meta.url)('@nx/devkit');

const DC = '.devcontainer/devcontainer.json';
const MARKER = '.devcontainer/.bespunky-devcontainer.json';
const LOCK = '.devcontainer/devcontainer-lock.json';
const FEATURE = 'ghcr.io/devcontainers-extra/features/firebase-cli';
const GCLOUD = 'ghcr.io/jajera/features/gcloud-cli';

const DEVCONTAINER = `{
  "name": "shop",
  "features": {
    "ghcr.io/devcontainers/features/github-cli:1": {},
    // The Firebase CLI.
    "${FEATURE}": {},
    "${GCLOUD}": {}
  }
}
`;
const firebaseWorkspace = (tree, devDeps = { nx: '23.1.0' }) => {
  writeJson(tree, 'firebase.json', {});
  writeJson(tree, 'package.json', { name: 'shop', devDependencies: devDeps });
};
const lock = (tree) =>
  tree.write(LOCK, `${JSON.stringify({ features: { [FEATURE]: { version: '1.0.0' }, [GCLOUD]: { version: '1.0.1' } } }, null, 2)}\n`);

export default {
  name: '0.50.0 · firebase-cli-from-package',
  ladder: ['0.50.0/firebase-cli-from-package'],
  cases: [
    {
      name: 'owned: firebase-tools declared exactly; the feature, its comment and its lock pin go — nothing else',
      setup: (tree) => {
        firebaseWorkspace(tree);
        tree.write(DC, DEVCONTAINER);
        writeJson(tree, MARKER, { generator: '@bespunky/nx-tools:devcontainer', owned: true });
        lock(tree);
      },
      expect: (tree, t) => {
        t.ok(readJson(tree, 'package.json').devDependencies['firebase-tools'] === '15.32.1', 'firebase-tools pinned');
        t.ok(tree.read(DC, 'utf8') === DEVCONTAINER.replace(`    // The Firebase CLI.\n    "${FEATURE}": {},\n`, ''), `devcontainer.json:\n${tree.read(DC, 'utf8')}`);
        t.ok(JSON.stringify(readJson(tree, LOCK).features) === JSON.stringify({ [GCLOUD]: { version: '1.0.1' } }), 'the lock pin goes, the other stays');
      },
    },
    {
      name: 'adopted, the merge recorded the feature: it goes',
      setup: (tree) => {
        firebaseWorkspace(tree);
        tree.write(DC, DEVCONTAINER);
        writeJson(tree, MARKER, { owned: false, adopted: { houseAdded: [{ path: ['features', FEATURE], value: {} }] } });
      },
      expect: (tree, t) => t.ok(!tree.read(DC, 'utf8').includes(FEATURE), 'feature still declared'),
    },
    {
      name: 'adopted, the project wrote the feature: it stays (something outside the workspace may use it)',
      setup: (tree) => {
        firebaseWorkspace(tree);
        tree.write(DC, DEVCONTAINER);
        writeJson(tree, MARKER, { owned: false });
        lock(tree);
      },
      expect: (tree, t) => {
        t.ok(tree.read(DC, 'utf8') === DEVCONTAINER, 'the project\'s devcontainer untouched');
        t.ok(readJson(tree, LOCK).features[FEATURE], 'its lock pin kept with it');
        t.ok(readJson(tree, 'package.json').devDependencies['firebase-tools'] === '15.32.1', 'the devDependency still added');
      },
    },
    {
      name: "the project's own firebase-tools pin is kept",
      setup: (tree) => firebaseWorkspace(tree, { 'firebase-tools': '^14.20.0' }),
      expect: (tree, t) => t.ok(readJson(tree, 'package.json').devDependencies['firebase-tools'] === '^14.20.0', 'kept'),
    },
    {
      name: '`"firebase-tools": "latest"` → the installed version',
      setup: (tree) => {
        firebaseWorkspace(tree, { 'firebase-tools': 'latest' });
        writeJson(tree, 'node_modules/firebase-tools/package.json', { name: 'firebase-tools', version: '15.30.0' });
      },
      expect: (tree, t) => t.ok(readJson(tree, 'package.json').devDependencies['firebase-tools'] === '15.30.0', `got ${readJson(tree, 'package.json').devDependencies['firebase-tools']}`),
    },
    {
      name: 'no firebase.json (no Firebase layer): nothing',
      setup: (tree) => {
        tree.write(DC, DEVCONTAINER);
        writeJson(tree, MARKER, { owned: true });
      },
      expect: (tree, t) => {
        t.ok(tree.read(DC, 'utf8') === DEVCONTAINER, 'untouched');
        t.ok(!readJson(tree, 'package.json').devDependencies?.['firebase-tools'], 'no devDependency');
      },
    },
  ],
};
