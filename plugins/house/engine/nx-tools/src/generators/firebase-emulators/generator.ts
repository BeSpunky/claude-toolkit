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
//   - firebase/{firestore.rules,firestore.indexes.json,storage.rules} — SEEDED (never owned) and only with
//                        --seedRules, which the planner passes only when the layer is ENSURED (`new`,
//                        `add-layer firebase`) — never on a plain upgrade: a project with no rules in the repo
//                        keeps them in the Firebase console, and a seed plus a deploy target would overwrite the
//                        live rules on the first deploy. Deny-all, and MARKED as a seed: the deploy skips a file
//                        that still carries the marker, so nothing the house wrote reaches production unreviewed.
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
//   THE DEPLOY CONTRACT (what `nx affected -t deploy` — by hand or the `ci` layer — relies on): every deployable
//   house project has a target named exactly `deploy` that runs non-interactively when given `--non-interactive`,
//   forwards every extra argument to the Firebase CLI (`--project=<alias>` under run-many/affected, `-P <alias>`
//   under `nx run`), never caches, never runs beside another task (`parallelism: false` — two deploys must not race
//   one Firebase project), builds what it ships through Nx (`dependsOn`), and declares the root Firebase files as
//   `{workspaceRoot}/…` inputs, so a change to firebase.json, .firebaserc or a root rules file marks it affected.
//   Both projects are HOUSE PROJECTS (_utils/project-files): found by project, created the way this workspace
//   defines projects (a project.json, or a package.json workspace member under TS-solution linking).
//   - tools/{emulators,emulator-data,reap-emulators,push-secrets,firebase-welcome}.sh, tools/emulator-ports.mjs,
//                        tools/seed/* — the launch path, data lifecycle, port reclaim (and the one port table
//                        both read, projected from emulator-ports.ts), secrets push, cloud-linkage banner, and
//                        the seed applier (tools/seed/apply.mjs), and the declarative seed worlds
//                        (world.mjs and the seeds README are user-owned once written).
//   - root eslint.config.mjs — best-effort insertion of the `platform:` dependency-constraint firewall:
//                        `platform:web` bans firebase-admin/firebase-functions; `platform:server` bans the
//                        browser SDK and every present client framework (each adapter names its own).
//
// No longer here: the nx.json TUI switch. It is a property of the DEV LOOP (a continuous multi-process serve),
// not of Firebase, and belongs to the generator that owns that loop.
import { seedServedApps } from '../dev/generator';
import {
  type Tree,
  type GeneratorCallback,
  type TargetConfiguration,
  formatFiles,
  offsetFromRoot,
  addDependenciesToPackageJson,
  installPackagesTask,
  applyChangesToString,
  type StringChange,
  ChangeType,
  readJson,
  readProjectConfiguration,
  writeJson,
  logger,
} from '@nx/devkit';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadTypeScript, type TsArrayLiteralExpression, type TsNode } from '../_utils/typescript-api';
import { adapterOf, applicationsWith } from '../../adapters/registry';
import { workspaceStacksWith } from '../../adapters/workspace';
import { hasDependency } from '../../layers/evidence';
import { HOUSE_EMULATORS, defaultPort, renderEmulatorPortsModule } from './emulator-ports';
import { describeShadow, effectiveAppHostingDir, shadowedAppHostingConfigs } from './apphosting-config';
import firebaseClientGenerator from '../firebase-client/generator';
import { ensureHouseProject, houseProjectHome, type HouseProjectHome } from '../_utils/project-files';
import { resolveAppsDir } from '../_utils/workspace-layout';
import { rootTsconfig } from '../_utils/linking';
import { workspaceIdentity } from '../_utils/workspace-identity';

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

# Isolated port-offset stacks (\`<app>:serve --portOffset\`): each gets its own data dir
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
export function writeSeedTooling(tree: Tree, workspaceName: string): void {
  const template = (name: string) => readFileSync(join(__dirname, name), 'utf8');
  tree.write('tools/seed/build.mjs', template('seed-build.mjs.tpl'));
  tree.write('tools/seed/apply.mjs', template('seed-apply.mjs.tpl').split('{{workspaceName}}').join(workspaceName));
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
  const functions = houseProjectHome(tree, 'functions', `${appsDir}/functions`);
  const suite = houseProjectHome(tree, 'firebase', 'firebase');
  const functionsPaths = (tpl: string) =>
    tpl.split('{{functionsRoot}}').join(functions.root).split('{{functionsDist}}').join(distOf(functions)).split('{{functionsProject}}').join(functions.name);

  // 1) firebase.json at workspace root. The `emulators` and `functions` keys are generator-owned (asserted to
  //    canonical on every run); any other top-level keys the user added are preserved.
  const lint = hasDependency(tree, '@nx/eslint');
  const firebaseJson: Record<string, unknown> = tree.exists('firebase.json') ? readJson(tree, 'firebase.json') : {};
  firebaseJson.emulators = canonicalEmulatorsBlock();
  firebaseJson.functions = canonicalFunctionsBlock(functions);
  // The rules — seeded only when the layer is being CREATED, for services the project declares none for.
  if (options.seedRules) seedRules(tree, firebaseJson, suite.root, template);
  writeJson(tree, 'firebase.json', firebaseJson);
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

  // 1c) .gitignore — the emulator block, then the secrets block under its own marker (so a project already past
  //     the first still gains the second on upgrade).
  const gitignore = tree.exists('.gitignore') ? tree.read('.gitignore', 'utf8') ?? '' : '';
  if (!gitignore.includes('/.emulator-data')) tree.write('.gitignore', `${gitignore.trimEnd()}\n\n${GITIGNORE_BLOCK}`);
  const gitignoreNow = tree.exists('.gitignore') ? tree.read('.gitignore', 'utf8') ?? '' : '';
  if (!gitignoreNow.includes(secretsOf(functions))) {
    tree.write('.gitignore', `${gitignoreNow.trimEnd()}\n\n${secretGitignoreBlock(functions)}`);
  }
  const gitignoreLast = tree.read('.gitignore', 'utf8') ?? '';
  if (!gitignoreLast.includes(sandboxSecretsOf(functions))) {
    tree.write('.gitignore', `${gitignoreLast.trimEnd()}\n\n${sandboxGitignoreBlock(functions)}`);
  }

  // 2) The emulator tooling. Generator-owned (always rewritten) EXCEPT tools/seed/world.mjs and
  //    tools/emulator-seeds/README.md, which model the APP'S data and are user-owned once written. The applier that
  //    turns a world into emulator writes is tools/seed/apply.mjs — owned, so its fixes reach every project. The env paths
  //    are the client app's — empty without one, which the scripts treat as "no env file" (demo-/.firebaserc).
  //    The welcome banner looks for client env files across the APPS DIRECTORY rather than a list rendered now: an
  //    app added later (`nx g @bespunky/nx-tools:app`) gets its env files from firebase-client without this
  //    workspace step re-running, and the banner must still see them.
  tree.write('tools/firebase-welcome.sh', template('firebase-welcome.sh.tpl').split('{{appsDir}}').join(appsDir));
  tree.write('tools/reap-emulators.sh', template('reap-emulators.sh.tpl'));
  tree.write('tools/emulator-ports.mjs', renderEmulatorPortsModule(template('emulator-ports.mjs.tpl')));
  tree.write(
    'tools/emulators.sh',
    functionsPaths(substitute(template('emulators.sh.tpl'))).split('{{appEnvPath}}').join(clientEnv?.dev ?? ''),
  );
  tree.write('tools/emulator-data.sh', template('emulator-data.sh.tpl'));
  tree.write(
    'tools/push-secrets.sh',
    functionsPaths(template('push-secrets.sh.tpl')).split('{{appEnvProdPath}}').join(clientEnv?.prod ?? ''),
  );
  tree.write('tools/seed/build-seeds.sh', substitute(template('seed-build-seeds.sh.tpl')));
  tree.write('tools/firebase-deploy-rules.mjs', template('firebase-deploy-rules.mjs.tpl').split('{{seedMarker}}').join(RULES_SEED_MARKER));
  writeSeedTooling(tree, workspaceName);
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

  // 4) Best-effort: the `platform:` firewall in the root flat ESLint config.
  const serverBanned = [
    'firebase',
    'firebase/*',
    ...workspaceStacksWith(tree, 'firebase').flatMap((stack) => stack.firebase.serverBannedImports),
  ];
  const eslintConfigPath = 'eslint.config.mjs';
  if (tree.exists(eslintConfigPath)) {
    const current = tree.read(eslintConfigPath, 'utf8') ?? '';
    const patched = addPlatformBoundaries(current, eslintConfigPath, serverBanned);
    if (patched && patched !== current) {
      tree.write(eslintConfigPath, patched);
    } else if (!patched) {
      logger.warn(
        `[firebase-emulators] Could not auto-insert the platform: dependency constraints into ${eslintConfigPath}. ` +
        `Add these entries to the @nx/enforce-module-boundaries depConstraints array manually:\n` +
        `  { sourceTag: 'platform:web', bannedExternalImports: ['firebase-admin', 'firebase-admin/*', 'firebase-functions', 'firebase-functions/*'] },\n` +
        `  { sourceTag: 'platform:server', bannedExternalImports: ${JSON.stringify(serverBanned).replace(/"/g, "'")} }`
      );
    }
  }

  // 5) The Cloud Functions runtime + build deps, at the WORKSPACE ROOT (no per-project node_modules). Existing
  //    entries are never overwritten. @nx/esbuild moves in lockstep with `nx`. A repo with no package.json hosts
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
  const missing = (deps: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(deps).filter(([name]) => !rootPkg.dependencies?.[name] && !rootPkg.devDependencies?.[name]),
    );
  const nxVersion = rootPkg.devDependencies?.['nx'] ?? rootPkg.dependencies?.['nx'] ?? 'latest';
  addDependenciesToPackageJson(
    tree,
    missing({ 'firebase-admin': '^13.6.0', 'firebase-functions': '^7.0.0' }),
    missing({ '@nx/esbuild': nxVersion, ...functionsToolchain(tree) }),
  );

  await formatFiles(tree);
  return () => {
    clientCallback();
    installPackagesTask(tree);
  };
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
function functionsToolchain(tree: Tree): Record<string, string> {
  let pinned: { esbuildVersion?: string; typescriptVersion?: string; typesNodeVersion?: string } = {};
  try {
    pinned = require(require.resolve('@nx/js/src/utils/versions', { paths: [tree.root] }));
  } catch {
    // Not installed yet (it arrives with @nx/esbuild) — the fallbacks below are Nx 23.2's own pins.
  }
  const wanted: Record<string, string> = {
    esbuild: pinned.esbuildVersion ?? '^0.27.0',
    typescript: pinned.typescriptVersion ?? '~6.0.3',
    '@types/node': pinned.typesNodeVersion ?? '^22.0.0',
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
  lint: boolean,
  functions: HouseProjectHome,
  render: (template: string) => string,
): void {
  const { root } = functions;
  const offset = offsetFromRoot(root);
  const template = (name: string) => render(readFileSync(join(__dirname, name), 'utf8')).split('{{offsetFromRoot}}').join(offset);

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
            esbuildOptions: { outExtension: { '.js': '.js' } },
          },
        },
        // Lints via the workspace flat config — no per-project ESLint island. Only where the workspace lints.
        ...(lint ? { lint: { executor: '@nx/eslint:lint' } } : {}),
        // THE DEPLOY CONTRACT (header). Nx builds (and lints) what ships — firebase.json carries no predeploy.
        deploy: {
          executor: 'nx:run-commands',
          dependsOn: ['build', ...(lint ? ['lint'] : [])],
          inputs: ['default', '^default', ...FIREBASE_ROOT_INPUTS],
          cache: false,
          parallelism: false,
          options: { command: 'firebase deploy --only functions', cwd: '{workspaceRoot}' },
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

  ifAbsent(`${root}/package.json`, 'functions-package.json.tpl');
  ifAbsent(`${root}/src/main.ts`, 'functions-main.ts.tpl');
  // The committed shape doc for local Functions secrets (.secret.local itself is gitignored).
  // User-owned once written — it grows with each `defineSecret` the functions add.
  ifAbsent(`${root}/.secret.local.example`, 'functions-secret.local.example.tpl');
}

/**
 * The emulator suite as its own workspace-level Nx project — a house project (see the header).
 *
 * @param rulesFiles what firebase.json declares — the deploy's inputs (with the conventional root locations).
 */
function ensureFirebaseProject(tree: Tree, suite: HouseProjectHome, functions: HouseProjectHome, rulesFiles: string[]): void {
  // Not `continuous`: the dev engine runs one suite per STACK (each on its shifted ports, with its own hub), and Nx
  // shares a continuous task across every invocation in the tree — a second stack's suite would only wait on the
  // first. A second suite started by hand on the base ports now fails loudly on the bind instead.
  const emulatorsTarget = (only?: string): TargetConfiguration => ({
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
        'in once (a human, in a terminal): `npx firebase init firestore storage -P <alias>`.',
    );
  }

  ensureHouseProject(tree, 'firebase-emulators', suite, {
    projectType: 'application',
    tags: ['platform:server'],
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
        inputs: ['default', ...FIREBASE_ROOT_INPUTS, ...rootRulesInputs(suite, rulesFiles), '{workspaceRoot}/tools/firebase-deploy-rules.mjs'],
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
 * already declares — and never on a plain upgrade (the caller passes --seedRules only when ENSURING the layer).
 * A conventional root rules file firebase.json does not name yet is the project's (a `firebase init` leftover, or
 * rules copied in by hand): reported, never shadowed by a seed.
 */
function seedRules(tree: Tree, firebaseJson: Record<string, unknown>, root: string, template: (name: string) => string): void {
  const at = (file: string) => (root === '.' ? file : `${root}/${file}`);
  const marked = (name: string) => template(name).split('{{seedMarker}}').join(RULES_SEED_MARKER);
  const services: Array<{ key: 'firestore' | 'storage'; conventional: string[]; files: Array<[string, string, string]> }> = [
    { key: 'firestore', conventional: ['firestore.rules', 'firestore.indexes.json'], files: [['rules', 'firestore.rules', 'firestore.rules.tpl'], ['indexes', 'firestore.indexes.json', 'firestore.indexes.json.tpl']] },
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

/**
 * Insert the `platform:` dependency constraints into the root flat ESLint config's
 * `depConstraints` array (the `@nx/enforce-module-boundaries` rule).
 *
 * Uses the TypeScript compiler API to locate the array (no regex on source — source code
 * is a tree, not text), then applies a text insert via `applyChangesToString` so the
 * surrounding formatting is preserved and `formatFiles` polishes the result.
 *
 * Returns:
 *   - the updated source when the constraints are inserted,
 *   - the original `source` when they're already present (idempotent no-op),
 *   - `null` when no `depConstraints` array literal is found — the caller logs an
 *     actionable warning with the manual snippet.
 */
function addPlatformBoundaries(source: string, sourcePath: string, serverBanned: readonly string[]): string | null {
  // Idempotency: the tag literal anywhere in the file means the firewall is already declared.
  if (source.includes('platform:web') || source.includes('platform:server')) {
    return source;
  }

  const ts = loadTypeScript();
  if (!ts) return null;

  const sf = ts.createSourceFile(
    sourcePath,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.JS
  );

  let constraintsArray: TsArrayLiteralExpression | null = null;
  const findConstraints = (node: TsNode): void => {
    if (constraintsArray) return;
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'depConstraints' &&
      ts.isArrayLiteralExpression(node.initializer)
    ) {
      constraintsArray = node.initializer;
      return;
    }
    ts.forEachChild(node, findConstraints);
  };
  findConstraints(sf);
  if (!constraintsArray) return null;

  const found: TsArrayLiteralExpression = constraintsArray;
  const elements = found.elements;
  // THE SPLICE IS SHAPED BY ITS NEIGHBOURS, not dropped before the closing bracket. Inserting at `]` put the
  // comma and the snippet AFTER whatever whitespace preceded the bracket — valid JS, but an ugly `}\n   ,\n// …`
  // that lands as-is wherever prettier is absent (formatFiles only formats when it is installed), and on a
  // project that never asked for it. So: after the last element (and its trailing comma, if any), at that
  // element's own indentation; into an empty array, one level inside the property's indentation.
  const indentOfLineAt = (pos: number): string => /^[ \t]*/.exec(source.slice(source.lastIndexOf('\n', pos - 1) + 1))![0];
  const last = elements.length ? elements[elements.length - 1] : null;
  const indent = last ? indentOfLineAt(last.getStart(sf)) : `${indentOfLineAt(found.getStart(sf))}  `;
  const lines = [
    `// by platform: the server-only Firebase Admin/Functions SDKs belong to Cloud`,
    `// Functions alone — they must never reach browser/SSR code (they pull in`,
    `// Node-native modules and admin credentials). Symmetrically, the browser Firebase`,
    `// SDK and the client framework have no place in the functions runtime.`,
    `{`,
    `  sourceTag: 'platform:web',`,
    `  bannedExternalImports: ['firebase-admin', 'firebase-admin/*', 'firebase-functions', 'firebase-functions/*'],`,
    `},`,
    `{`,
    `  sourceTag: 'platform:server',`,
    `  bannedExternalImports: [${serverBanned.map((pkg) => `'${pkg}'`).join(', ')}],`,
    `}`,
  ];
  const block = lines.map((line) => `${indent}${line}`).join('\n');
  // Where the last element ends — past its trailing comma when it has one.
  const afterLast = last ? (elements.hasTrailingComma ? source.indexOf(',', last.getEnd()) + 1 : last.getEnd()) : -1;
  const changes: StringChange[] = [
    last
      ? { type: ChangeType.Insert, index: afterLast, text: `${elements.hasTrailingComma ? '' : ','}\n${block}${elements.hasTrailingComma ? ',' : ''}` }
      : { type: ChangeType.Insert, index: found.getStart(sf) + 1, text: `\n${block},\n${indentOfLineAt(found.getStart(sf))}` },
  ];
  return applyChangesToString(source, changes);
}
