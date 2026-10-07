// HOUSE DOCS · THE BRANCH MODEL — the branch rules (HOUSE.rules.md) and parameters (HOUSE.md) render the project's
// DECLARED model from `.bespunky/branches.json`'s projection, never a hard-coded development → staging → main.
// Three ways that breaks silently, each a case here:
//   - a declared model rendered with the old names (an always-on rule telling the agent to branch off, protect and
//     promote lines the project does not have);
//   - an UNDECLARED project losing its protection (the first sync after rollout would otherwise strip "never commit
//     onto main" from every consumer) or being handed an assumed model;
//   - a projection schema this payload does not know being guessed at instead of refused.
import { workspace } from '../workspaces.mjs';

const MODEL = '.bespunky/branches.json';

/** A branches.json carrying only what readers may parse — the projection (§2 of the contract). */
const declare = (projection) => (tree) => tree.write(MODEL, JSON.stringify({ schema: 1, projection: { schema: 1, ...projection } }, null, 2));

const THREE_LINE = {
  integration: 'development',
  production: ['main'],
  productionPatterns: [],
  chain: ['development', 'staging', 'main'],
  protected: ['development', 'staging', 'main'],
  protectedPatterns: [],
  workBase: 'development',
  summary: 'development → staging → main',
};
const TRUNK = {
  integration: 'main',
  production: ['main'],
  productionPatterns: [],
  chain: ['main'],
  protected: ['main'],
  protectedPatterns: [],
  workBase: 'main',
  summary: 'main (trunk — integration is production)',
};
const GITFLOW = {
  integration: 'develop',
  production: ['main'],
  productionPatterns: [],
  chain: ['develop', 'main'],
  protected: ['develop', 'main'],
  protectedPatterns: ['release/*'],
  workBase: 'develop',
  summary: 'develop → release/{version} → main',
};

/** A `## <title>` section of a doc, up to the next `## `. */
const section = (doc, title) => {
  const at = doc.indexOf(`## ${title}`);
  if (at < 0) return '';
  const next = doc.indexOf('\n## ', at + 1);
  return doc.slice(at, next < 0 ? undefined : next);
};
const RULES = (t) => section(t.read('HOUSE.rules.md'), 'Branch & release workflow');
const PARAMS = (t) => section(t.read('HOUSE.md'), 'Branch & release parameters');

const generate = (layers, extra = {}) => async (tree, ctx) => {
  await ctx.load('generators/house-doc/generator').default(tree, { layers, nxToolsVersion: '9.9.9', pluginVersion: '1.0.0', ...extra });
};

/** What every rendering — declared or not — must still say. */
const common = (t, rules) => {
  t.ok(rules.length > 0, 'HOUSE.rules.md has the branch section');
  t.ok(rules.includes('`bespunky-workflow:branch-and-release` skill before any git branch, worktree, integration, promotion, or release action'), 'the mandatory skill invocation');
  t.ok(rules.includes('Step 0, every request'), 'the step-0 relevance check');
  t.ok(rules.includes('Commit small increments'), 'small commits');
  t.ok(rules.includes('Nothing promotes on its own'), 'nothing promotes on its own');
  t.ok(rules.includes('`status:` frontmatter'), 'DECISION.md status at the merge gate');
  for (const doc of ['HOUSE.md', 'HOUSE.rules.md']) {
    const leftovers = t.read(doc).match(/\{\{[^}]*\}\}/g);
    t.ok(!leftovers, `${doc} has unrendered tokens: ${leftovers?.join(' ')}`);
  }
};

const declared = (name, projection, check) => ({
  name,
  setup: () => {
    const tree = workspace();
    declare(projection)(tree);
    return tree;
  },
  run: generate(['nx', 'agent']),
  expect: (tree, t) => {
    const rules = RULES(t);
    const params = PARAMS(t);
    common(t, rules);
    t.ok(rules.includes(`**This project's branch model: ${projection.summary}.**`), `the summary, verbatim: ${rules.slice(0, 600)}`);
    t.ok(rules.includes(`open a new worktree off \`${projection.workBase}\``), 'step 0 branches off the declared work base');
    t.ok(rules.includes('changes **only** through the skill\'s change procedure') && rules.includes(`\`${MODEL}\``), 'names the model file and its change procedure');
    t.ok(!rules.includes('not declared yet'), 'no undeclared wording');
    t.ok(params.includes(`**${projection.summary}**`), 'HOUSE.md names the model');
    for (const name of projection.protected) t.ok(params.includes(`| \`${name}\` |`), `HOUSE.md tables ${name}`);
    for (const glob of projection.protectedPatterns) t.ok(params.includes(`| \`${glob}\` | protected line (pattern)`), `HOUSE.md tables the pattern ${glob}`);
    // Semantics stay with the engine — the generic deploy text, never a hard-coded binding.
    t.ok(params.includes('`branches.mjs describe`'), 'deploy bindings point at describe');
    t.ok(!/staging → staging|pushing either triggers/.test(params), 'no hard-coded deploy binding');
    // No structured binding in the projection → the page claims none (a note, if any, is the engine's to show).
    t.ok(params.includes('none is structured in the model yet') && !params.includes('the model binds these'), 'deploy bindings are not asserted to exist');
    check(t, rules, params);
  },
});

export default {
  name: 'house-doc · renders the declared branch model',
  cases: [
    declared('declared three-line: the names it declares, in role words', THREE_LINE, (t, rules, params) => {
      t.ok(rules.includes('the protected lines are `development`, `staging` and `main`'), 'protected names');
      t.ok(rules.includes('production is `main`'), 'production');
      t.ok(params.includes('| `development` | integration · new work branches from here |'), 'integration row');
      t.ok(params.includes('| `staging` | stage |'), 'stage row');
      t.ok(params.includes('| `main` | stage · production |'), 'production row');
    }),
    declared('declared trunk: one line, integration is production, no stage names leak in', TRUNK, (t, rules, params) => {
      t.ok(rules.includes('the protected lines are `main`;'), 'protected: main alone');
      t.ok(params.includes('| `main` | integration · production · new work branches from here |'), 'the one row carries every role');
      for (const absent of ['development', 'staging']) t.ok(!rules.includes(absent) && !params.includes(`\`${absent}\``), `no \`${absent}\` anywhere`);
    }),
    declared('declared gitflow-ish: develop integration, protected release/* pattern', GITFLOW, (t, rules, params) => {
      t.ok(rules.includes('the protected lines are `develop` and `main`, plus every branch matching `release/*`'), 'names plus the pattern');
      t.ok(rules.includes('landing work on `develop`'), 'lands on develop');
      t.ok(!rules.includes('`development`') && !rules.includes('`staging`'), 'no three-line names');
      t.ok(params.includes('| `release/*` | protected line (pattern) |'), 'the pattern row');
    }),
    {
      name: 'undeclared: protective rules, nothing assumed',
      setup: () => workspace(),
      run: generate(['nx', 'agent', 'web', 'firebase']),
      expect: (tree, t) => {
        const rules = RULES(t);
        const params = PARAMS(t);
        common(t, rules);
        t.ok(rules.includes('branch model is not declared yet'), 'says the model is undeclared');
        t.ok(rules.includes('`main`, `master`, `development`, `develop` or `staging`'), 'protects every name the toolkit or gitflow ever used');
        t.ok(rules.includes('Before the first branch or promotion action of a session, investigate and ask'), 'investigate and ask, once per session');
        t.ok(rules.includes('Assume **no** model'), 'never assume a model');
        t.ok(!rules.includes('development → staging → main') || rules.includes('not "development → staging → main"'), 'the old chain only as a non-assumption');
        t.ok(params.includes('not declared yet') && params.includes('**protected**'), 'HOUSE.md carries the protections too');
        t.ok(!params.includes('| Line | Role |'), 'no table for a model that does not exist');
        t.ok(!tree.exists(MODEL), 'the generator never writes the model to escape the undeclared state');
      },
    },
    // THE RESOLVED MODEL WINS OVER THE TREE. A sync resolves which copy is in force (the integration tip, local or
    // remote) and hands it in as `branchProjection`; the Tree is only the working copy, which may be stale, absent
    // (a branch cut before the declaration) or in another directory (an Nx workspace nested below the git root).
    {
      // STRUCTURED deploy bindings are facts the projection carries, so the page shows them — and with the ci +
      // firebase layers, says the cloud identity is the human's to create.
      name: 'structured deploy bindings render as a table; ci + firebase add the CI section and the IAM rule',
      setup: () => workspace(),
      run: generate(['nx', 'node', 'firebase', 'ci'], {
        branchProjection: JSON.stringify({
          schema: 1, ...TRUNK,
          deploys: [{ kind: 'line', line: 'main', ci: { environment: 'production', providers: { firebase: 'default' } }, appHosting: [{ project: 'default', backend: 'web' }] }],
        }),
      }),
      expect: (_tree, t) => {
        const params = PARAMS(t);
        t.ok(params.includes('| `main` | `production` (firebase: `default`) | `default/web` |'), `the binding row: ${params}`);
        t.ok(params.includes('local-source'), 'both App Hosting modes are named');
        const ci = section(t.read('HOUSE.md'), 'Continuous deployment (CI)');
        t.ok(ci.includes('! bash tools/setup-gcp.sh --dry-run') && ci.includes('never Claude'), 'the human-run setup');
        t.ok(t.read('HOUSE.rules.md').includes('Never run `tools/setup-gcp.sh`'), 'the always-on IAM rule');
        t.ok(!/\{\{[^}]*\}\}/.test(t.read('HOUSE.md')), 'no unrendered token');
      },
    },
    {
      name: 'branchProjection is rendered, and a conflicting working-tree file is not read',
      setup: () => {
        const tree = workspace();
        declare(THREE_LINE)(tree);
        return tree;
      },
      run: generate(['nx', 'agent'], { branchProjection: JSON.stringify({ schema: 1, remote: 'origin', ...TRUNK }) }),
      expect: (tree, t) => {
        const rules = RULES(t);
        common(t, rules);
        t.ok(rules.includes(`**This project's branch model: ${TRUNK.summary}.**`), 'the passed projection is the one rendered');
        t.ok(!rules.includes('`development`') && !rules.includes('`staging`'), 'nothing from the Tree\'s three-line copy');
      },
    },
    {
      name: 'branchProjection "undeclared" renders the protective rules even over a declared working-tree file',
      setup: () => {
        const tree = workspace();
        declare(GITFLOW)(tree);
        return tree;
      },
      run: generate(['nx', 'agent'], { branchProjection: 'undeclared' }),
      expect: (tree, t) => {
        const rules = RULES(t);
        common(t, rules);
        t.ok(rules.includes('branch model is not declared yet'), 'undeclared wording');
        t.ok(!rules.includes('release/*'), 'nothing from the Tree\'s gitflow copy');
      },
    },
    {
      name: 'branchProjection with an unknown schema major is refused, not guessed at',
      once: 'the generator throws; there is no second state to compare',
      setup: () => workspace(),
      run: async (tree, ctx) => {
        ctx.error = undefined;
        try {
          await generate(['nx', 'agent'], { branchProjection: JSON.stringify({ ...THREE_LINE, schema: 2 }) })(tree, ctx);
        } catch (error) {
          ctx.error = error;
        }
      },
      expect: (tree, t, ctx) => {
        t.ok(/branchProjection/.test(ctx.error?.message ?? '') && /projection\.schema` is 2/.test(ctx.error?.message ?? ''), `a clear refusal: ${ctx.error?.message}`);
        t.ok(!tree.exists('HOUSE.rules.md'), 'nothing written before the refusal');
      },
    },
    // A schema MINOR is additive (readers check the major): "1.1" reads, from the Tree and from the option alike.
    {
      name: 'projection schema "1.1" is read as major 1 (Tree)',
      setup: () => {
        const tree = workspace();
        tree.write(MODEL, JSON.stringify({ schema: 1, projection: { ...THREE_LINE, schema: '1.1' } }));
        return tree;
      },
      run: generate(['nx', 'agent']),
      expect: (tree, t) => t.ok(RULES(t).includes(`**This project's branch model: ${THREE_LINE.summary}.**`), 'rendered'),
    },
    {
      name: 'projection schema "1.1" is read as major 1 (branchProjection)',
      setup: () => workspace(),
      run: generate(['nx', 'agent'], { branchProjection: JSON.stringify({ ...GITFLOW, schema: '1.1' }) }),
      expect: (tree, t) => t.ok(RULES(t).includes(`**This project's branch model: ${GITFLOW.summary}.**`), 'rendered'),
    },
    {
      name: 'an unknown projection schema major is refused, not guessed at',
      once: 'the generator throws; there is no second state to compare',
      setup: () => {
        const tree = workspace();
        tree.write(MODEL, JSON.stringify({ schema: 2, projection: { ...THREE_LINE, schema: 2 } }));
        return tree;
      },
      run: async (tree, ctx) => {
        ctx.error = undefined;
        try {
          await generate(['nx', 'agent'])(tree, ctx);
        } catch (error) {
          ctx.error = error;
        }
      },
      expect: (tree, t, ctx) => {
        t.ok(ctx.error, 'the generator refused');
        t.ok(/projection\.schema` is 2/.test(ctx.error?.message ?? '') && /update @bespunky\/nx-tools/.test(ctx.error?.message ?? ''), `a clear refusal: ${ctx.error?.message}`);
        t.ok(!tree.exists('HOUSE.rules.md'), 'nothing written before the refusal');
      },
    },
    {
      name: 'a model file with no projection is refused',
      once: 'the generator throws; there is no second state to compare',
      setup: () => {
        const tree = workspace();
        tree.write(MODEL, JSON.stringify({ schema: 1, integration: { branch: 'development' } }));
        return tree;
      },
      run: async (tree, ctx) => {
        ctx.error = undefined;
        try {
          await generate(['nx', 'agent'])(tree, ctx);
        } catch (error) {
          ctx.error = error;
        }
      },
      expect: (tree, t, ctx) => {
        t.ok(/no `projection` block/.test(ctx.error?.message ?? ''), `a clear refusal: ${ctx.error?.message}`);
      },
    },
  ],
};
