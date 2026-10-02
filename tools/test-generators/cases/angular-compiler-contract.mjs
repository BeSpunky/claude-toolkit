// THE ANGULAR COMPILER CONTRACT — in a workspaces-linked workspace the base tsconfig is written for tsc-built
// packages (`emitDeclarationOnly: true`, an ES-only `lib`), so every Angular project states, in its own
// tsconfig.json, what the Angular compiler needs: JavaScript emit, and the inherited `lib` plus DOM
// (adapters/angular/ts-solution.ts). Pure Tree work — no @nx/angular needed; the project tsconfigs below are the
// shape @nx/angular writes (its own tsconfig.json extends the base; every build/test config extends it). The real
// build that proves the contract sufficient is tools/test-angular-ts-solution.
import { requireFromRepo } from '../../test-support/payload.mjs';
import { workspace } from '../workspaces.mjs';

const { updateJson, writeJson } = requireFromRepo('@nx/devkit');

/** An Angular project's root tsconfig.json, as @nx/angular writes it for an app or a library. */
function angularProject(tree, root, extendsPath = '../../tsconfig.base.json') {
  writeJson(tree, `${root}/tsconfig.json`, {
    extends: extendsPath,
    compilerOptions: { strict: true, noImplicitOverride: true },
    files: [],
    include: [],
    references: [{ path: './tsconfig.app.json' }],
  });
}

const optionsOf = (tree, root) => JSON.parse(tree.read(`${root}/tsconfig.json`, 'utf8')).compilerOptions;
const state = (root) => (tree, ctx) => ctx.load('adapters/angular/ts-solution').stateAngularCompilerContract(tree, root);

export default {
  name: 'angular · the compiler contract in a TS-solution workspace',
  cases: [
    ...['apps/shop', 'packages/ui'].map((root) => ({
      name: `${root}: JavaScript emit and the base lib plus dom, over a tsc-oriented base`,
      setup: () => {
        const tree = workspace({ link: 'workspaces-npm' });
        angularProject(tree, root);
        return tree;
      },
      run: state(root),
      expect: (tree, t) => {
        const options = optionsOf(tree, root);
        t.equal(options.emitDeclarationOnly, false, 'emitDeclarationOnly');
        t.equal(options.lib, ['es2022', 'dom'], 'lib derived from the base');
        t.equal(options.strict, true, "the project's own options kept");
        t.equal(JSON.parse(tree.read('tsconfig.base.json', 'utf8')).compilerOptions.emitDeclarationOnly, true, 'the base untouched');
      },
    })),
    {
      name: 'a base that already has DOM (any casing): lib kept as inherited, no duplicate',
      setup: () => {
        const tree = workspace({ link: 'workspaces-npm' });
        updateJson(tree, 'tsconfig.base.json', (json) => ({ ...json, compilerOptions: { ...json.compilerOptions, lib: ['ES2023', 'DOM'] } }));
        angularProject(tree, 'apps/shop');
        return tree;
      },
      run: state('apps/shop'),
      expect: (tree, t) => t.equal(optionsOf(tree, 'apps/shop').lib, ['ES2023', 'DOM'], 'lib'),
    },
    {
      name: 'no lib anywhere in the chain: none written (the target default already has DOM)',
      setup: () => {
        const tree = workspace({ link: 'workspaces-npm' });
        updateJson(tree, 'tsconfig.base.json', (json) => {
          delete json.compilerOptions.lib;
          return json;
        });
        angularProject(tree, 'apps/shop');
        return tree;
      },
      run: state('apps/shop'),
      expect: (tree, t) => {
        t.equal(optionsOf(tree, 'apps/shop').lib, undefined, 'lib');
        t.equal(optionsOf(tree, 'apps/shop').emitDeclarationOnly, false, 'emitDeclarationOnly');
      },
    },
    {
      name: 'lib inherited through an intermediate config',
      setup: () => {
        const tree = workspace({ link: 'workspaces-npm' });
        writeJson(tree, 'apps/tsconfig.shared.json', { extends: '../tsconfig.base.json', compilerOptions: { lib: ['es2024'] } });
        angularProject(tree, 'apps/shop', '../tsconfig.shared.json');
        return tree;
      },
      run: state('apps/shop'),
      expect: (tree, t) => t.equal(optionsOf(tree, 'apps/shop').lib, ['es2024', 'dom'], 'lib'),
    },
    {
      name: 'a paths workspace: untouched (its base is Angular-shaped already)',
      setup: () => {
        const tree = workspace({ link: 'paths' });
        angularProject(tree, 'apps/shop');
        return tree;
      },
      run: state('apps/shop'),
      expect: (tree, t) => t.equal(optionsOf(tree, 'apps/shop'), { strict: true, noImplicitOverride: true }, 'compilerOptions'),
    },
  ],
};
