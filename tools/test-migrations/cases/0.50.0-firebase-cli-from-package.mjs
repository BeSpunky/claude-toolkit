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

// ── The feature as earlier releases really shipped it (owned devcontainers, firebase on). The id and its `{}` never
//    changed, and the house never wrote a comment above it; what changed is what SURROUNDS it — the template era's
//    claude-code feature, trailing commas, the JDK note and local features after it; the composed era's local feature.
//    The rung removes the one member, so each shape keeps its own neighbours: it "diverges" from the composed
//    canonical only there, and asserts that exactly the feature's line (and its lock pin) went. ─────────────────────
const CC = 'ghcr.io/devcontainers-extra/features/claude-code';
const GH_BARE = 'ghcr.io/devcontainers/features/github-cli';
const LOCAL = './features/bespunky-house-setup';
/** git show 0d09453:…/devcontainer/devcontainer.json.tpl — the JDK note after the last feature (0.6.0 …). */
const JDK_NOTE = `    // Note: the JDK required by the Firebase emulators (Firestore / RTDB / Storage all run
    // on the JVM) is installed via apt in .devcontainer/post-create.sh — NOT as a
    // devcontainer feature. The canonical \`ghcr.io/devcontainers/features/java\` is
    // SDKMAN-based and structurally fragile (its install fetches from github.com, which
    // intermittently fails: TLS errors / "Could not connect to server"). apt pulls from
    // Debian's package mirrors which are far more reliable, and apt runs in the container's
    // runtime network stack rather than the buildx build phase.
`;
/** git show 7aafe46:…/devcontainer/compose.ts — the local feature's `why`, as render() prints it. */
const LOCAL_WHY = `    // The one LOCAL feature (a \`./\` id is a PATH beside this file), written by the same generator. It INSTALLS
    // NOTHING: its postCreateCommand chains \`.devcontainer/post-create.bespunky.sh\` when that file exists —
    // where the house setup goes in a project whose own postCreateCommand runs something else. Feature
    // lifecycle commands are ADDITIVE (they run before this file's), so it is the one key that can run the
    // house setup in an adopted project without displacing what that project already runs.
`;
const devcontainer = (features) => `{\n  "name": "shop",\n  "features": {\n${features}  },\n  "postCreateCommand": "bash .devcontainer/post-create.sh"\n}\n`;
const ERAS = {
  // git show 7aafe46:…/compose.ts + layers/agent.ts + layers/firebase.ts (0.35.0 … 0.49.x; claude-code gone by 0.43.0)
  composed: devcontainer(`    "${GH_BARE}": {},\n    "${FEATURE}": {},\n    "${GCLOUD}": {},\n${LOCAL_WHY}    "${LOCAL}": {}\n`),
  // git show 2e62f9c:plugins/project-starter/skills/new-project/assets/nx-tools/src/generators/devcontainer/devcontainer.json.tpl
  '2e62f9c': devcontainer(`    "${CC}": {},\n    "${GH_BARE}": {},\n    "${FEATURE}": {},\n    "${GCLOUD}": {}\n`),
  // git show 0d09453:<same path> — the JDK note after the last member
  '0d09453': devcontainer(`    "${CC}": {},\n    "${GH_BARE}": {},\n    "${FEATURE}": {},\n    "${GCLOUD}": {}\n${JDK_NOTE}`),
  // git show 2ace14b:<same path> — trailing commas
  '2ace14b': devcontainer(`    "${CC}": {},\n    "${GH_BARE}": {},\n    "${FEATURE}": {},\n    "${GCLOUD}": {},\n${JDK_NOTE}`),
  // git show 97b7851:<same path> — the local feature after it (its long comment abridged to its first line)
  '97b7851': devcontainer(
    `    "${CC}": {},\n    "${GH_BARE}": {},\n    "${FEATURE}": {},\n    "${GCLOUD}": {},\n` +
      `    // The one LOCAL feature. An id that starts with \`./\` is a PATH resolved from the folder holding THIS\n    "${LOCAL}": {},\n${JDK_NOTE}`,
  ),
};
/** devcontainer-lock.json as the devcontainer CLI writes it (git show 9c24d7e:.devcontainer/devcontainer-lock.json). */
const realLock = (tree) =>
  tree.write(
    LOCK,
    `${JSON.stringify(
      {
        features: Object.fromEntries(
          [GH_BARE, FEATURE, GCLOUD].map((id) => [id, { version: '1.0.0', resolved: `${id}@sha256:0000`, integrity: 'sha256:0000' }]),
        ),
      },
      null,
      2,
    )}\n`,
  );
const ownedEra = (era) => (tree) => {
  firebaseWorkspace(tree);
  tree.write(DC, ERAS[era]);
  writeJson(tree, MARKER, { generator: '@bespunky/nx-tools:devcontainer', owned: true });
  realLock(tree);
};
const featureGone = (era) => (tree, t) => {
  t.ok(tree.read(DC, 'utf8') === ERAS[era].replace(`    "${FEATURE}": {},\n`, ''), `devcontainer.json:\n${tree.read(DC, 'utf8')}`);
  t.ok(!readJson(tree, LOCK).features[FEATURE] && readJson(tree, LOCK).features[GCLOUD], 'its lock pin goes, the others stay');
  t.ok(readJson(tree, 'package.json').devDependencies['firebase-tools'] === '15.32.1', 'firebase-tools pinned');
};
const AROUND = "that release's own neighbours (claude-code, trailing commas, the JDK note) stay — the rung removes only the feature";

export default {
  name: '0.50.0 · firebase-cli-from-package',
  ladder: ['0.50.0/firebase-cli-from-package'],
  cases: [
    {
      name: 'owned, the composed 0.35–0.49 shape: the feature line and its lock pin go — and every shape the house shipped it in',
      setup: ownedEra('composed'),
      expect: featureGone('composed'),
      historicalShapes: ['2e62f9c', '0d09453', '2ace14b', '97b7851'].map((era) => ({
        name: `template era (${era})`,
        setup: ownedEra(era),
        diverges: AROUND,
        expect: featureGone(era),
      })),
    },
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
      name: 'firebase-tools lands at its sorted place in a sorted block; appended (nothing moves) in a hand-ordered one',
      setup: (tree) => {
        firebaseWorkspace(tree, { '@nx/js': '23.1.0', nx: '23.1.0', vitest: '3.2.0' });
      },
      expect: (tree, t) => {
        const keys = Object.keys(readJson(tree, 'package.json').devDependencies);
        t.ok(keys.join() === '@nx/js,firebase-tools,nx,vitest', `sorted: ${keys}`);
      },
    },
    {
      name: 'a hand-ordered devDependencies keeps its order; firebase-tools goes last',
      setup: (tree) => firebaseWorkspace(tree, { vitest: '3.2.0', nx: '23.1.0' }),
      expect: (tree, t) => {
        const keys = Object.keys(readJson(tree, 'package.json').devDependencies);
        t.ok(keys.join() === 'vitest,nx,firebase-tools', `order kept: ${keys}`);
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
