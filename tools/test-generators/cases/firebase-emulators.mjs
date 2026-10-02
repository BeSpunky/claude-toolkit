// FIREBASE EMULATORS — the Cloud Functions app is the one APP the house creates itself, so it is where "apps live in
// apps/" was hardest-coded: the project root, firebase.json's `source`, the build output, the secrets path in three
// scripts, the .gitignore line, and a tsconfig whose `extends` climbs a fixed `../../`. All of it now follows the
// resolved appsDir — and the climb follows its DEPTH.
import { requireFromRepo } from '../../test-support/payload.mjs';
import { workspace, MATRIX, RESOLVED, LINKINGS, workspaceGlobs, SCOPE } from '../workspaces.mjs';

const { updateJson, writeJson, getProjects } = requireFromRepo('@nx/devkit');
const run = async (tree, ctx) => {
  await ctx.load('generators/firebase-emulators/generator').default(tree, { workspaceName: SCOPE });
};
const TEMPLATED = ['tools/emulators.sh', 'tools/push-secrets.sh', 'tools/firebase-welcome.sh'];

export default {
  name: 'firebase-emulators · the functions app follows the layout',
  cases: [
    ...MATRIX.map((m) => ({
      name: `${m.label}: functions in <appsDir>/functions, every path derived from it`,
      setup: () => workspace(m),
      run,
      expect: (tree, t) => {
        const appsDir = RESOLVED[m.layout].appsDir;
        const root = `${appsDir}/functions`;
        const project = getProjects(tree).get('functions');
        t.equal(project?.root, root, 'the functions root');
        t.ok(project?.tags?.includes('platform:server'), `tagged server-side (what cli.js apps excludes): ${project?.tags}`);
        t.equal(t.json('firebase.json')?.functions?.[0]?.source, `dist/${root}`, 'firebase.json source');
        t.equal(project?.targets?.build?.options?.outputPath, `dist/${root}`, 'build output');
        t.equal(t.json(`${root}/tsconfig.json`)?.extends, '../../tsconfig.base.json', 'tsconfig extends, two levels up');
        t.has('.gitignore', `\n${root}/.secret.local\n`);
        t.has('tools/emulators.sh', `$ROOT/${root}/.secret.local`);
        t.has('tools/firebase-welcome.sh', `"$_fb_root"/${appsDir}/*/src/environments`);
        for (const file of [...TEMPLATED, `${root}/package.json`, `${root}/tsconfig.json`, `${root}/src/main.ts`]) {
          t.ok(!/\{\{\s*\w+\s*\}\}/.test(t.read(file)), `leftover {{…}} in ${file}`);
        }
        if (LINKINGS[m.link].linking === 'workspaces') {
          t.missing(`${root}/project.json`);
          const manifest = t.json(`${root}/package.json`);
          t.equal([manifest?.name, manifest?.nx?.name], [`@${SCOPE}/functions`, 'functions'], 'scoped package, bare Nx name');
          t.ok(workspaceGlobs(tree).some((g) => g === `${appsDir}/*` || g === root), `membership: ${workspaceGlobs(tree)}`);
          t.ok(t.json('firebase/package.json')?.name === `@${SCOPE}/firebase`, 'the emulator suite is a scoped package too');
        } else {
          t.exists(`${root}/project.json`);
        }
      },
    })),
    {
      name: 'a deeper appsDir (src/apps): the tsconfig climbs three levels, not a hard-coded two',
      setup: () => {
        const tree = workspace();
        updateJson(tree, 'nx.json', (json) => ({ ...json, workspaceLayout: { appsDir: 'src/apps', libsDir: 'src/libs' } }));
        return tree;
      },
      run,
      expect: (tree, t) => {
        t.equal(t.json('src/apps/functions/tsconfig.json')?.extends, '../../../tsconfig.base.json', 'extends');
        t.equal(t.json('src/apps/functions/tsconfig.app.json')?.compilerOptions?.outDir, '../../../dist/out-tsc', 'outDir');
        t.equal(t.json('firebase.json')?.functions?.[0]?.source, 'dist/src/apps/functions', 'source');
      },
    },
    {
      name: 'an existing functions app elsewhere stays where it is — its house targets follow it',
      setup: () => {
        const tree = workspace({ layout: 'packages' });
        writeJson(tree, 'apps/functions/project.json', { name: 'functions', root: 'apps/functions', projectType: 'application', targets: { custom: { command: 'x' } } });
        return tree;
      },
      run,
      expect: (tree, t) => {
        const project = getProjects(tree).get('functions');
        t.equal(project?.root, 'apps/functions', 'not moved');
        t.ok(project?.targets?.custom && project?.targets?.build, `its own target kept, the house's added: ${Object.keys(project?.targets ?? {})}`);
        t.missing('packages/functions');
        t.equal(t.json('firebase.json')?.functions?.[0]?.source, 'dist/apps/functions', 'firebase.json follows it');
      },
    },
  ],
};
