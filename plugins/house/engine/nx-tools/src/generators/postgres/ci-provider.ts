// The Postgres layer as a CI DEPLOY PROVIDER (`LayerDescriptor.ciDeploy`). Lives with the layer: `generators/ci` knows no
// provider. A schema deploy: it runs, and must succeed, before every code deploy of the line.
//
// No cloud identity and no OIDC: the credential is the direct URL, a secret of the line's GitHub environment, handed only to
// the deploy step of this stage. A line names no target for it: what it deploys into is the line's environment.
import { type Tree, readProjectConfiguration } from '@nx/devkit';
import type { CiDeployProvider, CiEnvironment } from '../../layers/descriptor';
import { houseProjectHome } from '../_utils/project-files';

export const POSTGRES_DEPLOY_SECRET = 'POSTGRES_DEPLOY_URL';

export const postgresCiProvider: CiDeployProvider = {
  id: 'postgres',
  title: 'Postgres (schema migrations, by dbmate over a direct connection)',
  deploySignals: [/\bdbmate\s+(?:\S+\s+)*?(?:up|migrate)\b/],
  deployStage: 'schema',
  deployEnv: { [POSTGRES_DEPLOY_SECRET]: `\${{ secrets.${POSTGRES_DEPLOY_SECRET} }}` },
  deployTargets: (tree: Tree) => {
    const home = houseProjectHome(tree, 'postgres', 'postgres');
    if (!home.exists) return [];
    return readProjectConfiguration(tree, home.name).targets?.deploy ? [{ project: home.name, target: 'deploy' }] : [];
  },
  authSteps: () => '',
  // Prompts for the value, so it reaches neither a command line nor a shell's history.
  humanStep: (env: CiEnvironment) =>
    `! gh secret set ${POSTGRES_DEPLOY_SECRET} --env ${env.name} — '${env.name}' (branches ${env.branches.join(', ')}) migrates the database this secret names, and its deploy fails until it is set. ` +
    `It prompts for the host's DIRECT URL (not a pooler). A HUMAN runs it: never paste the URL into chat. ` +
    `If GitHub has no such environment yet: gh api --method PUT repos/{owner}/{repo}/environments/${env.name}`,
};
