// Which package manager a Node-hosted workspace uses — the ONE precedence every house tool agrees on:
// the `packageManager` DECLARATION first, then the lockfile, then the house default (yarn).
//
// It is decided from the workspace's own evidence, never assumed: installing a yarn workspace with npm writes
// a second lockfile into a tree the developer is about to commit.
//
// THE RULE IS DATA, rendered for every reader that cannot call this function: the generated post-create.sh
// detects at RUN time (a project can change package manager between rebuilds), so it is handed the bash
// rendering of this same table (`packageManagerShellDetection`) rather than keeping a hand-copy that drifts.
// (house.sh's outer shell keeps its own copy — it runs before this package is installed.)
import type { Tree } from '@nx/devkit';

export type PackageManager = 'yarn' | 'npm' | 'pnpm';

/** How each package manager installs, runs a package binary, and runs nx — as a person types it. */
export const PACKAGE_MANAGERS: Readonly<Record<PackageManager, { install: string; exec: string; nx: string }>> = {
  pnpm: { install: 'pnpm install', exec: 'pnpm exec', nx: 'pnpm nx' },
  yarn: { install: 'yarn install', exec: 'yarn', nx: 'yarn nx' },
  // `npm nx` is not a command; npm runs a package binary through npx.
  npm: { install: 'npm install', exec: 'npx --no-install', nx: 'npx nx' },
};

/** The lockfiles, in precedence order — consulted only when package.json declares no `packageManager`. */
const LOCKFILES: readonly (readonly [file: string, pm: PackageManager])[] = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['package-lock.json', 'npm'],
];

/** A package.json that declares nothing and has no lockfile: the house default. */
export const DEFAULT_PACKAGE_MANAGER: PackageManager = 'yarn';

const DECLARATION = /"packageManager"\s*:\s*"(yarn|npm|pnpm)@/;

/**
 * The workspace's package manager, or `undefined` when there is no root package.json to have one (a repo hosted by
 * the Nx wrapper — never answered with a guess, which is how a Python repo used to be told to run `yarn nx …`).
 *
 * The `packageManager` field is the only signal a human deliberately WROTE; every other one is an artifact.
 */
export function detectPackageManager(tree: Tree): PackageManager | undefined {
  if (!tree.exists('package.json')) return undefined;
  const declared = DECLARATION.exec(tree.read('package.json', 'utf8') ?? '')?.[1];
  if (declared) return declared as PackageManager;
  return LOCKFILES.find(([file]) => tree.exists(file))?.[1] ?? DEFAULT_PACKAGE_MANAGER;
}

/**
 * The same rule as POSIX shell, for a script that must decide at run time: sets `PM`, `PM_INSTALL` and `PM_EXEC`
 * from `$WS/package.json` (which the caller has checked exists) and the lockfiles beside it.
 */
export function packageManagerShellDetection(): string {
  const set = (pm: PackageManager) =>
    `PM=${pm}; PM_INSTALL="${PACKAGE_MANAGERS[pm].install}"; PM_EXEC="${PACKAGE_MANAGERS[pm].exec}"`;
  const declared = (Object.keys(PACKAGE_MANAGERS) as PackageManager[]).map((pm) => `  *'"${pm}@'*) ${set(pm)} ;;`);
  const lockfiles = LOCKFILES.map(([file, pm], index) => `    ${index ? 'elif' : 'if'} [ -f "$WS/${file}" ]; then ${set(pm)}`);
  return [
    `case "$(grep -m1 '"packageManager"' "$WS/package.json" 2>/dev/null | tr -d ' ')" in`,
    ...declared,
    '  *)',
    ...lockfiles,
    `    else ${set(DEFAULT_PACKAGE_MANAGER)}`,
    '    fi',
    '    ;;',
    'esac',
  ].join('\n');
}
