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
import { cpSync, mkdirSync, rmSync, existsSync, readFileSync, readdirSync, writeFileSync, mkdtempSync } from 'node:fs';
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
check('assets/layers.sh matches the registry (regenerate: --write)', (ok) =>
  ok(existsSync(PROJECTION) && readFileSync(PROJECTION, 'utf8') === projection, 'layers.sh is stale or missing'),
);
check('assets/layers.sh parses and defines the registered ids', (ok) => {
  const out = execFileSync('bash', ['-c', `set -eu; . "$1"; printf '%s|%s|%s' "$HOUSE_LAYERS" "$HOUSE_LAYER_FLOOR" "$(house_layer_ensurable_scaffold web)"`, '_', PROJECTION]).toString();
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
  'python service with its own serve target, no agent': () => {
    const tree = createTreeWithEmptyWorkspace();
    tree.delete('package.json');
    addProjectConfiguration(tree, 'api', {
      root: 'services/api',
      projectType: 'library',
      targets: { serve: { executor: 'nx:run-commands', options: { command: 'uvicorn app:api' } } },
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
  'python service with its own serve target, no agent': 'nx,web',
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
    mode: 'sync',
    active: ordered([...detected, ...ensured]),
    ensured: new Set(ensured),
    project: 'shop',
    app: 'shop',
    nodeMajor: '22',
    voice: false,
    staging: false,
    ...overrides,
    ...(overrides.ensured ? { ensured: ordered(ensured), active: ordered([...detected, ...ensured]) } : {}),
  };
};
const render = (lines) =>
  lines.map((l) => (l.kind === 'gen' ? `${l.generator} ${l.args.join(' ')}`.trim() : l.kind === 'warn' ? 'WARN' : 'PARTIAL'));

check('bare repo, --ensure=agent: the agent trio, then the stamp — nothing else', (ok) => {
  const got = render(plan(ctxFor(FIXTURES['bare nx workspace'](), { ensured: ['nx', 'agent'] }), STAMP));
  const want = [
    'devcontainer --name=shop --nodeMajor=22 --layers=nx,agent,node',
    'claude-settings --layers=nx,agent,node',
    'window-identity --name=shop',
    'house-doc --nxToolsVersion=9.9.9 --pluginVersion=1.0.0 --packageManager=yarn --layers=nx,agent,node',
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
  const want = ['serve', 'serve-options', 'worktree-tab-label', 'design-system-styles', 'firebase-client', 'devcontainer', 'claude-settings', 'window-identity', 'playwright', 'port-claim', 'shared-browser', 'worktree-domains', 'dev', 'angular-ai', 'design-system', 'firebase-emulators', 'house-doc'];
  ok(JSON.stringify(order) === JSON.stringify(want), `order ${order.join(',')}`);
  ok(got.includes('serve --project=shop'), 'serve takes only the project');
  ok(got.includes('worktree-tab-label --project=shop'), 'the tab label gets no --wireProviders on a detect-only angular');
  ok(got.includes('design-system --scope=shop'), 'design-system gets no --wireProviders on a detect-only sync');
  // Phase 4: the Firebase CLIENT attaches per app (through the app's stack adapter), the neutral CORE is a
  // workspace step that runs after it and follows the client app.
  ok(got.includes('firebase-client --project=shop --workspaceName=shop --staging=true --wireProviders'), 'firebase client args');
  ok(got.includes('firebase-emulators --workspaceName=shop --staging=true --clientApp=shop'), 'firebase core args');
  const devcontainer = got.find((l) => l.startsWith('devcontainer ')) ?? '';
  ok(devcontainer.endsWith('--layers=nx,agent,node,js,web,angular,design-system,firebase'), `devcontainer layers: ${devcontainer}`);
});
check('scaffold mode runs no per-app steps (the app generator composes them)', (ok) => {
  const got = render(plan(ctxFor(FIXTURES['angular web app with firebase and a design system'](), { mode: 'scaffold' }), STAMP));
  ok(!got.some((l) => /^(serve|serve-options|firebase-client|design-system-styles) /.test(l)), `got ${got.join(' | ')}`);
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
check('declaration-only web (no Nx-served app): per-app Nx steps skipped quietly, the engine still written', (ok) => {
  const got = render(plan(ctxFor(FIXTURES['python repo with a hand-written dev declaration'](), { app: 'pyrepo' }), STAMP));
  ok(!got.includes('PARTIAL'), `a declaration-only project is not a partial sync: ${got.join(' | ')}`);
  ok(!got.some((l) => /^(serve|serve-options|playwright) /.test(l) || l === 'playwright'), `no Nx/JS step: ${got.join(' | ')}`);
  for (const step of ['port-claim', 'shared-browser', 'worktree-domains', 'dev']) ok(got.includes(step), `${step} runs`);
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
  await generator('devcontainer')(tree, { name: 'shop', nodeMajor: '22', layers, ...extra });
  await generator('claude-settings')(tree, { layers });
  await generator('house-doc')(tree, { layers, nxToolsVersion: '9.9.9', pluginVersion: '1.0.0', ...(extra.packageManager ? { packageManager: extra.packageManager } : {}) });
  const read = (path) => tree.read(path, 'utf8') ?? '';
  return {
    dc: parseJsonc(read('.devcontainer/devcontainer.json')),
    dcText: read('.devcontainer/devcontainer.json'),
    post: read('.devcontainer/post-create.sh'),
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
  ok(a.dc.image === 'mcr.microsoft.com/devcontainers/base:debian', `image ${a.dc.image}`);
  ok(a.dc.remoteUser === 'vscode', `remoteUser ${a.dc.remoteUser}`);
  ok(a.dc.features['ghcr.io/devcontainers/features/node:1']?.version === '22', 'the Node feature, pinned to the node major');
  ok(JSON.stringify(a.dc.overrideFeatureInstallOrder) === '["ghcr.io/devcontainers/features/node"]', 'Node installs first');
  ok(a.dc.mounts.some((m) => m.includes('target=/home/vscode/.claude')), 'the .claude mount follows the image user');
  ok(a.dc.mounts.some((m) => m.endsWith('/.nx/cache,type=volume')) && !a.dc.mounts.some((m) => m.endsWith('/.nx,type=volume')), 'Nx state on exact volumes, never over .nx/ (it holds the committed nxw.js)');
  ok(!a.dcText.includes('/home/node'), '/home/node hard-coded');
  ok(!/node_modules|CHOKIDAR|eslint|prettier|\.nx,type=volume|4200|xvfb|runArgs|forwardPorts/.test(a.dcText), 'a Node/web/Angular artifact leaked into the devcontainer');
  ok(a.dcText.startsWith('// BeSpunky-standard devcontainer.'), 'the ownership fingerprint (first line) is kept');
  ok(bashParses(a.post), 'post-create.sh does not parse');
  ok(!/xvfb|playwright install|PM_INSTALL|default-jdk|angular\/skills/.test(a.post), 'post-create carries a step for a layer this repo does not have');
  ok(a.post.includes('.nx/nxw.js') && a.post.includes('OS_PACKAGES="$OS_PACKAGES tmux"'), 'the wrapper install + the agent OS packages');
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
  ok(!a.house.includes('tools/dev/dev serve <app> --'), 'engine commands rendered where the Nx face exists');
  ok(/, and\n- the \*\*shared co-driven browser/.test(a.house), 'the serve list is one list (no blank line left by a removed block)');
});

checkAsync('a build-bringing layer on an nx-init repo (firebase, no create-nx-workspace .gitignore): dist is ignored, once', async (ok) => {
  const tree = FIXTURES['plain npm repo wearing firebase and a neutral design system']();
  tree.write('.gitignore', 'node_modules\n');
  await artifacts(tree, [...registry.detectLayers(tree), 'agent']);
  await generator('claude-settings')(tree, { layers: [...registry.detectLayers(tree), 'agent'] });
  const lines = (tree.read('.gitignore', 'utf8') ?? '').split('\n');
  ok(lines.filter((l) => l === 'dist').length === 1, `dist ignored exactly once: ${JSON.stringify(lines)}`);
  // A create-nx-workspace .gitignore already says `dist` — a house workspace must not gain a second entry.
  const cnw = FIXTURES['plain npm repo wearing firebase and a neutral design system']();
  cnw.write('.gitignore', '# compiled output\ndist\ntmp\n');
  await generator('claude-settings')(cnw, { layers: [...registry.detectLayers(cnw), 'agent'] });
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
  ok(a.dc.image === 'mcr.microsoft.com/devcontainers/typescript-node:22' && a.dc.remoteUser === 'node', `image ${a.dc.image}`);
  ok(!a.dc.features['ghcr.io/devcontainers/features/node:1'] && !a.dc.overrideFeatureInstallOrder, 'no Node feature on a Node image');
  ok(a.dc.mounts.some((m) => m.includes('node_modules,type=volume')) && a.dc.remoteEnv.CHOKIDAR_USEPOLLING === 'true', 'node artifacts');
  ok(!/xvfb|4200|runArgs/.test(a.dcText + a.post), 'web/Angular artifacts leaked');
  ok(bashParses(a.post) && a.post.includes('$PM_INSTALL'), 'post-create installs through the package manager');
  ok(a.house.includes('npx nx build <project>') && !a.house.includes('npm nx'), 'HOUSE.md renders `npx nx`, never `npm nx`');
  ok(a.house.includes('**Package manager**: npm'), 'the package manager is named');
});

checkAsync('full house shape (angular+firebase+design system, web): the 0.34 container, bespunky-angular enabled', async (ok) => {
  const tree = FIXTURES['angular web app with firebase and a design system']();
  tree.write('yarn.lock', '');
  const layers = registry.detectLayers(tree);
  const a = await artifacts(tree, layers);
  ok(a.dc.image === 'mcr.microsoft.com/devcontainers/typescript-node:22', `image ${a.dc.image}`);
  ok(JSON.stringify(a.dc.forwardPorts) === '[80,4200,4000,9099,8080,9150,9199,5001]', `forwardPorts ${JSON.stringify(a.dc.forwardPorts)}`);
  ok(a.dc.portsAttributes['4200'].label === 'Angular Dev Server', '4200 label');
  ok(a.dc.portsAttributes['6080'].requireLocalPort === true && a.dc.portsAttributes['6119'], 'the noVNC band');
  for (const ext of ['nrwl.angular-console', 'Angular.ng-template', 'toba.vsfire', 'dbaeumer.vscode-eslint', 'formulahendry.auto-rename-tag']) {
    ok(a.dc.customizations.vscode.extensions.includes(ext), `extension ${ext}`);
  }
  ok(a.dc.runArgs.includes('--sysctl') && a.dc.containerEnv.BESPUNKY_DEVCONTAINER_ID, 'web run args + container env');
  ok(a.dc.mounts.length === 7, `mounts ${a.dc.mounts.length}`);
  ok(bashParses(a.post), 'post-create.sh does not parse');
  for (const piece of ['xvfb', 'default-jdk-headless', 'angular/skills', 'playwright install --with-deps', 'zz-firebase-welcome', '/var/opt/bespunky/ports']) {
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
  ok(bashParses(first.post) && first.post.includes('espeak-ng'), 'voice step');
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

checkAsync('adopted devcontainer on its own image: only the active layers merged in, no remoteUser imposed, mounts follow its user', async (ok) => {
  const tree = wrapperRepo();
  tree.write('.devcontainer/devcontainer.json', '{\n  // Our Python image.\n  "image": "python:3.12",\n  "postCreateCommand": "pip install -r requirements.txt"\n}\n');
  const a = await artifacts(tree, ['nx', 'agent']);
  ok(a.dc.image === 'python:3.12' && a.dcText.includes('// Our Python image.'), 'the project image and its comment survive');
  ok(!('remoteUser' in a.dc), `a remoteUser was imposed on an image that may not have it: ${a.dc.remoteUser}`);
  ok(a.dc.mounts.some((m) => m.includes('target=/root/.claude')), `the .claude mount follows the image's user: ${a.dc.mounts}`);
  ok(a.dc.features['ghcr.io/devcontainers/features/node:1'], 'Node arrives as a feature (the house tooling needs it)');
  ok(!/node_modules|xvfb|4200|CHOKIDAR/.test(a.dcText), 'an inactive layer leaked into the adopted devcontainer');
  ok(a.dc.postCreateCommand === 'pip install -r requirements.txt' && tree.exists('.devcontainer/post-create.bespunky.sh'), 'their postCreate kept; house script beside it');
  const marker = JSON.parse(tree.read('.devcontainer/.bespunky-devcontainer.json', 'utf8'));
  ok(marker.owned === false && marker.adopted.skipped.includes('image'), `adoption report: ${JSON.stringify(marker.adopted)}`);
});

checkAsync('post-create: web provisions the shared browser through its own runtime; @playwright/test is the js layer\'s', async (ok) => {
  const web = await artifacts(wrapperRepo(), ['nx', 'agent', 'web']);
  ok(web.post.includes('shared-browser" install --with-deps'), 'web: no `shared-browser install --with-deps`');
  ok(!web.post.includes('@playwright/test'), 'web (no js): still keyed on @playwright/test');
  ok(bashParses(web.post), 'web post-create does not parse');
  const tree = createTreeWithEmptyWorkspace();
  const both = await artifacts(tree, ['nx', 'agent', 'node', 'js', 'web']);
  ok(both.post.includes('"@playwright/test"') && both.post.includes('install --with-deps'), 'js+web: both pieces');
  ok(both.post.indexOf('reclaiming $HOME/.cache/ms-playwright') < both.post.indexOf('@playwright/test detected'), 'the cache volume is reclaimed before any install');
  ok(bashParses(both.post), 'js+web post-create does not parse');
});

// ── the dev-loop seams between units: stack adapters, the composer mirror, the TUI, the platform firewall ────
const ts_ = require_('typescript');
const angularShop = () => {
  const tree = createTreeWithEmptyWorkspace();
  writeJson(tree, 'package.json', { name: 'shop', devDependencies: { '@nx/angular': '23.1.0' } });
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
  ok(t.serve.executor === '@bespunky/nx-tools:serve', 'composer on `serve`');
  ok(JSON.stringify(t.serve.options) === JSON.stringify(t['dev-server'].options), 'composer options mirror the leaf');
  ok(JSON.stringify(t.serve.configurations) === JSON.stringify(t['dev-server'].configurations), 'composer configurations mirror the leaf');
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
  ok(t.serve.options.port === 5173 && !('buildTarget' in t.serve.options), `composer: ${JSON.stringify(t.serve)}`);
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
  ok(t.serve.options.proxyConfig === 'apps/shop/proxy.conf.mjs', 'the composer mirror carries it too');
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
  ok(/\n {24}},\n {24}\/\/ by platform:/.test(out), `not at the neighbours' indentation:\n${out}`);
  ok(/sourceTag: 'platform:server'[\s\S]*\n {24}}\n {20}\]/.test(out), `closing bracket not on its own line:\n${out}`);
  await generator('firebase-emulators')(tree, {});
  ok(tree.read('eslint.config.mjs', 'utf8') === out, 'a re-run changed eslint.config.mjs');
});

for (const run of pending) await run();

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
