// WHAT BELONGS TO ONE PLATFORM — the one table both halves of the platform boundary read: the ESLint firewall bans
// these packages (./firewall) and the classifier counts them as evidence (./classify). Two copies of it would let
// the classifier call a library `shared` that the firewall then fails for importing one of them.
//
// What is listed is a FACT ABOUT THE PACKAGE, not about the workspace: firebase-admin is server-only wherever it is
// installed. So the table holds in a workspace that has not added Firebase yet, and the classifier can use it there.
// A project adds its own facts in its ESLint config (`platformConstraints`); `withDeclared` folds them back in, so
// the classifier honours what the config bans and never the table alone.
//
// NODE'S BUILT-IN MODULES are a different kind of fact, and the difference is load-bearing. They are server
// EVIDENCE — a library that imports `node:fs` runs in Node, not anywhere — but the firewall cannot BAN them: Nx's
// rule resolves an import to a project-graph node before it checks a ban, a built-in is no npm package, and for an
// unresolved import the rule bails ("If target is not found (including node internals) we bail early",
// @nx/eslint-plugin 23). A built-in in a browser bundle fails the BUILD instead (esbuild cannot resolve it), so it
// is loud where a banned package would be silent. Hence `isNodeBuiltin`: evidence only, never written as a ban.
import { isBuiltin } from 'node:module';

/** Package patterns (Nx `bannedExternalImports` syntax) that only one platform may import. */
export interface PlatformExternals {
  /** Browser-only: the Firebase client SDK (and its modular packages) and every client framework the workspace wears. */
  readonly web: readonly string[];
  /** Server-only: the Firebase Admin and Functions SDKs, Google Cloud's server clients, Node HTTP servers. */
  readonly server: readonly string[];
  /** Bound to SOME platform by the project's own config, which does not say which (a ban only `platform:shared` declares). */
  readonly unsided: readonly string[];
}

// `x` and `x/*` both: in Nx's syntax a bare name matches only itself, and `x/*` every subpath (see `matchesExternal`).
const SERVER_ONLY = [
  'firebase-admin', 'firebase-admin/*',
  'firebase-functions', 'firebase-functions/*',
  // The functions test SDK drives functions in Node; in a spec it is not judged at all (./scopes, never-ships).
  'firebase-functions-test', 'firebase-functions-test/*',
  // Google Cloud's Node clients (Secret Manager, Storage, Pub/Sub, …): service-account credentials, gRPC.
  '@google-cloud/*',
  'express', 'express/*',
];
const WEB_ONLY = [
  'firebase', 'firebase/*',
  // The modular SDK's real packages — `firebase/app` re-exports `@firebase/app`; importing them directly is the same SDK.
  '@firebase/*',
  'rxfire', 'rxfire/*',
];

/**
 * The table, given the web-only packages the workspace's stacks name (Angular: `@angular/*`). Pure — the stacks are
 * read by the caller (./index `platformExternals`), so this module, which the classifier loads, loads no adapter.
 */
export function tableExternals(stackWebOnly: readonly string[]): PlatformExternals {
  return { server: SERVER_ONLY, web: [...new Set([...WEB_ONLY, ...stackWebOnly])], unsided: [] };
}

/** The table, plus what the project's own firewall declares (from `readDeclaredBans`). */
export function withDeclared(table: PlatformExternals, declared: DeclaredBans | null): PlatformExternals {
  if (!declared) return table;
  const web = new Set([...table.web, ...declared.server]);
  const server = new Set([...table.server, ...declared.web]);
  return {
    web: [...web],
    server: [...server],
    unsided: [...new Set([...table.unsided, ...declared.shared.filter((pkg) => !web.has(pkg) && !server.has(pkg))])],
  };
}

/** What each platform's constraint in a project's config bans (so `web` lists SERVER-bound packages). */
export interface DeclaredBans {
  web: string[];
  server: string[];
  shared: string[];
}

/**
 * Does `pattern` (an Nx banned-import pattern) match the import `specifier`? Nx's own rule (`mapGlobToRegExp`,
 * @nx/eslint-plugin 23): every `*` run (and `.*`) becomes `.*`, the rest is used AS A REGEX SOURCE, anchored at both
 * ends — so `firebase` matches only `firebase`, never `firebase/app`; that is what `firebase/*` is for.
 */
export function matchesExternal(pattern: string, specifier: string): boolean {
  const mapped = pattern.split(/(?:\.\*)|\*+/).join('.*');
  try {
    return new RegExp(`^${new RegExp(mapped).source}$`).test(specifier);
  } catch {
    return false; // a pattern Nx itself could not compile bans nothing there either
  }
}

/**
 * A Node built-in module — `node:` anything, or a bare built-in name. Bare names that a BROWSER package also owns
 * (`events`, `buffer`, `util`, … — published polyfills web code imports by that very name) are not evidence: in a
 * browser bundle they resolve to the npm package, so the import says nothing about where the code runs.
 */
export function isNodeBuiltin(specifier: string): boolean {
  if (specifier.startsWith('node:')) return true;
  return isBuiltin(specifier) && !BROWSER_NAMESAKES.has(specifier.split('/')[0]);
}

/** Built-in names that are also published browser packages of the same name. */
const BROWSER_NAMESAKES = new Set(['assert', 'buffer', 'events', 'path', 'process', 'punycode', 'querystring', 'string_decoder', 'url', 'util']);
