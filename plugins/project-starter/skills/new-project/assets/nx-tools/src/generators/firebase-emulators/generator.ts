// House generator: scaffold Firebase emulator config + Cloud Functions + Nx targets + app initialization.
// Idempotent and safe in --repair mode.
//
// IMPORTANT: this generator NEVER writes `.firebaserc`. The cloud-project linkage is the
// Firebase CLI's responsibility — `firebase use --add` validates against the user's actual
// account and writes `.firebaserc` properly. Fabricating one here would lie about the cloud
// state and break `firebase deploy` / `firebase use` the moment the user touches them.
// Emulators don't need `.firebaserc`: the launch script (tools/emulators.sh) passes
// `--project=demo-<workspaceName>` explicitly. The `demo-` prefix is Firebase's documented
// convention for "offline only, no cloud calls," so emulators work without login and without
// a real GCP project.
//
// Writes:
//   - firebase.json     (workspace root) — emulator suite config (auth/firestore/storage/functions/ui),
//                        singleProjectMode, all emulators bound to 0.0.0.0 for Docker/devcontainer
//                        compatibility, AND a `functions` block pointing at the built Nx output
//                        (dist/apps/functions). The functions block is REQUIRED: configuring the
//                        functions emulator with no backend behind it makes `emulators:start`
//                        fatally abort. The generator asserts the `emulators` + `functions` keys
//                        and preserves any other top-level keys the user added (firestore rules,
//                        storage rules, …). NO top-level `hosting` block — the BeSpunky default is
//                        Firebase App Hosting (framework-aware), whose config lives in apphosting.yaml.
//   - apphosting.yaml   (workspace root) — Firebase App Hosting deploy config. Starter ships empty
//                        with commented examples. Created only if absent (preserves user edits).
//   - .gitignore        — emulator debug logs (*-debug.log) + the working data dir (/.emulator-data).
//   - nx.json           — `tui.enabled = false`: the interactive TUI multiplexes the continuous
//                        `serve` + `firebase:emulators` pair into a redrawing multi-pane terminal
//                        that's awkward for humans and agents alike; plain streamed, prefixed logs
//                        and a single Ctrl+C are the right dev loop here.
//   - apps/<project>/src/environments/* — Angular environment-files pattern (see section 2).
//   - apps/<project>/src/app/firebase.config.ts — provideAppFirebase() (see section 2b).
//   - apps/functions/   — Cloud Functions as a first-class Nx app: esbuild-bundled to
//                        dist/apps/functions with a generated deploy-manifest package.json;
//                        runtime deps (firebase-admin/firebase-functions) live at the WORKSPACE
//                        ROOT (no per-project node_modules); lints via the workspace flat config.
//                        Source files are written only if absent (the user owns their functions);
//                        project.json's build/lint/deploy targets are generator-owned (re-asserted),
//                        extra targets are preserved.
//   - firebase/project.json — the emulator suite as its own workspace-level Nx project (it's a
//                        workspace concept, not an app concern): `emulators` (full suite, dependsOn
//                        functions:build), `emulators:<svc>` (one + UI), `seed:build`, `reset`.
//                        All funnel through tools/emulators.sh. Generator-owned targets are
//                        re-asserted; user-added targets (e.g. `reset:<seed>`) are preserved.
//   - tools/emulators.sh — the single launch path: reap → prime → start, importing the gitignored
//                        .emulator-data/ working dir and (full runs only) exporting back on a clean
//                        exit, so session + data survive every serve. Focused `--only` runs
//                        import-only (a partial export would clobber the other services' data).
//   - tools/emulator-data.sh — owns the working-dir ↔ committed-seeds lifecycle: `ensure` (prime
//                        from the default seed when empty) and `reset [<seed>]` (on-call wipe).
//   - tools/seed/{world.mjs,build.mjs} + tools/seed/build-seeds.sh — declarative seed worlds
//                        (world.mjs is USER-OWNED once written — it models the app's schema) and
//                        the one-command rebuild (`nx run firebase:seed:build`) that exports each
//                        world into tools/emulator-seeds/<name>/ (committed, generated artifacts).
//   - tools/reap-emulators.sh — verified port + process reclaim before each start: pass 0 kills
//                        orphaned emulator JVMs by cache path (catches fallback-port and
//                        alive-but-unbound orphans), pass 1 polls the configured ports until they
//                        are ACTUALLY free (SIGTERM → grace → SIGKILL), so an ungraceful prior
//                        death (closed terminal, container stop, SIGKILL) can't break the next start.
//   - tools/firebase-welcome.sh — self-extinguishing cloud-linkage banner (see section 3a).
//   - apps/<project>/project.json targets:
//       * `serve`     — an nx:run-commands orchestrator running `firebase:emulators` and
//                       `<project>:serve-app` in parallel. One command, one Ctrl+C, and
//                       `serve-app` stays runnable ALONE (emulator-free — e.g. an offline
//                       configuration). This replaced the earlier `serve.dependsOn=['emulators']`
//                       continuous-task wiring: with the suite extracted to the workspace-level
//                       `firebase` project, the orchestrator is the battle-tested shape (and the
//                       generator self-heals the dependsOn form into it).
//       * `serve-app` — the real Angular dev-server target.
//   - root eslint.config.mjs — best-effort insertion of the `platform:` dependency-constraint
//                       firewall: `platform:web` bans firebase-admin/firebase-functions imports,
//                       `platform:server` bans firebase/@angular. The app is tagged platform:web,
//                       functions + firebase are tagged platform:server.
import {
  type Tree,
  type GeneratorCallback,
  type TargetConfiguration,
  type ProjectConfiguration,
  readProjectConfiguration,
  updateProjectConfiguration,
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
import * as ts from 'typescript';

interface FirebaseEmulatorsSchema {
  project: string;
  workspaceName?: string;
}

const EMULATORS = ['auth', 'firestore', 'storage', 'functions'] as const;

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
function canonicalFunctionsBlock() {
  return [
    {
      source: 'dist/apps/functions',
      codebase: 'default',
      disallowLegacyRuntimeConfig: true,
      ignore: ['node_modules', '.git', 'firebase-debug.log', 'firebase-debug.*.log', '*.local'],
      predeploy: ['yarn nx lint functions', 'yarn nx build functions'],
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
`;

export default async function firebaseEmulatorsGenerator(
  tree: Tree,
  options: FirebaseEmulatorsSchema
): Promise<GeneratorCallback> {
  if (!options.project) {
    throw new Error('firebase-emulators generator requires --project=<app-name>.');
  }
  const projectName = options.project;
  const workspaceName = options.workspaceName ?? projectName;
  const project = readProjectConfiguration(tree, projectName);
  const appRoot = project.root;

  const substitute = (tpl: string) => tpl.split('{{workspaceName}}').join(workspaceName);
  const template = (name: string) => readFileSync(join(__dirname, name), 'utf8');

  // 1) firebase.json at workspace root. The `emulators` and `functions` keys are
  //    generator-owned (asserted to canonical on every run); any other top-level keys the
  //    user added (firestore/storage rules paths, …) are preserved.
  //    Note: `.firebaserc` is deliberately NOT generated — see the file header.
  const firebaseJson: Record<string, unknown> = tree.exists('firebase.json')
    ? readJson(tree, 'firebase.json')
    : {};
  firebaseJson.emulators = canonicalEmulatorsBlock();
  firebaseJson.functions = canonicalFunctionsBlock();
  writeJson(tree, 'firebase.json', firebaseJson);

  // 1b) apphosting.yaml at workspace root — Firebase App Hosting's deploy config.
  //     Don't clobber user edits; only write if absent.
  if (!tree.exists('apphosting.yaml')) {
    tree.write('apphosting.yaml', template('apphosting.yaml.tpl'));
  }

  // 1c) .gitignore — emulator debug logs + the working data dir. Without these,
  //     firebase-debug.log / firestore-debug.log pile up untracked at the workspace
  //     root and the (machine-local) .emulator-data/ cache risks being committed.
  const gitignore = tree.exists('.gitignore') ? tree.read('.gitignore', 'utf8') ?? '' : '';
  if (!gitignore.includes('/.emulator-data')) {
    tree.write('.gitignore', `${gitignore.trimEnd()}\n\n${GITIGNORE_BLOCK}`);
  }

  // 1d) nx.json — disable the interactive TUI. It multiplexes the continuous
  //     `serve` + `firebase:emulators` pair into one redrawing multi-pane terminal that's
  //     awkward to drive (for humans and agents); disabled, Nx streams plain, scrollable,
  //     prefixed logs and a single Ctrl+C stops the whole run.
  if (tree.exists('nx.json')) {
    updateJson(tree, 'nx.json', (json) => {
      json.tui = { ...(json.tui ?? {}), enabled: false };
      return json;
    });
  }

  // 2) Environment files — Angular's canonical environments pattern.
  //    - `environment.interface.ts` is the shared shape (always rewrite — generator-owned,
  //      no user values inside).
  //    - `environment.ts` is the dev/emulator default (only write if absent — preserves any
  //      user-customized emulator endpoints across re-runs).
  //    - `environment.prod.ts` is the production target (only write if absent — preserves the
  //      user's real Firebase web config across re-runs). If the project still has a legacy
  //      firebase.config.ts with a non-empty `productionFirebaseConfig`, we migrate those
  //      values into the new environment.prod.ts before writing it, so `--repair --firebase`
  //      against an old project doesn't drop a real production config on the floor.
  const envDir = `${appRoot}/src/environments`;
  const envInterfacePath = `${envDir}/environment.interface.ts`;
  const envDevPath = `${envDir}/environment.ts`;
  const envProdPath = `${envDir}/environment.prod.ts`;
  const firebaseConfigPath = `${appRoot}/src/app/firebase.config.ts`;

  tree.write(envInterfacePath, template('environment.interface.ts.tpl'));

  if (!tree.exists(envDevPath)) {
    tree.write(envDevPath, substitute(template('environment.ts.tpl')));
  }

  if (!tree.exists(envProdPath)) {
    // Migration: if the project still has the legacy firebase.config.ts shape
    // with a populated `productionFirebaseConfig`, carry those values into the
    // new environment.prod.ts. Empty placeholders stay empty (their job is to
    // make a half-wired prod build fail loud).
    const migrated = tree.exists(firebaseConfigPath)
      ? extractLegacyProdConfig(tree.read(firebaseConfigPath, 'utf8') ?? '')
      : { projectId: '', apiKey: '', appId: '', authDomain: '' };
    if (migrated.projectId || migrated.apiKey || migrated.appId) {
      logger.info(
        `[firebase-emulators] Migrated productionFirebaseConfig from ${firebaseConfigPath} into ${envProdPath} ` +
        `(legacy shape detected). Verify the new file before committing.`
      );
    }
    tree.write(
      envProdPath,
      template('environment.prod.ts.tpl')
        .split('{{projectId}}').join(migrated.projectId)
        .split('{{apiKey}}').join(migrated.apiKey)
        .split('{{appId}}').join(migrated.appId)
        .split('{{authDomain}}').join(migrated.authDomain)
    );
  }

  // 2b) src/app/firebase.config.ts — write whenever it's absent, and (re)write
  //     when we detect the LEGACY ngDevMode-and-two-consts shape (so --repair
  //     self-heals old projects into the environment-files shape). Once a file
  //     is on the modern shape (i.e. it imports from '../environments/environment'),
  //     leave it alone — the user may have added app-specific customizations
  //     to providers (e.g. `initializeFirestore` options, extra `messagingSenderId`
  //     fields, custom emulator wiring). Clobbering those silently every
  //     `--repair --firebase` would burn users.
  //
  //     The "modern" detection is intentionally lenient: any file that already
  //     imports the env via the canonical relative path counts as "user-owned
  //     from here on" — even if the user has reshaped the providers list.
  const existingFirebaseConfig = tree.exists(firebaseConfigPath)
    ? tree.read(firebaseConfigPath, 'utf8') ?? ''
    : null;
  const isLegacyShape =
    existingFirebaseConfig !== null &&
    (existingFirebaseConfig.includes('productionFirebaseConfig') ||
      existingFirebaseConfig.includes('emulatorFirebaseConfig') ||
      existingFirebaseConfig.includes('declare const ngDevMode')) &&
    !existingFirebaseConfig.includes(`from '../environments/environment'`);
  if (existingFirebaseConfig === null || isLegacyShape) {
    if (isLegacyShape) {
      logger.info(
        `[firebase-emulators] Rewriting ${firebaseConfigPath} from the legacy ngDevMode shape ` +
        `to the environment-files shape. Any custom provider wiring in the legacy file is gone — ` +
        `port it onto the new shape by hand if needed.`
      );
    }
    tree.write(firebaseConfigPath, template('firebase.config.ts.tpl'));
  }

  // 3a) tools/firebase-welcome.sh — self-extinguishing banner that nudges the user
  //     toward the cloud-linkage steps every time they open a terminal in the devcontainer,
  //     and goes silent once setup is complete. Sourced by /etc/profile.d/zz-firebase-welcome.sh
  //     which the devcontainer's postCreateCommand installs (when --firebase=true).
  //     Always (re)write — small file, our content, no user edits expected.
  tree.write('tools/firebase-welcome.sh', template('firebase-welcome.sh.tpl'));

  // 3b) The emulator tooling scripts. All generator-owned (always rewritten) EXCEPT
  //     tools/seed/world.mjs and tools/emulator-seeds/README.md, which model the APP'S data
  //     and are user-owned once written:
  //       - tools/reap-emulators.sh   — verified process+port reclaim before each start.
  //       - tools/emulators.sh        — the single launch path: reap → prime → start
  //                                     (import .emulator-data; export-on-exit on full runs).
  //       - tools/emulator-data.sh    — working-dir lifecycle: ensure / reset [<seed>].
  //       - tools/seed/build-seeds.sh — rebuild every committed seed from world.mjs.
  //       - tools/seed/build.mjs      — the per-world command emulators:exec runs.
  //       - tools/seed/world.mjs      — the DECLARATIVE seed worlds (user-owned: it mirrors
  //                                     the app's real document shapes; written only if absent).
  //       - tools/emulator-seeds/README.md — seed catalog + usage (user-extended; if absent).
  tree.write('tools/reap-emulators.sh', template('reap-emulators.sh.tpl'));
  tree.write('tools/emulators.sh', substitute(template('emulators.sh.tpl')));
  tree.write('tools/emulator-data.sh', template('emulator-data.sh.tpl'));
  tree.write('tools/seed/build-seeds.sh', substitute(template('seed-build-seeds.sh.tpl')));
  tree.write('tools/seed/build.mjs', template('seed-build.mjs.tpl'));
  if (!tree.exists('tools/seed/world.mjs')) {
    tree.write('tools/seed/world.mjs', substitute(template('seed-world.mjs.tpl')));
  }
  if (!tree.exists('tools/emulator-seeds/README.md')) {
    tree.write('tools/emulator-seeds/README.md', template('emulator-seeds-README.md.tpl'));
  }

  // 3c) Cloud Functions as a first-class Nx app (apps/functions). REQUIRED for the emulator
  //     suite to boot at all: firebase.json configures the functions emulator, and a configured
  //     functions emulator with no backend behind it fatally aborts `emulators:start`.
  //     Source files (manifest package.json, tsconfigs, main.ts) are written only if absent —
  //     the user owns their functions code. The project.json's build/lint/deploy targets are
  //     generator-owned (re-asserted); any extra targets the user added are preserved.
  ensureFunctionsProject(tree);

  // 3d) The emulator suite as its own workspace-level Nx project (firebase/project.json) —
  //     the emulators are a workspace concept, not an app concern. Generator-owned targets
  //     are re-asserted; user-added targets (e.g. `reset:<seed>` for extra worlds) survive.
  ensureFirebaseProject(tree);

  // 4) Nx targets on the app's project.json.
  project.targets ??= {};
  const targets = project.targets;

  // The app is browser code — tag it so the platform firewall (4c) applies.
  ensureTag(project, 'platform:web');

  // `serve` is an nx:run-commands ORCHESTRATOR running the `firebase:emulators` continuous
  // task and the real dev-server (`serve-app`) in parallel: one command, one Ctrl+C, both
  // lifecycles owned by the same Nx run — and `serve-app` stays independently runnable
  // (emulator-free dev, e.g. an offline build configuration).
  //
  // Self-heals every earlier generation on --repair:
  //   - serve IS the dev-server (fresh scaffold, or the previous `dependsOn: ['emulators']`
  //     wiring) → move it to `serve-app` (stripping the emulators dependsOn) and park the
  //     orchestrator at `serve`.
  //   - serve is the ancient `firebase emulators:exec` wrapper around an existing `serve-app`
  //     → overwrite `serve` with the orchestrator.
  //   - already on the orchestrator shape → idempotent re-assert.
  const isRunCommands = (t?: TargetConfiguration) => t?.executor === 'nx:run-commands';
  if (targets.serve && !isRunCommands(targets.serve)) {
    stripEmulatorsDependsOn(targets.serve);
    targets.serve.continuous = true;
    targets['serve-app'] = targets.serve;
  } else if (targets['serve-app']) {
    stripEmulatorsDependsOn(targets['serve-app']);
    targets['serve-app'].continuous = true;
  }
  if (targets['serve-app']) {
    targets.serve = {
      continuous: true,
      executor: 'nx:run-commands',
      options: {
        parallel: true,
        commands: ['nx run firebase:emulators', `nx run ${projectName}:serve-app`],
      },
    };
  } else {
    logger.warn(
      `[firebase-emulators] No dev-server target found on project \`${projectName}\` (neither \`serve\` nor \`serve-app\`) — ` +
      `skipped wiring the serve orchestrator. Add a dev-server target, then re-run --repair --firebase.`
    );
  }

  // The per-app `emulators*` targets of earlier generations moved to the workspace-level
  // `firebase` project — drop them from the app so there's exactly one home.
  delete targets.emulators;
  for (const svc of EMULATORS) {
    delete targets[`emulators:${svc}`];
  }

  // 4b) Register the environment-files fileReplacement on the production build
  //     configuration. This is what makes the Angular build swap
  //     `environment.ts` → `environment.prod.ts` when you run `nx build <app>`
  //     (production is the default build configuration on the app target).
  //
  //     Idempotent: we only append the entry if it's not already in the list.
  //     We touch `targets.build.configurations.production` exactly — never
  //     `build.options` or other configurations — so a user who's added their
  //     own staging configuration with their own fileReplacements is unaffected.
  const buildTarget = targets.build as
    | { configurations?: Record<string, { fileReplacements?: Array<{ replace: string; with: string }> }> }
    | undefined;
  if (buildTarget) {
    buildTarget.configurations ??= {};
    buildTarget.configurations.production ??= {};
    const prodCfg = buildTarget.configurations.production;
    const replacement = {
      replace: envDevPath,
      with: envProdPath,
    };
    const existing = Array.isArray(prodCfg.fileReplacements) ? prodCfg.fileReplacements : [];
    const alreadyPresent = existing.some(
      (entry) => entry?.replace === replacement.replace && entry?.with === replacement.with
    );
    prodCfg.fileReplacements = alreadyPresent ? existing : [...existing, replacement];
  } else {
    logger.warn(
      `[firebase-emulators] No \`build\` target on project \`${projectName}\` — skipped registering the environment-files fileReplacement. ` +
      `Add it manually to the production build configuration: ` +
      `{ "replace": "${envDevPath}", "with": "${envProdPath}" }`
    );
  }

  updateProjectConfiguration(tree, projectName, project);

  // 4c) Best-effort: the `platform:` dependency-constraint firewall in the root flat
  //     ESLint config. Server-only SDKs (firebase-admin/firebase-functions pull in Node
  //     natives and admin credentials) must never reach browser code; the browser SDK and
  //     Angular must never reach the functions runtime.
  const eslintConfigPath = 'eslint.config.mjs';
  if (tree.exists(eslintConfigPath)) {
    const current = tree.read(eslintConfigPath, 'utf8') ?? '';
    const patched = addPlatformBoundaries(current, eslintConfigPath);
    if (patched === current) {
      // Already present — idempotent no-op.
    } else if (patched) {
      tree.write(eslintConfigPath, patched);
    } else {
      logger.warn(
        `[firebase-emulators] Could not auto-insert the platform: dependency constraints into ${eslintConfigPath}. ` +
        `Add these entries to the @nx/enforce-module-boundaries depConstraints array manually:\n` +
        `  { sourceTag: 'platform:web', bannedExternalImports: ['firebase-admin', 'firebase-admin/*', 'firebase-functions', 'firebase-functions/*'] },\n` +
        `  { sourceTag: 'platform:server', bannedExternalImports: ['firebase', 'firebase/*', '@angular/*'] }`
      );
    }
  }

  // 5) Best-effort: wire provideAppFirebase() into app.config.ts.
  const appConfigPath = `${appRoot}/src/app/app.config.ts`;
  if (tree.exists(appConfigPath)) {
    const current = tree.read(appConfigPath, 'utf8') ?? '';
    const wired = wireProvideAppFirebase(current, appConfigPath);
    if (wired === current) {
      // Already wired or no changes needed.
    } else if (wired) {
      tree.write(appConfigPath, wired);
    } else {
      logger.warn(
        `[firebase-emulators] Could not auto-wire ${appConfigPath}. ` +
        `Add \`import { provideAppFirebase } from './firebase.config';\` and ` +
        `include \`provideAppFirebase()\` in your providers array manually.`
      );
    }
  }

  // 6) Runtime + build deps. `latest` resolves to current at install time; the lockfile pins
  //    after install. Existing entries are never overwritten (preserves user pins on --repair).
  //      - firebase / @angular/fire          — the browser SDK (dependencies).
  //      - firebase-admin / firebase-functions — the Cloud Functions runtime, at the WORKSPACE
  //        ROOT (no per-project node_modules; local build/lint/emulate resolve from root).
  //        Keep these aligned with apps/functions/package.json (the deploy manifest).
  //      - @nx/esbuild — the functions build executor, pinned to the workspace's own Nx
  //        version (Nx plugin packages must move in lockstep with `nx` itself).
  const rootPkg = readJson(tree, 'package.json') as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const missing = (deps: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(deps).filter(
        ([name]) => !rootPkg.dependencies?.[name] && !rootPkg.devDependencies?.[name]
      )
    );
  const nxVersion =
    rootPkg.devDependencies?.['nx'] ?? rootPkg.dependencies?.['nx'] ?? 'latest';
  addDependenciesToPackageJson(
    tree,
    missing({
      'firebase': 'latest',
      '@angular/fire': 'latest',
      'firebase-admin': '^13.6.0',
      'firebase-functions': '^7.0.0',
    }),
    missing({ '@nx/esbuild': nxVersion })
  );

  await formatFiles(tree);

  // Post-commit: install the new deps via the workspace's package manager.
  return () => {
    installPackagesTask(tree);
  };
}

/** Ensure a tag is present on a project configuration (idempotent). */
function ensureTag(project: ProjectConfiguration, tag: string): void {
  project.tags ??= [];
  if (!project.tags.includes(tag)) {
    project.tags.push(tag);
  }
}

/**
 * Strip any emulator wiring from a target's `dependsOn` — the previous generator
 * generation declared `serve.dependsOn = ['emulators']` (later `{ projects: ['firebase'],
 * target: 'emulators' }`); on the orchestrator shape that wiring lives in the `serve`
 * orchestrator's parallel commands instead.
 */
function stripEmulatorsDependsOn(target: TargetConfiguration): void {
  if (!target.dependsOn) return;
  target.dependsOn = target.dependsOn.filter((dep) => {
    const depTarget = typeof dep === 'string' ? dep : dep?.target;
    return depTarget !== 'emulators';
  });
  if (target.dependsOn.length === 0) {
    delete target.dependsOn;
  }
}

/**
 * Merge generator-owned targets into a project.json-style config file, preserving any
 * user-added targets and tags. Writes the file when absent.
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
  if (!tree.exists(path)) {
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
  updateJson(tree, path, (json) => {
    json.tags ??= [];
    for (const tag of canonical.tags) {
      if (!json.tags.includes(tag)) json.tags.push(tag);
    }
    json.targets = { ...(json.targets ?? {}), ...canonical.targets };
    return json;
  });
}

/** Cloud Functions as a first-class Nx app at apps/functions. */
function ensureFunctionsProject(tree: Tree): void {
  const root = 'apps/functions';

  // Source files: user-owned once written (the manifest's deps, the functions code, and the
  // compiler options are all things a project legitimately evolves).
  const ifAbsent = (path: string, templateName: string) => {
    if (!tree.exists(path)) {
      tree.write(path, readFileSync(join(__dirname, templateName), 'utf8'));
    }
  };
  ifAbsent(`${root}/package.json`, 'functions-package.json.tpl');
  ifAbsent(`${root}/tsconfig.json`, 'functions-tsconfig.json.tpl');
  ifAbsent(`${root}/tsconfig.app.json`, 'functions-tsconfig.app.json.tpl');
  ifAbsent(`${root}/src/main.ts`, 'functions-main.ts.tpl');

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
            esbuildOptions: { outExtension: { '.js': '.js' } },
          },
        },
        // Lints via the workspace flat config — no per-project ESLint island.
        lint: { executor: '@nx/eslint:lint' },
        deploy: {
          executor: 'nx:run-commands',
          dependsOn: ['build'],
          options: { command: 'firebase deploy --only functions', cwd: '{workspaceRoot}' },
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
        // Add `reset:<seed>` siblings here for extra worlds — they survive --repair.
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
function addPlatformBoundaries(source: string, sourcePath: string): string | null {
  // Idempotency: the tag literal anywhere in the file means the firewall is already declared.
  if (source.includes('platform:web') || source.includes('platform:server')) {
    return source;
  }

  const sf = ts.createSourceFile(
    sourcePath,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.JS
  );

  let constraintsArray: ts.ArrayLiteralExpression | null = null;
  const findConstraints = (node: ts.Node): void => {
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

  const found: ts.ArrayLiteralExpression = constraintsArray;
  const snippet =
    `// by platform: the server-only Firebase Admin/Functions SDKs belong to Cloud\n` +
    `// Functions alone — they must never reach browser/SSR Angular code (they pull in\n` +
    `// Node-native modules and admin credentials). Symmetrically, the browser Firebase\n` +
    `// SDK and Angular have no place in the functions runtime.\n` +
    `{\n` +
    `  sourceTag: 'platform:web',\n` +
    `  bannedExternalImports: ['firebase-admin', 'firebase-admin/*', 'firebase-functions', 'firebase-functions/*'],\n` +
    `},\n` +
    `{\n` +
    `  sourceTag: 'platform:server',\n` +
    `  bannedExternalImports: ['firebase', 'firebase/*', '@angular/*'],\n` +
    `},`;
  const elements = found.elements;
  const text =
    elements.length === 0
      ? snippet
      : elements.hasTrailingComma
      ? `\n${snippet}`
      : `,\n${snippet}`;

  const changes: StringChange[] = [
    {
      type: ChangeType.Insert,
      index: found.getEnd() - 1, // position just before the closing `]`
      text,
    },
  ];
  return applyChangesToString(source, changes);
}

/**
 * Wire `provideAppFirebase()` into `appConfig`'s `providers` array, and add the
 * matching `import` at the top of the file.
 *
 * Uses the TypeScript compiler API to locate AST positions (no regex on source —
 * source code is a tree, not text), then applies non-overlapping text inserts via
 * `applyChangesToString` so the surrounding formatting is preserved and the
 * surrounding `formatFiles` polishes the result.
 *
 * Returns:
 *   - the updated source when wiring is applied,
 *   - the original `source` when the file is already wired (idempotent no-op),
 *   - `null` when the file shape is unrecognized (no imports, or no
 *     `appConfig.providers` ArrayLiteral) — the caller logs an actionable warning.
 */
function wireProvideAppFirebase(source: string, sourcePath: string): string | null {
  const sf = ts.createSourceFile(
    sourcePath,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TS
  );

  // Idempotency: any Identifier named `provideAppFirebase` anywhere in the file
  // (import, call, alias) means this file is already wired — never re-write it.
  let alreadyWired = false;
  const detectExisting = (node: ts.Node): void => {
    if (alreadyWired) return;
    if (ts.isIdentifier(node) && node.text === 'provideAppFirebase') {
      alreadyWired = true;
      return;
    }
    ts.forEachChild(node, detectExisting);
  };
  detectExisting(sf);
  if (alreadyWired) return source;

  // Locate the providers ArrayLiteralExpression inside the `appConfig` object literal:
  //   export const appConfig: ApplicationConfig = { providers: [ ... ], ... };
  let providersArray: ts.ArrayLiteralExpression | null = null;
  const findProviders = (node: ts.Node): void => {
    if (providersArray) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'appConfig' &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      for (const prop of node.initializer.properties) {
        if (
          ts.isPropertyAssignment(prop) &&
          ts.isIdentifier(prop.name) &&
          prop.name.text === 'providers' &&
          ts.isArrayLiteralExpression(prop.initializer)
        ) {
          providersArray = prop.initializer;
          return;
        }
      }
    }
    ts.forEachChild(node, findProviders);
  };
  findProviders(sf);
  if (!providersArray) return null;
  // Alias to a const: TS can't track the closure assignment above, so a const pins
  // the narrowed type for the uses below.
  const providers: ts.ArrayLiteralExpression = providersArray;

  // Find the last top-level ImportDeclaration so we know where to put our new import.
  let lastImport: ts.ImportDeclaration | null = null;
  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt)) lastImport = stmt;
    else break; // imports come first; stop scanning once we hit other top-level statements
  }
  if (!lastImport) return null;

  // Pick the right separator based on whether the array already has a trailing comma
  // — the AST's `hasTrailingComma` is the source of truth, no regex on the text.
  const elements = providers.elements;
  const arrSnippet =
    elements.length === 0
      ? 'provideAppFirebase()'
      : elements.hasTrailingComma
      ? ' provideAppFirebase(),'
      : ', provideAppFirebase()';

  const changes: StringChange[] = [
    {
      type: ChangeType.Insert,
      index: lastImport.getEnd(),
      text: `\nimport { provideAppFirebase } from './firebase.config';`,
    },
    {
      type: ChangeType.Insert,
      index: providers.getEnd() - 1, // position just before the closing `]`
      text: arrSnippet,
    },
  ];

  return applyChangesToString(source, changes);
}

/**
 * Extract the field values of the legacy `productionFirebaseConfig` const from
 * an old-shape firebase.config.ts (the pre-environment-files version that
 * carried the two-consts-plus-ngDevMode pattern).
 *
 * Used by the generator's migration path: when `--repair --firebase` runs on a
 * project that still has the legacy file, we don't want to drop the user's
 * real production config on the floor — those values get carried into the new
 * `environment.prod.ts` before the legacy file is overwritten with the new
 * structural shape.
 *
 * Uses the TypeScript compiler API (no regex on source — source code is a tree,
 * not text) to find the `productionFirebaseConfig` variable declaration and
 * read the string fields. Returns empty strings for any field that's
 * absent, non-literal, or itself an empty string — same shape as the template's
 * placeholders, so missing values stay missing.
 *
 * Returns all-empty when the source is the new shape (no
 * `productionFirebaseConfig` const) — the caller treats all-empty as
 * "no migration needed."
 */
function extractLegacyProdConfig(source: string): {
  projectId: string;
  apiKey: string;
  appId: string;
  authDomain: string;
} {
  const empty = { projectId: '', apiKey: '', appId: '', authDomain: '' };
  if (!source.includes('productionFirebaseConfig')) return empty;

  const sf = ts.createSourceFile(
    'firebase.config.ts',
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TS
  );

  let prodObject: ts.ObjectLiteralExpression | null = null;
  const findProd = (node: ts.Node): void => {
    if (prodObject) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'productionFirebaseConfig' &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      prodObject = node.initializer;
      return;
    }
    ts.forEachChild(node, findProd);
  };
  findProd(sf);
  if (!prodObject) return empty;

  const readField = (name: string): string => {
    for (const prop of prodObject!.properties) {
      if (
        ts.isPropertyAssignment(prop) &&
        ts.isIdentifier(prop.name) &&
        prop.name.text === name &&
        ts.isStringLiteral(prop.initializer)
      ) {
        return prop.initializer.text;
      }
    }
    return '';
  };

  return {
    projectId: readField('projectId'),
    apiKey: readField('apiKey'),
    appId: readField('appId'),
    authDomain: readField('authDomain'),
  };
}
