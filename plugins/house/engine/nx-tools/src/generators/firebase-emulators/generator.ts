// House generator: the FIREBASE CORE — the emulator suite, Cloud Functions, App Hosting config and their tooling.
// Framework-neutral: it needs only the Nx floor, and runs the same for an Angular app, a plain npm repo, or a
// repo with no frontend at all. Idempotent and safe in upgrade mode.
//
// THE CLIENT IS NOT HERE. What an APP needs to talk to Firebase (environment files, SDK initialisation, the
// provider in its bootstrap, the browser SDK) depends on its framework, so it is the `firebase-client`
// generator's job, done through the app's stack adapter (src/adapters/<stack>/firebase-client.ts). `--project`
// composes it, so `nx g @bespunky/nx-tools:firebase-emulators --project=<app>` still retrofits Firebase onto an
// app in one command.
//
// IMPORTANT: this generator NEVER writes `.firebaserc`. The cloud-project linkage is the
// Firebase CLI's responsibility — `firebase use --add` validates against the user's actual
// account and writes `.firebaserc` properly. Fabricating one here would lie about the cloud
// state and break `firebase deploy` / `firebase use` the moment the user touches them.
// Emulators don't need `.firebaserc`: the launch script (tools/emulators.sh) passes `--project`
// explicitly, DERIVING it from the CLIENT APP's dev environment file (its single source of truth) and falling
// back to `demo-<workspaceName>`. The `demo-` prefix is Firebase's documented convention for
// "offline only, no cloud calls," so emulators work without login and without a real GCP project.
//
// THE CLIENT APP — whose env files the scripts derive project ids from — is `--clientApp` (or `--project`)
// when given, else the app already wired with the Firebase client (detected through its adapter, never
// declared), else none: the scripts then fall back to `demo-<workspaceName>` / `.firebaserc`.
//
// Writes:
//   - firebase.json     (workspace root) — emulator suite config (auth/firestore/storage/functions/ui),
//                        singleProjectMode, all emulators bound to 0.0.0.0 for Docker/devcontainer
//                        compatibility, AND a `functions` block pointing at the built Nx output
//                        (dist/<functions root>). The functions block is REQUIRED: configuring the
//                        functions emulator with no backend behind it makes `emulators:start`
//                        fatally abort. The generator asserts the `emulators` + `functions` keys
//                        and preserves any other top-level keys the user added. NO top-level `hosting`
//                        block — the BeSpunky default is Firebase App Hosting, configured in apphosting.yaml.
//                        The `firestore` / `storage` keys (the RULES) are the project's: written only by
//                        --seedRules (below), never re-asserted.
//   - firebase/{firestore.rules,storage.rules} — SEEDED (never owned) and only with --seedRules, which the
//                        planner passes only when this run CREATES the layer (ensured, and not already in the
//                        workspace: `new`, or `add-layer firebase` on a project without it) — never on an upgrade,
//                        and never on a re-ensure: a project with no rules in the repo keeps them in the Firebase
//                        console (a seed plus a deploy target would overwrite the live rules), and its local
//                        emulators run open (a deny-all seed would break every local read and write). Deny-all, and
//                        MARKED as a seed: the deploy skips a file that still carries the marker, so nothing the
//                        house wrote reaches production unreviewed. NO indexes file: JSON cannot carry the marker,
//                        so a seeded one would be indistinguishable from the project's own — and a deploy with
//                        `--force` DELETES every live index the file does not list. The emulator needs none; an
//                        indexes file the project declares (`firebase init firestore` pulls the live one) is its own.
//   - apphosting.yaml (+ apphosting.staging.yaml with --staging) — only with a client app, and only if absent, in the
//                        directory App Hosting already reads for it (else the workspace root; apphosting-config.ts);
//                        a nearer apphosting*.yaml shadowing a farther one is warned about on every run:
//                        App Hosting builds and serves a web app, so a core-only repo (functions + emulators)
//                        has nothing for it to deploy. A later sync seeds it once a client app is wired.
//   - .gitignore        — emulator debug logs, the working data dirs, <functions root>/.secret.local and the
//                        emulator's opt-in <functions root>/.secret.sandbox.local.
//   - <appsDir>/functions/ — Cloud Functions as a first-class Nx app, in the workspace's apps directory (or wherever
//                        a `functions` project already lives): esbuild-bundled to dist/<functions root> with a
//                        generated deploy-manifest package.json; runtime deps at the WORKSPACE ROOT. Source
//                        files are written only if absent; its house targets are generator-owned.
//   - firebase/         — the emulator suite as its own workspace-level Nx project: `emulators`,
//                        `emulators:<svc>`, `seed:build`, `reset`, and `deploy` (the rules and indexes
//                        firebase.json declares — tools/firebase-deploy-rules.mjs). User-added targets are preserved.
//   - tools/firebase-deploy.mjs, tools/firebase-deploy-rules.mjs — the deploy runners (owned, rewritten every run).
//   THE DEPLOY CONTRACT (what `nx affected -t deploy` — by hand or the `ci` layer — relies on): every deployable
//   house project has a target named exactly `deploy` that runs non-interactively when given `--non-interactive`,
//   forwards every extra argument to the Firebase CLI (`--project=<alias>` under run-many/affected, `-P <alias>`
//   under `nx run`, or a named configuration's `args`) — through a SHELL, as Nx run-commands does (each argument
//   double-quoted: `$` and backticks are still expanded — escape them with a backslash) — never caches, never runs beside another task
//   (`parallelism: false` — two deploys must not race one Firebase project), builds what it ships through Nx
//   (`dependsOn: build`), and declares as `{workspaceRoot}/…` inputs exactly the root files whose change changes
//   what ships: firebase.json, .firebaserc and the rules files it declares outside the suite project. Never the
//   deploy RUNNERS: a toolkit release that only rewrites tools/firebase-deploy*.mjs ships nothing new, so it must
//   not mark a deploy affected. `cache`, `parallelism` and `dependsOn: build` are re-asserted on every upgrade
//   (DEPLOY_CONTRACT — a project value that differed is reported); `lint` in `dependsOn` is a quality gate the
//   project may drop. The rules deploy refuses a declared rules file its inputs do not watch, so what affected
//   sees and what the deploy ships cannot drift apart.
//   Both projects are HOUSE PROJECTS (_utils/project-files): found by project, created the way this workspace
//   defines projects (a project.json, or a package.json workspace member under TS-solution linking).
//   - tools/{emulators,emulator-data,push-secrets,firebase-welcome}.sh, tools/emulator-ports.mjs,
//                        tools/seed/* — the launch path, data lifecycle (and the one port table
//                        the scripts read, projected from emulator-ports.ts), secrets push, cloud-linkage banner, and
//                        the seed applier (tools/seed/apply.mjs), and the declarative seed worlds
//                        (world.mjs and the seeds README are user-owned once written).
//   - tools/emulator-project.mjs, tools/emulator-secrets.cjs, tools/functions-esbuild.config.cjs — what a local run
//                        can reach: the suite's offline `demo-` project id (the real one only when environment.ts
//                        commits a real service), and the Functions emulator's inert secrets — written by every
//                        functions build (the esbuild config's plugin) and overlaid at launch.
//   - root eslint.config.mjs — best-effort insertion of the fail-closed platform firewall (src/platform): its own
//                        rule over `platformConstraints`; untagged code projects classified then (or reported),
//                        and the platform sync generator registered on lint for the projects made later.
//
// No longer here: the nx.json TUI switch. It is a property of the DEV LOOP (one multi-process stack — `serve`,
// the dev engine), not of Firebase, and belongs to the generator that owns
// that loop.
import { seedServedApps } from '../dev/generator';
import {
  type Tree,
  type GeneratorCallback,
  type TargetConfiguration,
  formatFiles,
  offsetFromRoot,
  installPackagesTask,
  readJson,
  readProjectConfiguration,
  writeJson,
  logger,
} from '@nx/devkit';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { adapterOf, applicationsWith } from '../../adapters/registry';
import { hasDependency } from '../../layers/evidence';
import { HOUSE_EMULATORS, defaultPort, renderEmulatorPortsModule } from './emulator-ports';
import { describeShadow, effectiveAppHostingDir, shadowedAppHostingConfigs } from './apphosting-config';
import firebaseClientGenerator from '../firebase-client/generator';
import { ensureHouseProject, type HouseProjectHome } from '../_utils/project-files';
import { firebaseHomes } from './homes';
import { houseLintTarget } from '../_utils/lint-inference';
import { applyJsonChanges } from '../_utils/json-edits';
import { resolveAppsDir } from '../_utils/workspace-layout';
import { rootTsconfig } from '../_utils/linking';
import { workspaceIdentity } from '../_utils/workspace-identity';
import { nxInvocation } from '../_utils/nx-host';
import {
  FIREWALL_CONFIG,
  classifyUntaggedProjects,
  firewallSnippet,
  insertPlatformFirewall,
  platformCommand,
  platformExternals,
  registerPlatformSync,
} from '../../platform';
import { declareDependencies, declaredSpec, floatingAdditions } from '../_utils/dependencies';
import { isPinnedSpec } from '../_utils/version-spec';
import { nodeVersionFile, projectNodeMajor } from '../_utils/node-version';
import { FIREBASE_ADMIN_VERSION, FIREBASE_FUNCTIONS_VERSION, FIREBASE_TOOLS_VERSION } from '../_utils/versions';
import { FUNCTIONS_NODE_RUNTIMES } from '../_utils/firebase-compat';

interface FirebaseEmulatorsSchema {
  /** Also attach the Firebase client to this app (composes `firebase-client`), and make it the client app. */
  project?: string;
  /** The app whose env files the suite's scripts derive project ids from, WITHOUT attaching anything to it. */
  clientApp?: string;
  workspaceName?: string;
  /** Opt-in: the staging App Hosting config (and, with --project, the staging env bundle). */
  staging?: boolean;
  /** See wireProviders in schema.json — wiring is a BASELINE act, never a sync-time one. */
  wireProviders?: boolean;
  /** Seed deny-all, marked rules for the services firebase.json declares none for — ONLY when ensuring the layer. */
  seedRules?: boolean;
}

// The canonical `emulators` block. Every backend-service emulator binds to `0.0.0.0`
// (all interfaces) — required when running inside Docker / devcontainers, where the
// firebase-tools probe (`127.0.0.1:<port>`) otherwise fails with "Port X is not open on
// localhost (127.0.0.1)" because the emulator bound to ::1 (IPv6) or a container-internal
// interface only.
function canonicalEmulatorsBlock() {
  // The ui is `enabled: true` explicitly; every emulator binds 0.0.0.0. Ports: emulator-ports.ts (one table).
  return {
    ...Object.fromEntries(
      HOUSE_EMULATORS.map((name) => [
        name,
        { ...(name === 'ui' ? { enabled: true } : {}), host: '0.0.0.0', port: defaultPort(name) },
      ]),
    ),
    singleProjectMode: true,
  };
}

// The canonical `functions` block — REQUIRED whenever the functions emulator is configured:
// without a functions backend behind it, `firebase emulators:start` fatally aborts. The
// source points at the BUILT Nx output (dist/<functions root>, which carries a generated
// package.json).
//
// NO `predeploy`. Nx owns the build: `nx run functions:deploy` depends on `build` (and `lint`), so the task graph
// orders, caches and — under `affected` — sees it. A predeploy that ran `nx build` again built the bundle TWICE on
// every deploy (a real second build wherever the build is not cached — CI, first of all) and hid an Nx run inside
// an Nx task. Deploy through Nx (by hand or CI), not a raw `firebase deploy`.
//
// `configDir` points Firebase's params files — `.env`, `.env.<projectId>`, and the emulator-only
// `.env.local` — at the functions SOURCE directory, read in place by both the emulator and deploy.
// Without it they are read from the built bundle, which only ever received `.env` (as a build asset):
// the emulator-only override channel was dead, and a project could not aim a param at a test target.
function canonicalFunctionsBlock(functions: HouseProjectHome) {
  return [
    {
      source: distOf(functions),
      configDir: functions.root,
      codebase: 'default',
      disallowLegacyRuntimeConfig: true,
      ignore: ['node_modules', '.git', 'firebase-debug.log', 'firebase-debug.*.log', '*.local'],
    },
  ];
}

/**
 * THE DEPLOY CONTRACT's re-asserted values (header): what `nx affected -t deploy` relies on in every `deploy` target.
 * A cached deploy is a skipped deploy; two deploys at once race one Firebase project; a deploy that does not build
 * first ships yesterday's bundle. (`functions:deploy` builds; the rules deploy has nothing to build.)
 */
const DEPLOY_CONTRACT = { cache: false, parallelism: false };
const BUILDS_WHAT_IT_SHIPS = { ...DEPLOY_CONTRACT, dependsOn: ['build'] };

/** The root files every Firebase deploy reads — inputs of every deploy target, so `affected` sees them. */
const FIREBASE_ROOT_INPUTS = ['{workspaceRoot}/firebase.json', '{workspaceRoot}/.firebaserc'];

/** Where `firebase init` puts the rules by default — watched even before firebase.json names them. */
const CONVENTIONAL_RULES_FILES = ['firestore.rules', 'firestore.indexes.json', 'storage.rules'];

/** Every rules / indexes file firebase.json declares (`firestore` and `storage` — an object, or one per database / bucket). */
export function declaredRulesFiles(firebaseJson: Record<string, unknown>): string[] {
  const entries = (key: string) => {
    const value = firebaseJson[key];
    return (Array.isArray(value) ? value : value ? [value] : []) as Array<Record<string, unknown>>;
  };
  const paths = [
    ...entries('firestore').flatMap((entry) => [entry?.rules, entry?.indexes]),
    ...entries('storage').map((entry) => entry?.rules),
  ];
  return [...new Set(paths.filter((path): path is string => typeof path === 'string' && path.length > 0))];
}

/** A line every seeded rules file carries until a human makes the rules theirs — the deploy skips a file with it. */
export const RULES_SEED_MARKER = 'bespunky:house-seed';

// .gitignore additions (idempotency marker: `/.emulator-data`).
const GITIGNORE_BLOCK = `# Firebase emulator-generated logs (firebase-debug.log, firestore-debug.log, ui-debug.log, …)
*-debug.log
firebase-debug.*.log

# The emulator working data — the cache \`nx serve\` imports/exports each run. Ephemeral and
# machine-local; the committed seed worlds live in tools/emulator-seeds/ (see its README).
/.emulator-data

# Isolated port-offset stacks (\`nx serve <app> --port-offset=N\`): each gets its own data dir
# and a generated offset firebase.json. Ephemeral and machine-local.
/.emulator-data-*
/.firebase.offset-*.json
`;

/** Where the Cloud Functions bundle is built to — what firebase.json deploys and the emulator loads. */
const distOf = (functions: HouseProjectHome) => `dist/${functions.root}`;

/** The gitignored local secrets file of the Cloud Functions project — PRODUCTION's values, push-secrets' source. */
const secretsOf = (functions: HouseProjectHome) => `${functions.root}/.secret.local`;

/** The gitignored, opt-in SANDBOX secrets the emulator may load (tools/emulators.sh) — never production's. */
const sandboxSecretsOf = (functions: HouseProjectHome) => `${functions.root}/.secret.sandbox.local`;

// Local Functions secrets ignore — kept separate from GITIGNORE_BLOCK (its own idempotency
// marker: the secrets path itself) so a project already past the emulator block self-heals to ignore
// .secret.local on upgrade.
const secretGitignoreBlock = (functions: HouseProjectHome) => `# Local Cloud Functions secrets — the gitignored source for \`nx run ${functions.name}:push-secrets\`
# (which sets them in Google Secret Manager for production). Never fed to the emulator.
# The committed ${secretsOf(functions)}.example documents the shape.
${secretsOf(functions)}
`;

// The sandbox secrets ignore — its own block under its own marker (the path), so a project already past the
// secrets block above still gains it on upgrade.
const sandboxGitignoreBlock = (functions: HouseProjectHome) => `# Opt-in SANDBOX credentials for the Functions emulator (a test bot, a sandbox account — never production's).
# Creating the file arms the emulator with them; tools/emulators.sh says so on every launch.
${sandboxSecretsOf(functions)}
`;

// The export staging dirs firebase-tools leaves in the WORKSPACE ROOT when an export is cut short. It stages every
// export (`--export-on-exit`, `emulators:export`) in `mkdtempSync('firebase-export-<ms>')` — relative, so the cwd —
// and only renames it over the data dir once it is complete (firebase-tools lib/emulator/hubExport.js). A suite killed
// mid-export (its keeper's deadline, an abandoned stop) leaves that dir behind holding the emulated world — user data,
// auth users — where `git add -A` would commit it. Its own block under its own marker, so a project already past the
// blocks above gains it on upgrade.
const EXPORT_STAGING_MARKER = '/firebase-export-*';
const EXPORT_STAGING_GITIGNORE_BLOCK = `# Firebase emulator export staging dirs (firebase-export-<ms>XXXXXX/), left in the workspace root when an export
# is interrupted. They hold emulator data (users, documents) — never commit them; delete one once no suite is running.
${EXPORT_STAGING_MARKER}
`;

/**
 * `firebase init <feature>` run with no active project templates the literal `undefined` where the project id
 * belongs — e.g. auth's `support@undefined.firebaseapp.com` (firebase-tools init/features/auth.js). The house
 * ships no `.firebaserc` by design, so a house repo is exactly where that happens. Not ours to repair (the right
 * value is the real project's, which no generator can know) — relayed, so it is fixed before it ships.
 */
function warnUnresolvedProjectTemplates(firebaseJson: Record<string, unknown>): void {
  const text = JSON.stringify(firebaseJson);
  if (!text.includes('undefined.firebaseapp.com') && !text.includes('@undefined.')) return;
  logger.warn(
    '[firebase-emulators] firebase.json contains "undefined.firebaseapp.com" — written by `firebase init` with no active ' +
      'project (firebase-tools templates the missing project id as "undefined"). Replace it with your project\'s value, ' +
      'and run `firebase use --add` before any further `firebase init <feature>`.',
  );
}

/**
 * The generator-owned seed tooling: the per-world entry `build.mjs` and the applier `apply.mjs` it runs a world
 * through. One function because the two are one contract (build.mjs imports applyWorld from apply.mjs), and
 * exported because migration 0.50.0/split-seed-applier must leave a workspace whose world.mjs already imports
 * from apply.mjs runnable on a bare `nx migrate`, before this generator has run.
 */
export function writeSeedTooling(tree: Tree): void {
  const template = (name: string) => readFileSync(join(__dirname, name), 'utf8');
  tree.write('tools/seed/build.mjs', template('seed-build.mjs.tpl'));
  tree.write('tools/seed/apply.mjs', template('seed-apply.mjs.tpl'));
}

export default async function firebaseEmulatorsGenerator(
  tree: Tree,
  options: FirebaseEmulatorsSchema = {}
): Promise<GeneratorCallback> {
  const workspaceName = options.workspaceName ?? options.project ?? workspaceIdentity(tree);
  const template = (name: string) => readFileSync(join(__dirname, name), 'utf8');
  const substitute = (tpl: string) => tpl.split('{{workspaceName}}').join(workspaceName);

  // 0) The client half first, when asked for: it writes the env files the scripts below derive ids from.
  const clientCallback: GeneratorCallback = options.project
    ? await firebaseClientGenerator(tree, {
        project: options.project,
        workspaceName,
        staging: options.staging,
        wireProviders: options.wireProviders,
        skipFormat: true,
      })
    : () => {};
  const clientApp = resolveClientApp(tree, options.project ?? options.clientApp);
  const clientEnv = clientApp ? adapterOf(tree, clientApp)?.env?.files(tree, clientApp) : undefined;

  // Where the two house projects live — resolved ONCE, before anything names a path inside them: every path below
  // (firebase.json's source, the gitignore entry, the scripts' secrets file) follows the functions project's
  // actual root, and every `nx` command its actual name. A new workspace puts it in its apps directory.
  const appsDir = resolveAppsDir(tree);
  const { functions, suite } = firebaseHomes(tree);
  const functionsPaths = (tpl: string) =>
    tpl.split('{{functionsRoot}}').join(functions.root).split('{{functionsDist}}').join(distOf(functions)).split('{{functionsProject}}').join(functions.name);

  // 1) firebase.json at workspace root. The `emulators` and `functions` keys are generator-owned (asserted to
  //    canonical on every run); any other top-level keys the user added are preserved.
  // How functions is linted where the workspace lints: @nx/eslint/plugin's inferred target (registered if need be), or
  // an explicit `eslint .` where inference is off — never the deprecated @nx/eslint:lint executor (_utils/lint-inference).
  const lint = hasDependency(tree, '@nx/eslint') ? houseLintTarget(tree, functions.root) : undefined;
  const firebaseJson: Record<string, unknown> = tree.exists('firebase.json') ? readJson(tree, 'firebase.json') : {};
  firebaseJson.emulators = canonicalEmulatorsBlock();
  firebaseJson.functions = canonicalFunctionsBlock(functions);
  // The rules — seeded only when the layer is being CREATED, for services the project declares none for.
  if (options.seedRules) seedRules(tree, firebaseJson, suite.root, template);
  // In place where it exists: the project's own keys (hosting, rules, …) keep their form; only what changed is written.
  if (tree.exists('firebase.json')) tree.write('firebase.json', applyJsonChanges(tree.read('firebase.json', 'utf8')!, readJson(tree, 'firebase.json'), firebaseJson));
  else writeJson(tree, 'firebase.json', firebaseJson);
  warnUnresolvedProjectTemplates(firebaseJson);

  // 1b) App Hosting's deploy config — seeded, never clobbered, and only for a CLIENT APP: App Hosting builds and
  //     serves a web app, so without one there is nothing for it to deploy (and the staging override, which
  //     builds the client app's `staging` configuration, nothing to name). Functions deploy without it.
  //     WHERE: the directory App Hosting already reads for a backend rooted at the client app (apphosting-config.ts:
  //     the nearest one with any apphosting*.yaml, walking up), else the workspace root — which that walk reaches.
  //     Never a second home: a seed beside a file the project moved would be shadowed (or shadow it), silently.
  if (clientApp) {
    const home = effectiveAppHostingDir(tree, readProjectConfiguration(tree, clientApp).root) ?? '.';
    const at = (file: string) => (home === '.' ? file : `${home}/${file}`);
    if (!tree.exists(at('apphosting.yaml'))) tree.write(at('apphosting.yaml'), template('apphosting.yaml.tpl'));
    if (options.staging && !tree.exists(at('apphosting.staging.yaml'))) {
      tree.write(at('apphosting.staging.yaml'), template('apphosting.staging.yaml.tpl').split('{{projectName}}').join(clientApp));
    }
  } else if (options.staging) {
    logger.warn('[firebase-emulators] --staging: no client app to build, so apphosting.staging.yaml was not written.');
  }
  for (const shadow of shadowedAppHostingConfigs(tree)) logger.warn(`[firebase-emulators] ${describeShadow(shadow)}`);

  // 1c) .gitignore — each block under its own marker, appended when its marker is missing (so a project already past
  //     the earlier blocks still gains each later one on upgrade), never twice.
  const gitignoreBlocks: Array<[marker: string, block: string]> = [
    ['/.emulator-data', GITIGNORE_BLOCK],
    [secretsOf(functions), secretGitignoreBlock(functions)],
    [sandboxSecretsOf(functions), sandboxGitignoreBlock(functions)],
    [EXPORT_STAGING_MARKER, EXPORT_STAGING_GITIGNORE_BLOCK],
  ];
  for (const [marker, block] of gitignoreBlocks) {
    const gitignore = tree.exists('.gitignore') ? tree.read('.gitignore', 'utf8') ?? '' : '';
    if (!gitignore.includes(marker)) tree.write('.gitignore', `${gitignore.trimEnd()}\n\n${block}`);
  }

  // 2) The emulator tooling. Generator-owned (always rewritten) EXCEPT tools/seed/world.mjs and
  //    tools/emulator-seeds/README.md, which model the APP'S data and are user-owned once written. The applier that
  //    turns a world into emulator writes is tools/seed/apply.mjs — owned, so its fixes reach every project. The env paths
  //    are the client app's — empty without one, which the scripts treat as "no env file" (demo-/.firebaserc).
  //    The welcome banner looks for client env files across the APPS DIRECTORY rather than a list rendered now: an
  //    app added later (`nx g @bespunky/nx-tools:app`) gets its env files from firebase-client without this
  //    workspace step re-running, and the banner must still see them.
  tree.write('tools/firebase-welcome.sh', template('firebase-welcome.sh.tpl').split('{{appsDir}}').join(appsDir));
  tree.write('tools/emulator-ports.mjs', renderEmulatorPortsModule(template('emulator-ports.mjs.tpl')));
  tree.write(
    'tools/emulators.sh',
    functionsPaths(substitute(template('emulators.sh.tpl'))).split('{{appEnvPath}}').join(clientEnv?.dev ?? ''),
  );
  tree.write('tools/emulator-data.sh', template('emulator-data.sh.tpl'));
  // The suite's project id (offline `demo-` twin unless environment.ts commits a real service) and what the Functions
  // emulator is given as secrets — Node modules, so the build (esbuild plugin) and emulators.sh share one rule each.
  tree.write('tools/emulator-project.mjs', template('emulator-project.mjs.tpl'));
  tree.write('tools/emulator-secrets.cjs', template('emulator-secrets.cjs.tpl').split('{{configDirSince}}').join(CONFIG_DIR_SINCE));
  // The functions build's esbuild options — generator-owned: the inert-secrets plugin is a guarantee, not a default.
  tree.write(ESBUILD_CONFIG, functionsPaths(template('functions-esbuild.config.cjs.tpl')));
  tree.write(
    'tools/push-secrets.sh',
    functionsPaths(template('push-secrets.sh.tpl')).split('{{appEnvProdPath}}').join(clientEnv?.prod ?? ''),
  );
  tree.write('tools/seed/build-seeds.sh', substitute(template('seed-build-seeds.sh.tpl')));
  tree.write('tools/firebase-deploy.mjs', functionsPaths(template('firebase-deploy.mjs.tpl')));
  tree.write(
    'tools/firebase-deploy-rules.mjs',
    template('firebase-deploy-rules.mjs.tpl').split('{{seedMarker}}').join(RULES_SEED_MARKER).split('{{suiteRoot}}').join(suite.root),
  );
  writeSeedTooling(tree);
  if (!tree.exists('tools/seed/world.mjs')) tree.write('tools/seed/world.mjs', substitute(template('seed-world.mjs.tpl')));
  if (!tree.exists('tools/emulator-seeds/README.md')) {
    tree.write('tools/emulator-seeds/README.md', template('emulator-seeds-README.md.tpl'));
  }

  // 3) Cloud Functions (REQUIRED for the suite to boot at all) and the suite's own workspace project.
  ensureFunctionsProject(tree, lint, functions, functionsPaths);
  ensureFirebaseProject(tree, suite, functions, declaredRulesFiles(firebaseJson));
  // The suite is now declarable: give every app the dev engine serves its `emulators` process (only where it is
  // not declared yet). The web layer's own seeding ran before this step on a first scaffold.
  seedServedApps(tree, 'firebase-emulators');

  // 4) Best-effort: the platform firewall in the root flat ESLint config (src/platform/firewall — fail closed, its own
  //    rule instance). Firebase is what brings a second platform, so it is what brings the firewall — and the
  //    firewall arrives over projects nobody classified. Classify them in the same act (evidence only, every
  //    inference reported, what nothing settles left for a human), and register the sync generator that classifies
  //    the projects created later, before lint judges them (generators/platform-sync).
  //    An EXISTING firewall is project state: the 0.49 shape is migration 0.50.0's to upgrade, never re-written here.
  const externals = platformExternals(tree);
  const nx = nxInvocation(tree).command;
  if (tree.exists(FIREWALL_CONFIG)) {
    const current = tree.read(FIREWALL_CONFIG, 'utf8') ?? '';
    const patched = insertPlatformFirewall(current, FIREWALL_CONFIG, externals, nx);
    if (patched && patched !== current) {
      tree.write(FIREWALL_CONFIG, patched);
      registerPlatformSync(tree);
      classifyUntaggedProjects(tree, { who: 'firebase-emulators', nx, externals });
    } else if (!patched) {
      logger.warn(
        `[firebase-emulators] Could not insert the platform firewall into ${FIREWALL_CONFIG} (it needs an \`export default [ … ]\` ` +
          `array, and TypeScript to read it). Add it by hand, then classify every project (${platformCommand(nx, '<project>')}):\n` +
          firewallSnippet(externals, nx),
      );
    }
  }

  // 5) The Cloud Functions runtime + build deps and the Firebase CLI, at the WORKSPACE ROOT (no per-project
  //    node_modules). Existing entries are never overwritten. @nx/esbuild moves in lockstep with `nx`. A repo with no package.json hosts
  //    Nx through the wrapper and has no Node dependency graph to add them to — said, not guessed around.
  if (!tree.exists('package.json')) {
    logger.warn(
      '[firebase-emulators] No root package.json — Cloud Functions are a Node app and need firebase-admin, ' +
        'firebase-functions and @nx/esbuild installed somewhere Nx can resolve them. Add a package.json and re-run.',
    );
    await formatFiles(tree);
    return clientCallback;
  }
  const rootPkg = readJson<{ dependencies?: Record<string, string>; devDependencies?: Record<string, string> }>(
    tree,
    'package.json',
  );
  // Every version from one place (_utils/versions.ts) — and the Firebase CLI is the PROJECT's: a pinned
  // devDependency, so the emulators, the deploy targets and `firebase login` run the version this commit names, on
  // every machine and in CI (node_modules/.bin is on PATH in the container and for every Nx target).
  declareDependencies(
    tree,
    'firebase-emulators',
    { 'firebase-admin': FIREBASE_ADMIN_VERSION, 'firebase-functions': FIREBASE_FUNCTIONS_VERSION },
    {
      'firebase-tools': FIREBASE_TOOLS_VERSION,
      ...(declaredSpec(tree, '@nx/esbuild') ? {} : { '@nx/esbuild': nxVersion(tree, rootPkg) }),
      ...functionsToolchain(tree, functionsRuntimeMajor(tree)),
    },
  );

  await formatFiles(tree);
  return () => {
    clientCallback();
    installPackagesTask(tree);
  };
}

/**
 * @nx/esbuild moves in LOCKSTEP with Nx: the version the workspace declares for `nx`, else the one installed. Neither
 * (an `nx` nobody can name) is refused — the house never guesses an Nx version.
 */
function nxVersion(tree: Tree, rootPkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }): string {
  const declared = rootPkg.devDependencies?.['nx'] ?? rootPkg.dependencies?.['nx'];
  if (declared && isPinnedSpec(declared)) return declared;
  try {
    return (require(require.resolve('nx/package.json', { paths: [tree.root] })) as { version: string }).version;
  } catch {
    throw new Error(
      '[firebase-emulators] Cloud Functions build with @nx/esbuild, which must match the workspace\'s Nx version — but ' +
        `package.json ${declared ? `declares nx as "${declared}", which names no version,` : 'declares no `nx`'} and none is ` +
        'installed. Declare nx as exactly the version this workspace runs, and re-run.',
    );
  }
}

/**
 * The Node major Cloud Functions runs: the project's own when Cloud Functions offers it as a GA runtime (projected from
 * the pinned firebase-tools — _utils/firebase-compat.ts), else the NEAREST one — the newest below it (code written
 * for Node N runs on an older runtime only as far as it avoids newer APIs, so the closest), else, for a project older
 * than every runtime, the oldest (the closest above).
 */
function functionsRuntimeMajor(tree: Tree): { major: string; project: string } {
  const project = projectNodeMajor(tree);
  if (FUNCTIONS_NODE_RUNTIMES.includes(project)) return { major: project, project };
  const below = [...FUNCTIONS_NODE_RUNTIMES].reverse().find((major) => Number(major) < Number(project));
  return { major: below ?? FUNCTIONS_NODE_RUNTIMES[0], project };
}

/**
 * The client app the suite's scripts follow: the one named, else the app already wired with the Firebase
 * client (detected through its adapter — one suite is one project, singleProjectMode), else none.
 */
function resolveClientApp(tree: Tree, named: string | undefined): string | undefined {
  if (named) return named;
  const wired = applicationsWith(tree, 'firebase').filter(({ project, port }) => port.isWired(tree, project));
  if (wired.length > 1) {
    logger.info(
      `[firebase-emulators] ${wired.length} apps carry the Firebase client; the suite's scripts follow ` +
        `\`${wired[0].project}\`. Pass --clientApp=<app> to choose another.`,
    );
  }
  return wired[0]?.project;
}

/**
 * What building a TypeScript Cloud Functions app needs beyond @nx/esbuild itself: `esbuild` (its peer), the
 * TypeScript compiler (the executor type-checks) and Node's types (tsconfig.app.json `types: ["node"]`). An
 * Angular workspace already provides all three (through @angular/build and its own setup); a plain repo provides
 * none. So each is declared exactly when NOTHING provides it — never added over a working install — at the
 * version Nx itself pins (@nx/js's versions, when resolvable), else the versions Nx 23.2 pins.
 */
function functionsToolchain(tree: Tree, runtime: { major: string }): Record<string, string> {
  let pinned: { esbuildVersion?: string; typescriptVersion?: string; typesNodeVersion?: string } = {};
  try {
    pinned = require(require.resolve('@nx/js/src/utils/versions', { paths: [tree.root] }));
  } catch {
    // Not installed yet (it arrives with @nx/esbuild) — the fallbacks below are Nx 23.2's own pins.
  }
  const wanted: Record<string, string> = {
    esbuild: pinned.esbuildVersion ?? '^0.27.0',
    typescript: pinned.typescriptVersion ?? '~6.0.3',
    '@types/node': pinned.typesNodeVersion ?? `^${runtime.major}.0.0`,
  };
  return Object.fromEntries(Object.entries(wanted).filter(([pkg]) => !resolvable(tree, pkg)));
}

/** Does `pkg` resolve from the workspace root (declared, or provided by something that is)? */
function resolvable(tree: Tree, pkg: string): boolean {
  try {
    require.resolve(`${pkg}/package.json`, { paths: [tree.root] });
    return true;
  } catch {
    return false;
  }
}

/**
 * Cloud Functions as a first-class Nx app — a house project (see the header), at `functions.root`.
 *
 * @param render fills the functions placeholders (root, dist, project name) into a template.
 */
function ensureFunctionsProject(
  tree: Tree,
  lint: { name: string; target?: TargetConfiguration } | undefined,
  functions: HouseProjectHome,
  render: (template: string) => string,
): void {
  const { root } = functions;
  const offset = offsetFromRoot(root);
  const buildOptions = functions.exists ? readProjectConfiguration(tree, functions.name).targets?.build?.options : undefined;
  const ownEsbuildOptions =
    buildOptions !== undefined && 'esbuildOptions' in buildOptions && JSON.stringify(buildOptions.esbuildOptions) !== HOUSE_ESBUILD_OPTIONS_0_49;
  if (ownEsbuildOptions) {
    logger.warn(
      `[firebase-emulators] ${functions.name}:build keeps esbuild options of its own, so it does not run the house's ` +
        `${ESBUILD_CONFIG} (Nx refuses esbuildOptions beside esbuildConfig) — its builds carry no inert emulator secrets ` +
        `file; tools/emulators.sh still places one at launch. Fold your options into a config that spreads the house's and ` +
        `point esbuildConfig at it.`,
    );
  }
  const runtime = functionsRuntimeMajor(tree);
  const template = (name: string) =>
    render(readFileSync(join(__dirname, name), 'utf8'))
      .split('{{offsetFromRoot}}').join(offset)
      .split('{{functionsNodeMajor}}').join(runtime.major)
      .split('{{firebaseAdminVersion}}').join(FIREBASE_ADMIN_VERSION)
      .split('{{firebaseFunctionsVersion}}').join(FIREBASE_FUNCTIONS_VERSION);

  // Source files: user-owned once written (the manifest's deps, the functions code, and the compiler options are
  // all things a project legitimately evolves).
  const ifAbsent = (path: string, templateName: string) => {
    if (!tree.exists(path)) tree.write(path, template(templateName));
  };
  // The compiler options come BEFORE the project: a project created as a package is referenced by the solution
  // tsconfig only when it already has a tsconfig.json to reference (`createProject`).
  // Extends the workspace's root compiler options (`rootTsconfig`: tsconfig.base.json, else a standalone
  // tsconfig.json) at this project's depth; a repo with neither gets functions that stand alone.
  if (!tree.exists(`${root}/tsconfig.json`)) {
    const base = rootTsconfig(tree);
    const tsconfig = template('functions-tsconfig.json.tpl');
    tree.write(
      `${root}/tsconfig.json`,
      base ? tsconfig.split('{{rootTsconfig}}').join(base) : tsconfig.replace(/^\s*"extends": "[^"]*",\n/m, ''),
    );
  }
  ifAbsent(`${root}/tsconfig.app.json`, 'functions-tsconfig.app.json.tpl');

  // Then the PROJECT. Its package.json is the Cloud Functions deploy manifest — and, in a workspace whose projects
  // are packages (TS-solution linking), also the file that DEFINES the project. So a new project is created from the
  // manifest template through the project seam, which writes it as that workspace needs (a workspace member, its
  // Nx configuration in the `nx` block); a project.json workspace gets the same manifest just below, beside it.
  ensureHouseProject(
    tree,
    'firebase-emulators',
    functions,
    {
      projectType: 'application',
      sourceRoot: `${root}/src`,
      tags: ['platform:server'],
      contract: { deploy: BUILDS_WHAT_IT_SHIPS },
      targets: {
        // esbuild-bundle to dist/<root> with a generated package.json (merging the manifest's deps + the built
        // `main` entry) — that dist output is what firebase.json's `functions.source` points at, for both the
        // emulator and `firebase deploy`.
        build: {
          executor: '@nx/esbuild:esbuild',
          outputs: ['{options.outputPath}'],
          options: {
            outputPath: distOf(functions),
            main: `${root}/src/main.ts`,
            tsConfig: `${root}/tsconfig.app.json`,
            platform: 'node',
            format: ['cjs'],
            bundle: true,
            thirdParty: false,
            generatePackageJson: true,
            deleteOutputPath: true,
            // No assets: the params files (.env, .env.<projectId>, .env.local) are read in place from the
            // source dir — firebase.json `functions.configDir` — by the emulator and deploy alike.
            // The esbuild config (generator-owned) writes the emulator's INERT `.secret.local` into every build, so a
            // rebuild mid-session, or a raw `firebase emulators:start`, never leaves a declared secret without one.
            // …unless the project keeps esbuild options of its own (Nx refuses both): reported by migration 0.50.0
            // read-functions-params-in-place, and named again below on every run.
            ...(ownEsbuildOptions ? {} : { esbuildConfig: ESBUILD_CONFIG }),
          },
        },
        // Lints via the workspace flat config — no per-project ESLint island. Only where the workspace lints, and only
        // where the target is not inferred (the plugin lints a project with no config of its own by the root config).
        ...(lint?.target ? { [lint.name]: lint.target } : {}),
        // THE DEPLOY CONTRACT (header). Nx builds (and lints) what ships — firebase.json carries no predeploy.
        deploy: {
          executor: 'nx:run-commands',
          dependsOn: ['build', ...(lint ? [lint.name] : [])],
          inputs: ['default', '^default', ...FIREBASE_ROOT_INPUTS],
          cache: false,
          parallelism: false,
          // `firebase deploy --only functions` through the deploy runner: on a failure it prints the road to a first
          // deploy (login → alias → deploy → CI) instead of ending on Firebase's bare "have you run firebase login?".
          options: { command: 'node tools/firebase-deploy.mjs --only functions', cwd: '{workspaceRoot}' },
        },
        // Push the project's .secret.local (KEY=VALUE) into Google Secret Manager for the deploy project — one
        // source of truth for which secrets exist (tools/push-secrets.sh).
        'push-secrets': {
          executor: 'nx:run-commands',
          options: { command: 'bash tools/push-secrets.sh', cwd: '{workspaceRoot}' },
        },
      },
    },
    JSON.parse(template('functions-package.json.tpl')),
  );

  if (!tree.exists(`${root}/package.json`) && runtime.major !== runtime.project) {
    logger.warn(
      `[firebase-emulators] Cloud Functions has no Node ${runtime.project} runtime (GA: ${FUNCTIONS_NODE_RUNTIMES.join(', ')}), ` +
        `so ${root}/package.json declares engines.node "${runtime.major}" while the project runs Node ${runtime.project} (${nodeVersionFile(tree)}).`,
    );
  }
  if (!tree.exists(`${root}/package.json`)) {
    // A rendered manifest is a manifest write like any other: no floating version through a template either.
    const floating = floatingAdditions(tree, {}, JSON.parse(template('functions-package.json.tpl')));
    if (floating.length) throw new Error(`[firebase-emulators] functions-package.json.tpl renders a floating version: ${floating.join(', ')}.`);
    ifAbsent(`${root}/package.json`, 'functions-package.json.tpl');
  }
  reportRuntimeMismatch(tree, `${root}/package.json`, runtime);
  ifAbsent(`${root}/src/main.ts`, 'functions-main.ts.tpl');
  // The committed shape doc for local Functions secrets (.secret.local itself is gitignored).
  // User-owned once written — it grows with each `defineSecret` the functions add.
  ifAbsent(`${root}/.secret.local.example`, 'functions-secret.local.example.tpl');
  requireConfigDirSupport(tree);
}

/** The inline esbuild options the house's functions build carried until 0.50.0 (the esbuildConfig replaced them). */
export const HOUSE_ESBUILD_OPTIONS_0_49 = JSON.stringify({ outExtension: { '.js': '.js' } });

/** The functions build's esbuild config — beside the module it loads, in tools/ (never an import across projects). */
const ESBUILD_CONFIG = 'tools/functions-esbuild.config.cjs';

/** The first firebase-tools whose EMULATOR reads firebase.json `functions.configDir` (deploy: 14.1x). Checked by
 *  version against the published packages, 2026-10 — tools/emulator-secrets.cjs refuses to launch below it. */
export const CONFIG_DIR_SINCE = '15.25.1';

/**
 * firebase.json points the params files at the functions source (`configDir`), and the build no longer copies `.env`
 * into the bundle — so a firebase-tools that ignores `configDir` runs every function WITHOUT its params. The house
 * pins one that reads it; a project's own older pin is named here on every upgrade (and refused at emulator launch).
 */
function requireConfigDirSupport(tree: Tree): void {
  const spec = declaredSpec(tree, 'firebase-tools');
  const version = spec?.match(/\d+\.\d+\.\d+/)?.[0];
  if (!version) return;
  const [a, b] = [version, CONFIG_DIR_SINCE].map((v) => v.split('.').map(Number));
  const below = a[0] !== b[0] ? a[0] < b[0] : a[1] !== b[1] ? a[1] < b[1] : a[2] < b[2];
  if (!below) return;
  logger.warn(
    `[firebase-emulators] package.json declares firebase-tools "${spec}", but the Functions emulator reads its params ` +
      `(.env, .env.<projectId>, .env.local) through firebase.json functions.configDir only from firebase-tools ` +
      `${CONFIG_DIR_SINCE} — below it every function runs without them, so tools/emulators.sh refuses to start the ` +
      `functions emulator. Raise it to "${FIREBASE_TOOLS_VERSION}" (the house's).`,
  );
}

/**
 * The deployed runtime and the project's Node are two declarations of one fact, and the manifest is the project's
 * once written — so a disagreement is NAMED on every run, never silently rewritten (moving a deployed runtime is a
 * deploy decision).
 */
function reportRuntimeMismatch(tree: Tree, manifest: string, runtime: { major: string; project: string }): void {
  let engines: string | undefined;
  try {
    engines = (readJson(tree, manifest) as { engines?: { node?: string } }).engines?.node;
  } catch {
    return;
  }
  if (engines === undefined || engines === runtime.major) return;
  logger.warn(
    `[firebase-emulators] ${manifest} deploys Cloud Functions on Node "${engines}", but the project's Node (${nodeVersionFile(tree)}) is ` +
      `${runtime.project}${runtime.major !== runtime.project ? ` (nearest Cloud Functions runtime: ${runtime.major})` : ''}. ` +
      `Set engines.node to "${runtime.major}" there — or the project's Node to ${engines} — so the code you run locally is the code ` +
      `that is deployed.`,
  );
}

/**
 * The emulator suite as its own workspace-level Nx project — a house project (see the header).
 *
 * @param rulesFiles what firebase.json declares — the deploy's inputs (with the conventional root locations).
 */
function ensureFirebaseProject(tree: Tree, suite: HouseProjectHome, functions: HouseProjectHome, rulesFiles: string[]): void {
  // EXPLICITLY not `continuous`: the dev engine runs one suite per STACK (each on its shifted ports, with its own
  // hub), and Nx shares a continuous task across every invocation in the tree — a second stack's suite would only
  // wait on the first. Written `false` rather than left out: Nx fills an absent key from nx.json targetDefaults.
  const emulatorsTarget = (only?: string): TargetConfiguration => ({
    continuous: false,
    executor: 'nx:run-commands',
    options: {
      command: `bash tools/emulators.sh${only ? ` --only ${only},ui` : ''}`,
      cwd: '{workspaceRoot}',
    },
  });
  const dependsOnFunctionsBuild = [{ projects: [functions.name], target: 'build' }];

  // The first time the suite gains its deploy, say what it will (and will not) ship — once, not every upgrade.
  if (suite.exists && !rulesFiles.length && !existingTargets(tree, suite.name).includes('deploy')) {
    logger.info(
      '[firebase-emulators] `nx run firebase:deploy` now ships the Firestore / Storage rules firebase.json declares — ' +
        'none yet, so it deploys nothing and the console keeps its rules. To keep them in the repo, pull the live ones ' +
        'in once (a human, in a terminal): `npx firebase init firestore -P <alias>`, then `npx firebase init storage -P <alias>`.',
    );
  }

  ensureHouseProject(tree, 'firebase-emulators', suite, {
    projectType: 'application',
    // `tooling` like the house's other tooling projects: the suite runs the emulators and holds rules and seeds —
    // no code a product runs, so the platform classifier and the house's lint scope leave it alone.
    // (`platform:server` predates that and stays: its files run in Node, and dropping it would fail lint on any
    // suite file that imports a workspace project.)
    tags: ['platform:server', 'tooling'],
    contract: { deploy: DEPLOY_CONTRACT },
    targets: {
      // The full suite. Depends on the functions build: firebase.json points the functions
      // emulator at the functions bundle in dist/, so the backend must exist before the suite boots.
      emulators: { ...emulatorsTarget(), dependsOn: dependsOnFunctionsBuild },
      'emulators:auth': emulatorsTarget('auth'),
      'emulators:firestore': emulatorsTarget('firestore'),
      'emulators:storage': emulatorsTarget('storage'),
      'emulators:functions': { ...emulatorsTarget('functions'), dependsOn: dependsOnFunctionsBuild },
      // Rebuild the committed seeds from tools/seed/world.mjs (run after schema changes).
      'seed:build': {
        executor: 'nx:run-commands',
        options: { command: 'bash tools/seed/build-seeds.sh', cwd: '{workspaceRoot}' },
      },
      // On-call reset to the default pristine world (takes effect on the next serve).
      // Add `reset:<seed>` siblings here for extra worlds — they survive an upgrade.
      reset: {
        executor: 'nx:run-commands',
        options: { command: 'bash tools/emulator-data.sh reset', cwd: '{workspaceRoot}' },
      },
      // THE DEPLOY CONTRACT (header): the Firestore rules, Firestore indexes and Storage rules firebase.json
      // declares — derived when it runs, so a rule set declared later deploys without an upgrade — and nothing it
      // does not declare: a project whose rules live only in the console gets a no-op that says how to adopt them.
      deploy: {
        executor: 'nx:run-commands',
        inputs: ['default', ...FIREBASE_ROOT_INPUTS, ...rootRulesInputs(suite, rulesFiles)],
        cache: false,
        parallelism: false,
        options: { command: 'node tools/firebase-deploy-rules.mjs', cwd: '{workspaceRoot}' },
      },
    },
  });
}

/** The targets project `name` has now — none when the graph cannot be read (a lookup must not take the generator down). */
function existingTargets(tree: Tree, name: string): string[] {
  try {
    return Object.keys(readProjectConfiguration(tree, name).targets ?? {});
  } catch {
    return [];
  }
}

/** The rules files outside the suite's own root (inside it, `default` already covers them), as root inputs. */
function rootRulesInputs(suite: HouseProjectHome, declared: string[]): string[] {
  const inside = (path: string) => suite.root !== '.' && (path === suite.root || path.startsWith(`${suite.root}/`));
  return [...new Set([...declared, ...CONVENTIONAL_RULES_FILES])]
    .map((path) => path.replace(/^\.\//, ''))
    .filter((path) => !inside(path))
    .map((path) => `{workspaceRoot}/${path}`);
}

/**
 * Seed deny-all, MARKED rules for each service firebase.json declares none for, inside the suite's project (so its
 * own files mark it affected), and declare them. Never over a file that exists, never for a service the project
 * already declares — and only when this run CREATES the layer (the caller passes --seedRules then, never on an
 * upgrade or a re-ensure). Never an indexes file (the header says why).
 * A conventional root rules file firebase.json does not name yet is the project's (a `firebase init` leftover, or
 * rules copied in by hand): reported, never shadowed by a seed.
 */
function seedRules(tree: Tree, firebaseJson: Record<string, unknown>, root: string, template: (name: string) => string): void {
  const at = (file: string) => (root === '.' ? file : `${root}/${file}`);
  const marked = (name: string) => template(name).split('{{seedMarker}}').join(RULES_SEED_MARKER);
  const services: Array<{ key: 'firestore' | 'storage'; conventional: string[]; files: Array<[string, string, string]> }> = [
    // Rules only — never an indexes file (the header: a seeded one cannot be told from the project's, and a forced
    // deploy deletes every live index it does not list).
    { key: 'firestore', conventional: ['firestore.rules', 'firestore.indexes.json'], files: [['rules', 'firestore.rules', 'firestore.rules.tpl']] },
    { key: 'storage', conventional: ['storage.rules'], files: [['rules', 'storage.rules', 'storage.rules.tpl']] },
  ];
  for (const service of services) {
    if (firebaseJson[service.key] !== undefined) continue;
    const loose = service.conventional.filter((file) => tree.exists(file));
    if (loose.length) {
      logger.warn(
        `[firebase-emulators] ${loose.join(', ')} exist but firebase.json declares no \`${service.key}\` — not seeding over them. ` +
          `Declare them in firebase.json (\`firebase init ${service.key}\` does) and \`nx run firebase:deploy\` ships them.`,
      );
      continue;
    }
    const declaration: Record<string, string> = {};
    for (const [field, file, tpl] of service.files) {
      if (!tree.exists(at(file))) tree.write(at(file), marked(tpl));
      declaration[field] = at(file);
    }
    firebaseJson[service.key] = declaration;
  }
}
