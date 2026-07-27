// The slice of the CLASSIC TypeScript compiler API this toolkit depends on — declared here, once.
//
// WHY THIS FILE EXISTS. Two generators walk a TS AST (wire-provider's `providers` array, firebase-emulators'
// ESLint depConstraints). Both used to type that dependency as `typeof import('typescript')`, which was true
// right up until TypeScript 7: the native port's main entry no longer exposes `createSourceFile`,
// `ScriptTarget`, or the `isXxx` guards, so those files now report ~44 errors in any editor carrying TS 7 —
// while the RUNTIME is already fine, because `loadTypeScript()` probes for the API and degrades to null.
// The type layer was simply making a claim the runtime had already stopped making.
//
// So the dependency is stated as what it actually is: not "the typescript package", but "an object that can
// parse a source file and identify a handful of node kinds". That is a small, stable contract — it is the
// TypeScript 1.x-era API, unchanged for a decade — and declaring it structurally means this code compiles
// against ANY TypeScript version, including ones that no longer ship it. Whether the contract is SATISFIED
// stays a runtime question, answered by the feature probe in `loadTypeScript()`, which is where a question
// about the installed environment belongs.
//
// DELIBERATELY MINIMAL. Every member below is one this toolkit calls; nothing is here "for completeness".
// A wider surface would be a bigger lie to keep true, and each addition should be driven by a real call.

/** Any AST node. `getEnd()` is the only universal member the callers use — they splice text by offset. */
export interface TsNode {
  getEnd(): number;
}

/** An identifier or string literal — both carry the `text` the callers compare against. */
export interface TsNamedNode extends TsNode {
  readonly text: string;
}

/** A node list. TypeScript's own NodeArray adds `hasTrailingComma`, which wire-provider needs to place a comma. */
export interface TsNodeArray<T> extends ReadonlyArray<T> {
  readonly hasTrailingComma?: boolean;
}

export interface TsSourceFile extends TsNode {
  readonly statements: TsNodeArray<TsNode>;
}

export interface TsArrayLiteralExpression extends TsNode {
  readonly elements: TsNodeArray<TsNode>;
}

export interface TsObjectLiteralExpression extends TsNode {
  readonly properties: TsNodeArray<TsNode>;
}

export interface TsVariableDeclaration extends TsNode {
  readonly name: TsNode;
  readonly initializer?: TsNode;
}

export interface TsPropertyAssignment extends TsNode {
  readonly name: TsNode;
  readonly initializer: TsNode;
}

export interface TsCallExpression extends TsNode {
  readonly expression: TsNode;
}

export interface TsImportSpecifier extends TsNode {
  readonly name: TsNamedNode;
}

export interface TsNamedImports extends TsNode {
  readonly elements: TsNodeArray<TsImportSpecifier>;
}

export interface TsImportDeclaration extends TsNode {
  readonly importClause?: { readonly namedBindings?: TsNode };
}

/**
 * The compiler-API subset. Numeric enum members are typed as `number` rather than re-declaring
 * TypeScript's enums — the callers only ever pass them straight back to `createSourceFile`.
 */
export interface ClassicTypeScript {
  createSourceFile(
    fileName: string,
    sourceText: string,
    languageVersion: number,
    setParentNodes?: boolean,
    scriptKind?: number,
  ): TsSourceFile;

  readonly ScriptTarget: { readonly Latest: number };
  readonly ScriptKind: { readonly TS: number; readonly JS: number };

  forEachChild(node: TsNode, cbNode: (node: TsNode) => void): void;

  isIdentifier(node: TsNode): node is TsNamedNode;
  isStringLiteral(node: TsNode): node is TsNamedNode;
  isVariableDeclaration(node: TsNode): node is TsVariableDeclaration;
  isObjectLiteralExpression(node: TsNode): node is TsObjectLiteralExpression;
  isPropertyAssignment(node: TsNode): node is TsPropertyAssignment;
  isArrayLiteralExpression(node: TsNode): node is TsArrayLiteralExpression;
  isCallExpression(node: TsNode): node is TsCallExpression;
  isImportDeclaration(node: TsNode): node is TsImportDeclaration;
  isNamedImports(node: TsNode): node is TsNamedImports;
}

let cached: ClassicTypeScript | null | undefined;

/**
 * The TypeScript compiler API, or `null` when this workspace hasn't got a usable one. Resolved once.
 *
 * BOUND LAZILY, and that is load-bearing rather than a micro-optimisation. A static value-import binds at
 * MODULE LOAD, so merely importing a generator that imports this file would throw in a workspace without
 * TypeScript — and a workspace produced by `nx init` hasn't got one. The failure landed nowhere near the
 * cause: the generator died before its first line ran, on a repo where the AST step would never have applied.
 *
 * "Usable" is checked by FEATURE, not by resolvability, and that distinction is already live rather than
 * hypothetical: `typescript` on npm now resolves to the 7.x native port, whose main entry no longer exposes
 * this API at all. So `require` SUCCEEDS and the first call would die with "createSourceFile is not a
 * function" — which reads as a bug in this toolkit rather than as a workspace whose TypeScript moved on.
 * Probing one representative entry point turns that crash into a graceful `null`, which every caller
 * already handles by returning null and warning with manual instructions.
 */
export function loadTypeScript(): ClassicTypeScript | null {
  if (cached === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const loaded = require('typescript') as Partial<ClassicTypeScript>;
      cached = typeof loaded?.createSourceFile === 'function' ? (loaded as ClassicTypeScript) : null;
    } catch {
      cached = null;
    }
  }
  return cached;
}
