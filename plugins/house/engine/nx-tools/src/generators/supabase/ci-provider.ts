// The Supabase layer as a CI DEPLOY PROVIDER: it SUPERSEDES postgres's, because with this layer the migrations run by the CLI, into
// its own ledger. Same target (`postgres:deploy`), same secret (the launcher reads one variable on both providers), same stage.
//
// THE CREDENTIAL IS A DATABASE URL for the schema, not an access token (that is only for functions, which only a project's token can ship):
// `db push --remote=<url>` needs no account on the runner, and so no link
// and no Management API reach; `supabase link` would also rewrite supabase.lock with hosted versions, on a runner, for nothing.
import { type Tree, readProjectConfiguration } from '@nx/devkit';
import type { CiDeployProvider, CiEnvironment } from '../../layers/descriptor';
import { environmentSecretSuffix } from '../_utils/deploy-contract';
import { postgresDeploySecret, POSTGRES_DEPLOY_VAR } from '../postgres/ci-provider';
import { postgresHome } from '../postgres/home';
import { SUPABASE_CLI_DOWNLOADS, SUPABASE_CLI_VERSION } from '../_utils/versions';

/** Only a project with functions needs it. Per environment for the reason postgres's URL is: a repo-level token would fill in for a missing one. */
export const supabaseTokenSecret = (environment: string): string => `SUPABASE_ACCESS_TOKEN_${environmentSecretSuffix(environment)}`;

export const supabaseCiProvider: CiDeployProvider = {
  id: 'supabase',
  title: 'Supabase (schema migrations, by the pinned CLI over a database URL)',
  supersedes: 'postgres',
  // Against a hosted project only: in v3 a bare `db push` is local, as common in a test job as it is harmless. `functions deploy` always ships.
  deploySignals: [/\bsupabase\s+(?:\S+\s+)*?db\s+push\b.*--(?:remote|linked|db-url|project-ref)\b/, /\bsupabase\s+(?:\S+\s+)*?functions\s+deploy\b/],
  credentialedDeploySignals: [/\bsupabase\s+(?:\S+\s+)*?link\b/],
  deployStage: 'schema',
  // Each by its literal name, as postgres's: the runner is handed only these. Never `secrets[...]`, which hands it every secret.
  deployEnv: (environments) => ({
    [POSTGRES_DEPLOY_VAR]: `\${{ ${environments.map((name) => `needs.resolve.outputs.environment == '${name}' && secrets.${postgresDeploySecret(name)}`).join(' || ')} || '' }}`,
    SUPABASE_ACCESS_TOKEN: `\${{ ${environments.map((name) => `needs.resolve.outputs.environment == '${name}' && secrets.${supabaseTokenSecret(name)}`).join(' || ')} || '' }}`,
  }),
  // A line names no target unless it ships functions: the database comes from its environment's secret, a function's project from here.
  deployOptions: (target?: string) => (target ? { args: `--project-ref=${target}` } : {}),
  deployTargets: (tree: Tree) => {
    const home = postgresHome(tree);
    if (!home) return [];
    return readProjectConfiguration(tree, home.name).targets?.deploy ? [{ project: home.name, target: 'deploy' }] : [];
  },
  authSteps: () => '',
  setupSteps: () =>
    [
      `- name: Install the Supabase CLI ${SUPABASE_CLI_VERSION}, checked against its pin`,
      '  run: |',
      '    mkdir -p "$RUNNER_TEMP/bin"',
      `    curl --fail --silent --show-error --location --retry 3 --output "$RUNNER_TEMP/supabase.tar.gz" ${SUPABASE_CLI_DOWNLOADS.amd64.url}`,
      `    echo "${SUPABASE_CLI_DOWNLOADS.amd64.sha256}  $RUNNER_TEMP/supabase.tar.gz" | sha256sum --check --strict`,
      '    tar -xzf "$RUNNER_TEMP/supabase.tar.gz" -C "$RUNNER_TEMP/bin" supabase',
      '    echo "$RUNNER_TEMP/bin" >> "$GITHUB_PATH"',
      '',
    ].join('\n'),
  humanStep: (env: CiEnvironment) =>
    `! gh secret set ${postgresDeploySecret(env.name)} --env ${env.name} — '${env.name}' (branches ${env.branches.join(', ')}) pushes migrations to the database this secret names, and its deploy fails until it is set. ` +
    `It prompts for a URL that reaches the database for migrations: hosted Supabase's direct host is IPv6 unless you bought the add-on, and GitHub's runners are IPv4, so give it the SESSION pooler (port 5432), never the transaction pooler (6543). A HUMAN runs it: never paste the URL into chat. ` +
    `If this project ships Edge Functions, also: gh secret set ${supabaseTokenSecret(env.name)} --env ${env.name} (a Supabase access token), and name the project ref on the line (ci.providers.supabase in the branch model). ` +
    `If GitHub has no such environment yet: gh api --method PUT repos/{owner}/{repo}/environments/${env.name}`,
};
