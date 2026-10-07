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
        t.ok(said.some((line) => /no stable @angular\/fire supported Angular 21 as of 2026-10-07[\s\S]*21\.0\.0-rc\.1/i.test(line)), `reported: ${said}`);
      },
    },
    {
      name: 'Angular 22 with @angular/fire 20 installed (the dogfood state): BOTH floats named, choices ordered, and the generator says the same',
      setup: (tree) => {
        listen();
        pkg(tree, { '@angular/core': '~22.1.0', firebase: 'latest', '@angular/fire': 'latest' });
        installed(tree, '@angular/core', { version: '22.1.2' });
        installed(tree, '@angular/fire', { version: '20.1.0', dependencies: { firebase: '^11.8.0' } });
        installed(tree, 'firebase', { version: '12.19.0' });
      },
      expect: (tree, t) => {
        t.ok(deps(tree).firebase === 'latest' && deps(tree)['@angular/fire'] === 'latest', 'no coherent pair: left as they are');
        const report = said.find((line) => line.includes('"@angular/fire": "latest" and "firebase": "latest"')) ?? '';
        t.ok(report, `both floating entries named: ${said}`);
        const order = ['1. Pin what is installed and runs today: "@angular/fire": "20.1.0", "firebase": "^11.8.0"', '2. Move to Angular 20', '3. Declare another'];
        t.ok(order.every((step, i) => report.indexOf(step) > (i ? report.indexOf(order[i - 1]) : -1)), `choices in order: ${report}`);
        t.ok(!said.some((line) => /Set "firebase": "\^11\.8\.0"/.test(line)), 'never the half-advice (firebase alone) on a mismatched Angular');
      },
    },
    {
      name: 'Angular 22 after following half the advice (firebase pinned, @angular/fire still "latest"): the float is still REPORTED',
      setup: (tree) => {
        listen();
        pkg(tree, { '@angular/core': '~22.1.0', firebase: '^11.8.0', '@angular/fire': 'latest' });
        installed(tree, '@angular/core', { version: '22.1.2' });
        installed(tree, '@angular/fire', { version: '20.1.0', dependencies: { firebase: '^11.8.0' } });
      },
      expect: (tree, t) => {
        t.ok(deps(tree)['@angular/fire'] === 'latest', 'left');
        t.ok(said.some((line) => /declares "@angular\/fire": "latest" —[\s\S]*1\. Pin what is installed/.test(line)), `reported: ${said}`);
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
      name: 'the report judges by the seam\'s own rule: ^1, >=1, 1.x are reported too; git, file: and npm: aliases with pins are not versions that float',
      setup: (tree) => {
        listen();
        pkg(tree, { a: '^1', b: '>=1.0.0', c: '1.x', d: 'github:me/d', e: 'file:../e', f: 'npm:g@^1.2.3', h: 'npm:i@latest' });
      },
      expect: (tree, t) => {
        for (const name of ['a', 'b', 'c', 'h']) t.ok(said.some((line) => line.includes(`dependencies.${name} is`)), `${name} reported: ${said}`);
        for (const name of ['d', 'e', 'f']) t.ok(!said.some((line) => line.includes(`dependencies.${name} is`)), `${name} not reported`);
      },
    },
    {
      name: 'no package.json (a wrapper-hosted repo): a no-op',
      setup: (tree) => tree.delete('package.json'),
      expect: (tree, t) => t.missing('package.json'),
    },
  ],
};
