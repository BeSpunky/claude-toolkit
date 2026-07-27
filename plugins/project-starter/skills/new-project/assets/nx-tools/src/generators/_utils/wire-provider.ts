// Shared generator util: wire a `provideX()` call into an Angular app's `appConfig.providers` array.
//
// The ONE implementation, used by all three callers:
//   - serve                 → provideWorktreeTabLabel()
//   - firebase-emulators    → provideAppFirebase()
//   - design-system-styles  → provideDesignSystem()
// `serve` and `firebase-emulators` each carried their own byte-for-byte copy of this TS-AST walk; a third
// copy for the design system would have been the exact "never do the same thing by hand twice" smell the
// house forbids, so the routine was extracted here and both originals deleted.
//
// Uses the TypeScript compiler API to locate AST positions (source code is a tree, not text), then
// applies non-overlapping text inserts via `applyChangesToString` so surrounding formatting survives
// and the caller's `formatFiles` polishes the result.
//
// TYPESCRIPT IS BOUND LAZILY, and that is load-bearing rather than a micro-optimisation. A static
// `import * as ts from 'typescript'` binds at MODULE LOAD, so merely importing a generator that imports
// this file would throw `Cannot find module 'typescript'` in a workspace that hasn't got one — and a
// workspace produced by `nx init` hasn't. The failure landed nowhere near the cause: the `serve` generator
// died before its first line ran, on a repo where the provider-wiring step would never have applied
// anyway. Same shape as the `@nx/angular` static import that took down `secondary-entrypoint`. So the
// binding happens at CALL time, and its absence degrades to `null` — which every caller already handles by
// warning with manual wiring instructions.
import { applyChangesToString, type StringChange, ChangeType } from '@nx/devkit';
import type * as TS from 'typescript';

let tsModule: typeof TS | null | undefined;

/**
 * The TypeScript compiler API, or `null` when this workspace hasn't got a usable one. Resolved once.
 *
 * "Usable" is checked by FEATURE, not by resolvability, and that distinction is already live rather than
 * hypothetical: `typescript` on npm now resolves to the 7.x native port, whose main entry no longer exposes
 * the classic compiler API (`createSourceFile`, `ScriptTarget`, the `isXxx` guards) — its `.` export is
 * essentially just the version. So `require` SUCCEEDS and the first call then dies with
 * "createSourceFile is not a function", which reads as a bug in this file rather than as a workspace whose
 * TypeScript moved on. Probing one representative entry point turns that crash into the same graceful
 * `null` the missing-module case produces, and callers already warn with manual wiring instructions.
 * (`compile-generators.mts` hits the same wall from the other side — see the pinned TS 5 in scaffold.sh.)
 */
export function loadTypeScript(): typeof TS | null {
  if (tsModule === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const loaded = require('typescript') as Partial<typeof TS>;
      tsModule = typeof loaded?.createSourceFile === 'function' ? (loaded as typeof TS) : null;
    } catch {
      tsModule = null;
    }
  }
  return tsModule;
}

export interface WireProviderOptions {
  /** The provider function to call inside `providers: [...]`, e.g. `provideDesignSystem`. */
  providerFn: string;
  /** The module specifier to import it from, e.g. `'./worktree-tab-label'` or `'@acme/design-system'`. */
  importFrom: string;
}

/**
 * Wire `<providerFn>()` into `appConfig`'s `providers` array (+ the matching import).
 *
 * Returns the updated source when wiring is applied, the ORIGINAL `source` when already wired
 * (idempotent no-op — so a --sync re-run is a no-op), or `null` when the file shape is
 * unrecognized (the caller warns with a manual-wiring instruction rather than crashing).
 */
export function wireProvider(
  source: string,
  sourcePath: string,
  { providerFn, importFrom }: WireProviderOptions
): string | null {
  const ts = loadTypeScript();
  if (!ts) return null;

  const sf = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, /* setParentNodes */ true, ts.ScriptKind.TS);

  // Locate `export const appConfig: ApplicationConfig = { providers: [ ... ] }`.
  let providersArray: TS.ArrayLiteralExpression | null = null;
  const findProviders = (node: TS.Node): void => {
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
  const providers: TS.ArrayLiteralExpression = providersArray;

  // Idempotency, scoped CORRECTLY: already wired means a CALL to `<providerFn>()` inside the providers
  // array — NOT merely the identifier appearing somewhere in the file. A leftover `import { providerFn }`
  // after a manual revert (a very common half-edit) would fool a whole-file identifier scan into
  // reporting "wired" and refusing to re-add the call, leaving the app importing-but-not-using it.
  let callWired = false;
  const detectCall = (node: TS.Node): void => {
    if (callWired) return;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === providerFn) {
      callWired = true;
      return;
    }
    ts.forEachChild(node, detectCall);
  };
  detectCall(providers);
  if (callWired) return source;

  // Find the last top-level ImportDeclaration so we know where to put our new import.
  let lastImport: TS.ImportDeclaration | null = null;
  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt)) lastImport = stmt;
    else break;
  }
  if (!lastImport) return null;

  // Don't add a second import if one is already present (e.g. the leftover-import case above).
  let hasImport = false;
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt)) break;
    const named = stmt.importClause?.namedBindings;
    if (named && ts.isNamedImports(named) && named.elements.some((e) => e.name.text === providerFn)) {
      hasImport = true;
      break;
    }
  }

  const elements = providers.elements;
  const call = `${providerFn}()`;
  const arrSnippet =
    elements.length === 0 ? call : elements.hasTrailingComma ? ` ${call},` : `, ${call}`;

  const changes: StringChange[] = [
    {
      type: ChangeType.Insert,
      index: providers.getEnd() - 1, // just before the closing `]`
      text: arrSnippet,
    },
  ];
  if (!hasImport) {
    changes.push({
      type: ChangeType.Insert,
      index: lastImport.getEnd(),
      text: `\nimport { ${providerFn} } from '${importFrom}';`,
    });
  }
  return applyChangesToString(source, changes);
}
