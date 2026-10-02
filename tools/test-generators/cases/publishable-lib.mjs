// PUBLISHABLE LIBRARIES — where they land, and how a cross-lib dependency (`--workspaceDeps`) is declared.
//
// The declared range is the whole difference between the linking models, and the wrong one fails silently:
//   paths       `^<sibling's version>` — the published-consumer contract; in-repo resolution is the alias
//   workspaces  the package manager's workspace range (`*` npm, `workspace:*` pnpm) — a caret there resolves from
//               the REGISTRY, i.e. the last published sibling, not the one beside it
// A sibling not in the workspace yet is a registry package under either model: caret range, and a warning.
//
// Delegates to @nx/js's library generator, an optional peer this repo does not install — see the harness header.
import { requireFromRepo } from '../../test-support/payload.mjs';
import { workspace, MATRIX, RESOLVED, LINKINGS, LINK_RANGE, workspaceGlobs, SCOPE } from '../workspaces.mjs';

const { updateJson, getProjects } = requireFromRepo('@nx/devkit');

export default {
  name: 'publishable-lib · workspaceDeps',
  cases: MATRIX.map((m) => ({
    name: `${m.label}: <libsDir>/<name>, siblings declared the linking's way, a missing one by caret`,
    needs: ['@nx/js'],
    once: 'it CREATES a library — the stack refuses a second create, by design',
    setup: async (ctx) => {
      const tree = workspace(m);
      updateJson(tree, 'package.json', (json) => ({ ...json, devDependencies: { ...json.devDependencies, '@nx/js': '23.1.0' } }));
      await ctx.load('generators/publishable-lib/generator').default(tree, { name: 'core', stack: 'js', skipFormat: true });
      return tree;
    },
    run: async (tree, ctx) => {
      await ctx.load('generators/publishable-lib/generator').default(tree, { name: 'ui', stack: 'js', workspaceDeps: ['core', 'ghost'], skipFormat: true });
    },
    expect: (tree, t, ctx) => {
      const root = `${RESOLVED[m.layout].libsDir}/ui`;
      t.equal(getProjects(tree).get('ui')?.root, root, 'the library root');
      const deps = t.json(`${root}/package.json`)?.dependencies ?? {};
      const coreVersion = t.json(`${RESOLVED[m.layout].libsDir}/core/package.json`)?.version;
      const expected = LINKINGS[m.link].linking === 'paths' ? `^${coreVersion}` : LINK_RANGE[m.link];
      t.equal(deps[`@${SCOPE}/core`], expected, 'the in-workspace sibling');
      t.equal(deps[`@${SCOPE}/ghost`], '^0.0.1', 'the sibling not in the workspace');
      t.ok(ctx.logs.some((l) => l.includes('ghost')), `the missing sibling is reported: ${ctx.logs.join(' | ')}`);
      t.equal(getProjects(tree).get('ui')?.targets?.['nx-release-publish']?.options?.packageRoot !== undefined, true, 'a publish packageRoot');
      if (LINKINGS[m.link].linking === 'workspaces') {
        t.ok(workspaceGlobs(tree).some((g) => root.startsWith(g.replace(/\*$/, '')) || g === root), `membership: ${workspaceGlobs(tree)}`);
      }
    },
  })),
};
