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

// ── The feature as earlier releases really shipped it (owned devcontainers, firebase on). The id and its `{}` never
//    changed, and the house never wrote a comment above it; what changed is what SURROUNDS it — and here that
//    matters: until 2ace14b it was the LAST member (no trailing comma, the JDK note after it from 0d09453), in 2ace14b
//    the last WITH a trailing comma, and from the local feature on a middle one. Each shape keeps its own neighbours,
//    so it "diverges" from the composed canonical only there, and asserts exactly what the cut must be. ────────────
const CC = 'ghcr.io/devcontainers-extra/features/claude-code';
const GH_BARE = 'ghcr.io/devcontainers/features/github-cli';
const FIREBASE_CLI = 'ghcr.io/devcontainers-extra/features/firebase-cli';
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
const MIDDLE = [`    "${FEATURE}": {},\n`, ''];
const ERAS = {
  // git show 7aafe46:…/compose.ts + layers/agent.ts + layers/firebase.ts (0.35.0 … 0.49.x; claude-code gone by 0.43.0)
  composed: { text: devcontainer(`    "${GH_BARE}": {},\n    "${FIREBASE_CLI}": {},\n    "${FEATURE}": {},\n${LOCAL_WHY}    "${LOCAL}": {}\n`), cut: MIDDLE },
  // git show 2e62f9c:plugins/project-starter/skills/new-project/assets/nx-tools/src/generators/devcontainer/devcontainer.json.tpl
  // — the LAST member: its line goes, and so does the comma it leaves trailing on firebase-cli
  '2e62f9c': {
    text: devcontainer(`    "${CC}": {},\n    "${GH_BARE}": {},\n    "${FIREBASE_CLI}": {},\n    "${FEATURE}": {}\n`),
    cut: [`    "${FIREBASE_CLI}": {},\n    "${FEATURE}": {}\n`, `    "${FIREBASE_CLI}": {}\n`],
  },
  // git show 0d09453:<same path> — still last, the JDK note after it (kept: it explains the JDK, not this feature)
  '0d09453': {
    text: devcontainer(`    "${CC}": {},\n    "${GH_BARE}": {},\n    "${FIREBASE_CLI}": {},\n    "${FEATURE}": {}\n${JDK_NOTE}`),
    cut: [`    "${FIREBASE_CLI}": {},\n    "${FEATURE}": {}\n`, `    "${FIREBASE_CLI}": {}\n`],
  },
  // git show 2ace14b:<same path> — last WITH a trailing comma
  '2ace14b': {
    text: devcontainer(`    "${CC}": {},\n    "${GH_BARE}": {},\n    "${FIREBASE_CLI}": {},\n    "${FEATURE}": {},\n${JDK_NOTE}`),
    cut: [`    "${FIREBASE_CLI}": {},\n    "${FEATURE}": {},\n`, `    "${FIREBASE_CLI}": {}\n`],
  },
  // git show 97b7851:<same path> — the local feature after it (its long comment abridged to its first line)
  '97b7851': {
    text: devcontainer(
      `    "${CC}": {},\n    "${GH_BARE}": {},\n    "${FIREBASE_CLI}": {},\n    "${FEATURE}": {},\n` +
        `    // The one LOCAL feature. An id that starts with \`./\` is a PATH resolved from the folder holding THIS\n    "${LOCAL}": {},\n${JDK_NOTE}`,
    ),
    cut: MIDDLE,
  },
};
/** devcontainer-lock.json as the devcontainer CLI writes it (git show 9c24d7e:.devcontainer/devcontainer-lock.json). */
const realLock = (tree) =>
  tree.write(
    LOCK,
    `${JSON.stringify(
      {
        features: Object.fromEntries(
          [GH_BARE, FIREBASE_CLI, FEATURE].map((id) => [id, { version: '1.0.0', resolved: `${id}@sha256:0000`, integrity: 'sha256:0000' }]),
        ),
      },
      null,
      2,
    )}\n`,
  );
const ownedEra = (era) => (tree) => {
  firebase(tree);
  tree.write(DC, ERAS[era].text);
  writeJson(tree, MARKER, { generator: '@bespunky/nx-tools:devcontainer', owned: true });
  realLock(tree);
};
const featureGone = (era) => (tree, t) => {
  const [from, to] = ERAS[era].cut;
  t.ok(tree.read(DC, 'utf8') === ERAS[era].text.replace(from, to), `devcontainer.json:\n${tree.read(DC, 'utf8')}`);
  t.ok(!readJson(tree, LOCK).features[FEATURE] && readJson(tree, LOCK).features[FIREBASE_CLI], 'its lock pin goes, the others stay');
};
const AROUND = "that release's own neighbours (claude-code, trailing commas, the JDK note) stay — the rung removes only the feature";

export default {
  name: '0.50.0 · gcloud-cli-from-image',
  ladder: ['0.50.0/gcloud-cli-from-image'],
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
