// WHICH PACKAGES BELONG TO ONE PLATFORM — the one table both halves of the platform boundary read: the ESLint
// firewall bans them (./firewall) and the classifier counts them as evidence (./classify). Two copies of it would
// let the classifier call a library `shared` that the firewall then fails for importing one of them.
//
// What is listed is a FACT ABOUT THE PACKAGE, not about the workspace: firebase-admin is server-only wherever it is
// installed. So the table holds in a workspace that has not added Firebase yet, and the classifier can use it there.
import type { Tree } from '@nx/devkit';
import { workspaceStacksWith } from '../adapters/workspace';

/** Package patterns (Nx `bannedExternalImports` syntax — `*` wildcards) that only one platform may import. */
export interface PlatformExternals {
  /** Browser-only: the Firebase client SDK and every client framework the workspace wears. */
  readonly web: readonly string[];
  /** Server-only: the Firebase Admin and Functions SDKs (Node-native modules, admin credentials). */
  readonly server: readonly string[];
}

const SERVER_ONLY = ['firebase-admin', 'firebase-admin/*', 'firebase-functions', 'firebase-functions/*'];
const WEB_ONLY = ['firebase', 'firebase/*'];

export function platformExternals(tree: Tree): PlatformExternals {
  return {
    server: SERVER_ONLY,
    // Each stack names its own framework (Angular: `@angular/*`) — the same list it hands the server firewall.
    web: [...new Set([...WEB_ONLY, ...workspaceStacksWith(tree, 'firebase').flatMap((stack) => stack.firebase.serverBannedImports)])],
  };
}

/** Does `pattern` (an Nx banned-import pattern) match the import `specifier`? Mirrors Nx's wildcard rule. */
export function matchesExternal(pattern: string, specifier: string): boolean {
  if (!pattern.includes('*')) return specifier === pattern || specifier.startsWith(`${pattern}/`);
  const regex = new RegExp(`^${pattern.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\/]/g, '\\$&')).join('.*')}$`);
  return regex.test(specifier);
}
