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
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync, readFileSync, readdirSync, writeFileSync, mkdtempSync } from 'node:fs';
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
  ok(got.includes('firebase-emulators --workspaceName=shop --staging=true --clientApp=shop --seedRules'), 'firebase core args (ensured: seeds rules)');
  // Seeding rules is a baseline act: an upgrade that merely DETECTS firebase never seeds (the console may hold the live rules).
  const detected = render(plan(ctxFor(FIXTURES['angular web app with firebase and a design system'](), { ensured: ['nx'] }), STAMP));
  ok(detected.some((l) => l.startsWith('firebase-emulators ') && !l.includes('--seedRules')), `a detect-only sync seeds no rules: ${detected.find((l) => l.startsWith('firebase-emulators '))}`);
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
  ok(a.dc.features['ghcr.io/devcontainers/features/node:1']?.version === '22', 'the Node feature, pinned to the node major');
  ok(JSON.stringify(a.dc.overrideFeatureInstallOrder) === '["ghcr.io/devcontainers/features/node"]', 'Node installs first');
  ok(a.dc.mounts.some((m) => m.includes('target=/home/vscode/.claude')), 'the .claude mount follows the image user');
  ok(a.dc.mounts.some((m) => m.endsWith('/.nx/cache,type=volume')) && !a.dc.mounts.some((m) => m.endsWith('/.nx,type=volume')), 'Nx state on exact volumes, never over .nx/ (it holds the committed nxw.js)');
  ok(!a.dcText.includes('/home/node'), '/home/node hard-coded');
  ok(!/node_modules|CHOKIDAR|eslint|prettier|\.nx,type=volume|4200|tigervnc|runArgs|forwardPorts/.test(a.dcText), 'a Node/web/Angular artifact leaked into the devcontainer');
  ok(a.dcText.startsWith('// BeSpunky-standard devcontainer.'), 'the ownership fingerprint (first line) is kept');
  ok(bashParses(a.post), 'post-create.sh does not parse');
  ok(!/tigervnc|playwright install|PM_INSTALL|default-jdk|angular\/skills/.test(a.post + a.osScript), 'post-create or the package list carries a step for a layer this repo does not have');
  ok(a.post.includes('.nx/nxw.js') && /^tmux$/m.test(a.osScript) && /^curl$/m.test(a.osScript), 'the wrapper install + the agent OS packages');
  // No layer here declares an apt repository: no empty HOUSE_REPOSITORIES list, no installer looping over nothing.
  ok(!/HOUSE_REPOSITORIES|repositories\(\)|\{\{/.test(a.osScript) && shParses(a.osScript), 'the repository machinery (or a placeholder) rendered with no repository to add');
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
  // One deliberate exception: a SECOND stack of the same app in the same tree is the engine's (Nx shares one
  // `<app>:serve` per workspace), and *Running stacks* says so. Everywhere else the Nx face is the command.
  const outsideStacks = a.house.replace(/### Running stacks[\s\S]*?(?=\n### |\n## )/, '');
  ok(a.house.includes('### Running stacks') && a.house.includes('tools/dev/dev serve <app> --port-offset=auto`. A second `yarn nx serve <app>`'), 'the second-stack exception is documented, with the Nx face named');
  ok(!outsideStacks.includes('tools/dev/dev serve <app> --'), 'engine commands rendered where the Nx face exists');
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
  ok(!a.dc.features['ghcr.io/devcontainers/features/node:1'] && !a.dc.overrideFeatureInstallOrder, 'no Node feature on a Node image');
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

checkAsync('HOUSE.rules.md: the stack-agnostic directives render in a repo with NO ui layer (none hides inside a layer gate)', async (ok) => {
  const a = await artifacts(createTreeWithEmptyWorkspace(), ['nx', 'agent']);
  for (const heading of ['## Architect mentality', '## Architecture-first (non-negotiable)', '## Finish the whole job — verified where it runs (non-negotiable)', '## A feature is a package (non-negotiable)']) {
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
  const quoted = runInstaller(renderOsPackagesScript(c.osPackages), { projectList: '' });
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
  ok(!/(^| )libnss3( |$)/m.test(f.osScript), 'a foreign image got the Debian 13 Chromium names (one wrong name fails the whole apt transaction)');
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
  ok(a.dc.features['ghcr.io/devcontainers/features/node:1'], 'Node arrives as a feature (the house tooling needs it)');
  ok(!/node_modules|tigervnc|4200|CHOKIDAR/.test(a.dcText), 'an inactive layer leaked into the adopted devcontainer');
  ok(a.dc.postCreateCommand === 'pip install -r requirements.txt' && tree.exists('.devcontainer/post-create.bespunky.sh'), 'their postCreate kept; house script beside it');
  const marker = JSON.parse(tree.read('.devcontainer/.bespunky-devcontainer.json', 'utf8'));
  ok(marker.owned === false && marker.adopted.skipped.includes('build'), `adoption report: ${JSON.stringify(marker.adopted)}`);
});

checkAsync('adopted devcontainer: the house RECORDS what it added, keeps it across runs, and drops what the project changed', async (ok) => {
  const prov = require_(join(BUILD, 'src/generators/_utils/devcontainer-provenance'));
  const DC = '.devcontainer/devcontainer.json';
  const MARKER = '.devcontainer/.bespunky-devcontainer.json';
  const GH = 'ghcr.io/devcontainers/features/github-cli';
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
  ok((both.osScript.match(/(^| )libnss3( |$)/gm) ?? []).length === 1, 'js+web: Chromium\'s libraries listed twice (the composer must de-duplicate)');
  const js = await artifacts(createTreeWithEmptyWorkspace(), ['nx', 'agent', 'node', 'js']);
  ok(/(^| )libnss3( |$)/m.test(js.osScript), 'js (no web): @playwright/test\'s Chromium libraries are not image packages');
  const { PLAYWRIGHT_VERSION } = require_(join(BUILD, 'src/generators/_utils/versions'));
  const { CHROMIUM_OS_PACKAGES_VERSION } = require_(join(BUILD, 'src/generators/_utils/playwright-deps'));
  ok(CHROMIUM_OS_PACKAGES_VERSION === PLAYWRIGHT_VERSION, `Chromium's OS packages were projected from playwright-core@${CHROMIUM_OS_PACKAGES_VERSION}, the pin is ${PLAYWRIGHT_VERSION} — run: node tools/playwright-deps/project.mjs --write`);
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

// The Firebase CLI is the PROJECT's pinned devDependency (0.50.0), not an image feature: no second `firebase` on PATH,
// and nothing new to persist — firebase-tools keeps its login in ~/.config/configstore (configstore's XDG home) and its
// emulator downloads in ~/.cache/firebase, both inside the agent layer's persisted volumes asserted above. gcloud keeps
// its logins and application-default credentials in ~/.config/gcloud (googlecloudsdk/core/config.py) — persisted too.
checkAsync('firebase: the CLI comes from node_modules/.bin, gcloud is a pinned image package — no unpinned features; their state lives in the persisted XDG homes', async (ok) => {
  const tree = createTreeWithEmptyWorkspace();
  writeJson(tree, 'firebase.json', {});
  const a = await artifacts(tree, ['nx', 'agent', 'node', 'firebase']);
  const features = Object.keys(a.dc.features ?? {});
  ok(!features.some((id) => id.includes('firebase-cli')), `the image still installs a Firebase CLI of its own: ${features}`);
  // gcloud: a PINNED image package from Google's apt repository (signed-by keyring), never the unpinned feature.
  const { GCLOUD_CLI_VERSION } = require_(join(BUILD, 'src/generators/_utils/versions'));
  ok(!features.some((id) => id.includes('gcloud')), `gcloud still comes from a feature: ${features}`);
  ok(a.osScript.includes(`google-cloud-cli=${GCLOUD_CLI_VERSION}`), 'gcloud is not a pinned image package');
  ok(a.osScript.includes('google-cloud-sdk https://packages.cloud.google.com/apt/doc/apt-key.gpg https://packages.cloud.google.com/apt cloud-sdk main'), 'Google\'s apt repository is not declared to the installer');
  ok(!a.osScript.includes('apt-key add'), 'the installer uses apt-key (gone from Debian 13)');
  ok(/^if ! repositories; then$/m.test(a.osScript) && !a.osScript.includes('{{') && shParses(a.osScript), 'with a repository, its installer is rendered (markers gone) and the script parses');
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
  ok(t.serve.executor === '@bespunky/nx-tools:follow-stack' && !t.serve.continuous, '`serve` is the follower — not continuous, so a dead stack fails `nx serve`');
  ok(JSON.stringify(t['dev-stack'].options) === JSON.stringify(t['dev-server'].options), 'composer options mirror the leaf');
  ok(JSON.stringify(t['dev-stack'].configurations) === JSON.stringify(t['dev-server'].configurations), 'composer configurations mirror the leaf');
  ok(JSON.stringify(Object.keys(t.serve.configurations ?? {})) === JSON.stringify(Object.keys(t['dev-server'].configurations ?? {})), '`serve` takes the same -c names');
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
  ok(/';\n\n\/\/ THE PLATFORM FIREWALL[\s\S]*\n\];\n\nexport default \[/.test(out), `the constraints, set apart above the export:\n${out}`);
  ok(/sourceTag: "\*",/.test(out) && !/sourceTag: 'platform:[a-z]+',\n {28}/.test(out), `the project's own constraints untouched:\n${out}`);
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
  const block = a.post.slice(start, a.post.indexOf('\nfi\n', start) + 4).replace(/^\s*\$PM_INSTALL\s*$/m, '');
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
