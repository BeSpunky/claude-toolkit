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
//   - firebase.json   (workspace root) — emulators config (auth/firestore/storage/functions/ui), singleProjectMode.
//   - apps/<project>/src/app/firebase.config.ts — provideAppFirebase() using `ngDevMode` to switch emulator vs prod.
//   - apps/<project>/src/app/app.config.ts — best-effort wiring of provideAppFirebase() into providers; warns if unrecognized.
//   - apps/<project>/project.json targets:
//       * `serve`              — nx:run-commands orchestrator: emulators + serve-app in parallel.
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

const FIREBASE_JSON = {
  emulators: {
    auth: { port: 9099 },
    firestore: { port: 8080 },
    storage: { port: 9199 },
    functions: { port: 5001 },
    hosting: { port: 5000 },
    ui: { enabled: true, port: 4000 },
    singleProjectMode: true,
  },
};

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
  tree.write('firebase.json', JSON.stringify(FIREBASE_JSON, null, 2) + '\n');

  // 2) src/app/firebase.config.ts (don't clobber user edits).
  const firebaseConfigPath = `${appRoot}/src/app/firebase.config.ts`;
  if (!tree.exists(firebaseConfigPath)) {
    const tpl = readFileSync(join(__dirname, 'firebase.config.ts.tpl'), 'utf8');
    tree.write(firebaseConfigPath, tpl.split('{{workspaceName}}').join(workspaceName));
  }

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

  // Rename the original `serve` (Angular dev-server) to `serve-app`, then wrap with an orchestrator.
  const existingServe = project.targets.serve;
  if (existingServe && existingServe.executor !== 'nx:run-commands') {
    project.targets['serve-app'] = existingServe;
    project.targets.serve = {
      continuous: true,
      executor: 'nx:run-commands',
      options: {
        commands: [
          `nx run ${projectName}:emulators`,
          `nx run ${projectName}:serve-app`,
        ],
        parallel: true,
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
