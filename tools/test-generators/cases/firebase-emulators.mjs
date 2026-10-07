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
const TEMPLATED = ['tools/emulators.sh', 'tools/push-secrets.sh', 'tools/firebase-welcome.sh', 'tools/seed/apply.mjs', 'tools/seed/world.mjs'];

export default {
  name: 'firebase-emulators · the functions app follows the layout',
  cases: [
    {
      // Every generator-owned client config is rewritten whole on every upgrade, so a syntax error in a template is
      // re-shipped to every Firebase app on every run with no local fix possible. The harness's parse check is the
      // assertion; this case exists so it runs without @nx/angular, which every app-creating case here needs.
      name: 'the client config set renders to TypeScript that parses',
      setup: () => workspace(),
      run: async (tree, ctx) => {
        ctx.written = ctx.load('generators/firebase-emulators/service-configs').writeFirebaseConfigs(tree, 'apps/web');
      },
      expect: (tree, t, ctx) => t.ok(ctx.written?.[0] === 'apps/web/src/app/firebase.config.ts', `written: ${ctx.written}`),
    },
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
        t.has('.gitignore', `\n${root}/.secret.sandbox.local\n`);
        t.has('tools/emulators.sh', `FUNCTIONS_SRC="$ROOT/${root}"`);
        t.has('tools/emulators.sh', `FUNCTIONS_DIST="$ROOT/dist/${root}"`);
        // The params files are read in place from the source dir — so the emulator-only .env.local works.
        t.equal(t.json('firebase.json')?.functions?.[0]?.configDir, root, 'firebase.json configDir');
        t.ok(!project?.targets?.build?.options?.assets, `build copies no params file: ${JSON.stringify(project?.targets?.build?.options?.assets)}`);
        // The seed applier is generator-owned; the worlds are not.
        t.has('tools/seed/apply.mjs', 'export async function applyWorld');
        t.has('tools/seed/build.mjs', "from './apply.mjs'");
        t.has('tools/seed/world.mjs', "import { ref, at } from './apply.mjs';");
        t.hasNot('tools/seed/world.mjs', 'localhost:8080');
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
      // firebase-tools' `init auth` with no active project writes `support@undefined.firebaseapp.com`. Not ours to
      // repair (the right value is the real project's), but the upgrade says so — and must not touch the key.
      name: "firebase.json from `firebase init` without a project: the undefined support email is reported, kept",
      setup: () => {
        const tree = workspace();
        writeJson(tree, 'firebase.json', { auth: { providers: { googleSignIn: { supportEmail: 'support@undefined.firebaseapp.com' } } } });
        return tree;
      },
      run: async (tree, ctx) => {
        const logger = requireFromRepo('@nx/devkit').logger;
        const previous = logger.warn;
        ctx.warnings = [];
        logger.warn = (...args) => (ctx.warnings.push(args.join(' ')), previous(...args));
        try {
          await run(tree, ctx);
        } finally {
          logger.warn = previous;
        }
      },
      expect: (tree, t, ctx) => {
        t.ok(ctx.warnings.some((w) => w.includes('undefined.firebaseapp.com') && w.includes('firebase use --add')), `warnings: ${ctx.warnings}`);
        t.equal(t.json('firebase.json')?.auth?.providers?.googleSignIn?.supportEmail, 'support@undefined.firebaseapp.com', 'auth block untouched');
      },
    },
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
