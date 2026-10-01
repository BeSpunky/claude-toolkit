// The stack-free dev engine (tools/dev/) — what a serve resolves to, before anything is spawned.
//
// WHAT THIS GUARDS.
//   - The offset rule. The main tree used to take offset 0 unconditionally, which made a second serve
//     destructive: both stacks claimed the base ports, and the second took them by tearing down the first. The
//     rule is "prefer the base ports, take them only when free". If that probe is ever dropped, the symptom is
//     not a test failure anywhere — it is someone's emulators dying again.
//   - The block is SIZED FROM THE DECLARATION. The Firebase suite (4000..9199) must still step by 6000 in nine
//     blocks — exactly the old hard-coded executor — while an app that declares one port gets small steps.
//   - Planning is pure and is what a dry run prints, so a dry run and a real run cannot disagree.
//
// The engine ships as .tpl files in the payload; this copies them into a temp tools/dev/ as .mjs — exactly
// what the `dev` generator writes — and imports them.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FILES = join(HERE, '../../plugins/project-starter/skills/new-project/assets/nx-tools/src/generators/dev/files');

let failed = 0;
const ok = (label, cond) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}`);
  if (!cond) failed = 1;
};
const throws = async (fn) => {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
};

// ── materialise the engine as a project would have it ─────────────────────────────────────────────────────
const repo = mkdtempSync(join(tmpdir(), 'dev-engine-'));
const engine = join(repo, 'tools', 'dev');
const copy = (from, to) => {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (entry.isDirectory()) copy(join(from, entry.name), join(to, entry.name));
    else cpSync(join(from, entry.name), join(to, entry.name.replace(/\.tpl$/, '')));
  }
};
copy(FILES, engine);
const load = (rel) => import(pathToFileURL(join(engine, rel)).href);
const { portBlock, blockForKey, resolvePortOffset } = await load('lib/ports.mjs');
const { validate, planApp, pickApp } = await load('lib/declaration.mjs');
const { parseArgs } = await load('dev.mjs');
const { parseWorktrees, worktreeSlug } = await load('lib/worktrees.mjs');

try {
  console.log('port blocks');
  const firebase = portBlock([4200, 4000, 4400, 4500, 5001, 8080, 9099, 9199]);
  ok('Firebase suite: step 6000 × 9 blocks (the old constants, unchanged)', firebase.step === 6000 && firebase.blocks === 9);
  const single = portBlock([4200]);
  ok('one declared port: step 1000, dozens of blocks', single.step === 1000 && single.blocks === 61);
  ok('no room for a block throws', await throws(() => portBlock([1000, 65000])));

  const free = async () => true;
  const busy = (...ports) => async (p) => !ports.includes(p);
  const base = { key: 'k', isMain: false, probed: [4200], block: firebase, probe: free };
  ok("'' and '0' → base stack", (await resolvePortOffset('', base)) === 0 && (await resolvePortOffset('0', base)) === 0);
  ok('a pinned integer is honoured', (await resolvePortOffset('12000', base)) === 12000 && (await resolvePortOffset(12000, base)) === 12000);
  ok('a bad spec throws rather than guessing', await throws(() => resolvePortOffset('nonsense', base)));
  ok('a pin past 65535 throws', await throws(() => resolvePortOffset('60000', base)));
  ok('auto + main + base free → 0', (await resolvePortOffset('auto', { ...base, isMain: true })) === 0);
  const shifted = await resolvePortOffset('auto', { ...base, isMain: true, probe: busy(4200) });
  ok('auto + main + base BUSY → shifts onto a real block (THE regression guard)', shifted > 0 && shifted % 6000 === 0);
  const a = await resolvePortOffset('auto', { ...base, key: 'tree-a' });
  ok('auto + worktree is stable and is its key block', a === blockForKey('tree-a', 9) * 6000 && a === (await resolvePortOffset('auto', { ...base, key: 'tree-a' })));
  const natural = blockForKey('tree-b', 9) * 6000;
  ok('a busy block walks to the next', (await resolvePortOffset('auto', { ...base, key: 'tree-b', probe: busy(4200 + natural) })) !== natural);
  ok('nothing free throws, never collides', await throws(() => resolvePortOffset('auto', { ...base, probe: async () => false })));
  ok('main + nothing free throws, never falls back to 0', await throws(() => resolvePortOffset('auto', { ...base, isMain: true, probe: async () => false })));

  console.log('declaration');
  const decl = validate({
    install: { cmd: ['yarn', 'install'], creates: 'node_modules' },
    apps: {
      web: {
        processes: [
          { id: 'app', cmd: ['nx', 'run', 'web:dev-server', '--port=${PORT:app}'], ports: { app: 4200 }, env: { NX_WORKSPACE_ROOT_PATH: '${TREE}' }, primary: true },
          {
            id: 'emulators',
            cmd: ['nx', 'run', 'firebase:emulators'],
            ports: { ui: 4000, auth: 9099 },
            url: [{ param: 'portOffset', value: '${OFFSET}', when: 'offset' }, { param: 'emulate', value: 'none', when: 'skipped' }],
            advice: [{ when: 'contended', text: 'oauth' }],
          },
        ],
      },
      site: { processes: [{ id: 'app', cmd: 'python3 -m http.server ${PORT:app}', ports: { app: 8000 } }] },
    },
  });
  const p0 = planApp(decl, 'web', { offset: 0, tree: '/t' });
  ok('base: cmd substituted, URL clean', p0.primary.display === 'nx run web:dev-server --port=4200' && p0.localUrl === 'http://localhost:4200/');
  ok('env: declared + PORT_<NAME>, no bare PORT, no PORT_OFFSET at base', p0.primary.added.NX_WORKSPACE_ROOT_PATH === '/t' && p0.primary.added.PORT_APP === '4200' && !('PORT' in p0.primary.added) && p0.primary.added.PORT_AUTH === '9099' && !('PORT_OFFSET' in p0.primary.added));
  const p6 = planApp(decl, 'web', { offset: 6000, tree: '/t', passthrough: ['--buildTarget=web:build:production'] });
  ok('shifted: every port moves, ?portOffset added, PORT_OFFSET exported', p6.primaryPort === 10200 && p6.processes[1].ports.auth === 15099 && p6.localUrl === 'http://localhost:10200/?portOffset=6000' && p6.primary.added.PORT_OFFSET === '6000');
  ok('passthrough lands on the primary only', p6.primary.args.at(-1) === '--buildTarget=web:build:production' && !p6.processes[1].args.includes('--buildTarget=web:build:production'));
  const pSkip = planApp(decl, 'web', { offset: 6000, tree: '/t', skip: ['emulators', 'nope'] });
  ok('skipped: not run, ?emulate=none, ?portOffset kept (as 0.34.x did)', pSkip.running.length === 1 && pSkip.localUrl.endsWith('?portOffset=6000&emulate=none'));
  ok('an unknown --skip is reported, not fatal', pSkip.ignoredSkips.join() === 'nope');
  ok('skipping the primary throws', await throws(() => planApp(decl, 'web', { offset: 0, tree: '/t', skip: ['app'] })));
  const py = planApp(decl, 'site', { offset: 1000, tree: '/t', passthrough: ['--bind', '0.0.0.0'] });
  ok('a string cmd runs through sh, passthrough shell-quoted', py.primary.shell && py.primary.command === 'python3 -m http.server 9000 --bind 0.0.0.0');
  ok('two apps → one must be named', await throws(() => pickApp(decl)) && pickApp(decl, 'site') === 'site');
  ok('an unknown ${PORT:x} throws', await throws(() => planApp(validate({ apps: { a: { processes: [{ id: 'x', cmd: 'run ${PORT:nope}', ports: { a: 1 } }] } } }), 'a', { offset: 0, tree: '/' })));
  ok('duplicate port names are refused', await throws(() => validate({ apps: { a: { processes: [{ id: 'x', cmd: 'a', ports: { p: 1 } }, { id: 'y', cmd: 'b', ports: { p: 2 } }] } } })));
  ok('an app with no port is refused', await throws(() => validate({ apps: { a: { processes: [{ id: 'x', cmd: 'a' }] } } })));
  ok('two primaries are refused', await throws(() => validate({ apps: { a: { processes: [{ id: 'x', cmd: 'a', ports: { p: 1 }, primary: true }, { id: 'y', cmd: 'b', ports: { q: 2 }, primary: true }] } } })));

  console.log('argv + worktrees');
  const args = parseArgs(['serve', 'web', '--worktree=feat/x', '--port-offset=auto', '--skip=emulators,ui', '--no-shared-browser', '--dry-run', '--', '--hmr']);
  ok('flags parse', args.app === 'web' && args.worktree === 'feat/x' && args.skip.join() === 'emulators,ui' && !args.sharedBrowser && args.dryRun && args.passthrough.join() === '--hmr');
  ok('bare --worktree means "pick"', parseArgs(['serve', '--worktree']).worktree === '');
  ok('an unknown flag is refused', await throws(() => parseArgs(['serve', '--portOffset=1'])));
  const trees = parseWorktrees('worktree /r\nHEAD a\nbranch refs/heads/main\n\nworktree /r/.claude/worktrees/x\nHEAD b\nbranch refs/heads/feat/x\n\n', '/r/.claude/worktrees/x');
  ok('porcelain: main first, current flagged', trees[0].isMain && trees[1].isCurrent && worktreeSlug(trees[1], 'r') === 'feat-x' && worktreeSlug(trees[0], 'My Repo') === 'my-repo');

  console.log('end to end (dry run, a non-JS repo)');
  writeFileSync(join(repo, 'main.py'), 'print(1)\n');
  mkdirSync(join(repo, '.bespunky'));
  writeFileSync(join(repo, '.bespunky', 'dev.json'), JSON.stringify({ apps: { site: { processes: [{ id: 'app', cmd: 'python3 -m http.server ${PORT:app}', ports: { app: 8000 } }] } } }));
  const out = execFileSync('sh', [join(engine, 'dev'), 'serve', '--dry-run', '--no-shared-browser', '--port-offset=3000'], { cwd: repo, encoding: 'utf8' });
  ok('the shim runs the engine with no node_modules and no git', out.includes('python3 -m http.server 11000') && out.includes('http://localhost:11000/'));
} finally {
  rmSync(repo, { recursive: true, force: true });
}

process.exit(failed);
