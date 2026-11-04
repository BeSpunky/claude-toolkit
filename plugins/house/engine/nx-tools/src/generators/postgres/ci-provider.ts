// The Postgres layer as a CI DEPLOY PROVIDER (`LayerDescriptor.ciDeploy`). Lives with the layer: `generators/ci` knows no
// provider. A schema deploy: it runs, and must succeed, before every code deploy of the line.
//
// No cloud identity and no OIDC: the credential is the direct URL, a secret of the line's GitHub environment, handed only to
// the deploy step of this stage. A binding's target names nothing a deploy needs, so it reaches no option here.
import { type Tree, readProjectConfiguration } from '@nx/devkit';
import type { CiDeployProvider } from '../../layers/descriptor';
import { houseProjectHome } from '../_utils/project-files';

export const POSTGRES_DEPLOY_SECRET = 'POSTGRES_DEPLOY_URL';

export const postgresCiProvider: CiDeployProvider = {
  id: 'postgres',
  title: 'Postgres (schema migrations, by dbmate over a direct connection)',
  targetLabel: "label for the hosted database (informational: the URL is the environment's POSTGRES_DEPLOY_URL secret)",
  deploySignals: [/\bdbmate\s+(?:\S+\s+)*?(?:up|migrate)\b/],
  deployStage: 'schema',
  deployEnv: { [POSTGRES_DEPLOY_SECRET]: `\${{ secrets.${POSTGRES_DEPLOY_SECRET} }}` },
  deployTargets: (tree: Tree) => {
    const home = houseProjectHome(tree, 'postgres', 'postgres');
    if (!home.exists) return [];
    return readProjectConfiguration(tree, home.name).targets?.deploy ? [{ project: home.name, target: 'deploy' }] : [];
  },
  deployOptions: () => ({}),
  authSteps: () => '',
};
