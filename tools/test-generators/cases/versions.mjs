// VERSIONS — a house generator never writes a version nobody chose (0.50.0).
//
// The CLASS GUARD first: `latest` reached projects from four generators because each call site restated "pin it" on
// its own and three forgot. Now there is one seam (`_utils/dependencies.ts` declareDependencies) that refuses a
// floating spec — and this suite fails if any generator goes around it, or names a floating spec anywhere in the
// payload's source outside the migrations (which quote it to rewrite it).
//
// Then the derivations that replaced the floats: @angular/fire from the INSTALLED Angular major and firebase from
// that release's own range (refusing, with the choices, when no stable release exists); the Node major from the
// project's .nvmrc; Cloud Functions' runtime from it; firebase-tools as the project's pinned devDependency.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireFromRepo } from '../../test-support/payload.mjs';
import { workspace, SCOPE } from '../workspaces.mjs';

const { writeJson, readJson } = requireFromRepo('@nx/devkit');
const SRC = join(dirname(fileURLToPath(import.meta.url)), '../../../plugins/house/engine/nx-tools/src');
const SEAM = 'generators/_utils/dependencies.ts';

function sources(dir = SRC) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'migrations' ? [] : sources(path);
    return /\.(ts|json)$/.test(name) ? [path] : [];
  });
}

const deps = (tree) => {
  const pkg = readJson(tree, 'package.json');
  return { ...pkg.dependencies, ...pkg.devDependencies };
};
const installed = (tree, name, manifest) => writeJson(tree, `node_modules/${name}/package.json`, { name, ...manifest });
const pinned = /^[~^]?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** Run `fn`, returning its error message (or undefined). */
const refusal = async (fn) => {
  try {
    await fn();
  } catch (error) {
    return error.message;
  }
  return undefined;
};

export default {
  name: 'versions · nothing floats, everything derives from one place',
  cases: [
    {
      name: 'no generator declares a dependency around the seam, and no source names a floating spec',
      once: 'a static scan of the payload source — no tree operation to repeat',
      setup: () => workspace(),
      run: (tree, ctx) => {
        ctx.offenders = [];
        for (const file of sources()) {
          const rel = relative(SRC, file);
          const text = readFileSync(file, 'utf8');
          if (rel !== SEAM && /\baddDependenciesToPackageJson\b/.test(text)) ctx.offenders.push(`${rel}: addDependenciesToPackageJson outside ${SEAM}`);
          // A floating spec as a VALUE: 'latest' / "latest" / 'next' quoted on its own (comments and prose say latest unquoted).
          for (const match of text.matchAll(/(['"])(latest|next)\1/g)) ctx.offenders.push(`${rel}: ${match[0]}`);
        }
      },
      expect: (tree, t, ctx) => t.ok(ctx.offenders.length === 0, `floating-version sites:\n    ${ctx.offenders.join('\n    ')}`),
    },
    {
      name: 'the seam refuses every floating spec and accepts every pinned one',
      once: 'asserts a pure function',
      setup: () => workspace(),
      run: async (tree, ctx) => {
        const { declareDependencies } = ctx.load('generators/_utils/dependencies');
        ctx.refused = [];
        for (const spec of ['latest', 'next', '*', 'x', '', '22', '>=1.0.0', '1.x', 'beta']) {
          if (await refusal(() => declareDependencies(tree, 'test', { pkg: spec }))) ctx.refused.push(spec);
        }
        for (const spec of ['1.2.3', '^13.6.0', '~6.0.3', '0.1.0-alpha.0', '21.0.0-rc.1']) declareDependencies(tree, 'test', { [`p${spec}`]: spec });
      },
      expect: (tree, t, ctx) => {
        t.equal(ctx.refused.length, 9, `refused: ${ctx.refused.join(' | ')}`);
        t.equal(deps(tree)['p^13.6.0'], '^13.6.0', 'a pinned range is written');
        t.ok(!('pkg' in deps(tree)), 'a refused spec writes nothing');
      },
    },
    {
      name: 'the seam never touches what the project already declares',
      setup: () => {
        const tree = workspace();
        writeJson(tree, 'package.json', { name: 'x', dependencies: { firebase: '^10.0.0' } });
        return tree;
      },
      run: (tree, ctx) => ctx.load('generators/_utils/dependencies').declareDependencies(tree, 'test', {}, { firebase: '^11.8.0' }),
      expect: (tree, t) => {
        t.equal(readJson(tree, 'package.json').dependencies.firebase, '^10.0.0', 'kept');
        t.ok(!readJson(tree, 'package.json').devDependencies?.firebase, 'not added to the other block');
      },
    },
    {
      name: 'Angular 20 installed: @angular/fire for 20, firebase exactly its own range',
      setup: () => {
        const tree = workspace();
        installed(tree, '@angular/core', { version: '20.3.4' });
        return tree;
      },
      run: (tree, ctx) => ctx.load('adapters/angular/angularfire').declareBrowserSdk(tree),
      expect: (tree, t, ctx) => {
        const { ANGULARFIRE_BY_ANGULAR_MAJOR } = ctx.load('generators/_utils/firebase-compat');
        const row = ANGULARFIRE_BY_ANGULAR_MAJOR[20].stable;
        t.equal(deps(tree)['@angular/fire'], row.angularfire, '@angular/fire');
        t.equal(deps(tree).firebase, row.firebase, 'firebase = @angular/fire\'s own dependencies.firebase');
        t.ok(pinned.test(deps(tree)['@angular/fire']), 'exact');
      },
    },
    {
      name: 'the declared Angular range is read when nothing is installed',
      setup: () => {
        const tree = workspace();
        writeJson(tree, 'package.json', { name: 'x', dependencies: { '@angular/core': '~20.1.0' } });
        return tree;
      },
      run: (tree, ctx) => ctx.load('adapters/angular/angularfire').declareBrowserSdk(tree),
      expect: (tree, t) => t.ok(deps(tree)['@angular/fire']?.startsWith('20.'), `got ${deps(tree)['@angular/fire']}`),
    },
    ...[
      { angular: '21.2.1', says: /No stable @angular\/fire supports Angular 21[\s\S]*21\.0\.0-rc[\s\S]*Angular 20/ },
      { angular: '99.0.0', says: /newer than this toolkit's @angular\/fire table/ },
      { angular: '15.2.0', says: /older than any @angular\/fire the house supports/ },
    ].map(({ angular, says }) => ({
      name: `Angular ${angular}: refuses, saying what is true and what to do — and writes nothing`,
      once: 'the operation throws by design',
      setup: () => {
        const tree = workspace();
        installed(tree, '@angular/core', { version: angular });
        return tree;
      },
      run: async (tree, ctx) => {
        ctx.error = await refusal(() => ctx.load('adapters/angular/angularfire').declareBrowserSdk(tree));
      },
      expect: (tree, t, ctx) => {
        t.ok(says.test(ctx.error ?? ''), `refusal: ${ctx.error}`);
        t.ok(!deps(tree)['@angular/fire'] && !deps(tree).firebase, 'nothing declared');
      },
    })),
    {
      name: 'Angular 21 with the pair declared by hand: kept — the refusal is only for what the house would have to choose',
      setup: () => {
        const tree = workspace();
        writeJson(tree, 'package.json', { name: 'x', dependencies: { '@angular/fire': '21.0.0-rc.1', firebase: '^12.18.0' } });
        installed(tree, '@angular/core', { version: '21.2.1' });
        installed(tree, '@angular/fire', { version: '21.0.0-rc.1', dependencies: { firebase: '^12.18.0' } });
        return tree;
      },
      run: (tree, ctx) => ctx.load('adapters/angular/angularfire').declareBrowserSdk(tree),
      expect: (tree, t, ctx) => {
        t.equal(deps(tree)['@angular/fire'], '21.0.0-rc.1', 'kept');
        t.ok(!ctx.logs.some((line) => line.startsWith('[warn]')), `no warning for a coherent pair: ${ctx.logs}`);
      },
    },
    {
      name: 'a firebase that disagrees with the installed @angular/fire is NAMED (the two-SDK state)',
      setup: () => {
        const tree = workspace();
        writeJson(tree, 'package.json', { name: 'x', dependencies: { '@angular/fire': '20.1.0', firebase: '12.19.0' } });
        installed(tree, '@angular/fire', { version: '20.1.0', dependencies: { firebase: '^11.8.0' } });
        return tree;
      },
      run: (tree, ctx) => ctx.load('adapters/angular/angularfire').declareBrowserSdk(tree),
      expect: (tree, t, ctx) => {
        t.ok(ctx.logs.some((line) => /two Firebase SDKs[\s\S]*"firebase": "\^11\.8\.0"/.test(line)), `warned: ${ctx.logs}`);
        t.equal(deps(tree).firebase, '12.19.0', 'reported, never rewritten by a generator');
      },
    },
    {
      name: '.nvmrc: seeded once with the house major, then read — v-prefixed and full versions too; an alias is refused',
      once: 'asserts the seed and the parser in sequence',
      setup: () => workspace(),
      run: async (tree, ctx) => {
        const { projectNodeMajor } = ctx.load('generators/_utils/node-version');
        const { HOUSE_NODE_MAJOR } = ctx.load('generators/_utils/versions');
        ctx.seeded = [projectNodeMajor(tree), tree.read('.nvmrc', 'utf8'), HOUSE_NODE_MAJOR];
        tree.write('.nvmrc', 'v22.11.0\n');
        ctx.full = projectNodeMajor(tree);
        tree.write('.nvmrc', 'lts/*\n');
        ctx.alias = await refusal(() => projectNodeMajor(tree));
      },
      expect: (tree, t, ctx) => {
        const [major, file, house] = ctx.seeded;
        t.equal(major, house, 'the house seed');
        t.equal(file, `${house}\n`, 'written to .nvmrc');
        t.equal(ctx.full, '22', 'v22.11.0 → 22');
        t.ok(/names no Node major/.test(ctx.alias ?? ''), `alias refused: ${ctx.alias}`);
      },
    },
    {
      name: 'firebase-emulators: firebase-tools is a pinned devDependency, every version it writes is pinned, functions run on .nvmrc',
      setup: () => {
        const tree = workspace();
        tree.write('.nvmrc', '22\n');
        return tree;
      },
      run: (tree, ctx) => ctx.load('generators/firebase-emulators/generator').default(tree, { workspaceName: SCOPE }),
      expect: (tree, t, ctx) => {
        const { FIREBASE_TOOLS_VERSION } = ctx.load('generators/_utils/versions');
        t.equal(readJson(tree, 'package.json').devDependencies['firebase-tools'], FIREBASE_TOOLS_VERSION, 'firebase-tools');
        const floating = Object.entries(deps(tree)).filter(([, spec]) => !pinned.test(spec));
        t.ok(floating.length === 0, `floating: ${JSON.stringify(floating)}`);
        t.equal(t.json('apps/functions/package.json')?.engines?.node, '22', 'functions engines follow .nvmrc');
      },
    },
    {
      name: 'firebase-emulators: a Node Cloud Functions lacks gets the nearest runtime below it — said, not silent',
      setup: () => {
        const tree = workspace();
        tree.write('.nvmrc', '99\n');
        return tree;
      },
      run: (tree, ctx) => ctx.load('generators/firebase-emulators/generator').default(tree, { workspaceName: SCOPE }),
      expect: (tree, t, ctx) => {
        const { FUNCTIONS_NODE_RUNTIMES } = ctx.load('generators/_utils/firebase-compat');
        const newest = FUNCTIONS_NODE_RUNTIMES[FUNCTIONS_NODE_RUNTIMES.length - 1];
        t.equal(t.json('apps/functions/package.json')?.engines?.node, newest, 'the newest GA runtime');
        t.ok(ctx.logs.some((line) => /Cloud Functions has no Node 99 runtime|deploys Cloud Functions on Node/.test(line)), `said: ${ctx.logs}`);
      },
    },
    {
      name: 'firebase-emulators: an existing manifest on another runtime is reported, never rewritten',
      setup: () => {
        const tree = workspace();
        tree.write('.nvmrc', '24\n');
        writeJson(tree, 'apps/functions/package.json', { name: 'functions', engines: { node: '22' } });
        return tree;
      },
      run: (tree, ctx) => ctx.load('generators/firebase-emulators/generator').default(tree, { workspaceName: SCOPE }),
      expect: (tree, t, ctx) => {
        t.equal(t.json('apps/functions/package.json')?.engines?.node, '22', 'kept');
        t.ok(ctx.logs.some((line) => /deploys Cloud Functions on Node "22", but the project's Node \(\.nvmrc\) is 24/.test(line)), `said: ${ctx.logs}`);
      },
    },
  ],
};
