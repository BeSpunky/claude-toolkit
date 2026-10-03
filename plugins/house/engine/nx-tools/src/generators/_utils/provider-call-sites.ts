// Shared util: find where a `provideX()` provider is actually CALLED inside a providers array, anywhere
// under an app.
//
// WHY THIS IS NOT A GREP. The obvious implementation — read every `.ts` file and test for the substring
// `provideX(` — is wrong in a way that is invisible until it bites, and it bit twice in one afternoon: the
// generator-owned `firebase-<service>.config.ts` files NAME `provideAppFirebase()` in their header prose,
// so a textual check reports "already wired" for an app that has never wired anything. Once from the
// 0.33.0 migration (four spurious "could not wire" warnings per app) and once from 0.33.1 (which would
// have skipped the very repair it exists to perform). A comment is not a call, and only the parser knows
// the difference.
//
// The question this answers is precisely "is this provider WIRED here", so a match must be a call
// expression sitting directly inside an ARRAY LITERAL — a providers array, whatever the enclosing object
// is named. A re-export, a mention in prose, or the `export function provideX()` that DEFINES it are all
// correctly not matches.
//
// The text scan survives as a cheap PREFILTER only: a file that lacks the substring cannot contain the
// call, so it is skipped without paying for a parse.
import type { Tree } from '@nx/devkit';
import { loadTypeScript, type TsNode, type TsSourceFile } from './typescript-api';

/**
 * Every `.ts` file under `root` in which `providerFn()` is called inside an array literal.
 *
 * @param tree       the Nx tree to read from.
 * @param root       directory to walk (e.g. `apps/web/src`).
 * @param providerFn the provider function name, e.g. `provideAppFirebase`.
 * @returns matching file paths, or `null` when the TypeScript compiler API could not be loaded — which is
 *          NOT the same as "no call sites", and callers must not treat it as such.
 */
export function findProviderCallSites(tree: Tree, root: string, providerFn: string): string[] | null {
  const ts = loadTypeScript();
  if (!ts) return null;

  const hits: string[] = [];
  const walk = (dir: string): void => {
    for (const child of tree.children(dir)) {
      const path = `${dir}/${child}`;
      if (!tree.isFile(path)) {
        walk(path);
        continue;
      }
      if (!path.endsWith('.ts') || path.endsWith('.d.ts')) continue;
      const content = tree.read(path, 'utf8') ?? '';
      if (!content.includes(`${providerFn}(`)) continue; // Cheap prefilter — cannot contain the call.
      if (callsProviderInArray(ts, path, content, providerFn)) hits.push(path);
    }
  };
  walk(root);
  return hits;
}

/** True when `providerFn()` appears as a call directly inside an array literal in this source. */
function callsProviderInArray(
  ts: NonNullable<ReturnType<typeof loadTypeScript>>,
  path: string,
  content: string,
  providerFn: string
): boolean {
  const sf = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS) as TsSourceFile;
  let found = false;
  const visit = (node: TsNode): void => {
    if (found) return;
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === providerFn &&
      node.parent &&
      ts.isArrayLiteralExpression(node.parent)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}
