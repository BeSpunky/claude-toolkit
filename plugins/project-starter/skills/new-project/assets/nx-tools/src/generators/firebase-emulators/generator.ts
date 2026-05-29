// House generator: scaffold Firebase emulator config + Nx targets + app initialization.
// Idempotent and safe in --repair mode.
//
// Writes:
//   - firebase.json   (workspace root) — emulators config (auth/firestore/storage/functions/ui), singleProjectMode.
//   - .firebaserc     (workspace root) — default project `demo-<workspaceName>` (Firebase emulator convention).
//   - apps/<project>/src/app/firebase.config.ts — provideAppFirebase() using `ngDevMode` to switch emulator vs prod.
//   - apps/<project>/src/app/app.config.ts — best-effort wiring of provideAppFirebase() into providers; warns if unrecognized.
//   - apps/<project>/project.json targets:
//       * `serve`              — nx:run-commands orchestrator: emulators + serve-app in parallel.
//       * `serve-app`          — the original Angular dev-server target (renamed from `serve`).
//       * `emulators`          — start the whole emulator suite (long-running).
//       * `emulators:<svc>`    — start one emulator + UI (auth | firestore | storage | functions).
import {
  type Tree,
  type GeneratorCallback,
  readProjectConfiguration,
  updateProjectConfiguration,
  formatFiles,
  addDependenciesToPackageJson,
  installPackagesTask,
  logger,
} from '@nx/devkit';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
  tree.write('firebase.json', JSON.stringify(FIREBASE_JSON, null, 2) + '\n');

  // 2) .firebaserc with demo project id (Firebase emulator convention — works without GCP credentials).
  tree.write(
    '.firebaserc',
    JSON.stringify({ projects: { default: `demo-${workspaceName}` } }, null, 2) + '\n'
  );

  // 3) src/app/firebase.config.ts (don't clobber user edits).
  const firebaseConfigPath = `${appRoot}/src/app/firebase.config.ts`;
  if (!tree.exists(firebaseConfigPath)) {
    const tpl = readFileSync(join(__dirname, 'firebase.config.ts.tpl'), 'utf8');
    tree.write(firebaseConfigPath, tpl.split('{{workspaceName}}').join(workspaceName));
  }

  // 4) Best-effort: wire provideAppFirebase() into app.config.ts.
  const appConfigPath = `${appRoot}/src/app/app.config.ts`;
  if (tree.exists(appConfigPath)) {
    const current = tree.read(appConfigPath, 'utf8') ?? '';
    const wired = wireProvideAppFirebase(current);
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

  // 5) Nx targets on the app's project.json.
  project.targets ??= {};

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

  // Master `emulators` target — starts the full suite.
  project.targets.emulators = {
    continuous: true,
    executor: 'nx:run-commands',
    options: {
      command: 'firebase emulators:start',
      cwd: '{workspaceRoot}',
    },
  };

  // Per-emulator targets — start just one (+ UI).
  for (const svc of EMULATORS) {
    project.targets[`emulators:${svc}`] = {
      continuous: true,
      executor: 'nx:run-commands',
      options: {
        command: `firebase emulators:start --only ${svc},ui`,
        cwd: '{workspaceRoot}',
      },
    };
  }

  updateProjectConfiguration(tree, projectName, project);

  // 6) Runtime deps. `latest` resolves to current at install time;
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
 * Best-effort wiring: add `import { provideAppFirebase } from './firebase.config';`
 * and append `provideAppFirebase()` to the providers array.
 * Returns the updated source, the original source (if already wired), or null if the file shape is unexpected.
 */
function wireProvideAppFirebase(source: string): string | null {
  if (source.includes('provideAppFirebase')) return source; // already wired; no-op

  // Insert the import after the last existing import statement.
  const importRegex = /^import .+ from .+;$/gm;
  let lastImportEnd = -1;
  let m: RegExpExecArray | null;
  while ((m = importRegex.exec(source)) !== null) {
    lastImportEnd = m.index + m[0].length;
  }
  if (lastImportEnd === -1) return null;
  const importStmt = `\nimport { provideAppFirebase } from './firebase.config';`;
  let updated = source.slice(0, lastImportEnd) + importStmt + source.slice(lastImportEnd);

  // Append `provideAppFirebase()` inside the providers array. Non-greedy across lines.
  const providersRegex = /providers\s*:\s*\[([\s\S]*?)\]/;
  const pm = providersRegex.exec(updated);
  if (!pm) return null;
  const inner = pm[1];
  const trimmedInner = inner.trim();
  const replacement = trimmedInner.length
    ? `providers: [${inner.replace(/\s*$/, '')}, provideAppFirebase()]`
    : `providers: [provideAppFirebase()]`;
  updated = updated.slice(0, pm.index) + replacement + updated.slice(pm.index + pm[0].length);

  return updated;
}
