// THE DEPLOY WORKFLOW — rendered from the branch model's `ci` bindings and the active deploy providers.
//
// Code, not a template: its trigger list, its line → environment table and its authentication steps are all
// DERIVED (from the projection and from the providers the active layers contribute), and a template with that many
// holes is a program written in a worse language. What it does, step by step, is explained in its own comments —
// the generated file is read by the people whose deploys it runs.
//
// THREE JOBS, split by what each may hold:
//   resolve  the pushed ref → its environment (no checkout, no code of the project's).
//   prepare  checkout, install (every dependency's install scripts), nx-set-shas, and the list of projects to
//            deploy. It has NO `id-token` — nothing it runs can mint a cloud token.
//   deploy   in the GitHub environment (its protection rules, its variables): the dependencies prepare installed
//            (restored, never re-installed — no install script runs here), the providers' auth, and the deploys.
//            The only job with `id-token: write`, and one at a time per ENVIRONMENT.
// Provider arguments reach only provider targets: each provider's deploy targets carry a `ci-<environment>`
// configuration (written by the ci generator), and the deploy runs with `-c ci-<environment>` — a target without
// that configuration runs its default one, untouched.
import type { CiDeployProvider } from '../../layers/descriptor';
import type { PackageManager } from '../_utils/package-manager';
import { ACTIONS, uses } from './actions';
import { branchRefRegex } from './refs';

/** The `ci` layer's marker — its evidence, and the record of what the house owns. */
export const MARKER = '.bespunky/ci.json';

/** The path of the owned workflow. */
export const WORKFLOW = '.github/workflows/deploy.yml';

/** The Nx configuration a deploy target carries for one environment — the only way provider args reach it. */
export const ciConfiguration = (environment: string): string => `ci-${environment}`;

/** One wired line: a branch name or glob, and the environment it deploys into. */
export interface WiredLine {
  branch: string;
  environment: string;
  /**
   * A line PATTERN (several branches, one environment): every run deploys every project. `affected` measures from
   * the last successful run of the same BRANCH, which is not what the environment last received when a sibling
   * branch deployed in between — so a pattern never deploys a subset.
   */
  full: boolean;
}

export interface WorkflowInput {
  lines: readonly WiredLine[];
  providers: readonly CiDeployProvider[];
  /** How Nx is invoked on the runner (`yarn nx`, `npx nx`, `pnpm nx`, `./nx`). */
  nx: string;
  /** The package manager (a node host), or undefined on the Nx wrapper host (nothing to install). */
  packageManager?: PackageManager;
  /** Yarn 2+ (`yarn install --immutable`) rather than classic (`--frozen-lockfile`). */
  yarnBerry: boolean;
  /** The file the project declares its Node in (_utils/node-version `nodeVersionFile`) — setup-node reads each kind. */
  nodeVersionFile: string;
}

/** The install a CI runner does: exactly the lockfile, never an update of it. */
function installStep(pm: PackageManager | undefined, berry: boolean): string[] {
  if (!pm) return [];
  const command = { npm: 'npm ci', pnpm: 'pnpm install --frozen-lockfile', yarn: berry ? 'yarn install --immutable' : 'yarn install --frozen-lockfile' }[pm];
  return [...corepack(pm), `      - run: ${command}`];
}

/** The package manager at the version package.json declares (`packageManager`), through Node's corepack. */
function corepack(pm: PackageManager | undefined): string[] {
  return !pm || pm === 'npm' ? [] : ["      # The package manager at the version package.json declares (`packageManager`), through Node's corepack.", '      - run: corepack enable'];
}

/** What prepare hands deploy: the installed dependencies (or, on the Nx wrapper host, the wrapper's Nx install). */
function installedPaths(pm: PackageManager | undefined, berry: boolean): string[] {
  if (!pm) return ['.nx/installation'];
  return ['node_modules', '*/node_modules', '*/*/node_modules', ...(pm === 'yarn' && berry ? ['.yarn/cache', '.yarn/unplugged', '.yarn/install-state.gz', '.pnp.cjs', '.pnp.loader.mjs'] : [])];
}

const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;

export function renderWorkflow(input: WorkflowInput): string {
  const branches = [...new Set(input.lines.map((line) => line.branch))];
  // Exact names before globs — a name the model binds wins over a pattern that happens to match it.
  const ordered = [...input.lines].sort((a, b) => Number(a.branch.includes('*')) - Number(b.branch.includes('*')));
  const arms = ordered.flatMap((line, i) => [
    `          ${i ? 'elif' : 'if'} bound ${quote(branchRefRegex(line.branch))}; then`,
    `            environment=${line.environment}; full=${line.full}`,
  ]);
  const auth = input.providers.map((provider) => provider.authSteps().replace(/^(?=.)/gm, '      ')).join('');
  const cache = installedPaths(input.packageManager, input.yarnBerry).map((path) => `            ${path}`);
  const key = 'deploy-deps-${{ github.run_id }}';

  return [
    '# Generated by @bespunky/nx-tools (the `ci` layer) — OWNED: rewritten on every house upgrade. Never hand-edit it.',
    '#   WHEN it deploys and WHERE (which lines → which environment) is the branch model: the `ci` deploy bindings in',
    '#   .bespunky/branches.json — change them through the branch-and-release skill, then upgrade.',
    "#   WHAT ships, and how, is each project's `deploy` target — change the targets. A target may take a",
    '#   `ci-<environment>` configuration: the deploy runs with it (the house writes its providers\' targets\' own).',
    '# HOUSE.md → "Continuous deployment (CI)" explains the whole loop, and the one-time cloud setup a human runs.',
    '# Every action is pinned to a full commit SHA (the release it is, in the comment).',
    'name: Deploy',
    '',
    'on:',
    '  push:',
    '    branches:',
    ...branches.map((branch) => `      - ${quote(branch)}`),
    '  workflow_dispatch:',
    '    inputs:',
    '      scope:',
    "        description: 'affected = what changed since the last successful deploy of this branch; all = every project with a deploy target (the first deploy, or a recovery)'",
    '        type: choice',
    '        options: [affected, all]',
    '        default: affected',
    '',
    'permissions:',
    '  contents: read',
    '',
    'jobs:',
    '  resolve:',
    '    name: Resolve the environment',
    '    runs-on: ubuntu-latest',
    '    outputs:',
    '      environment: ${{ steps.binding.outputs.environment }}',
    '      full: ${{ steps.binding.outputs.full }}',
    '    steps:',
    "      # The branch model's `ci` bindings: which environment this branch deploys into. A glob's `*` never",
    "      # crosses `/` — the same rule as the push filter above and the cloud identity's condition.",
    '      - id: binding',
    '        shell: bash',
    '        run: |',
    '          # The pattern must stay unquoted inside [[ =~ ]] to be a regular expression.',
    '          bound() { [[ "$GITHUB_REF" =~ $1 ]]; }',
    ...arms,
    '          else',
    '            echo "::error::Branch $GITHUB_REF_NAME has no ci deploy binding in the branch model (.bespunky/branches.json) — nothing deploys from it." >&2',
    '            exit 1',
    '          fi',
    '          { echo "environment=$environment"; echo "full=$full"; } >> "$GITHUB_OUTPUT"',
    '',
    '  prepare:',
    '    name: Install and choose what to deploy',
    '    needs: resolve',
    '    runs-on: ubuntu-latest',
    '    # No id-token here: install scripts and third-party actions run in this job, and none of them can mint a',
    '    # cloud token.',
    '    permissions:',
    '      contents: read',
    "      actions: read # nx-set-shas reads this workflow's previous runs",
    '    outputs:',
    '      projects: ${{ steps.select.outputs.projects }}',
    '    steps:',
    `      - uses: ${uses(ACTIONS.checkout)}`,
    '        with:',
    '          fetch-depth: 0 # affected needs the history back to the last successful deploy',
    "      # Node from the project's one declaration of it — the same file the devcontainer reads.",
    `      - uses: ${uses(ACTIONS.setupNode)}`,
    '        with:',
    `          node-version-file: ${input.nodeVersionFile}`,
    ...installStep(input.packageManager, input.yarnBerry),
    '      # The base is the last SUCCESSFUL run of this workflow on this branch (not the previous commit).',
    `      - uses: ${uses(ACTIONS.nxSetShas)}`,
    '        with:',
    '          main-branch-name: ${{ github.ref_name }}',
    '      - id: select',
    '        shell: bash',
    '        env:',
    "          SCOPE: ${{ inputs.scope || 'affected' }}",
    '          FULL: ${{ needs.resolve.outputs.full }}',
    '        run: |',
    '          if [ "$SCOPE" = all ] || [ "$FULL" = true ]; then',
    `            projects="$(${input.nx} show projects --with-target deploy | paste -sd, -)"`,
    '          else',
    `            projects="$(${input.nx} show projects --affected --with-target deploy --base="$NX_BASE" --head="$NX_HEAD" | paste -sd, -)"`,
    '          fi',
    '          echo "Deploying: ${projects:-nothing (no project with a deploy target changed)}"',
    '          echo "projects=$projects" >> "$GITHUB_OUTPUT"',
    '      # Hand the installed dependencies to the deploy job, which must not run an install of its own.',
    `      - uses: ${uses(ACTIONS.cacheSave)}`,
    "        if: steps.select.outputs.projects != ''",
    '        with:',
    `          key: ${key}`,
    '          path: |',
    ...cache,
    '',
    '  deploy:',
    '    name: Deploy to ${{ needs.resolve.outputs.environment }}',
    '    needs: [resolve, prepare]',
    "    if: needs.prepare.outputs.projects != ''",
    '    runs-on: ubuntu-latest',
    '    # A GitHub environment per deployment environment: its variables (the cloud identity) and its protection rules.',
    '    environment: ${{ needs.resolve.outputs.environment }}',
    '    # One deploy per ENVIRONMENT at a time, and never cancelled: a cancelled deploy is a half-deployed environment.',
    '    # A run that arrives meanwhile waits; its base is the last SUCCESSFUL run, so nothing is skipped.',
    '    concurrency:',
    '      group: deploy-${{ needs.resolve.outputs.environment }}',
    '      cancel-in-progress: false',
    '    permissions:',
    '      contents: read',
    "      id-token: write # keyless cloud auth: GitHub's OIDC token, exchanged by Workload Identity Federation",
    '    steps:',
    `      - uses: ${uses(ACTIONS.checkout)}`,
    `      - uses: ${uses(ACTIONS.setupNode)}`,
    '        with:',
    `          node-version-file: ${input.nodeVersionFile}`,
    ...corepack(input.packageManager),
    `      - uses: ${uses(ACTIONS.cacheRestore)}`,
    '        with:',
    `          key: ${key}`,
    '          fail-on-cache-miss: true',
    '          path: |',
    ...cache,
    auth.trimEnd(),
    '      - name: Deploy',
    '        shell: bash',
    '        env:',
    '          PROJECTS: ${{ needs.prepare.outputs.projects }}',
    `          CONFIGURATION: ${ciConfiguration('${{ needs.resolve.outputs.environment }}')}`,
    '        run: |',
    `          ${input.nx} run-many -t deploy --projects="$PROJECTS" --configuration="$CONFIGURATION" --outputStyle=static`,
    '',
  ]
    .filter((line) => line !== '')
    .join('\n')
    .replace(/\n(on:|permissions:|jobs:|  prepare:|  deploy:)/g, '\n\n$1') + '\n';
}
