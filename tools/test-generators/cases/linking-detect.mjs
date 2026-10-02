// LINKING DETECTION — our copy of Nx's `isUsingTsSolutionSetup`. A workspace is `workspaces`-linked only when ALL of
// its facts hold; one missing fact is a classic `paths` workspace, which is what Nx's own generators would treat it
// as too. Disagreeing with Nx here would make our generators link one way and Nx's the other in the same repo.
import { requireFromRepo } from '../../test-support/payload.mjs';
import { workspace } from '../workspaces.mjs';

const { updateJson, writeJson } = requireFromRepo('@nx/devkit');

const detect = (name, make, expected) => ({
  name: `${name} → ${expected}`,
  setup: make,
  run: (tree, ctx) => (ctx.kind = ctx.load('generators/_utils/linking').detectLinking(tree)),
  expect: (tree, t, ctx) => t.equal(ctx.kind, expected, 'detectLinking'),
});

export default {
  name: 'linking · detection',
  cases: [
    detect('a classic integrated workspace', () => workspace(), 'paths'),
    detect('TS-solution under npm', () => workspace({ link: 'workspaces-npm' }), 'workspaces'),
    detect('TS-solution under pnpm (membership in pnpm-workspace.yaml)', () => workspace({ link: 'workspaces-pnpm' }), 'workspaces'),
    detect('TS-solution under yarn berry', () => workspace({ link: 'workspaces-npm', pm: 'yarn-berry' }), 'workspaces'),
    detect(
      'workspaces on, but a classic tsconfig',
      () => {
        const tree = workspace();
        updateJson(tree, 'package.json', (json) => ({ ...json, workspaces: ['packages/*'] }));
        return tree;
      },
      'paths',
    ),
    detect(
      'pnpm with package.json `workspaces` only (pnpm ignores it)',
      () => {
        const tree = workspace({ link: 'workspaces-pnpm' });
        tree.delete('pnpm-workspace.yaml');
        updateJson(tree, 'package.json', (json) => ({ ...json, workspaces: ['packages/*'] }));
        return tree;
      },
      'paths',
    ),
    detect(
      'a solution tsconfig.json that includes files is no solution file',
      () => {
        const tree = workspace({ link: 'workspaces-npm' });
        updateJson(tree, 'tsconfig.json', (json) => ({ ...json, files: ['main.ts'] }));
        return tree;
      },
      'paths',
    ),
    detect(
      'composite off',
      () => {
        const tree = workspace({ link: 'workspaces-npm' });
        updateJson(tree, 'tsconfig.base.json', (json) => ({ ...json, compilerOptions: { ...json.compilerOptions, composite: false } }));
        return tree;
      },
      'paths',
    ),
    detect(
      'declaration explicitly off',
      () => {
        const tree = workspace({ link: 'workspaces-npm' });
        updateJson(tree, 'tsconfig.base.json', (json) => ({ ...json, compilerOptions: { ...json.compilerOptions, declaration: false } }));
        return tree;
      },
      'paths',
    ),
    detect(
      'a tsconfig.json that does not parse',
      () => {
        const tree = workspace({ link: 'workspaces-npm' });
        tree.write('tsconfig.json', '{ "extends": ');
        return tree;
      },
      'paths',
    ),
    detect(
      'no root package.json (the Nx wrapper host)',
      () => {
        const tree = workspace();
        tree.delete('package.json');
        writeJson(tree, 'tsconfig.json', { extends: './tsconfig.base.json', files: [] });
        return tree;
      },
      'paths',
    ),
  ],
};
