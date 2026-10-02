// THE APP GENERATOR — `--name` alone lands the app in this workspace's apps directory, `<appsDir>/<name>`, the same
// answer every other house generator gives. Creating through the Angular stack needs @nx/angular (an optional peer
// this repo does not install — see the harness header); the refusal does not.
import { requireFromRepo } from '../../test-support/payload.mjs';
import { workspace, angularWorkspace, RESOLVED } from '../workspaces.mjs';

const { getProjects } = requireFromRepo('@nx/devkit');
const app = (ctx) => ctx.load('generators/app/generator').default;

export default {
  name: 'app generator · where an app lands',
  cases: [
    ...['apps-libs', 'packages', 'hybrid'].flatMap((layout) =>
      ['paths', 'workspaces-npm'].map((link) => ({
        name: `${layout} × ${link}: --name=shop → ${RESOLVED[layout].appsDir}/shop`,
        needs: ['@nx/angular'],
        once: 'it CREATES an app — the stack refuses a second create, by design',
        setup: (ctx) => {
          ctx.envBefore = process.env.NX_IGNORE_UNSUPPORTED_TS_SETUP;
          return angularWorkspace({ layout, link });
        },
        run: async (tree, ctx) => {
          await app(ctx)(tree, { name: 'shop', skipFormat: true });
        },
        expect: (tree, t, ctx) => {
          const root = `${RESOLVED[layout].appsDir}/shop`;
          t.equal(getProjects(tree).get('shop')?.root, root, 'the app root');
          // In a TS-solution workspace the app states its own compiler contract over the tsc-oriented base.
          if (link !== 'paths') {
            const options = JSON.parse(tree.read(`${root}/tsconfig.json`, 'utf8')).compilerOptions;
            t.equal({ emitDeclarationOnly: options.emitDeclarationOnly, lib: options.lib }, { emitDeclarationOnly: false, lib: ['es2022', 'dom'] }, 'the Angular compiler contract');
          }
          // The TS-solution opt-out is scoped to the one @nx/angular call — never left set for the rest of the process.
          t.equal(process.env.NX_IGNORE_UNSUPPORTED_TS_SETUP, ctx.envBefore, 'NX_IGNORE_UNSUPPORTED_TS_SETUP restored');
        },
      })),
    ),
    {
      name: 'neither a directory nor a --name: the refusal names this workspace\'s apps directory',
      once: 'the operation throws by design',
      setup: () => workspace({ layout: 'packages' }),
      run: async (tree, ctx) => {
        try {
          await app(ctx)(tree, { skipFormat: true });
        } catch (error) {
          ctx.error = error.message;
        }
      },
      expect: (tree, t, ctx) => t.ok((ctx.error ?? '').includes('packages/<name>'), `refusal: ${ctx.error}`),
    },
  ],
};
