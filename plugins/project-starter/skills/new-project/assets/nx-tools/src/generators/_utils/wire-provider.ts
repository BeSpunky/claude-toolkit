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
// The TypeScript compiler API is reached through `_utils/typescript-api` — a declared subset plus a lazy,
// feature-probed loader. See that file for why this cannot be `typeof import('typescript')` any more.
import { applyChangesToString, type StringChange, ChangeType } from '@nx/devkit';
import {
  loadTypeScript,
  type TsArrayLiteralExpression,
  type TsImportDeclaration,
  type TsNode,
} from './typescript-api';

export interface WireProviderOptions {
  /** The provider function to call inside `providers: [...]`, e.g. `provideDesignSystem`. */
  providerFn: string;
  /** The module specifier to import it from, e.g. `'./worktree-tab-label'` or `'@acme/design-system'`. */
  importFrom: string;
  /**
   * True ONLY when this run is ENSURING the layer that owns this provider — i.e. creating the capability,
   * not merely finding it already present. Wiring is a BASELINE act; see the header for why.
   *
   * Required rather than optional, and checked here rather than at each call site, so the compiler is what
   * guarantees a new caller has thought about it. An `if` at three call sites is three chances to forget.
   */
  ensuring: boolean;
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
  { providerFn, importFrom, ensuring }: WireProviderOptions
): string | null {
  // ── app.config.ts IS SEEDED, NEVER OWNED — SO WIRING HAPPENS ON ENSURE, NEVER ON DETECT ──────────────
  //
  // This used to run on every sync, and it overwrote deliberate decisions. In one project it re-added
  // `provideAppFirebase()` to the shared app.config.ts four lines above a comment saying Firebase was
  // deliberately NOT there — the app provided it in its browser-only config, so the re-add double-provided
  // it and initialised Firebase during SSR/prerender. The house's own Angular guidance exists to prevent
  // exactly that.
  //
  // app.config.ts is the file an Angular app is most CERTAIN to evolve: it is where every provider decision
  // accumulates. That makes it class (C) — seeded at baseline, never owned — and a generator writing into it
  // at sync time is a category error regardless of what it writes. Any later change to a provider is a
  // MIGRATION, which can be reviewed and can refuse to guess.
  //
  // The tempting alternative was to make the idempotency check smarter — scan the whole config graph before
  // adding. It would have prevented that exact diff, and it is the trap: the check would have to recognise
  // every shape an app config has ever had or might be restructured into (browser/server splits, re-exports,
  // providers assembled by a factory), forever. That is unbounded legacy healing wearing a small hat, and
  // retiring it is why the migration ladder exists. Note the existing guard below is CORRECT and still
  // failed here — it deliberately looks for a call inside THIS file's providers array, and no scan of a file
  // it was never told about could have helped. The write simply should not have been happening.
  //
  // Returning `source` (not null) means "no change": every caller already treats that as success, so a
  // detect-only run is a clean no-op rather than a warning about wiring nobody asked for.
  if (!ensuring) return source;

  const ts = loadTypeScript();
  if (!ts) return null;

  const sf = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, /* setParentNodes */ true, ts.ScriptKind.TS);

  // Locate `export const appConfig: ApplicationConfig = { providers: [ ... ] }`.
  let providersArray: TsArrayLiteralExpression | null = null;
  const findProviders = (node: TsNode): void => {
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
  const providers: TsArrayLiteralExpression = providersArray;

  // Idempotency, scoped CORRECTLY: already wired means a CALL to `<providerFn>()` inside the providers
  // array — NOT merely the identifier appearing somewhere in the file. A leftover `import { providerFn }`
  // after a manual revert (a very common half-edit) would fool a whole-file identifier scan into
  // reporting "wired" and refusing to re-add the call, leaving the app importing-but-not-using it.
  let callWired = false;
  const detectCall = (node: TsNode): void => {
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
  let lastImport: TsImportDeclaration | null = null;
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
