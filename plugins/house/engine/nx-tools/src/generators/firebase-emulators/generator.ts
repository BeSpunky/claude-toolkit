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
//   - apphosting.yaml (+ apphosting.staging.yaml with --staging) — only with a client app, and only if absent:
//                        App Hosting builds and serves a web app, so a core-only repo (functions + emulators)
//                        has nothing for it to deploy. A later sync seeds it once a client app is wired.
//   - .gitignore        — emulator debug logs, the working data dirs, <functions root>/.secret.local.
//   - <appsDir>/functions/ — Cloud Functions as a first-class Nx app, in the workspace's apps directory (or wherever
//                        a `functions` project already lives): esbuild-bundled to dist/<functions root> with a
//                        generated deploy-manifest package.json; runtime deps at the WORKSPACE ROOT. Source
//                        files are written only if absent; its house targets are generator-owned.
//   - firebase/         — the emulator suite as its own workspace-level Nx project: `emulators`,
//                        `emulators:<svc>`, `seed:build`, `reset`. User-added targets are preserved.
//   Both projects are HOUSE PROJECTS (_utils/project-files): found by project, created the way this workspace
//   defines projects (a project.json, or a package.json workspace member under TS-solution linking).
//   - tools/{emulators,emulator-data,reap-emulators,push-secrets,firebase-welcome}.sh, tools/emulator-ports.mjs,
//                        tools/seed/* — the launch path, data lifecycle, port reclaim (and the one port table
//                        both read, projected from emulator-ports.ts), secrets push, cloud-linkage banner, and
//                        the declarative seed worlds (world.mjs and the seeds README are user-owned once written).
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
  writeJson,
  logger,
} from '@nx/devkit';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadTypeScript, type TsArrayLiteralExpression, type TsNode } from '../_utils/typescript-api';
import { adapterOf, applicationsWith } from '../../adapters/registry';
import { workspaceStacksWith } from '../../adapters/workspace';
import { hasDependency } from '../../layers/evidence';
import { FIREBASE_DEFAULT_PORTS, HOUSE_EMULATORS, renderEmulatorPortsModule } from './emulator-ports';
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
        { ...(name === 'ui' ? { enabled: true } : {}), host: '0.0.0.0', port: FIREBASE_DEFAULT_PORTS[name] },
      ]),
    ),
    singleProjectMode: true,
  };
}

// The canonical `functions` block — REQUIRED whenever the functions emulator is configured:
// without a functions backend behind it, `firebase emulators:start` fatally aborts. The
// source points at the BUILT Nx output (dist/<functions root>, which carries a generated
// package.json), and predeploy routes lint + build through Nx so `firebase deploy` and
// `nx run functions:deploy` take the same path.
function canonicalFunctionsBlock(lint: boolean, functions: HouseProjectHome) {
  return [
    {
      source: distOf(functions),
      codebase: 'default',
      disallowLegacyRuntimeConfig: true,
      ignore: ['node_modules', '.git', 'firebase-debug.log', 'firebase-debug.*.log', '*.local'],
      // `nx` via the local bin, not `yarn nx`: this array is baked into the project's firebase.json and
      // runs on every deploy, so hardcoding one package manager breaks deploys for npm/pnpm projects.
      // `node_modules/.bin` is on PATH for anything the Firebase CLI spawns from the workspace root.
      // Lint only where the workspace lints: a plain repo without @nx/eslint would fail every deploy on it.
      predeploy: [...(lint ? [`npx --no-install nx lint ${functions.name}`] : []), `npx --no-install nx build ${functions.name}`],
    },
  ];
}

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

/** The gitignored local secrets file of the Cloud Functions project. */
const secretsOf = (functions: HouseProjectHome) => `${functions.root}/.secret.local`;

// Local Functions secrets ignore — kept separate from GITIGNORE_BLOCK (its own idempotency
// marker: the secrets path itself) so a project already past the emulator block self-heals to ignore
// .secret.local on upgrade.
const secretGitignoreBlock = (functions: HouseProjectHome) => `# Local Cloud Functions secrets — the gitignored source for \`nx run ${functions.name}:push-secrets\`
# (which sets them in Google Secret Manager for production) and the emulator's local injection.
# The committed ${secretsOf(functions)}.example documents the shape.
${secretsOf(functions)}
`;

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
  firebaseJson.functions = canonicalFunctionsBlock(lint, functions);
  writeJson(tree, 'firebase.json', firebaseJson);

  // 1b) App Hosting's deploy config — seeded, never clobbered, and only for a CLIENT APP: App Hosting builds and
  //     serves a web app, so without one there is nothing for it to deploy (and the staging override, which
  //     builds the client app's `staging` configuration, nothing to name). Functions deploy without it.
  if (clientApp) {
    if (!tree.exists('apphosting.yaml')) tree.write('apphosting.yaml', template('apphosting.yaml.tpl'));
    if (options.staging && !tree.exists('apphosting.staging.yaml')) {
      tree.write('apphosting.staging.yaml', template('apphosting.staging.yaml.tpl').split('{{projectName}}').join(clientApp));
    }
  } else if (options.staging) {
    logger.warn('[firebase-emulators] --staging: no client app to build, so apphosting.staging.yaml was not written.');
  }

  // 1c) .gitignore — the emulator block, then the secrets block under its own marker (so a project already past
  //     the first still gains the second on upgrade).
  const gitignore = tree.exists('.gitignore') ? tree.read('.gitignore', 'utf8') ?? '' : '';
  if (!gitignore.includes('/.emulator-data')) tree.write('.gitignore', `${gitignore.trimEnd()}\n\n${GITIGNORE_BLOCK}`);
  const gitignoreNow = tree.exists('.gitignore') ? tree.read('.gitignore', 'utf8') ?? '' : '';
  if (!gitignoreNow.includes(secretsOf(functions))) {
    tree.write('.gitignore', `${gitignoreNow.trimEnd()}\n\n${secretGitignoreBlock(functions)}`);
  }

  // 2) The emulator tooling. Generator-owned (always rewritten) EXCEPT tools/seed/world.mjs and
  //    tools/emulator-seeds/README.md, which model the APP'S data and are user-owned once written. The env paths
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
  tree.write('tools/seed/build.mjs', template('seed-build.mjs.tpl'));
  if (!tree.exists('tools/seed/world.mjs')) tree.write('tools/seed/world.mjs', substitute(template('seed-world.mjs.tpl')));
  if (!tree.exists('tools/emulator-seeds/README.md')) {
    tree.write('tools/emulator-seeds/README.md', template('emulator-seeds-README.md.tpl'));
  }

  // 3) Cloud Functions (REQUIRED for the suite to boot at all) and the suite's own workspace project.
  ensureFunctionsProject(tree, lint, functions, functionsPaths);
  ensureFirebaseProject(tree, suite, functions);
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
            // Copy the committed public-params file beside the bundle. The project's .env holds PUBLIC
            // (non-secret) function params and is a build asset (secrets go through .secret.local / Secret
            // Manager, never here). Without this the deploy/emulator bundle ships without .env and the
            // functions lose their params at runtime.
            assets: [{ glob: '.env', input: root, output: '.' }],
            esbuildOptions: { outExtension: { '.js': '.js' } },
          },
        },
        // Lints via the workspace flat config — no per-project ESLint island. Only where the workspace lints.
        ...(lint ? { lint: { executor: '@nx/eslint:lint' } } : {}),
        deploy: {
          executor: 'nx:run-commands',
          dependsOn: ['build'],
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

/** The emulator suite as its own workspace-level Nx project — a house project (see the header). */
function ensureFirebaseProject(tree: Tree, suite: HouseProjectHome, functions: HouseProjectHome): void {
  const emulatorsTarget = (only?: string): TargetConfiguration => ({
    continuous: true,
    executor: 'nx:run-commands',
    options: {
      command: `bash tools/emulators.sh${only ? ` --only ${only},ui` : ''}`,
      cwd: '{workspaceRoot}',
    },
  });
  const dependsOnFunctionsBuild = [{ projects: [functions.name], target: 'build' }];

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
    },
  });
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
