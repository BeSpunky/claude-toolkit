// The Firebase layer as a CI DEPLOY PROVIDER (`LayerDescriptor.ciDeploy`).
//
// A `ci` binding names a Firebase TARGET per environment (`"providers": {"firebase": "prod"}` — a .firebaserc alias or
// a project id). This module turns that into:
//   - a `ci-<environment>` configuration on the Firebase deploy targets ONLY (functions:deploy, firebase:deploy):
//     `--project=<target> --non-interactive`, which the house deploy runners pass to `firebase deploy`;
//   - keyless authentication: google-github-actions/auth with Workload Identity Federation — no key, no secret;
//   - the human-run setup that creates that identity, `tools/setup-gcp.sh`, rendered from the environments, and the
//     record it keeps of what it created (`.bespunky/gcp/<environment>.tsv`), which is what rollback undoes.
// App Hosting is NOT deployed from here: it is Firebase's own rollout (GitHub-linked) or a deliberate local-source
// deploy — see the `bespunky-house:firebase-app-hosting` skill — so CI never double-deploys the web app.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Tree, readProjectConfiguration } from '@nx/devkit';
import type { CiDeployProvider, CiEnvironment } from '../../layers/descriptor';
import { firebaseHomes } from '../firebase-emulators/homes';
import { ACTIONS, uses } from './actions';
import { branchRefRegex } from './refs';
import { WORKFLOW } from './workflow';

export const SETUP_SCRIPT = 'tools/setup-gcp.sh';

/**
 * Where setup-gcp.sh records what it created and granted, one file per environment. COMMITTED, deliberately: the
 * record must outlive the machine and the person that ran setup (a teammate rolls back months later), and it is a
 * change to someone's cloud IAM — reviewable in a PR like any other. The cloud cannot hold it: an IAM binding has
 * no field that says "this run added me" versus "this was here before". Nothing in it is a secret.
 */
export const SETUP_RECORD_DIR = '.bespunky/gcp';
export const setupRecord = (environment: string): string => `${SETUP_RECORD_DIR}/${environment}.tsv`;

/** The GitHub environment variables the auth step reads, and setup-gcp.sh prints — named here only. */
export const CI_VARIABLES = {
  provider: 'GCP_WORKLOAD_IDENTITY_PROVIDER',
  serviceAccount: 'GCP_DEPLOY_SERVICE_ACCOUNT',
} as const;

/** The branches of an environment as one CEL test on the OIDC token's `ref` claim (RE2 inside a CEL string). */
export function refCondition(branches: readonly string[]): string {
  return branches.map((branch) => `assertion.ref.matches('${branchRefRegex(branch).replace(/\\/g, '\\\\')}')`).join(' || ');
}

export const firebaseCiProvider: CiDeployProvider = {
  id: 'firebase',
  title: 'Firebase (Cloud Functions, rules, indexes — never App Hosting)',
  deployTargets: (tree: Tree) => {
    const { functions, suite } = firebaseHomes(tree);
    return [functions, suite]
      .filter((home) => home.exists && hasTarget(tree, home.name, 'deploy'))
      .map((home) => ({ project: home.name, target: 'deploy' }));
  },
  deployOptions: (target) => ({ args: `--project=${target} --non-interactive` }),
  authSteps: () =>
    [
      '# Firebase: the cloud identity is created ONCE, by a human (`bash tools/setup-gcp.sh` — IAM is never an',
      "# agent's to grant), and lives in this GitHub environment's variables. Missing → say exactly that, not a",
      '# cryptic auth failure.',
      '- name: Check the cloud identity is configured',
      `  if: \${{ vars.${CI_VARIABLES.provider} == '' || vars.${CI_VARIABLES.serviceAccount} == '' }}`,
      '  shell: bash',
      '  run: |',
      `    echo "::error::The \${{ needs.resolve.outputs.environment }} environment has no cloud identity yet. A human runs, once: bash ${SETUP_SCRIPT} --environment \${{ needs.resolve.outputs.environment }} — then sets the GitHub variables it prints."`,
      '    exit 1',
      `- uses: ${uses(ACTIONS.googleAuth)}`,
      '  with:',
      `    workload_identity_provider: \${{ vars.${CI_VARIABLES.provider} }}`,
      `    service_account: \${{ vars.${CI_VARIABLES.serviceAccount} }}`,
      '',
    ].join('\n'),
  files: (_tree, environments) => {
    const table = environments
      .map((env) => [env.name, env.target, env.branches.join(','), refCondition(env.branches), env.retired ? 'retired' : 'active'].join('\t'))
      .join('\n');
    const fill: Record<string, string> = {
      __ENVIRONMENTS__: table,
      __WORKFLOW__: WORKFLOW,
      __RECORD_DIR__: SETUP_RECORD_DIR,
      __VAR_PROVIDER__: CI_VARIABLES.provider,
      __VAR_SERVICE_ACCOUNT__: CI_VARIABLES.serviceAccount,
    };
    const content = readFileSync(join(__dirname, 'setup-gcp.sh.tpl'), 'utf8').replace(/__[A-Z_]+__/g, (token) => fill[token] ?? token);
    return [{ path: SETUP_SCRIPT, content, mode: 0o755 }];
  },
  isSetUp: (tree, environment) => tree.exists(setupRecord(environment)),
  humanStep: (env: CiEnvironment) =>
    `! bash ${SETUP_SCRIPT} --environment ${env.name} — creates (or converges) the keyless deploy identity for '${env.name}' ` +
    `(Firebase target ${env.target}; branches ${env.branches.join(', ')}). IAM grants are a HUMAN's to run — Claude is refused them by design. ` +
    `Then run the GitHub commands it prints, and commit ${setupRecord(env.name)} (its record of what it created — rollback undoes exactly that).`,
  retireStep: (env: CiEnvironment) =>
    `! bash ${SETUP_SCRIPT} --rollback --environment ${env.name} — no line deploys into '${env.name}' any more, but its cloud identity ` +
    `(recorded in ${setupRecord(env.name)}) still trusts ${env.branches.join(', ')}. Rollback removes exactly what setup recorded, then the record; ` +
    'commit that, and the next upgrade drops the environment from the script. A HUMAN runs it (IAM).',
};

function hasTarget(tree: Tree, project: string, target: string): boolean {
  try {
    return Boolean(readProjectConfiguration(tree, project).targets?.[target]);
  } catch {
    return false;
  }
}
