// House generator: the FIREBASE CORE — the emulator suite, Cloud Functions, App Hosting config and their tooling.
// Framework-neutral: it needs only the Nx floor, and runs the same for an Angular app, a plain npm repo, or a
// repo with no frontend at all. Idempotent and safe in --sync mode.
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
//                        (dist/apps/functions). The functions block is REQUIRED: configuring the
//                        functions emulator with no backend behind it makes `emulators:start`
//                        fatally abort. The generator asserts the `emulators` + `functions` keys
//                        and preserves any other top-level keys the user added. NO top-level `hosting`
//                        block — the BeSpunky default is Firebase App Hosting, configured in apphosting.yaml.
//   - apphosting.yaml (+ apphosting.staging.yaml with --staging and a client app) — written only if absent.
//   - .gitignore        — emulator debug logs, the working data dirs, apps/functions/.secret.local.
//   - apps/functions/   — Cloud Functions as a first-class Nx app: esbuild-bundled to dist/apps/functions with a
//                        generated deploy-manifest package.json; runtime deps at the WORKSPACE ROOT. Source
//                        files are written only if absent; project.json's targets are generator-owned.
//   - firebase/project.json — the emulator suite as its own workspace-level Nx project: `emulators`,
//                        `emulators:<svc>`, `seed:build`, `reset`. User-added targets are preserved.
//   - tools/{emulators,emulator-data,reap-emulators,push-secrets,firebase-welcome}.sh, tools/seed/* — the
//                        launch path, data lifecycle, port reclaim, secrets push, cloud-linkage banner, and
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
  type ProjectConfiguration,
  getProjects,
  formatFiles,
  addDependenciesToPackageJson,
  installPackagesTask,
  applyChangesToString,
  type StringChange,
  ChangeType,
  readJson,
  writeJson,
  updateJson,
  logger,
} from '@nx/devkit';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadTypeScript, type TsArrayLiteralExpression, type TsNode } from '../_utils/typescript-api';
import { ADAPTERS, adapterOf, applicationsWith } from '../../adapters/registry';
import { hasDependency } from '../../layers/evidence';
import { isPresent } from '../../layers/registry';
import firebaseClientGenerator from '../firebase-client/generator';

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
  return {
    auth:      { host: '0.0.0.0', port: 9099 },
    firestore: { host: '0.0.0.0', port: 8080 },
    storage:   { host: '0.0.0.0', port: 9199 },
    functions: { host: '0.0.0.0', port: 5001 },
    ui:        { enabled: true, host: '0.0.0.0', port: 4000 },
    singleProjectMode: true,
  };
}

// The canonical `functions` block — REQUIRED whenever the functions emulator is configured:
// without a functions backend behind it, `firebase emulators:start` fatally aborts. The
// source points at the BUILT Nx output (dist/apps/functions, which carries a generated
// package.json), and predeploy routes lint + build through Nx so `firebase deploy` and
// `nx run functions:deploy` take the same path.
function canonicalFunctionsBlock(lint: boolean) {
  return [
    {
      source: 'dist/apps/functions',
      codebase: 'default',
      disallowLegacyRuntimeConfig: true,
      ignore: ['node_modules', '.git', 'firebase-debug.log', 'firebase-debug.*.log', '*.local'],
      // `nx` via the local bin, not `yarn nx`: this array is baked into the project's firebase.json and
      // runs on every deploy, so hardcoding one package manager breaks deploys for npm/pnpm projects.
      // `node_modules/.bin` is on PATH for anything the Firebase CLI spawns from the workspace root.
      // Lint only where the workspace lints: a plain repo without @nx/eslint would fail every deploy on it.
      predeploy: [...(lint ? ['npx --no-install nx lint functions'] : []), 'npx --no-install nx build functions'],
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

// Local Functions secrets ignore — kept separate from GITIGNORE_BLOCK (its own idempotency
// marker) so a project already past the emulator block self-heals to ignore .secret.local on --sync.
const SECRET_GITIGNORE_BLOCK = `# Local Cloud Functions secrets — the gitignored source for \`nx run functions:push-secrets\`
# (which sets them in Google Secret Manager for production) and the emulator's local injection.
# The committed apps/functions/.secret.local.example documents the shape.
apps/functions/.secret.local
`;

export default async function firebaseEmulatorsGenerator(
  tree: Tree,
  options: FirebaseEmulatorsSchema = {}
): Promise<GeneratorCallback> {
  const workspaceName = options.workspaceName ?? options.project ?? basenameOf(tree.root);
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

  // 1) firebase.json at workspace root. The `emulators` and `functions` keys are generator-owned (asserted to
  //    canonical on every run); any other top-level keys the user added are preserved.
  const lint = hasDependency(tree, '@nx/eslint');
  const firebaseJson: Record<string, unknown> = tree.exists('firebase.json') ? readJson(tree, 'firebase.json') : {};
  firebaseJson.emulators = canonicalEmulatorsBlock();
  firebaseJson.functions = canonicalFunctionsBlock(lint);
  writeJson(tree, 'firebase.json', firebaseJson);

  // 1b) App Hosting's deploy config — never clobbered. The staging override builds the client app's `staging`
  //     configuration, so it needs one; without a client app there is nothing for it to name.
  if (!tree.exists('apphosting.yaml')) tree.write('apphosting.yaml', template('apphosting.yaml.tpl'));
  if (options.staging && !tree.exists('apphosting.staging.yaml')) {
    if (clientApp) {
      tree.write('apphosting.staging.yaml', template('apphosting.staging.yaml.tpl').split('{{projectName}}').join(clientApp));
    } else {
      logger.warn('[firebase-emulators] --staging: no client app to build, so apphosting.staging.yaml was not written.');
    }
  }

  // 1c) .gitignore — the emulator block, then the secrets block under its own marker (so a project already past
  //     the first still gains the second on --sync).
  const gitignore = tree.exists('.gitignore') ? tree.read('.gitignore', 'utf8') ?? '' : '';
  if (!gitignore.includes('/.emulator-data')) tree.write('.gitignore', `${gitignore.trimEnd()}\n\n${GITIGNORE_BLOCK}`);
  const gitignoreNow = tree.exists('.gitignore') ? tree.read('.gitignore', 'utf8') ?? '' : '';
  if (!gitignoreNow.includes('apps/functions/.secret.local')) {
    tree.write('.gitignore', `${gitignoreNow.trimEnd()}\n\n${SECRET_GITIGNORE_BLOCK}`);
  }

  // 2) The emulator tooling. Generator-owned (always rewritten) EXCEPT tools/seed/world.mjs and
  //    tools/emulator-seeds/README.md, which model the APP'S data and are user-owned once written. The env paths
  //    are the client app's — empty without one, which the scripts treat as "no env file" (demo-/.firebaserc).
  tree.write('tools/firebase-welcome.sh', template('firebase-welcome.sh.tpl'));
  tree.write('tools/reap-emulators.sh', template('reap-emulators.sh.tpl'));
  tree.write('tools/emulators.sh', substitute(template('emulators.sh.tpl')).split('{{appEnvPath}}').join(clientEnv?.dev ?? ''));
  tree.write('tools/emulator-data.sh', template('emulator-data.sh.tpl'));
  tree.write('tools/push-secrets.sh', template('push-secrets.sh.tpl').split('{{appEnvProdPath}}').join(clientEnv?.prod ?? ''));
  tree.write('tools/seed/build-seeds.sh', substitute(template('seed-build-seeds.sh.tpl')));
  tree.write('tools/seed/build.mjs', template('seed-build.mjs.tpl'));
  if (!tree.exists('tools/seed/world.mjs')) tree.write('tools/seed/world.mjs', substitute(template('seed-world.mjs.tpl')));
  if (!tree.exists('tools/emulator-seeds/README.md')) {
    tree.write('tools/emulator-seeds/README.md', template('emulator-seeds-README.md.tpl'));
  }

  // 3) Cloud Functions (REQUIRED for the suite to boot at all) and the suite's own workspace project.
  ensureFunctionsProject(tree, lint);
  ensureFirebaseProject(tree);
  // The suite is now declarable: give every app the dev engine serves its `emulators` process (only where it is
  // not declared yet). The web layer's own seeding ran before this step on a first scaffold.
  seedServedApps(tree, 'firebase-emulators');

  // 4) Best-effort: the `platform:` firewall in the root flat ESLint config.
  const serverBanned = [
    'firebase',
    'firebase/*',
    ...ADAPTERS.filter((stack) => stack.firebase && isPresent(tree, stack.layer)).flatMap(
      (stack) => stack.firebase!.serverBannedImports,
    ),
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

function basenameOf(path: string): string {
  return path.replace(/\/+$/, '').split('/').pop() || 'workspace';
}

/**
 * Merge generator-owned targets into a project config file, preserving any user-added targets
 * and tags. Writes the file only when the project genuinely has no home yet.
 *
 * THE PROJECT IS RESOLVED BY NAME, not by path, and that is the whole point of `existingProjectFile`
 * below. `tree.exists(path)` alone answers "is the canonical path free?" — a different question from
 * "does this project already exist?", and answering the second with the first is how you get two
 * projects called `firebase`, which makes EVERY `nx` command in the workspace fail with "defined in
 * multiple locations". The 0.24.1 migration already resolves the emulator home by name (it merges into
 * a `firebase` project wherever it lives, and logs that it avoided the duplicate); this generator ran
 * in the same sync and wrote the duplicate the migration had just refused to create.
 */
function ensureProjectFile(
  tree: Tree,
  path: string,
  canonical: {
    name: string;
    projectType: 'application' | 'library';
    sourceRoot?: string;
    tags: string[];
    targets: Record<string, TargetConfiguration>;
  },
  schemaRelativePrefix: string
): void {
  const existing = existingProjectFile(tree, canonical.name, path);

  if (!existing) {
    writeJson(tree, path, {
      name: canonical.name,
      $schema: `${schemaRelativePrefix}node_modules/nx/schemas/project-schema.json`,
      projectType: canonical.projectType,
      ...(canonical.sourceRoot ? { sourceRoot: canonical.sourceRoot } : {}),
      tags: canonical.tags,
      targets: canonical.targets,
    });
    return;
  }

  if (existing.path !== path) {
    logger.info(
      `[firebase-emulators] Project "${canonical.name}" already lives at ${existing.path}, so its ` +
        `house targets were merged there instead of into a new ${path} — two projects under one name ` +
        `break every \`nx\` command in the workspace.`
    );
  }

  updateJson(tree, existing.path, (json) => {
    // A package.json-defined project keeps its Nx configuration under `nx`; a project.json holds it
    // at the top level. Same merge, different container.
    const container = existing.kind === 'package.json' ? (json.nx ??= {}) : json;
    container.tags ??= [];
    for (const tag of canonical.tags) {
      if (!container.tags.includes(tag)) container.tags.push(tag);
    }
    container.targets = { ...(container.targets ?? {}), ...canonical.targets };
    return json;
  });
}

/**
 * Where a project of this name already lives, or `null` when it does not exist yet.
 *
 * Precedence mirrors the 0.24.1 migration exactly, so a sync cannot undo what the migration just
 * decided: the canonical path if it is taken; otherwise a project ALREADY NAMED this, wherever it
 * sits; otherwise a project that already owns the canonical DIRECTORY under some other name (writing
 * a project.json beside its package.json would silently rename it).
 *
 * `getProjects` throws on a workspace it cannot read; that must not take a generator down, so an
 * unreadable graph degrades to "canonical path only" — the behaviour this had before.
 */
function existingProjectFile(
  tree: Tree,
  name: string,
  canonicalPath: string
): { path: string; kind: 'project.json' | 'package.json' } | null {
  if (tree.exists(canonicalPath)) return { path: canonicalPath, kind: 'project.json' };

  const canonicalRoot = canonicalPath.slice(0, canonicalPath.lastIndexOf('/'));
  let projects: Map<string, ProjectConfiguration>;
  try {
    projects = getProjects(tree);
  } catch {
    return null;
  }

  const fileFor = (root: string): { path: string; kind: 'project.json' | 'package.json' } | null => {
    if (tree.exists(`${root}/project.json`)) return { path: `${root}/project.json`, kind: 'project.json' };
    if (tree.exists(`${root}/package.json`)) return { path: `${root}/package.json`, kind: 'package.json' };
    return null;
  };

  for (const [projectName, project] of projects) {
    if (projectName === name) return fileFor(project.root);
  }
  for (const [, project] of projects) {
    if (project.root === canonicalRoot) return fileFor(project.root);
  }
  return null;
}

/** Cloud Functions as a first-class Nx app at apps/functions. */
function ensureFunctionsProject(tree: Tree, lint: boolean): void {
  const root = 'apps/functions';

  // Source files: user-owned once written (the manifest's deps, the functions code, and the
  // compiler options are all things a project legitimately evolves).
  const ifAbsent = (path: string, templateName: string) => {
    if (!tree.exists(path)) {
      tree.write(path, readFileSync(join(__dirname, templateName), 'utf8'));
    }
  };
  ifAbsent(`${root}/package.json`, 'functions-package.json.tpl');
  // Extends the workspace's base tsconfig when it has one; a plain repo's functions stand alone.
  if (!tree.exists(`${root}/tsconfig.json`)) {
    const tsconfig = readFileSync(join(__dirname, 'functions-tsconfig.json.tpl'), 'utf8');
    tree.write(
      `${root}/tsconfig.json`,
      tree.exists('tsconfig.base.json') ? tsconfig : tsconfig.replace(/^\s*"extends": "[^"]*",\n/m, ''),
    );
  }
  ifAbsent(`${root}/tsconfig.app.json`, 'functions-tsconfig.app.json.tpl');
  ifAbsent(`${root}/src/main.ts`, 'functions-main.ts.tpl');
  // The committed shape doc for local Functions secrets (.secret.local itself is gitignored).
  // User-owned once written — it grows with each `defineSecret` the functions add.
  ifAbsent(`${root}/.secret.local.example`, 'functions-secret.local.example.tpl');

  ensureProjectFile(
    tree,
    `${root}/project.json`,
    {
      name: 'functions',
      projectType: 'application',
      sourceRoot: `${root}/src`,
      tags: ['platform:server'],
      targets: {
        // esbuild-bundle to dist/apps/functions with a generated package.json (merging the
        // manifest's deps + the built `main` entry) — that dist output is what firebase.json's
        // `functions.source` points at, for both the emulator and `firebase deploy`.
        build: {
          executor: '@nx/esbuild:esbuild',
          outputs: ['{options.outputPath}'],
          options: {
            outputPath: 'dist/apps/functions',
            main: `${root}/src/main.ts`,
            tsConfig: `${root}/tsconfig.app.json`,
            platform: 'node',
            format: ['cjs'],
            bundle: true,
            thirdParty: false,
            generatePackageJson: true,
            deleteOutputPath: true,
            // Copy the committed public-params file beside the bundle. apps/functions/.env holds
            // PUBLIC (non-secret) function params and is a build asset (secrets go through
            // .secret.local / Secret Manager, never here). Without this the deploy/emulator bundle
            // ships without .env and the functions lose their params at runtime.
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
        // Push apps/functions/.secret.local (KEY=VALUE) into Google Secret Manager for the deploy
        // project — one source of truth for which secrets exist (tools/push-secrets.sh).
        'push-secrets': {
          executor: 'nx:run-commands',
          options: { command: 'bash tools/push-secrets.sh', cwd: '{workspaceRoot}' },
        },
      },
    },
    '../../'
  );
}

/** The emulator suite as its own workspace-level Nx project (firebase/project.json). */
function ensureFirebaseProject(tree: Tree): void {
  const emulatorsTarget = (only?: string): TargetConfiguration => ({
    continuous: true,
    executor: 'nx:run-commands',
    options: {
      command: `bash tools/emulators.sh${only ? ` --only ${only},ui` : ''}`,
      cwd: '{workspaceRoot}',
    },
  });
  const dependsOnFunctionsBuild = [{ projects: ['functions'], target: 'build' }];

  ensureProjectFile(
    tree,
    'firebase/project.json',
    {
      name: 'firebase',
      projectType: 'application',
      tags: ['platform:server'],
      targets: {
        // The full suite. Depends on the functions build: firebase.json points the functions
        // emulator at dist/apps/functions, so the backend must exist before the suite boots.
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
        // Add `reset:<seed>` siblings here for extra worlds — they survive --sync.
        reset: {
          executor: 'nx:run-commands',
          options: { command: 'bash tools/emulator-data.sh reset', cwd: '{workspaceRoot}' },
        },
      },
    },
    '../'
  );
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
