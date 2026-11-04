// The Postgres layer as a CI DEPLOY PROVIDER (`LayerDescriptor.ciDeploy`). Lives with the layer: `generators/ci` knows no
// provider. A schema deploy: it runs, and must succeed, before every code deploy of the line.
//
// No cloud identity and no OIDC: the credential is the direct URL, a secret of the line's GitHub environment, handed only to
// the deploy step of this stage. A line names no target for it: what it deploys into is the line's environment.
import { type Tree, readProjectConfiguration } from '@nx/devkit';
import type { CiDeployProvider, CiEnvironment } from '../../layers/descriptor';
import { houseProjectHome } from '../_utils/project-files';
import { DBMATE_DOWNLOADS, DBMATE_VERSION } from '../_utils/versions';

export const POSTGRES_DEPLOY_SECRET = 'POSTGRES_DEPLOY_URL';

export const postgresCiProvider: CiDeployProvider = {
  id: 'postgres',
  title: 'Postgres (schema migrations, by dbmate over a direct connection)',
  // `dbmate[^\s]*`: an image (`amacneil/dbmate:2`) or a release binary (`dbmate-linux-amd64`) runs the same migrations.
  deploySignals: [/\bdbmate[^\s]*\s+(?:\S+\s+)*?(?:up|migrate)\b/, /\bpostgres\.mjs\s+deploy\b/],
  deployStage: 'schema',
  deployEnv: { [POSTGRES_DEPLOY_SECRET]: `\${{ secrets.${POSTGRES_DEPLOY_SECRET} }}` },
  deployTargets: (tree: Tree) => {
    const home = houseProjectHome(tree, 'postgres', 'postgres');
    if (!home.exists) return [];
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
    `! gh secret set ${POSTGRES_DEPLOY_SECRET} --env ${env.name} — '${env.name}' (branches ${env.branches.join(', ')}) migrates the database this secret names, and its deploy fails until it is set. ` +
    `It prompts for the host's DIRECT URL (not a pooler). A HUMAN runs it: never paste the URL into chat. ` +
    `If GitHub has no such environment yet: gh api --method PUT repos/{owner}/{repo}/environments/${env.name}`,
};
