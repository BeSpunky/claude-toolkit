// The native provider: a Debian server per stack, migrated by dbmate. GENERATOR-OWNED.
//
// A PROVIDER ANSWERS ONE QUESTION: how does this stack get a local server, and how do the verbs reach it? `postgres.mjs` holds
// everything that does not depend on the answer: the verbs, addressing, the deploy's URL rules and its gates.
import { BASE_PORT, DATABASE, PORT_NAME, ROLE, declaredMajor, stacksWithData } from './layout.mjs';
import { applySeeds, dbmateMigrate, dropDatabase, ensureDatabase, localMigrate, newMigration, seedOnce } from './schema.mjs';
import { serve } from './server.mjs';
import { assertIdentity } from './stack.mjs';
import { scrubbedEnv } from './tools.mjs';

export const provider = {
  /** What a stack of this provider binds, by name, at base. */
  ports: { [PORT_NAME]: BASE_PORT },
  /** Ranges no port of the stack may land in (`tools/dev/dev run --avoid-ports`). */
  avoidPorts: [],
  seedsLabel: 'postgres/seed/world',
  serve,
  assertIdentity,
  stacksWithData: () => stacksWithData(declaredMajor()),
  migrate: (stack) => localMigrate(stack.port),
  seed: (stack) => applySeeds(stack.port),
  async reset(stack) {
    await dropDatabase(stack.port);
    await ensureDatabase(stack.port);
    await localMigrate(stack.port);
    await seedOnce(stack.port);
  },
  /** How a client reaches this stack. */
  client: (stack) => ({ args: ['-h', '127.0.0.1', '-p', String(stack.port), '-U', ROLE, '-d', DATABASE], env: scrubbedEnv() }),
  newMigration,
  /** Migrate the database a validated URL names. In the environment, not on the command line: argv is readable by every process. */
  deploy: (url, _target, hide) => dbmateMigrate({ args: ['--env', 'DATABASE_URL'], env: { DATABASE_URL: url } }, { onOutput: hide }),
};
