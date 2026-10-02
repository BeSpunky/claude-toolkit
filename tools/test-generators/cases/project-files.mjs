// THE PROJECT-FILES SEAM — which file defines a project, and how a new one is created, in a workspace that may
// define projects either way. Every house project (functions, the emulator suite, the tooling) is created through
// `createProject`, so its promise is the promise of all of them: under `workspaces`, a real member PACKAGE —
// scoped name, membership, solution reference — never a project.json that forks the workspace's convention.
import { requireFromRepo } from '../../test-support/payload.mjs';
import { workspace, MATRIX, LINKINGS, workspaceGlobs, references, SCOPE } from '../workspaces.mjs';

const { writeJson, getProjects } = requireFromRepo('@nx/devkit');
const files = (tree, root) => ['project.json', 'package.json'].filter((f) => tree.exists(`${root}/${f}`));

const createCases = MATRIX.map((m) => ({
  name: `${m.label}: createProject makes a project the way this workspace defines them`,
  // The house's re-runs go through ensureHouseProject, covered below.
  once: 'createProject refuses an existing project, by contract',
  setup: () => {
    const tree = workspace(m);
    // A tsconfig written BEFORE creation is what earns the solution reference.
    writeJson(tree, 'tools/thing/tsconfig.json', { extends: '../../tsconfig.base.json', files: [], include: [] });
    return tree;
  },
  run: (tree, ctx) => {
    const P = ctx.load('generators/_utils/project-files');
    P.createProject(tree, 'firebase', { root: 'tools/thing', targets: { up: { command: 'true' } }, tags: ['tooling'] }, { private: true });
    P.createProject(tree, 'noref', { root: 'tools/noref', targets: {} });
  },
  expect: (tree, t) => {
    const project = getProjects(tree).get('firebase');
    t.ok(project?.root === 'tools/thing', `Nx sees the project: ${project?.root}`);
    t.equal(project?.tags, ['tooling'], 'tags');
    if (LINKINGS[m.link].linking === 'paths') {
      t.equal(files(tree, 'tools/thing'), ['project.json'], 'a project.json, as before');
    } else {
      t.equal(files(tree, 'tools/thing'), ['package.json'], 'a package, never a project.json');
      const manifest = t.json('tools/thing/package.json');
      t.equal(manifest.name, `@${SCOPE}/firebase`, 'scoped — a bare `firebase` member would shadow the Firebase SDK');
      t.equal(manifest.nx?.name, 'firebase', 'the Nx name stays bare');
      t.equal(manifest.private, true, 'the seed manifest is kept');
      t.ok(workspaceGlobs(tree).includes('tools/*'), `membership: ${workspaceGlobs(tree)}`);
      t.ok(references(tree).includes('./tools/thing'), `referenced: ${references(tree)}`);
      t.ok(!references(tree).includes('./tools/noref'), 'no tsconfig, no reference');
    }
  },
}));

export default {
  name: 'project files · the seam',
  cases: [
    ...createCases,
    {
      name: 'projectDefinitionFile: project.json wins where both exist; a new root gets the workspace\'s convention',
      setup: () => {
        const tree = workspace({ link: 'workspaces-npm' });
        writeJson(tree, 'packages/both/project.json', { name: 'both' });
        writeJson(tree, 'packages/both/package.json', { name: '@acme/both' });
        writeJson(tree, 'packages/pkg/package.json', { name: '@acme/pkg' });
        return tree;
      },
      run: (tree, ctx) => {
        const { projectDefinitionFile } = ctx.load('generators/_utils/project-files');
        ctx.got = ['packages/both', 'packages/pkg', 'packages/new'].map((root) => projectDefinitionFile(tree, root).kind);
        ctx.paths = projectDefinitionFile(workspace(), 'packages/new').kind;
      },
      expect: (tree, t, ctx) => {
        t.equal(ctx.got, ['project.json', 'package.json', 'package.json'], 'under workspaces');
        t.equal(ctx.paths, 'project.json', 'a new root under paths');
      },
    },
    {
      name: 'joinWorkspace: an app package outside the globs joins; a project.json island does not need to',
      setup: () => {
        const tree = workspace({ link: 'workspaces-npm' });
        writeJson(tree, 'apps/web/package.json', { name: '@acme/web' });
        writeJson(tree, 'apps/island/project.json', { name: 'island' });
        return tree;
      },
      run: (tree, ctx) => {
        const { joinWorkspace } = ctx.load('generators/_utils/project-files');
        ctx.web ??= joinWorkspace(tree, './apps/web/');
        ctx.island ??= joinWorkspace(tree, 'apps/island');
      },
      expect: (tree, t, ctx) => {
        t.equal(ctx.web, 'apps/*', 'the narrowest glob — no stranger in apps/');
        t.equal(ctx.island, null, 'a project.json island');
        t.ok(getProjects(tree).has('@acme/web'), 'Nx now sees the package app');
      },
    },
    ...['paths', 'workspaces-npm'].map((link) => ({
      name: `${link}: ensureHouseProject re-asserts house targets and tags, keeps the project's own`,
      setup: () => workspace({ link }),
      run: async (tree, ctx) => {
        const P = ctx.load('generators/_utils/project-files');
        const home = P.houseProjectHome(tree, 'shared-browser', 'tools/shared-browser');
        P.ensureHouseProject(tree, 'test', home, { tags: ['tooling'], targets: { up: { command: 'up' } } });
        // The project adds a target of its own between syncs.
        const file = P.projectDefinitionFile(tree, 'tools/shared-browser');
        const json = JSON.parse(tree.read(file.path, 'utf8'));
        const config = file.kind === 'package.json' ? json.nx : json;
        config.targets.mine ??= { command: 'mine' };
        tree.write(file.path, JSON.stringify(json, null, 2) + '\n');
      },
      expect: (tree, t) => {
        const project = getProjects(tree).get('shared-browser');
        t.equal(Object.keys(project?.targets ?? {}).filter((k) => ['up', 'mine'].includes(k)).sort(), ['mine', 'up'], 'targets');
        t.equal(project?.tags, ['tooling'], 'tags, not duplicated');
      },
    })),
    {
      name: 'houseProjectHome is a silent lookup that follows a relocated project',
      setup: () => {
        const tree = workspace();
        writeJson(tree, 'apps/functions/project.json', { name: 'functions', root: 'apps/functions' });
        return tree;
      },
      run: (tree, ctx) => (ctx.home = ctx.load('generators/_utils/project-files').houseProjectHome(tree, 'functions', 'packages/functions')),
      expect: (tree, t, ctx) => {
        t.equal([ctx.home.root, ctx.home.exists], ['apps/functions', true], 'found where it is');
        t.equal(ctx.logs, [], 'a lookup says nothing');
      },
    },
  ],
};
