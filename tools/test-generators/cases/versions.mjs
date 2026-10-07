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
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireFromRepo } from '../../test-support/payload.mjs';
import { workspace, SCOPE } from '../workspaces.mjs';

const { writeJson, readJson } = requireFromRepo('@nx/devkit');
const { FsTree } = requireFromRepo('nx/src/generators/tree');

/**
 * A real directory (the choice reads the INSTALLED @nx/angular's version table from disk) holding a fresh workspace
 * right after `nx add @nx/angular`: no @angular/core yet, @angular-devkit/core at the latest major, and a stand-in
 * @nx/angular laid out as Nx 23.3 ships it (dist/src/utils/{versions,backward-compatible-versions}.js).
 */
function freshAngularWorkspace(manifest) {
  const dir = mkdtempSync(join(tmpdir(), 'house-angular-major-'));
  const nx = join(dir, 'node_modules/@nx/angular');
  mkdirSync(join(nx, 'dist/src/utils'), { recursive: true });
  writeFileSync(join(nx, 'package.json'), JSON.stringify({ name: '@nx/angular', version: '23.3.0' }));
  writeFileSync(join(nx, 'dist/src/utils/versions.js'), "exports.angularVersion = '~22.1.0'; exports.angularDevkitVersion = '~22.1.0'; exports.rxjsVersion = '~7.8.0'; exports.tsLibVersion = '^2.3.0'; exports.zoneJsVersion = '~0.16.0';\n");
  writeFileSync(
    join(nx, 'dist/src/utils/backward-compatible-versions.js'),
    "exports.supportedVersions = [22, 21, 20];\nexports.backwardCompatibleVersions = { 21: { angularVersion: '~21.2.0', angularDevkitVersion: '~21.2.0', rxjsVersion: '~7.8.0', tsLibVersion: '^2.3.0', zoneJsVersion: '~0.16.0' }, 20: { angularVersion: '~20.3.0', angularDevkitVersion: '~20.3.0', rxjsVersion: '~7.8.0', tsLibVersion: '^2.3.0', zoneJsVersion: '~0.15.0' } };\n",
  );
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest));
  writeFileSync(join(dir, 'nx.json'), '{}');
  return new FsTree(dir, false);
}
const SRC = join(dirname(fileURLToPath(import.meta.url)), '../../../plugins/house/engine/nx-tools/src');
const SEAM = 'generators/_utils/dependencies.ts';
/** Files that name a floating word as a value for a reason other than writing it — each with the reason. */
const FLOATING_NAME_EXEMPT = {
  'generators/_utils/node-spec.ts': 'parses Node version aliases (nvm `latest`/`node`, a Node feature\'s `latest`) — reads, never writes a dependency',
};
/** Manifest writes past updateManifest — each with why no dependency entry can be among them. */
const MANIFEST_WRITE_EXEMPT = {
  'generators/design-system/generator.ts': 'creates a NEW library manifest of `name` + `version` only',
};

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
          // A manifest edited by a JSON helper directly, past the guarded writer (updateManifest) — the write path
          // R1-7 found open (updateJsonInPlace on package.json in three generators).
          for (const match of text.matchAll(/\b(updateJsonInPlace|updateJson|writeJson)\(\s*tree,\s*[^,]*package\.json[^,]*,/g)) {
            if (!MANIFEST_WRITE_EXEMPT[rel]) ctx.offenders.push(`${rel}: ${match[1]} on a package.json outside updateManifest`);
          }
          // A floating spec as a VALUE: 'latest' / "latest" / 'next' quoted on its own (comments and prose say latest unquoted).
          if (FLOATING_NAME_EXEMPT[rel]) continue;
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
      name: 'the seam keeps the file\'s order: sorted place in a sorted block, appended in a hand-ordered one',
      setup: () => {
        const tree = workspace();
        writeJson(tree, 'package.json', { name: 'x', dependencies: { zod: '3.0.0', angular: '1.0.0' }, devDependencies: { a: '1.0.0', c: '1.0.0' } });
        return tree;
      },
      run: (tree, ctx) => ctx.load('generators/_utils/dependencies').declareDependencies(tree, 'test', { m: '1.0.0' }, { b: '1.0.0' }),
      expect: (tree, t) => {
        const json = readJson(tree, 'package.json');
        t.equal(Object.keys(json.dependencies).join(), 'zod,angular,m', 'hand order kept, the new name last');
        t.equal(Object.keys(json.devDependencies).join(), 'a,b,c', 'sorted block stays sorted');
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
      { angular: '21.2.1', says: /No stable @angular\/fire supported Angular 21 as of \d{4}-\d\d-\d\d[\s\S]*21\.0\.0-rc[\s\S]*Angular 20/ },
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
      name: 'new + firebase: a fresh workspace is created at the newest Angular @angular/fire supports, and says why',
      setup: () => freshAngularWorkspace({ name: 'shop', devDependencies: { '@angular-devkit/core': '~22.1.0', '@nx/angular': '23.3.0', typescript: '~6.0.3' } }),
      run: (tree, ctx) => ctx.load('adapters/angular/angularfire').pinAngularForFirebase(tree),
      expect: (tree, t, ctx) => {
        const { ANGULARFIRE_BY_ANGULAR_MAJOR } = ctx.load('generators/_utils/firebase-compat');
        const newest = Math.max(...Object.entries(ANGULARFIRE_BY_ANGULAR_MAJOR).filter(([, r]) => r.stable).map(([m]) => Number(m)));
        t.equal(newest, 20, 'the fixture\'s @nx/angular table is keyed to today\'s answer');
        t.equal(readJson(tree, 'package.json').dependencies?.['@angular/core'], '~20.3.0', '@nx/angular\'s own range for Angular 20');
        t.equal(readJson(tree, 'package.json').devDependencies['@angular-devkit/core'], '~20.3.0', 'the devkit init added is realigned');
        // The WHOLE runtime: @nx/angular adds it only when @angular/core is undeclared (the R1-0 follow-on: a workspace
        // with no @angular/compiler, router or zone.js), so the pin declares what it would have.
        const dependencies = readJson(tree, 'package.json').dependencies;
        for (const name of ['@angular/common', '@angular/compiler', '@angular/forms', '@angular/platform-browser', '@angular/router']) t.equal(dependencies[name], '~20.3.0', name);
        t.equal(dependencies['zone.js'], '~0.15.0', 'zone.js (Angular 20 apps are not zoneless)');
        t.equal(dependencies.rxjs, '~7.8.0', 'rxjs');
        t.equal(readJson(tree, 'package.json').devDependencies.typescript, ctx.load('generators/_utils/firebase-compat').ANGULAR_TYPESCRIPT_BY_MAJOR[20].pin, 'TypeScript inside what Angular 20\'s compiler accepts');
        t.ok(ctx.logs.some((line) => /Angular 20 — the newest major @angular\/fire supports; upgrade when AngularFire ships 21\+/.test(line)), `said: ${ctx.logs}`);
      },
    },
    {
      name: 'an EXISTING workspace keeps its Angular — the choice is creation-time only (the client refuses there)',
      setup: () => freshAngularWorkspace({ name: 'shop', dependencies: { '@angular/core': '~21.2.0' } }),
      run: (tree, ctx) => ctx.load('adapters/angular/angularfire').pinAngularForFirebase(tree),
      expect: (tree, t) => t.equal(readJson(tree, 'package.json').dependencies['@angular/core'], '~21.2.0', 'untouched'),
    },
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
      name: 'Angular 22 + @angular/fire 20 installed, both "latest": the SAME ordered advice the 0.50.0 migration gives — never "set firebase" alone',
      setup: () => {
        const tree = workspace();
        writeJson(tree, 'package.json', { name: 'x', dependencies: { '@angular/core': '~22.1.0', '@angular/fire': 'latest', firebase: 'latest' } });
        installed(tree, '@angular/core', { version: '22.1.2' });
        installed(tree, '@angular/fire', { version: '20.1.0', dependencies: { firebase: '^11.8.0' } });
        return tree;
      },
      run: (tree, ctx) => ctx.load('adapters/angular/angularfire').declareBrowserSdk(tree),
      expect: (tree, t, ctx) => {
        const report = ctx.logs.find((line) => line.includes('"@angular/fire": "latest" and "firebase": "latest"')) ?? '';
        t.ok(/1\. Pin what is installed[\s\S]*2\. Move to Angular 20[\s\S]*3\. Declare another/.test(report), `ordered choices: ${ctx.logs}`);
        t.ok(!ctx.logs.some((line) => /two Firebase SDKs/.test(line)), 'no half-advice');
        t.equal(deps(tree)['@angular/fire'], 'latest', 'a generator reports, never rewrites a declared spec');
      },
    },
    {
      name: 'Angular 22 running a pinned @angular/fire 20 stopgap: an info line (no nagging), dated — the table is a snapshot',
      setup: () => {
        const tree = workspace();
        writeJson(tree, 'package.json', { name: 'x', dependencies: { '@angular/core': '~22.1.0', '@angular/fire': '20.1.0', firebase: '^11.8.0' } });
        installed(tree, '@angular/core', { version: '22.1.2' });
        installed(tree, '@angular/fire', { version: '20.1.0', dependencies: { firebase: '^11.8.0' } });
        return tree;
      },
      run: (tree, ctx) => ctx.load('adapters/angular/angularfire').declareBrowserSdk(tree),
      expect: (tree, t, ctx) => {
        t.ok(!ctx.logs.some((line) => line.startsWith('[warn]')), `no warning: ${ctx.logs}`);
        t.ok(ctx.logs.some((line) => /built for Angular 20\) runs on Angular 22\.1\.2[\s\S]*as of \d{4}-\d\d-\d\d/.test(line)), `said: ${ctx.logs}`);
        t.ok(!ctx.logs.some((line) => /\byet\b/.test(line)), 'no live claim ("yet") from a frozen table');
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
      name: '.nvmrc: seeded once with the house major, then read in nvm\'s grammar — versions, x-ranges, comments, aliases',
      once: 'asserts the seed and the parser in sequence',
      setup: () => workspace(),
      run: async (tree, ctx) => {
        const { projectNodeMajor } = ctx.load('generators/_utils/node-version');
        const { HOUSE_NODE_MAJOR } = ctx.load('generators/_utils/versions');
        const { NODE_NEWEST_LTS_MAJOR, NODE_LTS_CODENAMES } = ctx.load('generators/_utils/node-facts');
        ctx.facts = { lts: String(NODE_NEWEST_LTS_MAJOR), iron: String(NODE_LTS_CODENAMES.iron) };
        ctx.seeded = [projectNodeMajor(tree), tree.read('.nvmrc', 'utf8'), HOUSE_NODE_MAJOR];
        ctx.read = {};
        for (const text of ['v22.11.0\n', '22.x\n', '# the team runs\n22 # LTS\n\n', 'lts/*\n', 'lts/iron\n']) {
          tree.write('.nvmrc', text);
          ctx.read[text] = projectNodeMajor(tree);
        }
        ctx.refused = {};
        for (const text of ['system\n', 'my-alias\n', '22\n24\n']) {
          tree.write('.nvmrc', text);
          ctx.refused[text] = await refusal(() => projectNodeMajor(tree));
        }
      },
      expect: (tree, t, ctx) => {
        const [major, file, house] = ctx.seeded;
        t.equal(major, house, 'the house seed');
        t.equal(file, `${house}\n`, 'written to .nvmrc');
        t.equal(ctx.read['v22.11.0\n'], '22', 'v22.11.0 → 22');
        t.equal(ctx.read['22.x\n'], '22', '22.x → 22');
        t.equal(ctx.read['# the team runs\n22 # LTS\n\n'], '22', 'comments and blanks dropped');
        t.equal(ctx.read['lts/*\n'], ctx.facts.lts, 'lts/* → the newest LTS as of the facts');
        t.equal(ctx.read['lts/iron\n'], ctx.facts.iron, 'lts/<codename> → its major');
        t.ok(ctx.logs.some((line) => /lts\/\* \(Node \d+ as of \d{4}-\d\d-\d\d\)/.test(line)), 'a moving alias is resolved OUT LOUD, dated');
        for (const [text, error] of Object.entries(ctx.refused)) t.ok(/names no Node the house can resolve/.test(error ?? ''), `refused ${JSON.stringify(text)}: ${error}`);
      },
    },
    {
      name: 'Node: one source — .node-version and Volta are read when there is no .nvmrc, never a second file seeded; disagreements are named',
      once: 'asserts the reader in sequence',
      setup: () => workspace(),
      run: (tree, ctx) => {
        const { projectNodeMajor, nodeVersionFile } = ctx.load('generators/_utils/node-version');
        tree.write('.node-version', '20.11.1\n');
        ctx.nodeVersion = [projectNodeMajor(tree), nodeVersionFile(tree), tree.exists('.nvmrc')];
        tree.delete('.node-version');
        writeJson(tree, 'package.json', { name: 'x', volta: { node: '22.11.0' }, engines: { node: '>=24' } });
        ctx.volta = [projectNodeMajor(tree), nodeVersionFile(tree), tree.exists('.nvmrc')];
      },
      expect: (tree, t, ctx) => {
        t.equal(JSON.stringify(ctx.nodeVersion), JSON.stringify(['20', '.node-version', false]), '.node-version is the source; no .nvmrc written');
        t.equal(JSON.stringify(ctx.volta), JSON.stringify(['22', 'package.json', false]), 'volta.node is the source; no .nvmrc written');
        t.ok(ctx.logs.some((line) => /engines\.node ">=24" does not admit Node 22/.test(line)), `engines disagreement named: ${ctx.logs}`);
      },
    },
    {
      name: 'Node: a project with no version file is seeded from the Node its devcontainer ALREADY runs, never the house default',
      setup: () => {
        const tree = workspace();
        tree.write('.devcontainer/devcontainer.json', '{\n  // the stock VS Code template\n  "image": "mcr.microsoft.com/devcontainers/typescript-node:1-22-bookworm",\n}\n');
        return tree;
      },
      run: (tree, ctx) => {
        ctx.major = ctx.load('generators/_utils/node-version').projectNodeMajor(tree);
      },
      expect: (tree, t, ctx) => {
        t.equal(ctx.major, '22', 'typescript-node:1-22-bookworm is image 1, Node 22');
        t.equal(tree.read('.nvmrc', 'utf8'), '22\n', 'seeded with it');
      },
    },
    {
      name: 'Node: an unreadable devcontainer Node is refused, never guessed; an odd major refuses the house image by name',
      once: 'the operations throw by design',
      setup: () => workspace(),
      run: async (tree, ctx) => {
        const { projectNodeMajor, assertNodeImage } = ctx.load('generators/_utils/node-version');
        tree.write('.devcontainer/devcontainer.json', '{ "build": { "dockerfile": "Dockerfile" } }');
        tree.write('.devcontainer/Dockerfile', 'FROM ubuntu:24.04\nRUN apt-get install -y nodejs\n');
        ctx.unreadable = await refusal(() => projectNodeMajor(tree));
        ctx.wrote = tree.exists('.nvmrc');
        tree.write('.nvmrc', '23\n');
        ctx.odd = await refusal(() => assertNodeImage(tree, projectNodeMajor(tree)));
      },
      expect: (tree, t, ctx) => {
        t.ok(/cannot be read[\s\S]*will not guess/.test(ctx.unreadable ?? ''), `refused: ${ctx.unreadable}`);
        t.ok(!ctx.wrote, 'no .nvmrc guessed');
        t.ok(/publishes no Node 23 image/.test(ctx.odd ?? ''), `odd major: ${ctx.odd}`);
      },
    },
    {
      name: 'Angular library test runner follows the workspace\'s Angular major (vitest-angular needs 21+ and a build)',
      once: 'asserts a pure choice',
      setup: () => workspace(),
      run: (tree, ctx) => {
        const { libraryUnitTestRunner } = ctx.load('adapters/angular/workspace-angular');
        ctx.choices = {};
        for (const core of ['~20.3.0', '~21.2.0', '~22.1.0']) {
          writeJson(tree, 'package.json', { name: 'x', dependencies: { '@angular/core': core } });
          ctx.choices[core] = [libraryUnitTestRunner(tree, true), libraryUnitTestRunner(tree, false)];
        }
        writeJson(tree, 'package.json', { name: 'x' });
        ctx.unknown = libraryUnitTestRunner(tree, true);
      },
      expect: (tree, t, ctx) => {
        t.equal(JSON.stringify(ctx.choices['~20.3.0']), JSON.stringify(['vitest-analog', 'vitest-analog']), 'Angular 20: Analog for both');
        t.equal(JSON.stringify(ctx.choices['~21.2.0']), JSON.stringify(['vitest-angular', 'vitest-analog']), 'Angular 21: vitest-angular for a built lib');
        t.equal(JSON.stringify(ctx.choices['~22.1.0']), JSON.stringify(['vitest-angular', 'vitest-analog']), 'Angular 22 likewise');
        t.equal(ctx.unknown, undefined, 'no Angular yet: left to @nx/angular');
      },
    },
    {
      name: 'firebase-tools follows @angular/fire\'s peer: Angular 19 + firebase gets the in-range pin named (npm would ERESOLVE)',
      setup: () => {
        const tree = workspace();
        writeJson(tree, 'package.json', { name: 'x', dependencies: { '@angular/core': '^19.0.0' }, devDependencies: { 'firebase-tools': '15.32.1' } });
        installed(tree, '@angular/core', { version: '19.2.1' });
        return tree;
      },
      run: (tree, ctx) => ctx.load('adapters/angular/angularfire').declareBrowserSdk(tree),
      expect: (tree, t, ctx) => {
        t.equal(deps(tree)['@angular/fire'], '19.2.0', 'the release for Angular 19');
        t.ok(ctx.logs.some((line) => /peers firebase-tools "\^13\.0\.0"[\s\S]*"firebase-tools": "13\.\d+\.\d+"/.test(line)), `said: ${ctx.logs}`);
      },
    },
    {
      name: 'every manifest write is guarded: updateManifest refuses a floating version (a workspace link passes)',
      once: 'the operation throws by design',
      setup: () => {
        const tree = workspace();
        writeJson(tree, 'libs/a/package.json', { name: '@x/a', version: '0.0.1' });
        writeJson(tree, 'libs/a/project.json', { name: 'a', root: 'libs/a' });
        return tree;
      },
      run: async (tree, ctx) => {
        const { updateManifest } = ctx.load('generators/_utils/dependencies');
        ctx.before = tree.read('package.json', 'utf8');
        ctx.refused = {};
        for (const spec of ['latest', '^22', '>=1.0.0', '1.x', '*']) {
          ctx.refused[spec] = await refusal(() => updateManifest(tree, 'package.json', 'test', (json) => ({ ...json, dependencies: { pkg: spec } })));
        }
        ctx.after = tree.read('package.json', 'utf8');
        updateManifest(tree, 'package.json', 'test', (json) => ({ ...json, dependencies: { '@x/a': '*', pinned: '^1.2.3' } }));
      },
      expect: (tree, t, ctx) => {
        for (const [spec, error] of Object.entries(ctx.refused)) t.ok(/refusing to write a floating dependency/.test(error ?? ''), `refused "${spec}"`);
        t.equal(ctx.after, ctx.before, 'a refused write leaves the file as it was');
        t.equal(deps(tree)['@x/a'], '*', 'a workspace link passes');
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
