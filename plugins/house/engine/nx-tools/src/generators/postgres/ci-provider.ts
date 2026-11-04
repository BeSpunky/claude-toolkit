// The Postgres layer as a CI DEPLOY PROVIDER (`LayerDescriptor.ciDeploy`). Lives with the layer: `generators/ci` knows no
// provider. A schema deploy: it runs, and must succeed, before every code deploy of the line.
//
// No cloud identity and no OIDC: the credential is the direct URL, a secret of the line's GitHub environment, handed only to
// the deploy step of this stage. A line names no target for it: what it deploys into is the line's environment.
//
// THE SECRET IS NAMED AFTER THE ENVIRONMENT. GitHub falls back from an environment's secret to a repo-level or org-level one of
// the same name, so with one name, an environment that lacks it would silently migrate whatever that one names.
import { type Tree, readProjectConfiguration } from '@nx/devkit';
import { environmentSecretSuffix } from '../_utils/deploy-contract';
import type { CiDeployProvider, CiEnvironment } from '../../layers/descriptor';
import { postgresHome } from './home';
import { DBMATE_DOWNLOADS, DBMATE_VERSION } from '../_utils/versions';

/** What the launcher reads. In CI it holds the environment's secret, `POSTGRES_DEPLOY_URL_<ENVIRONMENT>`. */
export const POSTGRES_DEPLOY_VAR = 'POSTGRES_DEPLOY_URL';
export const postgresDeploySecret = (environment: string): string => `${POSTGRES_DEPLOY_VAR}_${environmentSecretSuffix(environment)}`;

export const postgresCiProvider: CiDeployProvider = {
  id: 'postgres',
  title: 'Postgres (schema migrations, by dbmate over a direct connection)',
  // `dbmate[^\s]*`: an image (`amacneil/dbmate:2`) or a release binary (`dbmate-linux-amd64`) runs the same migrations.
  deploySignals: [/\bpostgres\.mjs\s+deploy\b/],
  credentialedDeploySignals: [/\bdbmate[^\s]*\s+(?:\S+\s+)*?(?:up|migrate)\b/],
  deployStage: 'schema',
  // Each secret by its literal name, so the runner is handed only these; the job's environment picks one. A name that is empty
  // ends the chain empty, never at another environment's: `&&` fails over to `||`, and the next comparison is false.
  deployEnv: (environments) => ({
    [POSTGRES_DEPLOY_VAR]: `\${{ ${environments.map((name) => `needs.resolve.outputs.environment == '${name}' && secrets.${postgresDeploySecret(name)}`).join(' || ')} || '' }}`,
  }),
  deployTargets: (tree: Tree) => {
    const home = postgresHome(tree);
    if (!home) return [];
    return readProjectConfiguration(tree, home.name).targets?.deploy ? [{ project: home.name, target: 'deploy' }] : [];
  },
  authSteps: () => '',
  // The deploy job runs on a stock amd64 runner, where dbmate is not, and the launcher takes no npm package's in its place.
  setupSteps: () =>
    [
      `- name: Install dbmate ${DBMATE_VERSION}, checked against its pin`,
      '  run: |',
      '    mkdir -p "$RUNNER_TEMP/bin"',
      `    curl --fail --silent --show-error --location --retry 3 --output "$RUNNER_TEMP/bin/dbmate" ${DBMATE_DOWNLOADS.amd64.url}`,
      `    echo "${DBMATE_DOWNLOADS.amd64.sha256}  $RUNNER_TEMP/bin/dbmate" | sha256sum --check --strict`,
      '    chmod +x "$RUNNER_TEMP/bin/dbmate"',
      '    echo "$RUNNER_TEMP/bin" >> "$GITHUB_PATH"',
      '',
    ].join('\n'),
  // Prompts for the value, so it reaches neither a command line nor a shell's history.
  humanStep: (env: CiEnvironment) =>
    `! gh secret set ${postgresDeploySecret(env.name)} --env ${env.name} — '${env.name}' (branches ${env.branches.join(', ')}) migrates the database this secret names, and its deploy fails until it is set. ` +
    `It prompts for the host's DIRECT URL (not a pooler). A HUMAN runs it: never paste the URL into chat. ` +
    `If GitHub has no such environment yet: gh api --method PUT repos/{owner}/{repo}/environments/${env.name}`,
};
