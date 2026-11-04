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

/** A version a devcontainer can act on: exact, or a `major[.minor]` line. A range or a tag is treated as no version: installing one would float. */
const USABLE_VERSION = '^[0-9]+([.][0-9]+)?$|^[0-9]+[.][0-9]+[.][0-9]+(-[0-9A-Za-z.-]+)?$';
/**
 * One line of a yarn rc file that hands over to the project's own copy, whatever the global one is: yarn 2+'s setting,
 * and yarn 1's. A key with no value hands over to nothing. Both real yarns accept the quoted and spaced forms.
 * A pattern for JavaScript and `grep -E` alike, so a literal tab rather than a class.
 * THE SAME RULE, IN BASH: engine/house.sh `yarn_path_reaches_project`, which runs where there may be no Node; change both.
 */
const YARN_PATH_LINE = '^["\']?yarnPath["\']?[ \t]*:[ \t]*[^ \t#]|^"?yarn-path"?:?[ \t]+[^ \t#]';
const BERRY_LOCKFILE = /^__metadata:/m;

const handsOver = (text: string): boolean => text.split(/\r?\n/).some((line) => new RegExp(YARN_PATH_LINE).test(line));
/** A pattern in a single-quoted shell word. */
const shellQuoted = (pattern: string): string => pattern.replace(/'/g, `'\\''`);

/** Without a declaration, is this repo on yarn 2+? Its own config file, else a lockfile only yarn 2+ writes. */
function hasYarnBerryEvidence(tree: Tree): boolean {
  return tree.exists('.yarnrc.yml') || BERRY_LOCKFILE.test(tree.read('yarn.lock', 'utf8') ?? '');
}

/**
 * Is this repo on yarn 2+? Asked of the repo, never of `yarn --version`, which answers for whatever yarn is on this
 * machine's PATH: a declared major, else the evidence. None of them means classic, the yarn that predates all three.
 */
export function isYarnBerry(tree: Tree): boolean {
  const declared = /"packageManager"\s*:\s*"yarn@(\d+)/.exec(tree.read('package.json', 'utf8') ?? '')?.[1];
  return declared ? Number(declared) >= 2 : hasYarnBerryEvidence(tree);
}

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
 * What this workspace needs of its package manager, as `.devcontainer/house.package-manager.sh` reads it (that script
 * lists the forms), or `undefined` with no root package.json. Rendered for the image build at generation time; the
 * post-create derives the same thing at run time (`packageManagerShellDetection`).
 *
 * A `yarnPath` makes any yarn right: it only has to hand over, and no global install could change what then runs.
 */
export function packageManagerSpec(tree: Tree): string | undefined {
  const pm = detectPackageManager(tree);
  if (!pm) return undefined;
  const read = (file: string) => (tree.exists(file) ? tree.read(file, 'utf8') ?? '' : '');
  if (pm === 'yarn' && (handsOver(read('.yarnrc.yml')) || handsOver(read('.yarnrc')))) return pm;
  const declared = new RegExp(`"packageManager"\\s*:\\s*"${pm}@([^"+]*)`).exec(read('package.json'))?.[1];
  if (declared !== undefined) return new RegExp(USABLE_VERSION).test(declared) ? `${pm}@${declared}` : pm;
  return pm === 'yarn' && hasYarnBerryEvidence(tree) ? 'yarn@berry' : pm;
}

/**
 * The same rule as POSIX shell, for a script that must decide at run time: sets `PM`, `PM_INSTALL`, `PM_EXEC` and `PM_SPEC`
 * from `$WS/package.json` (which the caller has checked exists) and the lockfiles beside it.
 */
export function packageManagerShellDetection(): string {
  const set = (pm: PackageManager) =>
    `PM=${pm}; PM_INSTALL="${PACKAGE_MANAGERS[pm].install}"; PM_EXEC="${PACKAGE_MANAGERS[pm].exec}"`;
  const declared = (Object.keys(PACKAGE_MANAGERS) as PackageManager[]).map((pm) => `  ${pm}@*) ${set(pm)} ;;`);
  const lockfiles = LOCKFILES.map(([file, pm], index) => `    ${index ? 'elif' : 'if'} [ -f "$WS/${file}" ]; then ${set(pm)}`);
  return [
    // The first on the line, as the TypeScript's regex reads it: a greedy sed would take the last of a minified manifest.
    `PM_DECLARED="$({ grep -Eo '"packageManager"[[:space:]]*:[[:space:]]*"[^"+]*' "$WS/package.json" || true; } | head -n 1 | sed 's/.*"//')"`,
    'case "$PM_DECLARED" in',
    ...declared,
    '  *)',
    ...lockfiles,
    `    else ${set(DEFAULT_PACKAGE_MANAGER)}`,
    '    fi',
    '    ;;',
    'esac',
    'PM_SPEC="$PM"',
    `if [ "$PM" = yarn ] && grep -Eqs '${shellQuoted(YARN_PATH_LINE)}' "$WS/.yarnrc.yml" "$WS/.yarnrc"; then`,
    '  :',
    'elif [ "${PM_DECLARED%%@*}" = "$PM" ] && [ "$PM_DECLARED" != "$PM" ]; then',
    `  if printf '%s' "\${PM_DECLARED#*@}" | grep -Eq '${USABLE_VERSION}'; then PM_SPEC="$PM_DECLARED"; fi`,
    `elif [ "$PM" = yarn ] && { [ -f "$WS/.yarnrc.yml" ] || grep -Eqs '${BERRY_LOCKFILE.source}' "$WS/yarn.lock"; }; then`,
    '  PM_SPEC=yarn@berry',
    'fi',
  ].join('\n');
}
