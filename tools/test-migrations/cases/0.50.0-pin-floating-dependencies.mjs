// 0.50.0 — `"latest"` → a COHERENT pin. The shapes: the reported bug state (Angular 20, @angular/fire 20 installed with
// its own firebase 11 nested, firebase 12 at the root), a fresh one with nothing installed, Angular 21 (no stable
// @angular/fire: left and reported), a project's own @angular/fire pin, the other house-written floats, a project's
// own floating spec (reported, untouched) and a workspace link `*` (not a version — untouched, unreported).
import { createRequire } from 'node:module';

const { writeJson, readJson, logger } = createRequire(import.meta.url)('@nx/devkit');

const pkg = (tree, deps, devDeps = {}) => writeJson(tree, 'package.json', { name: 'shop', dependencies: deps, devDependencies: devDeps });
const installed = (tree, name, manifest) => writeJson(tree, `node_modules/${name}/package.json`, { name, ...manifest });
const deps = (tree) => {
  const json = readJson(tree, 'package.json');
  return { ...json.dependencies, ...json.devDependencies };
};
/** The warnings the rung speaks (the harness captures the logger; this listens beside it). */
const said = [];
const listen = () => {
  said.length = 0;
  const original = logger.warn;
  logger.warn = (...args) => {
    said.push(args.join(' '));
    original(...args);
  };
};

export default {
  name: '0.50.0 · pin-floating-dependencies',
  ladder: ['0.50.0/pin-floating-dependencies'],
  cases: [
    {
      name: 'the bug state: firebase follows the INSTALLED @angular/fire\'s own range — not the installed root firebase 12',
      setup: (tree) => {
        pkg(tree, { '@angular/core': '~20.3.0', firebase: 'latest', '@angular/fire': 'latest' }, { nx: '23.1.0' });
        installed(tree, '@angular/core', { version: '20.3.4' });
        installed(tree, '@angular/fire', { version: '20.0.1', dependencies: { firebase: '^11.8.0' } });
        installed(tree, 'firebase', { version: '12.19.0' });
      },
      expect: (tree, t) => {
        t.ok(deps(tree)['@angular/fire'] === '20.0.1', `@angular/fire: ${deps(tree)['@angular/fire']} (the installed release of this major — no surprise upgrade)`);
        t.ok(deps(tree).firebase === '^11.8.0', `firebase: ${deps(tree).firebase}`);
        t.ok(deps(tree).nx === '23.1.0', 'other deps untouched');
      },
    },
    {
      name: 'nothing installed: the house release for the declared Angular major',
      setup: (tree) => pkg(tree, { '@angular/core': '~19.2.0', firebase: 'latest', '@angular/fire': 'latest' }),
      expect: (tree, t) => {
        t.ok(deps(tree)['@angular/fire'] === '19.2.0', `@angular/fire: ${deps(tree)['@angular/fire']}`);
        t.ok(deps(tree).firebase === '^11.8.0', `firebase: ${deps(tree).firebase}`);
      },
    },
    {
      name: 'installed @angular/fire of ANOTHER major (latest outran Angular): the house release for Angular\'s major',
      setup: (tree) => {
        pkg(tree, { '@angular/core': '~19.2.0', firebase: 'latest', '@angular/fire': 'latest' });
        installed(tree, '@angular/core', { version: '19.2.14' });
        installed(tree, '@angular/fire', { version: '20.1.0', dependencies: { firebase: '^11.8.0' } });
      },
      expect: (tree, t) => t.ok(deps(tree)['@angular/fire'] === '19.2.0', `@angular/fire: ${deps(tree)['@angular/fire']}`),
    },
    {
      name: 'Angular 21: no stable @angular/fire — both stay "latest", and the choices are reported',
      setup: (tree) => {
        listen();
        pkg(tree, { '@angular/core': '~21.2.0', firebase: 'latest', '@angular/fire': 'latest' });
        installed(tree, '@angular/core', { version: '21.2.1' });
      },
      expect: (tree, t) => {
        t.ok(deps(tree).firebase === 'latest' && deps(tree)['@angular/fire'] === 'latest', 'left as they are');
        t.ok(said.some((line) => /no stable @angular\/fire supports Angular 21[\s\S]*21\.0\.0-rc\.1/.test(line)), `reported: ${said}`);
      },
    },
    {
      name: 'the project pinned @angular/fire itself: firebase follows THAT installed release',
      setup: (tree) => {
        pkg(tree, { '@angular/core': '~20.3.0', firebase: 'latest', '@angular/fire': '20.0.3' });
        installed(tree, '@angular/core', { version: '20.3.4' });
        installed(tree, '@angular/fire', { version: '20.0.3', dependencies: { firebase: '^11.8.0' } });
      },
      expect: (tree, t) => {
        t.ok(deps(tree)['@angular/fire'] === '20.0.3', 'the project\'s pin kept');
        t.ok(deps(tree).firebase === '^11.8.0', `firebase: ${deps(tree).firebase}`);
      },
    },
    {
      name: 'the other house floats: typescript-utils, @nx/esbuild (lockstep with nx), an adopted package',
      setup: (tree) => {
        pkg(tree, { '@bespunky/typescript-utils': 'latest', '@bespunky/kit': 'latest' }, { nx: '23.1.0', '@nx/esbuild': 'latest' });
        installed(tree, '@bespunky/kit', { version: '1.4.2' });
        writeJson(tree, 'libs/kit/project.json', { name: 'kit', root: 'libs/kit', projectType: 'library' });
        writeJson(tree, 'libs/kit/extraction.json', { ingestedPackage: { name: '@bespunky/kit', version: '(nx release)' } });
      },
      expect: (tree, t) => {
        t.ok(deps(tree)['@bespunky/typescript-utils'] === '0.1.0-alpha.0', `typescript-utils: ${deps(tree)['@bespunky/typescript-utils']}`);
        t.ok(deps(tree)['@nx/esbuild'] === '23.1.0', `@nx/esbuild: ${deps(tree)['@nx/esbuild']}`);
        t.ok(deps(tree)['@bespunky/kit'] === '^1.4.2', `adopted: ${deps(tree)['@bespunky/kit']}`);
      },
    },
    {
      name: "a project's own floating spec is reported, never rewritten; a workspace link `*` is not a version at all",
      setup: (tree) => {
        listen();
        pkg(tree, { lodash: 'next', '@shop/ui': '*' });
        writeJson(tree, 'libs/ui/project.json', { name: 'ui', root: 'libs/ui', projectType: 'library' });
        writeJson(tree, 'libs/ui/package.json', { name: '@shop/ui', version: '0.0.1' });
      },
      expect: (tree, t) => {
        t.ok(deps(tree).lodash === 'next' && deps(tree)['@shop/ui'] === '*', 'untouched');
        t.ok(said.some((line) => /lodash is "next"/.test(line)), `lodash reported: ${said}`);
        t.ok(!said.some((line) => line.includes('@shop/ui')), 'the link was reported as a float');
      },
    },
    {
      name: 'no package.json (a wrapper-hosted repo): a no-op',
      setup: (tree) => tree.delete('package.json'),
      expect: (tree, t) => t.missing('package.json'),
    },
  ],
};
