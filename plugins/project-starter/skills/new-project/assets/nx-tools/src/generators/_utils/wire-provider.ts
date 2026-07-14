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
import { applyChangesToString, type StringChange, ChangeType } from '@nx/devkit';
import * as ts from 'typescript';

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
 * (idempotent no-op — so a --repair re-run is a no-op), or `null` when the file shape is
 * unrecognized (the caller warns with a manual-wiring instruction rather than crashing).
 */
export function wireProvider(
  source: string,
  sourcePath: string,
  { providerFn, importFrom }: WireProviderOptions
): string | null {
  const sf = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, /* setParentNodes */ true, ts.ScriptKind.TS);

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

  // Idempotency, scoped CORRECTLY: already wired means a CALL to `<providerFn>()` inside the providers
  // array — NOT merely the identifier appearing somewhere in the file. A leftover `import { providerFn }`
  // after a manual revert (a very common half-edit) would fool a whole-file identifier scan into
  // reporting "wired" and refusing to re-add the call, leaving the app importing-but-not-using it.
  let callWired = false;
  const detectCall = (node: ts.Node): void => {
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
  let lastImport: ts.ImportDeclaration | null = null;
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
