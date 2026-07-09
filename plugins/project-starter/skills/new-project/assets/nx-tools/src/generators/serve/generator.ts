// House generator: give a project the unified `serve` target + its `dev-server` leaf.
//
// The per-app sibling of serve-options, and the SINGLE home of the house dev loop. It parks two
// targets on the app, one composing the other:
//   - `dev-server` — the app's real @angular/build:dev-server (host 0.0.0.0, so it's reachable from
//     outside the devcontainer; configurations development (default) / production; buildTarget
//     <app>:build). An internal leaf the composing executor drives — also runnable directly.
//   - `serve`      — the @bespunky/nx-tools:serve composing executor: it runs `dev-server` plus, on a
//     Firebase tree, the emulator suite, plus the shared co-driven browser, under one graceful Ctrl+C,
//     for the current worktree or any chosen one. This REPLACES the old trio (serve / serve-worktree /
//     serve-with-shared-browser) — the worktree and shared-browser axes are now flags on this one serve.
//
// It also wires the LAYER-1 worktree tab label into the app (worktree-tab-label.ts + provider in
// app.config.ts): a dev-only initializer that, when the app is viewed on a `<slug>.localhost` worktree
// domain, prefixes the tab title with `[slug]` and tints the favicon by a hue hashed from the slug, so
// each worktree tab is visually distinct. Tree-shaken from prod (gated on ngDevMode).
//
// Why per-app (not workspace-level): every app — the scaffolder's first and every later
// `nx g @bespunky/nx-tools:app` — needs its own dev-server leaf + serve target, so it is applied here,
// on the same code path serve-options runs on, and can't drift as apps are added.
//
// Idempotent + --repair-safe: re-running re-asserts the same targets (self-healing the raw
// @nx/angular `serve` and any legacy dev-server names into the `dev-server` leaf), rewrites the
// generator-owned tab-label glue, and re-wires the provider only if absent.
import {
  type Tree,
  type TargetConfiguration,
  readProjectConfiguration,
  updateProjectConfiguration,
  applyChangesToString,
  type StringChange,
  ChangeType,
  formatFiles,
  logger,
} from '@nx/devkit';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import * as ts from 'typescript';

interface ServeSchema {
  project: string;
  // Override the workspace identity used as the base-host slug in the tab label. Defaults to the
  // workspace root directory name — correct in every normal case.
  workspaceName?: string;
}

const DEV_SERVER_EXECUTOR = '@angular/build:dev-server';
const SERVE_EXECUTOR = '@bespunky/nx-tools:serve';
// Every historical name the app dev-server may hide under (a fresh @nx/angular `serve`, or a legacy
// Firebase inner target) — consolidated into the single `dev-server` leaf.
const LEGACY_DEV_SERVER_NAMES = ['dev-server', 'serve-with-emulators', 'serve-no-emulators', 'serve-standalone', 'serve-app'];

export default async function serveGenerator(tree: Tree, options: ServeSchema): Promise<void> {
  const projectName = options.project;
  const workspaceName = options.workspaceName ?? basename(tree.root);

  const project = readProjectConfiguration(tree, projectName);
  project.targets ??= {};
  const targets = project.targets;

  // Locate the existing app dev-server (@angular/build:dev-server) under any historical name — or the
  // fresh `serve` before it becomes the composer — so we preserve its user options (host, and anything
  // the developer added) rather than clobbering them.
  let existing: TargetConfiguration | undefined;
  for (const name of [...LEGACY_DEV_SERVER_NAMES, 'serve']) {
    const t = targets[name];
    if (t && t.executor === DEV_SERVER_EXECUTOR) {
      existing = t;
      break;
    }
  }
  const preserved: Record<string, unknown> = { ...(existing?.options ?? {}) };
  const host = (preserved.host as string | undefined) ?? '0.0.0.0';
  // buildTarget + configurations are generator-owned on the leaf — drop any inherited copies.
  delete preserved.buildTarget;
  delete preserved.host;

  // Drop every legacy/duplicate dev-server name (and the fresh `serve` if it WAS the raw dev-server),
  // then assert the leaf + composer. The `serve` slot is reclaimed by the composer below.
  for (const name of LEGACY_DEV_SERVER_NAMES) delete targets[name];
  if (targets.serve?.executor === DEV_SERVER_EXECUTOR) delete targets.serve;

  // The `dev-server` leaf — the real Angular dev-server the composer drives. Env pinned via
  // configurations (development default / production), host applied so it's reachable from outside the
  // container. Preserves any extra user options captured above.
  targets['dev-server'] = {
    continuous: true,
    executor: DEV_SERVER_EXECUTOR,
    options: { ...preserved, buildTarget: `${projectName}:build`, host },
    configurations: {
      development: { buildTarget: `${projectName}:build:development` },
      production: { buildTarget: `${projectName}:build:production` },
    },
    defaultConfiguration: 'development',
  };

  // The composing `serve` — one command, one graceful Ctrl+C: dev-server + optional emulators + optional
  // shared browser, for the current worktree or any chosen one. Defaults cover the common case (emulators
  // + shared browser on, auto port offset); flags (`--no-emulators`, `--no-shared-browser`, `--worktree`,
  // `--portOffset`) tune it.
  targets.serve = {
    continuous: true,
    executor: SERVE_EXECUTOR,
    options: {},
  };

  // LAYER 1: the dev-only worktree tab label. Generator-owned glue (no user values) — always rewritten
  // so fixes propagate. Derives purely from the runtime hostname; the workspace name is baked in only as
  // the base-host sentinel (so `<workspaceName>.localhost` is treated as the base, not a worktree).
  const appRoot = project.root;
  const tabLabelPath = `${appRoot}/src/app/worktree-tab-label.ts`;
  tree.write(
    tabLabelPath,
    readFileSync(join(__dirname, 'files', 'worktree-tab-label.ts.tpl'), 'utf8').split('{{workspaceName}}').join(workspaceName),
  );

  updateProjectConfiguration(tree, projectName, project);

  // Best-effort: wire provideWorktreeTabLabel() into app.config.ts (idempotent — only when absent).
  const appConfigPath = `${appRoot}/src/app/app.config.ts`;
  if (tree.exists(appConfigPath)) {
    const current = tree.read(appConfigPath, 'utf8') ?? '';
    const wired = wireProvider(current, appConfigPath);
    if (wired && wired !== current) {
      tree.write(appConfigPath, wired);
    } else if (wired === null) {
      logger.warn(
        `[serve] Could not auto-wire ${appConfigPath}. Add ` +
        `\`import { provideWorktreeTabLabel } from './worktree-tab-label';\` and include ` +
        `\`provideWorktreeTabLabel()\` in your providers array manually (dev-only tab label).`,
      );
    }
  }

  await formatFiles(tree);
}

/**
 * Wire `provideWorktreeTabLabel()` into `appConfig`'s `providers` array (+ the matching import).
 *
 * Uses the TypeScript compiler API to locate AST positions (source code is a tree, not text), then
 * applies non-overlapping text inserts via `applyChangesToString` so surrounding formatting survives and
 * `formatFiles` polishes the result. Mirrors the firebase-emulators app.config wiring.
 *
 * Returns the updated source when wiring is applied, the original `source` when already wired
 * (idempotent no-op), or `null` when the file shape is unrecognized (the caller warns).
 */
function wireProvider(source: string, sourcePath: string): string | null {
  const sf = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, /* setParentNodes */ true, ts.ScriptKind.TS);

  // Idempotency: any Identifier named `provideWorktreeTabLabel` means the file is already wired.
  let alreadyWired = false;
  const detectExisting = (node: ts.Node): void => {
    if (alreadyWired) return;
    if (ts.isIdentifier(node) && node.text === 'provideWorktreeTabLabel') {
      alreadyWired = true;
      return;
    }
    ts.forEachChild(node, detectExisting);
  };
  detectExisting(sf);
  if (alreadyWired) return source;

  // Locate `export const appConfig: ApplicationConfig = { providers: [ ... ] }`.
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
  const providers: ts.ArrayLiteralExpression = providersArray;

  // Find the last top-level ImportDeclaration so we know where to put our new import.
  let lastImport: ts.ImportDeclaration | null = null;
  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt)) lastImport = stmt;
    else break;
  }
  if (!lastImport) return null;

  const elements = providers.elements;
  const arrSnippet =
    elements.length === 0
      ? 'provideWorktreeTabLabel()'
      : elements.hasTrailingComma
      ? ' provideWorktreeTabLabel(),'
      : ', provideWorktreeTabLabel()';

  const changes: StringChange[] = [
    {
      type: ChangeType.Insert,
      index: lastImport.getEnd(),
      text: `\nimport { provideWorktreeTabLabel } from './worktree-tab-label';`,
    },
    {
      type: ChangeType.Insert,
      index: providers.getEnd() - 1, // just before the closing `]`
      text: arrSnippet,
    },
  ];
  return applyChangesToString(source, changes);
}
