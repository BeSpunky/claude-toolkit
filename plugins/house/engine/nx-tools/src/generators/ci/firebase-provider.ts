// The Firebase layer as a CI DEPLOY PROVIDER (`LayerDescriptor.ciDeploy`).
//
// A `ci` binding names a Firebase TARGET per environment (`"providers": {"firebase": "prod"}` — a .firebaserc alias or
// a project id). This module turns that into:
//   - the args every `deploy` target is run with: `--project=<target> --non-interactive` (the house Firebase deploy
//     targets pass them through to `firebase deploy`);
//   - keyless authentication: google-github-actions/auth with Workload Identity Federation — no key, no secret;
//   - the human-run setup that creates that identity, `tools/setup-gcp.sh`, rendered from the environments.
// App Hosting is NOT deployed from here: it is Firebase's own rollout (GitHub-linked) or a deliberate local-source
// deploy — see the `bespunky-house:firebase-app-hosting` skill — so CI never double-deploys the web app.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CiDeployProvider, CiEnvironment } from '../../layers/descriptor';

export const SETUP_SCRIPT = 'tools/setup-gcp.sh';
const AUTH_ACTION = 'google-github-actions/auth@v2';

/** A branch name or glob as a CEL test on the OIDC token's `ref` claim. */
export function refCondition(branch: string): string {
  if (!branch.includes('*')) return `assertion.ref == 'refs/heads/${branch}'`;
  const regex = branch
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\\\$&'))
    .join('[^/]+');
  return `assertion.ref.matches('^refs/heads/${regex}$')`;
}

export const firebaseCiProvider: CiDeployProvider = {
  id: 'firebase',
  title: 'Firebase (Cloud Functions, rules, indexes — never App Hosting)',
  deployArgs: (target) => [`--project=${target}`, '--non-interactive'],
  variables: [
    { name: 'GCP_WORKLOAD_IDENTITY_PROVIDER', holds: 'the Workload Identity provider resource name (printed by tools/setup-gcp.sh)' },
    { name: 'GCP_DEPLOY_SERVICE_ACCOUNT', holds: 'the deployer service account email (printed by tools/setup-gcp.sh)' },
  ],
  authSteps: () =>
    [
      '# Firebase: the cloud identity is created ONCE, by a human (`bash tools/setup-gcp.sh` — IAM is never an',
      "# agent's to grant), and lives in this GitHub environment's variables. Missing → say exactly that, not a",
      '# cryptic auth failure.',
      '- name: Check the cloud identity is configured',
      "  if: ${{ vars.GCP_WORKLOAD_IDENTITY_PROVIDER == '' || vars.GCP_DEPLOY_SERVICE_ACCOUNT == '' }}",
      '  shell: bash',
      '  run: |',
      '    echo "::error::The ${{ needs.resolve.outputs.environment }} environment has no cloud identity yet. A human runs, once: bash tools/setup-gcp.sh --environment ${{ needs.resolve.outputs.environment }} — then sets the two GitHub variables it prints."',
      '    exit 1',
      `- uses: ${AUTH_ACTION}`,
      '  with:',
      '    workload_identity_provider: ${{ vars.GCP_WORKLOAD_IDENTITY_PROVIDER }}',
      '    service_account: ${{ vars.GCP_DEPLOY_SERVICE_ACCOUNT }}',
      '',
    ].join('\n'),
  files: (_tree, environments) => {
    const table = environments
      .map((env) => [env.name, env.target, env.branches.join(','), env.branches.map(refCondition).join(' || ')].join('\t'))
      .join('\n');
    const content = readFileSync(join(__dirname, 'setup-gcp.sh.tpl'), 'utf8').replace('__ENVIRONMENTS__', () => table);
    return [{ path: SETUP_SCRIPT, content, mode: 0o755 }];
  },
  humanStep: (env: CiEnvironment) =>
    `! bash ${SETUP_SCRIPT} --environment ${env.name} — creates (or updates) the keyless deploy identity for '${env.name}' ` +
    `(Firebase target ${env.target}; branches ${env.branches.join(', ')}). IAM grants are a HUMAN's to run — Claude is refused them by design. ` +
    'Then set the two GitHub variables it prints (or paste them back to Claude).',
};
