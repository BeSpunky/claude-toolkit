// THE IMPORT READER — which modules a source file imports, read exactly the way the firewall reads them.
//
// The firewall is `@nx/enforce-module-boundaries`, and it sees an import only through five AST visitors
// (@nx/eslint-plugin 23, rules/enforce-module-boundaries `create`): an `import … from '…'`, an `export … from '…'`
// (named or `*`), an `import('…')`, a `require('…')` and a `require.resolve('…')` — each only when the specifier is a
// plain STRING LITERAL. A template literal (`` import(`x`) ``), a computed specifier, TypeScript's
// `import x = require('…')` and an ambient `declare module '…'` are invisible to it. So they are invisible here: a
// classifier that counted what lint cannot see would tag a project for evidence the enforcer never checks, and one
// that missed what lint sees would call a project `shared` that lint then fails.
//
// Hence an AST walk and never a pattern over the text: a regex also matches an import written in a COMMENT
// (`// never import from 'firebase-admin'`) or inside a STRING (`` `import x from 'firebase'` ``) — neither of which is
// an import, and both of which the old classifier counted as platform evidence.
//
// Type-only imports count: Nx 23 has no `importKind` exemption in its boundary checks, so neither has this.
import { loadTypeScript, type ClassicTypeScript, type TsNode } from '../generators/_utils/typescript-api';

/** The file extensions ESLint lints by default in an Nx flat config — the files whose imports the firewall reads. */
export const SOURCE_EXTENSIONS = ['ts', 'tsx', 'cts', 'mts', 'js', 'jsx', 'cjs', 'mjs'] as const;
const SOURCE_FILE = new RegExp(`\\.(?:${SOURCE_EXTENSIONS.join('|')})$`);

export const isSourceFile = (path: string): boolean => SOURCE_FILE.test(path) && !path.endsWith('.d.ts');

/**
 * The module specifiers `text` imports, in source order — or `null` when no usable TypeScript is installed (the
 * caller then has NO evidence for the file, which it must report, never read as "imports nothing").
 */
export function importSpecifiers(text: string, fileName: string): string[] | null {
  const ts = loadTypeScript();
  if (!ts) return null;
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, /* setParentNodes */ false, scriptKind(ts, fileName));
  const found: string[] = [];
  const literal = (node: TsNode | undefined): string | undefined => (node && ts.isStringLiteral(node) ? node.text : undefined);
  const visit = (node: TsNode): void => {
    let specifier: string | undefined;
    if (ts.isImportDeclaration(node)) specifier = literal(node.moduleSpecifier);
    else if (ts.isExportDeclaration(node)) specifier = literal(node.moduleSpecifier);
    else if (ts.isCallExpression(node) && isImportOrRequire(ts, node.expression)) specifier = literal(node.arguments[0]);
    if (specifier !== undefined) found.push(specifier);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** `import(…)`, `require(…)` or `require.resolve(…)` — the callees Nx's visitors accept. */
function isImportOrRequire(ts: ClassicTypeScript, callee: TsNode): boolean {
  if (callee.kind === ts.SyntaxKind.ImportKeyword) return true;
  if (ts.isIdentifier(callee)) return callee.text === 'require';
  return ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === 'require' && callee.name.text === 'resolve';
}

function scriptKind(ts: ClassicTypeScript, fileName: string): number {
  if (fileName.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (fileName.endsWith('.jsx')) return ts.ScriptKind.JSX;
  return /\.[cm]?ts$/.test(fileName) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
}
