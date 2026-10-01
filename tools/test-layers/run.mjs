#!/usr/bin/env node
/**
 * Test the LAYER REGISTRY — and keep its shell projection honest.
 *
 *   node tools/test-layers/run.mjs           # check
 *   node tools/test-layers/run.mjs --write   # regenerate assets/layers.sh from the registry, then check
 *
 * ── WHY ────────────────────────────────────────────────────────────────────────────────────────────────
 *
 * The registry (nx-tools/src/layers/*.ts) is the single source of truth for what layers exist. Two readers
 * cannot load it — scaffold.sh's outer shell, which validates --ensure before anything is installed, and the
 * SessionStart hook, which must stay a few greps — so they read `assets/layers.sh`, a GENERATED projection.
 * A generated file that can drift is a second source of truth with extra steps; this is what stops it
 * drifting: the check regenerates the projection from the compiled registry and fails on any difference.
 *
 * It also pins the behaviour the projection and the planner promise, against fixture workspaces:
 *   - detection (incl. the regressions this effort fixed: tooling projects no longer read as `js`, HOUSE.md
 *     alone no longer reads as `agent`);
 *   - the plan (which generators run, in which order, with which arguments);
 *   - EVIDENCE PARITY: the bash evaluator inside layers.sh, run against the same fixture written to disk,
 *     never reports a layer the registry does not (it may under-report — that is its documented direction).
 *
 * Like the migration tests it compiles the payload the way the publisher does and tests the RESULT.
 * Needs `yarn install`.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const ASSETS = join(REPO, 'plugins/project-starter/skills/new-project/assets');
const PAYLOAD = join(ASSETS, 'nx-tools');
const PROJECTION = join(ASSETS, 'layers.sh');
const BUILD = join(REPO, 'node_modules/.cache/bespunky-layer-tests');
const write = process.argv.includes('--write');

for (const pkg of ['@nx/devkit', 'typescript', 'nx']) {
  if (!existsSync(join(REPO, 'node_modules', pkg))) {
    console.error(`Layer tests need the workspace installed (${pkg} is missing): yarn install`);
    process.exit(2);
  }
}

rmSync(BUILD, { recursive: true, force: true });
mkdirSync(BUILD, { recursive: true });
cpSync(join(PAYLOAD, 'src'), join(BUILD, 'src'), { recursive: true });
execFileSync(process.execPath, [join(ASSETS, 'compile-generators.mts'), BUILD], { cwd: REPO, stdio: ['ignore', 'ignore', 'inherit'] });

const require_ = createRequire(join(REPO, 'noop.js'));
const registry = require_(join(BUILD, 'src/layers/registry'));
const { plan } = require_(join(BUILD, 'src/layers/plan'));
const { shellProjection } = require_(join(BUILD, 'src/layers/cli'));
const { createTreeWithEmptyWorkspace } = require_('@nx/devkit/testing');
const { addProjectConfiguration, writeJson } = require_('@nx/devkit');

let failed = 0;
let passed = 0;
const check = (name, fn) => {
  const problems = [];
  try {
    fn((cond, msg) => cond || problems.push(msg));
  } catch (error) {
    problems.push(`threw: ${error.stack || error.message}`);
  }
  if (problems.length) {
    failed++;
    console.log(`  FAIL ${name}`);
    for (const p of problems) console.log(`         ${p}`);
  } else {
    passed++;
    console.log(`  ok   ${name}`);
  }
};

// ── the projection ─────────────────────────────────────────────────────────────────────────────────────────
console.log('projection');
const projection = shellProjection();
if (write) writeFileSync(PROJECTION, projection);
check('assets/layers.sh matches the registry (regenerate: --write)', (ok) =>
  ok(existsSync(PROJECTION) && readFileSync(PROJECTION, 'utf8') === projection, 'layers.sh is stale or missing'),
);
check('assets/layers.sh parses and defines the registered ids', (ok) => {
  const out = execFileSync('bash', ['-c', `set -eu; . "$1"; printf '%s|%s|%s' "$HOUSE_LAYERS" "$HOUSE_LAYER_FLOOR" "$(house_layer_ensurable_scaffold web)"`, '_', PROJECTION]).toString();
  ok(out === `${registry.LAYERS.map((l) => l.id).join(',')}|nx|via:angular`, `got ${out}`);
});

// ── fixtures ───────────────────────────────────────────────────────────────────────────────────────────────
const tooling = (tree, name, extra = {}) =>
  addProjectConfiguration(tree, name, {
    root: `tools/${name}`,
    tags: ['tooling'],
    targets: { up: { executor: 'nx:run-commands', options: { command: 'true' } } },
    ...extra,
  });

const FIXTURES = {
  'bare nx workspace': () => createTreeWithEmptyWorkspace(),
  'legacy tooling projects declaring projectType library': () => {
    const tree = createTreeWithEmptyWorkspace();
    tooling(tree, 'shared-browser', { projectType: 'library' });
    tooling(tree, 'worktree-domains', { projectType: 'library' });
    return tree;
  },
  'HOUSE.md only (the floor stamp, no agent tooling)': () => {
    const tree = createTreeWithEmptyWorkspace();
    tree.write('HOUSE.md', '# house\n');
    return tree;
  },
  'agent project with voice remembered': () => {
    const tree = createTreeWithEmptyWorkspace();
    tree.write('HOUSE.md', '# house\n');
    writeJson(tree, '.devcontainer/.bespunky-devcontainer.json', { owned: true, voice: true });
    return tree;
  },
  'angular web app with firebase and a design system': () => {
    const tree = createTreeWithEmptyWorkspace();
    writeJson(tree, 'package.json', { name: 'shop', devDependencies: { '@nx/angular': '23.1.0', '@nx/js': '23.1.0' } });
    writeJson(tree, '.devcontainer/.bespunky-devcontainer.json', { owned: true });
    tree.write('firebase.json', '{}');
    addProjectConfiguration(tree, 'shop', {
      root: 'apps/shop',
      projectType: 'application',
      targets: { build: { executor: '@angular/build:application' }, 'dev-server': { executor: '@angular/build:dev-server' } },
    });
    addProjectConfiguration(tree, 'design-system', { root: 'packages/design-system', projectType: 'library', tags: ['type:design-system'] });
    return tree;
  },
  'python service with its own serve target, no agent': () => {
    const tree = createTreeWithEmptyWorkspace();
    addProjectConfiguration(tree, 'api', {
      root: 'services/api',
      projectType: 'library',
      targets: { serve: { executor: 'nx:run-commands', options: { command: 'uvicorn app:api' } } },
    });
    return tree;
  },
};

const EXPECTED_DETECTION = {
  'bare nx workspace': 'nx',
  'legacy tooling projects declaring projectType library': 'nx',
  'HOUSE.md only (the floor stamp, no agent tooling)': 'nx',
  'agent project with voice remembered': 'nx,agent',
  'angular web app with firebase and a design system': 'nx,agent,js,web,angular,design-system,firebase',
  'python service with its own serve target, no agent': 'nx,web',
};

console.log('\ndetection');
for (const [name, make] of Object.entries(FIXTURES)) {
  check(name, (ok) => {
    const got = registry.detectLayers(make()).join(',');
    ok(got === EXPECTED_DETECTION[name], `detected ${got}, expected ${EXPECTED_DETECTION[name]}`);
  });
}

// ── evidence parity: the bash evaluator never claims more than the registry ───────────────────────────────
console.log('\nevidence parity (layers.sh evaluator vs the registry)');
const flush = (tree) => {
  const dir = mkdtempSync(join(tmpdir(), 'layers-'));
  const walk = (path) => {
    for (const child of tree.children(path)) {
      const full = path === '.' ? child : `${path}/${child}`;
      if (tree.isFile(full)) {
        mkdirSync(dirname(join(dir, full)), { recursive: true });
        writeFileSync(join(dir, full), tree.read(full));
      } else walk(full);
    }
  };
  walk('.');
  return dir;
};
for (const [name, make] of Object.entries(FIXTURES)) {
  check(name, (ok) => {
    const tree = make();
    const dir = flush(tree);
    try {
      const shell = execFileSync('bash', ['-c', '. "$1"; house_layers_evident "$2"', '_', PROJECTION, dir]).toString().trim();
      const exact = new Set(registry.detectLayers(tree));
      const extra = shell.split(',').filter((id) => id && !exact.has(id));
      ok(extra.length === 0, `the shell evaluator over-reports: ${extra.join(',')} (shell=${shell})`);
      // And it is not vacuous: on these fixtures every layer is visible to grep, so the two agree exactly.
      // (A layer known only through a `detect` refinement would legitimately be missing here.)
      ok(shell === [...exact].join(','), `the shell evaluator saw ${shell}, the registry ${[...exact].join(',')}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

// ── the plan ───────────────────────────────────────────────────────────────────────────────────────────────
console.log('\nplan');
const STAMP = { nxToolsVersion: '9.9.9', pluginVersion: '1.0.0', packageManager: 'yarn' };
const ctxFor = (tree, overrides = {}) => {
  const detected = registry.detectLayers(tree);
  const ensured = overrides.ensured ?? [];
  return {
    tree,
    mode: 'sync',
    active: new Set([...detected, ...ensured]),
    ensured: new Set(ensured),
    project: 'shop',
    app: 'shop',
    nodeMajor: '22',
    voice: false,
    staging: false,
    ...overrides,
    ...(overrides.ensured ? { ensured: new Set(ensured), active: new Set([...detected, ...ensured]) } : {}),
  };
};
const render = (lines) =>
  lines.map((l) => (l.kind === 'gen' ? `${l.generator} ${l.args.join(' ')}`.trim() : l.kind === 'warn' ? 'WARN' : 'PARTIAL'));

check('bare repo, --ensure=agent: the agent trio, then the stamp — nothing else', (ok) => {
  const got = render(plan(ctxFor(FIXTURES['bare nx workspace'](), { ensured: ['nx', 'agent'] }), STAMP));
  const want = [
    'devcontainer --name=shop --nodeMajor=22 --web=false --angular=false --firebase=false',
    'claude-settings',
    'window-identity --name=shop',
    'house-doc --nxToolsVersion=9.9.9 --pluginVersion=1.0.0 --packageManager=yarn --layers=nx,agent',
  ];
  ok(JSON.stringify(got) === JSON.stringify(want), `got\n           ${got.join('\n           ')}`);
});
check('a plain sync on a bare repo runs only the stamp (everything above the floor is opt-in)', (ok) => {
  const got = render(plan(ctxFor(FIXTURES['HOUSE.md only (the floor stamp, no agent tooling)']()), STAMP));
  ok(got.length === 1 && got[0].startsWith('house-doc ') && got[0].endsWith('--layers=nx'), `got ${got.join(' | ')}`);
});
check('voice is carried forward from the devcontainer marker', (ok) => {
  const got = render(plan(ctxFor(FIXTURES['agent project with voice remembered']()), STAMP));
  ok(got[0].endsWith('--voice=true'), `got ${got[0]}`);
});
check('full house sync: per-app steps first, then workspace steps in registry order, stamp last', (ok) => {
  const got = render(plan(ctxFor(FIXTURES['angular web app with firebase and a design system'](), { ensured: ['nx', 'firebase'], staging: true }), STAMP));
  const order = got.map((l) => l.split(' ')[0]);
  const want = ['serve', 'serve-options', 'firebase-emulators', 'devcontainer', 'claude-settings', 'window-identity', 'playwright', 'shared-browser', 'worktree-domains', 'angular-ai', 'design-system', 'house-doc'];
  ok(JSON.stringify(order) === JSON.stringify(want), `order ${order.join(',')}`);
  ok(got.includes('firebase-emulators --project=shop --workspaceName=shop --staging=true --wireProviders'), 'firebase args');
  ok(got.includes('serve --project=shop'), 'serve gets no --wireProviders on a detect-only web');
  ok(got.includes('design-system --scope=shop'), 'design-system gets no --wireProviders on a detect-only sync');
  ok(got[3].includes('--web=true --angular=true --firebase=true'), `devcontainer flags: ${got[3]}`);
});
check('scaffold mode runs no per-app steps (the app generator composes them)', (ok) => {
  const got = render(plan(ctxFor(FIXTURES['angular web app with firebase and a design system'](), { mode: 'scaffold' }), STAMP));
  ok(!got.some((l) => /^(serve|serve-options|firebase-emulators) /.test(l)), `got ${got.join(' | ')}`);
});
check('web without agent: web generators skipped, reported, sync marked partial', (ok) => {
  const got = render(plan(ctxFor(FIXTURES['python service with its own serve target, no agent'](), { app: 'api' }), STAMP));
  ok(got[0] === 'WARN' && got[1] === 'PARTIAL', `got ${got.join(' | ')}`);
  ok(!got.some((l) => /^(serve|playwright|shared-browser) /.test(l)), 'no web generator ran');
});
check('app missing: per-app steps skipped and reported partial, workspace steps still run', (ok) => {
  const got = render(plan(ctxFor(FIXTURES['angular web app with firebase and a design system'](), { app: 'nope' }), STAMP));
  ok(got.filter((l) => l === 'PARTIAL').length === 3, `got ${got.join(' | ')}`);
  ok(got.includes('playwright'), 'workspace web steps still run');
});
check('an unknown layer id is refused, not ignored', (ok) => {
  let threw = false;
  try {
    registry.layer('reactt');
  } catch {
    threw = true;
  }
  ok(threw, 'layer("reactt") did not throw');
});

// ── migrations.json: every rung names a registered layer scope ─────────────────────────────────────────────
console.log('\nmigration scopes');
check('every migrations.json entry declares a registered `layer`', (ok) => {
  const { generators } = JSON.parse(readFileSync(join(PAYLOAD, 'migrations.json'), 'utf8'));
  const ids = new Set(registry.LAYERS.map((l) => l.id));
  for (const [name, entry] of Object.entries(generators)) ok(ids.has(entry.layer), `${name}: layer ${entry.layer}`);
});

rmSync(BUILD, { recursive: true, force: true });
console.log(`\n${failed === 0 ? 'ok' : 'FAILED'}: ${passed} passed, ${failed} failed${write ? ' (layers.sh regenerated)' : ''}`);
process.exit(failed === 0 ? 0 : 1);
