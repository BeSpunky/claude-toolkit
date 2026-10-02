// THE DESIGN SYSTEM, LINKED TO AN APP — in every layout × linking cell.
//
// The neutral design system (no framework binding — the workspace's stack has none here) is a plain source library,
// and `design-system-styles` wires every app that can consume it. That is two generators each reaching a library
// through the linking port: the DS links ITSELF (identity, membership, reference), and design-system-styles links it
// TO THE APP (under `workspaces`, the app's governing package.json depends on it — pnpm links nothing undeclared).
//
// The app is an Angular-built one, written the way @nx/angular writes it: a capability only ever reaches an app
// through its stack adapter's ports, which read config, so @nx/angular itself is not needed for this. The DS is
// created BEFORE the app exists — with an Angular app present the workspace's stack would bind it to Angular and
// delegate to @nx/angular:library (that path is the tripwire's, tools/test-angular-ts-solution/) — so `run` is
// exactly a SYNC over an existing neutral DS and a newer app: what wires every app, every time.
import { requireFromRepo } from '../../test-support/payload.mjs';
import { workspace, angularWorkspace, angularApp, MATRIX, RESOLVED, LINKINGS, LINK_RANGE, workspaceGlobs, references, aliases, SCOPE } from '../workspaces.mjs';

const { writeJson, getProjects } = requireFromRepo('@nx/devkit');
const DS = `@${SCOPE}/design-system`;

const neutral = MATRIX.map((m) => ({
    name: `${m.label}: lands in <libsDir>/design-system, linked to the app the workspace's way`,
    setup: async (ctx) => {
      const tree = workspace(m);
      await ctx.load('generators/design-system/generator').default(tree, { skipFormat: true });
      ctx.app = `${RESOLVED[m.layout].appsDir}/web`;
      angularApp(tree, ctx.app, 'web');
      if (LINKINGS[m.link].linking === 'workspaces') {
        // A project.json island hosted in a TS-solution workspace — its imports resolve through the ROOT manifest.
        // Give it its own package.json in the packages layout, where apps are members like everything else.
        if (m.layout === 'packages') {
          writeJson(tree, `${ctx.app}/package.json`, { name: `@${SCOPE}/web`, version: '0.0.0' });
          ctx.manifest = `${ctx.app}/package.json`;
        } else ctx.manifest = 'package.json';
      }
      return tree;
    },
    run: async (tree, ctx) => {
      await ctx.load('generators/design-system/generator').default(tree, { skipFormat: true });
    },
    expect: (tree, t, ctx) => {
      const root = `${RESOLVED[m.layout].libsDir}/design-system`;
      const project = getProjects(tree).get('design-system');
      t.equal(project?.root, root, 'the DS project root');
      t.ok(project?.tags?.includes('type:design-system'), `tagged: ${project?.tags}`);
      t.exists(`${root}/styles/_index.scss`);
      t.equal(t.json(`${root}/package.json`)?.name, DS, 'the package name');
      const app = getProjects(tree).get('web');
      t.ok(app?.implicitDependencies?.includes('design-system'), `the app depends on the DS: ${app?.implicitDependencies}`);
      t.ok(
        JSON.stringify(app?.targets?.build?.options?.stylePreprocessorOptions ?? {}).includes(RESOLVED[m.layout].libsDir),
        `the sass load path: ${JSON.stringify(app?.targets?.build?.options)}`,
      );
      t.has(`${ctx.app}/src/styles.scss`, 'design-system/styles');
      if (LINKINGS[m.link].linking === 'paths') {
        t.ok(aliases(tree)[DS]?.length === 1, `the DS alias: ${JSON.stringify(aliases(tree))}`);
        t.ok(!t.json(`${root}/package.json`).exports?.['.'], 'no source export under paths — the alias is the link');
      } else {
        t.ok(!aliases(tree)[DS], 'no alias under workspaces');
        t.ok(workspaceGlobs(tree).some((g) => g === `${RESOLVED[m.layout].libsDir}/*` || g === root), `membership: ${workspaceGlobs(tree)}`);
        t.ok(references(tree).includes(`./${root}`), `referenced: ${references(tree)}`);
        t.ok(t.json(`${root}/package.json`).exports?.['.']?.[`@${SCOPE}/source`], 'the source condition export');
        t.equal(t.json(ctx.manifest).dependencies?.[DS], LINK_RANGE[m.link], `${ctx.manifest} depends on the DS`);
        t.missing(`${root}/project.json`);
      }
    },
  }));

// The Angular-BOUND design system: an @nx/angular publishable library. Under `workspaces` it is the honest hybrid —
// a project.json island (that is what @nx/angular writes) that is nonetheless a real member package, reached through
// its `exports` under the workspace's source condition, never through an alias.
const angularBound = ['paths', 'workspaces-npm', 'workspaces-pnpm'].map((link) => ({
  name: `packages × ${link}: an Angular-bound DS is created through @nx/angular and linked the workspace's way`,
  needs: ['@nx/angular', '@nx/js'],
  setup: (ctx) => {
    const tree = angularWorkspace({ layout: 'packages', link });
    angularApp(tree, 'packages/web', 'web');
    writeJson(tree, 'packages/web/package.json', { name: `@${SCOPE}/web`, version: '0.0.0' });
    return tree;
  },
  run: async (tree, ctx) => {
    await ctx.load('generators/design-system/generator').default(tree, { skipFormat: true });
  },
  expect: (tree, t) => {
    const root = 'packages/design-system';
    t.equal(getProjects(tree).get('design-system')?.root, root, 'root');
    t.exists(`${root}/ng-package.json`);
    t.exists(`${root}/styles/_index.scss`);
    if (link === 'paths') {
      t.ok(aliases(tree)[DS], `alias: ${JSON.stringify(aliases(tree))}`);
    } else {
      t.ok(!aliases(tree)[DS], 'no alias');
      t.ok(t.json(`${root}/package.json`)?.exports?.['.']?.[`@${SCOPE}/source`], 'the source condition export');
      t.ok(references(tree).includes(`./${root}`), `referenced: ${references(tree)}`);
      t.equal(t.json('packages/web/package.json').dependencies?.[DS], LINK_RANGE[link], 'the app depends on it');
    }
  },
}));

export default {
  name: 'design system · created and linked to an app',
  cases: [...neutral, ...angularBound],
};
