// House generator: scaffold Firebase emulator config + Nx targets + app initialization.
// Idempotent and safe in --repair mode.
//
// IMPORTANT: this generator NEVER writes `.firebaserc`. The cloud-project linkage is the
// Firebase CLI's responsibility — `firebase use --add` validates against the user's actual
// account and writes `.firebaserc` properly. Fabricating one here would lie about the cloud
// state and break `firebase deploy` / `firebase use` the moment the user touches them.
// Emulators don't need `.firebaserc`: each `firebase emulators:start` Nx target passes
// `--project=demo-<workspaceName>` explicitly. The `demo-` prefix is Firebase's documented
// convention for "offline only, no cloud calls," so emulators work without login and without
// a real GCP project.
//
// Writes:
//   - firebase.json     (workspace root) — emulator suite config (auth/firestore/storage/functions/ui),
//                        singleProjectMode, all emulators bound to 0.0.0.0 for Docker/devcontainer compatibility.
//                        NO top-level `hosting` block — the BeSpunky default is Firebase App Hosting
//                        (framework-aware), whose config lives in apphosting.yaml.
//   - apphosting.yaml   (workspace root) — Firebase App Hosting deploy config. Starter ships empty
//                        with commented examples; users fill in runConfig / env / scripts as needed.
//                        Created only if absent (preserves user edits on --repair).
//   - apps/<project>/src/environments/environment.interface.ts — shared Environment shape.
//   - apps/<project>/src/environments/environment.ts — dev/emulator config (default).
//   - apps/<project>/src/environments/environment.prod.ts — production config (placeholders;
//     gets migrated values from a legacy firebase.config.ts when --repair --firebase runs).
//   - apps/<project>/src/app/firebase.config.ts — provideAppFirebase() that reads from
//     `environment` and gates emulator wiring on `!environment.production`. Always rewritten
//     to the canonical shape; user-customizable values live in the env files now.
//   - apps/<project>/src/app/app.config.ts — best-effort wiring of provideAppFirebase() into providers; warns if unrecognized.
//   - apps/<project>/project.json targets:
//       * `serve`              — `firebase emulators:exec` wrapper that runs `serve-app` as its
//                                child. firebase owns the emulator lifecycle: it boots the suite,
//                                runs the wrapped dev-server, and on shutdown tears down ALL
//                                emulator JVMs — no orphan Java processes holding ports between
//                                restarts. ng serve also starts only after emulators are ready,
//                                so the app doesn't race emulator boot.
//                                (Earlier shape was parallel `emulators` + `serve-app` via
//                                nx:run-commands; signal propagation through yarn→nx→firebase→java
//                                was unreliable and orphaned the Firestore JVM on every kill.)
//       * `serve-app`          — the original Angular dev-server target (renamed from `serve`).
//       * `emulators`          — start the whole emulator suite under --project=demo-<workspaceName>.
//       * `emulators:<svc>`    — start one emulator + UI under --project=demo-<workspaceName>.
import {
  type Tree,
  type GeneratorCallback,
  readProjectConfiguration,
  updateProjectConfiguration,
  formatFiles,
  addDependenciesToPackageJson,
  installPackagesTask,
  applyChangesToString,
  type StringChange,
  ChangeType,
  logger,
} from '@nx/devkit';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ts from 'typescript';

interface FirebaseEmulatorsSchema {
  project: string;
  workspaceName?: string;
}

// Build firebase.json. NOTE: no top-level `hosting` block, and no `hosting` emulator entry —
// the BeSpunky default is Firebase **App Hosting** (the framework-aware product), not classic
// static Hosting. App Hosting configuration lives in `apphosting.yaml` at the workspace root
// (generated separately); firebase.json plays no documented role in App Hosting deploys.
// Users who want the App Hosting emulator for production-parity local serve can run
// `firebase init apphosting` — it generates the correct `emulators.apphosting.startCommand`
// for the detected framework, which our generator can't sensibly hard-code.
//
// Every backend-service emulator binds to `0.0.0.0` (all interfaces) — required when running
// inside Docker / devcontainers, where the firebase-tools probe (`127.0.0.1:<port>`) otherwise
// fails with "Port X is not open on localhost (127.0.0.1)" because the emulator bound to ::1
// (IPv6) or a container-internal interface only. Binding 0.0.0.0 also makes the emulator UI
// reachable from the host browser via VS Code's auto-forwarding (the devcontainer
// has no explicit `forwardPorts` — auto-detection picks a free host port per binding
// so parallel devcontainers don't collide).
function buildFirebaseJson() {
  return {
    emulators: {
      auth:      { host: '0.0.0.0', port: 9099 },
      firestore: { host: '0.0.0.0', port: 8080 },
      storage:   { host: '0.0.0.0', port: 9199 },
      functions: { host: '0.0.0.0', port: 5001 },
      ui:        { enabled: true, host: '0.0.0.0', port: 4000 },
      singleProjectMode: true,
    },
  };
}

const EMULATORS = ['auth', 'firestore', 'storage', 'functions'] as const;

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

  // 1) firebase.json at workspace root (idempotent overwrite to canonical shape).
  // Note: `.firebaserc` is deliberately NOT generated — see the file header. The Firebase CLI
  // owns cloud-project linkage (`firebase use --add` after `firebase login`). Emulator targets
  // pass `--project=demo-<workspaceName>` explicitly, so emulators run without `.firebaserc`.
  tree.write('firebase.json', JSON.stringify(buildFirebaseJson(), null, 2) + '\n');

  // 1b) apphosting.yaml at workspace root — Firebase App Hosting's deploy config.
  //     Don't clobber user edits; only write if absent.
  if (!tree.exists('apphosting.yaml')) {
    const appHostingTpl = readFileSync(join(__dirname, 'apphosting.yaml.tpl'), 'utf8');
    tree.write('apphosting.yaml', appHostingTpl);
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

  tree.write(
    envInterfacePath,
    readFileSync(join(__dirname, 'environment.interface.ts.tpl'), 'utf8')
  );

  if (!tree.exists(envDevPath)) {
    const tpl = readFileSync(join(__dirname, 'environment.ts.tpl'), 'utf8');
    tree.write(envDevPath, tpl.split('{{workspaceName}}').join(workspaceName));
  }

  if (!tree.exists(envProdPath)) {
    // Migration: if the project still has the legacy firebase.config.ts shape
    // with a populated `productionFirebaseConfig`, carry those values into the
    // new environment.prod.ts. Empty placeholders stay empty (their job is to
    // make a half-wired prod build fail loud).
    const migrated = tree.exists(firebaseConfigPath)
      ? extractLegacyProdConfig(tree.read(firebaseConfigPath, 'utf8') ?? '')
      : { projectId: '', apiKey: '', appId: '' };
    if (migrated.projectId || migrated.apiKey || migrated.appId) {
      logger.info(
        `[firebase-emulators] Migrated productionFirebaseConfig from ${firebaseConfigPath} into ${envProdPath} ` +
        `(legacy shape detected). Verify the new file before committing.`
      );
    }
    const tpl = readFileSync(join(__dirname, 'environment.prod.ts.tpl'), 'utf8');
    tree.write(
      envProdPath,
      tpl
        .split('{{projectId}}').join(migrated.projectId)
        .split('{{apiKey}}').join(migrated.apiKey)
        .split('{{appId}}').join(migrated.appId)
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
    tree.write(
      firebaseConfigPath,
      readFileSync(join(__dirname, 'firebase.config.ts.tpl'), 'utf8')
    );
  }

  // 3a) tools/firebase-welcome.sh — self-extinguishing banner that nudges the user
  //     toward the cloud-linkage steps every time they open a terminal in the devcontainer,
  //     and goes silent once setup is complete. Sourced by /etc/profile.d/zz-firebase-welcome.sh
  //     which the devcontainer's postCreateCommand installs (when --firebase=true).
  //     Always (re)write — small file, our content, no user edits expected.
  const welcomePath = 'tools/firebase-welcome.sh';
  const welcomeTpl = readFileSync(join(__dirname, 'firebase-welcome.sh.tpl'), 'utf8');
  tree.write(welcomePath, welcomeTpl);

  // 3) Best-effort: wire provideAppFirebase() into app.config.ts.
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

  // 4) Nx targets on the app's project.json.
  project.targets ??= {};
  // `demo-<name>` is Firebase's offline convention — works without login, never calls the cloud.
  const demoProject = `demo-${workspaceName}`;

  // Rename the original `serve` (Angular dev-server) to `serve-app` on first wrap, then
  // (re)write `serve` to the canonical `firebase emulators:exec` wrapper. Always rewriting
  // the wrapper is what makes `--repair` self-heal: a project scaffolded by an earlier
  // version of this generator (parallel `emulators` + `serve-app` via nx:run-commands)
  // is normalized to the current shape on the next run.
  //
  // We only rename serve→serve-app when serve-app doesn't already exist — that protects any
  // user customizations on serve-app across re-runs, and is also the right behavior when an
  // earlier run already did the rename.
  const existingServe = project.targets.serve;
  if (
    existingServe &&
    existingServe.executor !== 'nx:run-commands' &&
    !project.targets['serve-app']
  ) {
    project.targets['serve-app'] = existingServe;
  }
  if (project.targets['serve-app']) {
    // Canonical wrapper: firebase owns the emulator lifecycle, signals propagate cleanly,
    // no orphan JVMs hold ports between restarts. Single-quoting the inner command keeps
    // bash from word-splitting the `nx run` argument.
    project.targets.serve = {
      continuous: true,
      executor: 'nx:run-commands',
      options: {
        command: `firebase emulators:exec --project=${demoProject} 'nx run ${projectName}:serve-app'`,
        cwd: '{workspaceRoot}',
      },
    };
  }

  // Master `emulators` target — starts the full suite under the offline demo project id.
  project.targets.emulators = {
    continuous: true,
    executor: 'nx:run-commands',
    options: {
      command: `firebase emulators:start --project=${demoProject}`,
      cwd: '{workspaceRoot}',
    },
  };

  // Per-emulator targets — start just one (+ UI), same offline demo project id.
  for (const svc of EMULATORS) {
    project.targets[`emulators:${svc}`] = {
      continuous: true,
      executor: 'nx:run-commands',
      options: {
        command: `firebase emulators:start --only ${svc},ui --project=${demoProject}`,
        cwd: '{workspaceRoot}',
      },
    };
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
  const buildTarget = project.targets.build as
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

  // 5) Runtime deps. `latest` resolves to current at install time;
  //    the lockfile pins after install. Re-running is safe (no-op if already present at compatible version).
  addDependenciesToPackageJson(
    tree,
    { 'firebase': 'latest', '@angular/fire': 'latest' },
    /* devDependencies */ {}
  );

  await formatFiles(tree);

  // Post-commit: install the new deps via the workspace's package manager.
  return () => {
    installPackagesTask(tree);
  };
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

  // Find the last top-level ImportDeclaration so we know where to put our new import.
  let lastImport: ts.ImportDeclaration | null = null;
  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt)) lastImport = stmt;
    else break; // imports come first; stop scanning once we hit other top-level statements
  }
  if (!lastImport) return null;

  // Pick the right separator based on whether the array already has a trailing comma
  // — the AST's `hasTrailingComma` is the source of truth, no regex on the text.
  const elements = providersArray.elements;
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
      index: providersArray.getEnd() - 1, // position just before the closing `]`
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
 * read the three string fields. Returns empty strings for any field that's
 * absent, non-literal, or itself an empty string — same shape as the template's
 * placeholders, so missing values stay missing.
 *
 * Returns `{ projectId: '', apiKey: '', appId: '' }` when the source is the new
 * shape (no `productionFirebaseConfig` const) — the caller treats all-empty as
 * "no migration needed."
 */
function extractLegacyProdConfig(source: string): { projectId: string; apiKey: string; appId: string } {
  const empty = { projectId: '', apiKey: '', appId: '' };
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
  };
}
