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
//   - The SIGNAL RULE, on real processes. A stop aimed at the engine alone (`kill <pid>`, `timeout`, a
//     supervisor) used to be swallowed: the engine waited forever and every server kept listening. And the
//     terminal's Ctrl+C must still reach each child exactly ONCE — a second signal is what makes an emulator
//     suite "force quit" and skip its export. Each child here counts what it received.
//
// The engine ships as .tpl files in the payload; this copies them into a temp tools/dev/ as .mjs — exactly
// what the `dev` generator writes — and imports them.
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// A HUMAN runs these unless a case says otherwise: under an AI agent (CLAUDECODE=1 — which is what runs this suite
// in a Claude Code session) the engine never takes the base ports, and the base-port cases would mean nothing.
delete process.env.CLAUDECODE;

const HERE = dirname(fileURLToPath(import.meta.url));
const FILES = join(HERE, '../../plugins/house/engine/nx-tools/src/generators/dev/files');

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
const { portBlock, blockForKey, resolvePortOffset, isPortFree } = await load('lib/ports.mjs');
const { validate, planApp, pickApp } = await load('lib/declaration.mjs');
const { parseArgs } = await load('dev.mjs');
const { parseWorktrees, worktreeSlug } = await load('lib/worktrees.mjs');

try {
  console.log('port blocks');
  const firebase = portBlock([4200, 4000, 4400, 4500, 5001, 8080, 9099, 9199]);
  ok('Firebase suite: step 6000 × 9 blocks (the old constants, unchanged)', firebase.step === 6000 && firebase.blocks === 9);
  const single = portBlock([4200]);
  ok('one declared port: step 1000, dozens of blocks', single.step === 1000 && single.blocks === 61);
  // Ports declared high up leave no room to SHIFT — which only a shifted serve needs. The base stack must still serve.
  const high = portBlock([65000]);
  ok('no room for a block is not an error by itself (blocks = 0)', high.blocks === 0);
  const highBase = { key: 'k', isMain: false, probed: [65000], block: high, probe: async () => true };
  ok('…the base stack still serves (--port-offset=0)', (await resolvePortOffset('0', highBase)) === 0);
  ok('…the main tree still takes the free base ports on auto', (await resolvePortOffset('auto', { ...highBase, isMain: true })) === 0);
  ok('…and a serve that must SHIFT is refused plainly', await throws(() => resolvePortOffset('auto', highBase)));

  const free = async () => true;
  const busy = (...ports) => async (p) => !ports.includes(p);
  const base = { key: 'k', isMain: false, probed: [4200], block: firebase, probe: free };
  ok("'0' → base stack", (await resolvePortOffset('0', base)) === 0);
  ok("an EMPTY offset is refused, never read as the base stack", await throws(() => resolvePortOffset('', base)));
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
            // A generic url param: any name works — `shift` is an example, not a switch the house writes.
            url: [{ param: 'shift', value: '${OFFSET}', when: 'offset' }, { param: 'emulate', value: 'none', when: 'skipped' }],
            advice: [{ when: 'contended', text: 'oauth' }],
          },
        ],
      },
      site: { processes: [{ id: 'app', cmd: 'python3 -m http.server ${PORT:app}', ports: { app: 8000 } }] },
    },
  });
  const p0 = planApp(decl, 'web', { offset: 0, tree: '/t' });
  ok('base: cmd substituted, URL clean', p0.primary.display === 'nx run web:dev-server --port=4200' && p0.localUrl === 'http://localhost:4200/');
  ok('env: declared + PORT_<NAME>, no bare PORT, PORT_OFFSET=0 at base', p0.primary.added.NX_WORKSPACE_ROOT_PATH === '/t' && p0.primary.added.PORT_APP === '4200' && !('PORT' in p0.primary.added) && p0.primary.added.PORT_AUTH === '9099' && p0.primary.added.PORT_OFFSET === '0');
  // S3-16: a stack started from inside another stack's process (an outer serve, a worktree's) must not inherit its identity.
  const outer = { PORT_OFFSET: '6000', DEV_URL_QUERY: 'shift=6000', DEV_STACK_DIR: '/outer', DEV_STACK_TMP: '/tmp/outer', DEV_STACK_LOCK: '/outer.lock', KEEP: 'me' };
  const nested = planApp(decl, 'web', { offset: 0, tree: '/t', baseEnv: outer, stackDir: '/inner', stackTmp: '/tmp/inner', stackLock: '/inner.lock' });
  const ne = nested.primary.env;
  ok("a nested base stack gets its own PORT_OFFSET/DEV_STACK_*, and no outer DEV_URL_QUERY", ne.PORT_OFFSET === '0' && ne.DEV_STACK_DIR === '/inner' && ne.DEV_STACK_TMP === '/tmp/inner' && ne.DEV_STACK_LOCK === '/inner.lock' && !('DEV_URL_QUERY' in ne) && ne.KEEP === 'me');
  const bare = planApp(decl, 'web', { offset: 0, tree: '/t', baseEnv: outer }).primary.env;
  ok('…and a variable this stack does not set is removed, never left at the outer value', !('DEV_STACK_DIR' in bare) && !('DEV_STACK_TMP' in bare) && !('DEV_STACK_LOCK' in bare) && bare.PORT_OFFSET === '0');
  // S3-5: what a dependent (an e2e run) is told — the stack's address, never a guessed port.
  const withExports = validate({ apps: { w: { processes: [{ id: 'app', cmd: 'a', ports: { app: 4200 }, primary: true }, { id: 'emu', cmd: 'b', ports: { auth: 9099 }, exports: { FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:${PORT:auth}' } }] } } });
  const ex = planApp(withExports, 'w', { offset: 1000, tree: '/t' }).exports;
  ok('exports: BASE_URL, DEV_URL, PORT_OFFSET, PORT_<NAME> and the declared emulator host, all shifted', ex.BASE_URL === 'http://localhost:5200' && ex.DEV_URL === 'http://localhost:5200/' && ex.PORT_OFFSET === '1000' && ex.PORT_AUTH === '10099' && ex.FIREBASE_AUTH_EMULATOR_HOST === '127.0.0.1:10099');
  ok("…a skipped process's exports are not given", !('FIREBASE_AUTH_EMULATOR_HOST' in planApp(withExports, 'w', { offset: 0, tree: '/t', skip: ['emu'] }).exports));
  ok('a non-string export is refused', await throws(() => validate({ apps: { w: { processes: [{ id: 'a', cmd: 'a', ports: { a: 1 }, exports: { X: 1 } }] } } })));
  const p6 = planApp(decl, 'web', { offset: 6000, tree: '/t', passthrough: ['--buildTarget=web:build:production'] });
  ok('shifted: every port moves, the offset url param added, PORT_OFFSET exported', p6.primaryPort === 10200 && p6.processes[1].ports.auth === 15099 && p6.localUrl === 'http://localhost:10200/?shift=6000' && p6.primary.added.PORT_OFFSET === '6000');
  ok('passthrough lands on the primary only', p6.primary.args.at(-1) === '--buildTarget=web:build:production' && !p6.processes[1].args.includes('--buildTarget=web:build:production'));
  const pSkip = planApp(decl, 'web', { offset: 6000, tree: '/t', skip: ['emulators', 'nope'] });
  ok('skipped: not run, ?emulate=none, the offset url param kept', pSkip.running.length === 1 && pSkip.localUrl.endsWith('?shift=6000&emulate=none'));
  ok('an unknown --skip is reported, not fatal', pSkip.ignoredSkips.join() === 'nope');
  // R4-3: a server rendering the app resolves what the page was opened with — the same query, as DEV_URL_QUERY.
  ok('skipped: every process is told the URL switches (DEV_URL_QUERY)', pSkip.primary.added.DEV_URL_QUERY === 'shift=6000&emulate=none' && pSkip.primary.env.DEV_URL_QUERY === 'shift=6000&emulate=none');
  ok('no URL switches → no DEV_URL_QUERY', !('DEV_URL_QUERY' in p0.primary.added) && p6.primary.added.DEV_URL_QUERY === 'shift=6000');
  ok("a skipped process's advice is not given", pSkip.advice.length === 0 && p0.advice.some((a) => a.text === 'oauth'));
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
  ok('bare --worktree means "pick"', parseArgs(['serve', '--worktree']).worktree === '' && parseArgs(['serve', '--worktree', '--dry-run']).worktree === '');
  const spaced = parseArgs(['serve', '--worktree', 'feat/x', 'web']);
  ok('--worktree <x> (space form) takes x as the tree, not the app', spaced.worktree === 'feat/x' && spaced.app === 'web');
  ok('a bare --port-offset is refused, never silently 0', await throws(() => parseArgs(['serve', '--port-offset'])) && await throws(() => parseArgs(['serve', '--port-offset', '--dry-run'])));
  ok('--port-offset <n> (space form) parses', parseArgs(['serve', '--port-offset', '3000']).portOffset === '3000');
  ok('an unknown flag is refused', await throws(() => parseArgs(['serve', '--portOffset=1'])));
  const trees = parseWorktrees('worktree /r\nHEAD a\nbranch refs/heads/main\n\nworktree /r/.claude/worktrees/x\nHEAD b\nbranch refs/heads/feat/x\n\n', '/r/.claude/worktrees/x');
  ok('porcelain: main first, current flagged', trees[0].isMain && trees[1].isCurrent && worktreeSlug(trees[1], 'r') === 'feat-x' && worktreeSlug(trees[0], 'My Repo') === 'my-repo');

  console.log('end to end (dry run, a non-JS repo)');
  writeFileSync(join(repo, 'main.py'), 'print(1)\n');
  mkdirSync(join(repo, '.bespunky'));
  writeFileSync(join(repo, '.bespunky', 'dev.json'), JSON.stringify({ apps: { site: { processes: [{ id: 'app', cmd: 'python3 -m http.server ${PORT:app}', ports: { app: 8000 } }] } } }));
  const out = execFileSync('sh', [join(engine, 'dev'), 'serve', '--dry-run', '--no-shared-browser', '--port-offset=3000'], { cwd: repo, encoding: 'utf8' });
  ok('the shim runs the engine with no node_modules and no git', out.includes('python3 -m http.server 11000') && out.includes('http://localhost:11000/'));

  console.log('a workspace in a SUBDIRECTORY of its repository');
  // mono/ is the git root; the workspace (tools/dev, .bespunky) is mono/services/web. Every process, and the install,
  // must run in the WORKSPACE — and a symlinked spelling of the engine's path must still run it.
  const mono = mkdtempSync(join(tmpdir(), 'dev-mono-'));
  try {
    const ws = join(mono, 'services', 'web');
    copy(FILES, join(ws, 'tools', 'dev'));
    mkdirSync(join(ws, '.bespunky'));
    writeFileSync(join(ws, '.bespunky', 'dev.json'), JSON.stringify({ apps: { site: { processes: [{ id: 'app', cmd: 'node server.js ${PORT:app}', ports: { app: 8000 } }] } } }));
    const git = (...a) => execFileSync('git', a, { cwd: mono, stdio: 'ignore', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
    git('init', '-q', '-b', 'main');
    git('add', '-A');
    git('commit', '-qm', 'init');
    git('worktree', 'add', '-q', '-b', 'feat/sub', join(mono, '.wt', 'sub'));
    const dry = (cwd, ...extra) => execFileSync('sh', [join(cwd, 'tools', 'dev', 'dev'), 'serve', '--dry-run', '--no-shared-browser', '--port-offset=0', ...extra], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const here = dry(ws);
    ok('cwd is the workspace, not the git root', here.includes(`cwd        : ${ws}\n`));
    ok('the main tree is reached at the workspace name', here.includes('slug       : web.localhost'));
    const other = dry(ws, '--worktree=feat/sub');
    ok('another worktree serves from the SAME subdirectory inside it', other.includes(`cwd        : ${join(mono, '.wt', 'sub', 'services', 'web')}\n`) && !other.includes('has no'));
    symlinkSync(mono, `${mono}-link`);
    const viaLink = execFileSync('sh', [join(`${mono}-link`, 'services', 'web', 'tools', 'dev', 'dev'), 'serve', '--dry-run', '--no-shared-browser', '--port-offset=0'], { cwd: ws, encoding: 'utf8' });
    ok('invoked through a SYMLINKED path, the engine still runs (it printed the plan)', viaLink.includes('DRY RUN'));
  } finally {
    rmSync(`${mono}-link`, { force: true });
    rmSync(mono, { recursive: true, force: true });
  }

  console.log('the free-port probe');
  {
    const v6 = createServer();
    const v6port = await new Promise((res, rej) => { v6.once('error', rej); v6.listen(0, '::1', () => res(v6.address().port)); }).catch(() => null);
    if (v6port === null) console.log('  skip  no IPv6 loopback here');
    else ok('a server on ::1 (where `localhost` resolves first) reads as BUSY', (await isPortFree(v6port)) === false);
    v6.close();
    const v4 = createServer();
    const v4port = await new Promise((res) => v4.listen(0, '127.0.0.1', () => res(v4.address().port)));
    ok('a server on 127.0.0.1 reads as busy', (await isPortFree(v4port)) === false);
    v4.close();
    const any = createServer();
    const anyPort = await new Promise((res) => any.listen(0, () => res(any.address().port)));
    ok('a server on every interface reads as busy', (await isPortFree(anyPort)) === false);
    await new Promise((r) => any.close(r));
    ok('…and a released port reads as free', (await isPortFree(anyPort)) === true);
  }

  console.log('signals (real processes)');
  // A server that records every signal it receives, and shuts down (slowly, like an emulator export) on the first.
  writeFileSync(
    join(repo, 'server.mjs'),
    `import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
const [port, record] = process.argv.slice(2);
const got = [];
const server = createServer((_, res) => res.end('ok')).listen(Number(port), '127.0.0.1');
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => {
  got.push(sig);
  writeFileSync(record, got.join(','));
  if (got.length === 1) { server.close(); setTimeout(() => process.exit(0), 400); }
});
`,
  );
  const freePort = () => new Promise((res) => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });
  const listening = (port) => new Promise((res) => { const c = connect(port, '127.0.0.1'); c.on('connect', () => { c.destroy(); res(true); }); c.on('error', () => res(false)); });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const isAliveHere = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  const until = async (cond, ms) => { for (const end = Date.now() + ms; Date.now() < end; await sleep(50)) if (await cond()) return true; return cond(); };

  /** Serve `server.mjs` (as an argv or a `sh -c` child), deliver `stop`, report what the engine and child saw. */
  const scenario = async (label, { shell, stop }) => {
    const port = await freePort();
    const record = join(repo, `got-${port}`);
    const server = join(repo, 'server.mjs');
    const cmd = shell ? `node ${server} \${PORT:app} ${record}` : ['node', server, '${PORT:app}', record];
    writeFileSync(join(repo, '.bespunky', 'dev.json'), JSON.stringify({ apps: { site: { processes: [{ id: 'app', cmd, ports: { app: port } }] } } }));
    // Its own process group (detached), as a terminal job is — so "the group" below is exactly this serve.
    const eng = spawn('sh', [join(engine, 'dev'), 'serve', '--no-shared-browser', '--port-offset=0'], { cwd: repo, detached: true, stdio: 'ignore' });
    const exited = new Promise((res) => eng.on('exit', (code, signal) => res({ code, signal })));
    if (!(await until(() => listening(port), 10000))) {
      ok(`${label}: the server came up`, false);
      process.kill(-eng.pid, 'SIGKILL');
      return;
    }
    await stop(eng.pid);
    const result = await Promise.race([exited, sleep(5000).then(() => null)]);
    const got = existsSync(record) ? readFileSync(record, 'utf8') : '';
    const stillUp = await listening(port);
    try {
      process.kill(-eng.pid, 'SIGKILL'); // whatever a failing engine left behind — never leak a server
    } catch {
      /* the group is already empty */
    }
    return { result, got, stillUp };
  };

  for (const shell of [false, true]) {
    const kind = shell ? 'sh -c child' : 'argv child';
    const directed = await scenario(`SIGTERM to the engine alone (${kind})`, { shell, stop: (pid) => process.kill(pid, 'SIGTERM') });
    ok(`SIGTERM to the engine alone (${kind}): engine exits, child got ONE SIGTERM, nothing listening`, directed && directed.result && directed.got === 'SIGTERM' && !directed.stillUp);
  }
  const hup = await scenario('SIGHUP to the engine alone', { shell: false, stop: (pid) => process.kill(pid, 'SIGHUP') });
  ok('SIGHUP to the engine alone: child got ONE SIGTERM, nothing listening', hup && hup.result && hup.got === 'SIGTERM' && !hup.stillUp);
  const ctrlC = await scenario('Ctrl+C', { shell: false, stop: (pid) => process.kill(-pid, 'SIGINT') });
  ok('Ctrl+C (SIGINT to the group): child got exactly ONE SIGINT — nothing forwarded — engine exits 130 (interrupted)', ctrlC && ctrlC.result?.code === 130 && ctrlC.got === 'SIGINT' && !ctrlC.stillUp);
  const both = await scenario('Ctrl+C then a supervisor SIGTERM', {
    shell: false,
    stop: async (pid) => {
      process.kill(-pid, 'SIGINT');
      await sleep(50);
      process.kill(pid, 'SIGTERM');
    },
  });
  ok('Ctrl+C then SIGTERM to the engine: the second stop is absorbed — child saw only the SIGINT', both && both.result && both.got === 'SIGINT');
  // A child the OOM killer (or anything) SIGKILLs is a crash, not a stop: the engine must fail, or \`nx serve\`
  // reports success for a stack that died.
  const crashed = await scenario('the child is SIGKILLed', {
    shell: false,
    stop: (pid) => {
      const kids = execFileSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
      // the engine runs under the sh shim (exec'd), so its children are the servers
      for (const k of kids) process.kill(Number(k), 'SIGKILL');
    },
  });
  ok('a SIGKILLed child makes the engine exit NON-ZERO', crashed && crashed.result && crashed.result.code !== 0);

  console.log('stack handles: run records, ps, stop (real processes)');
  {
    const { boundPorts } = await load('lib/declaration.mjs');
    const two = { processes: [{ id: 'app', cmd: 'x', ports: { app: 4200 } }, { id: 'emulators', cmd: 'y', ports: { hub: 4400, ui: 4000 } }] };
    ok('the free-port probe covers EVERY port the stack binds, not only the primary', JSON.stringify(boundPorts(two)) === JSON.stringify([4200, 4400, 4000]));
    ok('…but not a --skip-ped process', JSON.stringify(boundPorts(two, ['emulators'])) === JSON.stringify([4200]));
    const held = await resolvePortOffset('auto', { key: 'k', isMain: true, probed: boundPorts(two), block: portBlock(boundPorts(two)), probe: busy(4400) });
    ok('the main tree does NOT take the base block when only the hub is held', held !== 0);

    const dev = (env, ...args) =>
      new Promise((res) => {
        const p = spawn('sh', [join(engine, 'dev'), ...args], { cwd: repo, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        p.stdout.on('data', (d) => (out += d));
        p.stderr.on('data', (d) => (out += d));
        p.on('exit', (code) => res({ code, out }));
      });
    const port = await freePort();
    const server = join(repo, 'server.mjs');
    writeFileSync(join(repo, '.bespunky', 'dev.json'), JSON.stringify({ apps: { site: { processes: [{ id: 'app', cmd: ['node', server, '${PORT:app}', join(repo, 'got-h')], ports: { app: port } }] } } }));
    const human = { DEV_OWNER: 'user:dev', CLAUDE_CODE_SESSION_ID: '' };
    const eng = spawn('sh', [join(engine, 'dev'), 'serve', 'site', '--no-shared-browser', '--port-offset=0'], { cwd: repo, detached: true, stdio: 'ignore', env: { ...process.env, ...human } });
    try {
      ok('the stack came up', await until(() => listening(port), 10000));
      const rec = JSON.parse(readFileSync(join(repo, '.bespunky', 'run', 'site@0.json'), 'utf8'));
      ok('the run record names the serve, its owner, its ports and its child', rec.pid === eng.pid && rec.owner === 'user:dev' && rec.ports.app === port && rec.processes.length === 1);
      // R3-2: a Functions worker listens on <TMPDIR>/fire_emu_<16 hex>.sock, and a socket path is cut at 107 bytes.
      ok(`the stack's TMPDIR is short whatever the tree (${rec.tmp}: ${rec.tmp.length} ≤ 60) and exists`, rec.tmp.length <= 60 && existsSync(rec.tmp));
      ok('…and is the stack\'s own (keyed by tree and stack)', /^\/tmp\/bespunky-[0-9a-f]{12}$/.test(rec.tmp));
      ok('.bespunky/run ignores itself', readFileSync(join(repo, '.bespunky', 'run', '.gitignore'), 'utf8').includes('*'));
      const ps = JSON.parse((await dev({}, 'ps', '--json')).out);
      ok('ps lists it as live and listening', ps.length === 1 && ps[0].state === 'live' && ps[0].portStates[0].listening === true);
      const twin = await dev(human, 'serve', '--no-shared-browser', '--port-offset=0');
      ok('the same stack twice is refused, naming the running one', twin.code !== 0 && twin.out.includes(`pid ${eng.pid}`));
      const other = await dev({ DEV_OWNER: 'claude:x' }, 'stop', '--offset=0');
      ok("another owner's stop is REFUSED (exit non-zero) and nothing is signalled", other.code !== 0 && /not yours/.test(other.out) && (await listening(port)));
      const mine = await dev(human, 'stop');
      ok('the owner stops it by handle: exit 0, ports confirmed free', mine.code === 0 && /ports free/.test(mine.out) && !(await listening(port)));
      ok('…the child got ONE SIGTERM (the graceful path)', readFileSync(join(repo, 'got-h'), 'utf8') === 'SIGTERM');
      ok('…and the record, state dir and TMPDIR are gone', !existsSync(join(repo, '.bespunky', 'run', 'site@0.json')) && !existsSync(join(repo, '.bespunky', 'run', 'site@0')) && !existsSync(rec.tmp));
      ok('…and the engine exited 0 (a clean stop)', await until(() => eng.exitCode !== null, 3000) && eng.exitCode === 0);
      // A record whose lock nobody holds is dead — whatever its PID now names (the kernel reuses PIDs: here, a live one).
      const deadLock = join(repo, '.bespunky', 'run', 'locks', 'gone.lock');
      writeFileSync(deadLock, '');
      writeFileSync(join(repo, '.bespunky', 'run', 'site@9000.json'), JSON.stringify({ ...rec, key: 'site@9000', offset: 9000, pid: process.pid, procStart: null, lock: deadLock, processes: [] }));
      const stale = JSON.parse((await dev({}, 'ps', '--json')).out);
      ok('a record whose lock is free is pruned (record and lock), whatever its PID names now', stale.length === 0 && !existsSync(join(repo, '.bespunky', 'run', 'site@9000.json')) && !existsSync(deadLock));
    } finally {
      try {
        process.kill(-eng.pid, 'SIGKILL');
      } catch {
        /* already down — the point of the test */
      }
    }
  }

  console.log('claims: one identity for everything that binds this project\'s ports (R3-1, R3-7, R3-9, D4)');
  {
    const { readStacks } = await load('lib/stacks.mjs');
    const port = await freePort();
    const server = join(repo, 'slow.mjs');
    // Binds only after a second — a probe of the ports alone sees nothing during the window two serves race in.
    writeFileSync(server, `import { createServer } from 'node:http';
const port = Number(process.argv[2]);
setTimeout(() => createServer((_, r) => r.end('ok')).listen(port, '127.0.0.1').on('error', () => process.exit(1)), 1000);
process.on('SIGTERM', () => process.exit(0));
`);
    writeFileSync(join(repo, '.bespunky', 'dev.json'), JSON.stringify({ apps: { site: { processes: [{ id: 'app', cmd: ['node', server, '${PORT:app}'], ports: { app: port } }] } } }));
    const dev = (env, ...args) =>
      new Promise((res) => {
        const p = spawn('sh', [join(engine, 'dev'), ...args], { cwd: repo, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        p.stdout.on('data', (d) => (out += d));
        p.stderr.on('data', (d) => (out += d));
        p.on('exit', (code) => res({ code, out }));
      });
    const owner = { DEV_OWNER: 'agent:claims', CLAUDE_CODE_SESSION_ID: 'shared' };
    const serves = Array.from({ length: 5 }, () =>
      spawn('sh', [join(engine, 'dev'), 'serve', 'site', '--no-shared-browser'], { cwd: repo, detached: true, stdio: 'ignore', env: { ...process.env, ...owner } }),
    );
    try {
      await until(async () => JSON.parse((await dev({}, 'ps', '--json')).out).length === 5, 8000);
      const stacks = JSON.parse((await dev({}, 'ps', '--json')).out);
      const offsets = new Set(stacks.map((s) => s.offset));
      ok(`five concurrent auto serves: five stacks, five blocks, every one with its handle (${[...offsets].join(', ')})`, stacks.length === 5 && offsets.size === 5 && serves.every((e) => stacks.some((s) => s.pid === e.pid)));
      ok('…the main tree\'s base block went to exactly one of them', stacks.filter((s) => s.offset === 0).length === 1);
      const pinned = await dev(owner, 'serve', 'site', '--no-shared-browser', '--port-offset=0');
      ok('an explicit offset someone holds is refused, naming the holder and its stop command', pinned.code !== 0 && /offset 0 is held — site@0 \(live/.test(pinned.out) && /tools\/dev\/dev stop site --offset=0/.test(pinned.out));

      // R3-9: the session is ONE owner for itself and every subagent — selecting by it is refused; naming works.
      const session = { DEV_OWNER: '', CLAUDE_CODE_SESSION_ID: 'shared' };
      const all = await dev(session, 'stop', '--all-mine');
      ok('--all-mine under a shared session owner is refused (a subagent would stop its siblings)', all.code !== 0 && /subagents share/.test(all.out));
      const implicit = await dev(session, 'stop', 'site');
      ok('…so is "my stack here" without naming it', implicit.code !== 0 && /subagents share/.test(implicit.out));
      const labelled = await dev(owner, 'stop', '--all-mine');
      ok('an owner label of its own may stop all of its stacks', labelled.code === 0 && (await until(async () => JSON.parse((await dev({}, 'ps', '--json')).out).length === 0, 8000)));

      // LIVENESS IS THE KERNEL LOCK. A process holding a stack's lock (shared, as every member does) — the helper here.
      const run = join(repo, '.bespunky', 'run');
      const holder = (lock) => {
        writeFileSync(lock, '');
        const p = spawn('bash', ['-c', 'exec 9<"$0"; flock -s 9; echo held; exec sleep 60', lock], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
        return new Promise((res) => p.stdout.once('data', () => res(p)));
      };
      const fake = (key, machine, lock, extra = {}) => writeFileSync(join(run, `${key}.json`), JSON.stringify({ key, app: 'site', tree: repo, offset: 0, pid: 1, procStart: 'x', lock, machine, host: 'elsewhere', owner: 'user:other', ports: { app: port }, processes: [], ...extra }));

      // S3-7: a live stack of ANOTHER container sharing this workspace (its lock is held — flock is the kernel's, seen
      // across containers) is detected and REFUSED — never pruned by age: it has no heartbeat to miss.
      const foreignLock = join(run, 'locks', 'foreign.lock');
      const sibling = await holder(foreignLock);
      fake('site@0', 'another-boot/pid:[4026531836]', foreignLock);
      const old = new Date(Date.now() - 10 * 60_000);
      utimesSync(join(run, 'site@0.json'), old, old);
      ok('a held record of another container is FOREIGN — kept however old (nothing to go stale)', readStacks([repo]).some((r) => r.key === 'site@0' && r.state === 'foreign'));
      const shared = await dev(owner, 'serve', 'site', '--no-shared-browser');
      ok('…and every claim is REFUSED, naming the shared workspace (even an auto one on a free block)', shared.code !== 0 && /ANOTHER container/.test(shared.out) && /site@0 \(host elsewhere/.test(shared.out));
      process.kill(-sibling.pid, 'SIGKILL');
      await until(() => !readStacks([repo]).length, 3000);
      ok('…the moment its lock is free (that container stopped), it is dead — and pruned by the next ps', JSON.parse((await dev({}, 'ps', '--json')).out).length === 0 && !existsSync(join(run, 'site@0.json')));

      // A stopped (Ctrl+Z) or suspended claimer still holds its lock: alive, never pruned.
      const frozen = spawn('sh', [join(engine, 'dev'), 'serve', 'site', '--no-shared-browser', '--port-offset=0'], { cwd: repo, detached: true, stdio: 'ignore', env: { ...process.env, ...owner } });
      await until(async () => JSON.parse((await dev({}, 'ps', '--json')).out).length === 1, 8000);
      process.kill(-frozen.pid, 'SIGSTOP');
      const whileStopped = JSON.parse((await dev({}, 'ps', '--json')).out);
      ok('a SIGSTOPped serve is still its stack (live), not pruned', whileStopped.length === 1 && whileStopped[0].state === 'live');
      // KILL -9 THE OWNER — its whole group — and the block is free AT ONCE: the kernel released the lock.
      process.kill(-frozen.pid, 'SIGKILL');
      await until(async () => !(await listening(port)), 3000);
      const t0 = Date.now();
      const again = spawn('sh', [join(engine, 'dev'), 'serve', 'site', '--no-shared-browser', '--port-offset=0'], { cwd: repo, detached: true, stdio: 'ignore', env: { ...process.env, ...owner } });
      const reclaimed = await until(async () => JSON.parse((await dev({}, 'ps', '--json')).out).some((s) => s.offset === 0 && s.pid === again.pid), 8000);
      ok(`kill -9 of a serve's group: the base block is reclaimed at once (${Date.now() - t0} ms), no takeover, no wait`, reclaimed && Date.now() - t0 < 5000);
      // Kill -9 the serve ALONE: its server still runs and holds the lock — the stack is ORPHANED, and dev stop ends it.
      await until(() => listening(port), 5000);
      process.kill(again.pid, 'SIGKILL');
      const orphan = JSON.parse((await dev({}, 'ps', '--json')).out);
      ok('kill -9 of the serve alone: its server still holds the lock — the stack is ORPHANED, kept', orphan.length === 1 && orphan[0].state === 'orphaned');
      const ended = await dev(owner, 'stop', '--offset=0');
      ok('…and dev stop ends what it left, then the block is free', ended.code === 0 && !(await listening(port)) && JSON.parse((await dev({}, 'ps', '--json')).out).length === 0);
      try {
        process.kill(-again.pid, 'SIGKILL');
      } catch {
        /* stopped */
      }

      // D4: a script's stack claims the same way — a direct emulator run and a serve see each other. The script holds
      // its own lock (flock'ed before the claim); the record names it.
      const scriptLock = join(run, 'locks', 'script.lock');
      const sh = await holder(scriptLock);
      const unheld = await dev(owner, 'claim', 'firebase', '--pid=1', `--lock=${join(run, 'locks', 'nobody.lock')}`, `--ports=hub=${port}`, '--port-offset=0');
      ok('a claim whose lock is not held is refused', unheld.code !== 0 && /is not held/.test(unheld.out));
      const claimed = await dev(owner, 'claim', 'firebase', `--pid=${sh.pid}`, `--lock=${scriptLock}`, `--ports=hub=${port}`);
      ok(`a script claims its stack for ITS pid — the base block by default for a human (${claimed.out.trim().split('\n')[0]})`, claimed.code === 0 && /^STACK_KEY='firebase@0'$/m.test(claimed.out) && /^STACK_TMP='\/tmp\/bespunky-[0-9a-f]{12}'$/m.test(claimed.out));
      const beside = await dev(owner, 'serve', 'site', '--no-shared-browser', '--port-offset=0');
      ok("…a serve on the same ports is refused, naming the script's stack", beside.code !== 0 && /firebase@0 \(live, pid /.test(beside.out));
      await dev(owner, 'release', 'firebase@0', `--lock=${scriptLock}`);
      ok('…a release while the lock is still held keeps it (the last one out removes it)', existsSync(join(run, 'firebase@0.json')));
      process.kill(-sh.pid, 'SIGKILL');
      await until(() => !readStacks([repo]).length, 3000);
      await dev(owner, 'release', 'firebase@0', `--lock=${scriptLock}`);
      ok('…once nothing holds it, release gives it up (record, lock, state dir)', !existsSync(join(run, 'firebase@0.json')) && !existsSync(join(run, 'firebase@0')) && !existsSync(scriptLock));

      // S3-8: the old claim's last holder lets go LATE — after the key was claimed again. Its release names its own lock,
      // which the new record does not: the new stack keeps its record, state dir and TMPDIR.
      const lockA = join(run, 'locks', 'a.lock');
      const a = await holder(lockA);
      await dev(owner, 'claim', 'firebase', `--pid=${a.pid}`, `--lock=${lockA}`, `--ports=hub=${port}`);
      process.kill(-a.pid, 'SIGKILL');
      const lockB = join(run, 'locks', 'b.lock');
      const b = await holder(lockB);
      const reclaim = await dev(owner, 'claim', 'firebase', `--pid=${b.pid}`, `--lock=${lockB}`, `--ports=hub=${port}`);
      const tmpB = /^STACK_TMP='([^']+)'$/m.exec(reclaim.out)?.[1];
      await dev(owner, 'release', 'firebase@0', `--lock=${lockA}`);
      ok("S3-8: a late release of the key's OLD claim leaves the new claim alone (record, state dir, TMPDIR)", reclaim.code === 0 && JSON.parse(readFileSync(join(run, 'firebase@0.json'), 'utf8')).lock === lockB && existsSync(join(run, 'firebase@0')) && tmpB && existsSync(tmpB));
      process.kill(-b.pid, 'SIGKILL');
      await until(() => !readStacks([repo]).length, 3000);
      await dev(owner, 'release', 'firebase@0', `--lock=${lockB}`);

      // S3-9: the local-server rule, in code. Under an AI agent the base ports are never taken.
      const agent = { ...owner, CLAUDECODE: '1' };
      const zero = await dev(agent, 'serve', 'site', '--no-shared-browser', '--port-offset=0', '--dry-run');
      ok('an agent asking for --port-offset=0 is REFUSED, with the reason', zero.code !== 0 && /AI agent never takes the project's base ports/.test(zero.out));
      const auto = await dev(agent, 'serve', 'site', '--no-shared-browser', '--dry-run');
      ok('an agent\'s auto never resolves to offset 0 in the main tree, though it is free', auto.code === 0 && /offset {5}: [1-9]/.test(auto.out));
      const sh2 = await holder(scriptLock);
      const agentClaim = await dev(agent, 'claim', 'firebase', `--pid=${sh2.pid}`, `--lock=${scriptLock}`, `--ports=hub=${port}`);
      ok('…and a script it runs (a direct emulator run, no offset given) lands off the base block', agentClaim.code === 0 && !/^STACK_OFFSET='0'$/m.test(agentClaim.out));
      process.kill(-sh2.pid, 'SIGKILL');

      // S3-20: the stack's TMPDIR in shared /tmp is created private and checked — never adopted from someone else.
      const { stackTmp } = await load('lib/stacks.mjs');
      const planted = stackTmp(repo, 'site@0');
      rmSync(planted, { recursive: true, force: true });
      mkdirSync(planted, { mode: 0o755 });
      const tmpRefused = await dev(owner, 'serve', 'site', '--no-shared-browser', '--port-offset=0');
      ok("a pre-existing TMPDIR that is not this user's private dir (mode 755) is refused, named", tmpRefused.code !== 0 && /not this user's private directory/.test(tmpRefused.out) && tmpRefused.out.includes(planted));
      rmSync(planted, { recursive: true, force: true });
      // …and an orphan one (its record removed some other way) is swept once its stack's lock is free.
      const orphanTmp = stackTmp(repo, 'site@77');
      mkdirSync(orphanTmp, { mode: 0o700 });
      writeFileSync(join(orphanTmp, '.bespunky-stack'), JSON.stringify({ lock: join(run, 'locks', 'never.lock') }));
      await dev({}, 'ps');
      ok('an orphan TMPDIR whose lock is free is swept', !existsSync(orphanTmp));

      // S3-5: THE ADDRESS CONTRACT. Beside a developer's stack on the base ports, an e2e's stack (Nx's <app>:dev-stack)
      // lands elsewhere — and `dev with` tells the tests exactly where, never the developer's ports.
      const developer = spawn('sh', [join(engine, 'dev'), 'serve', 'site', '--no-shared-browser', '--port-offset=0'], { cwd: repo, detached: true, stdio: 'ignore', env: { ...process.env, DEV_OWNER: 'user:dev' } });
      await until(() => listening(port), 8000);
      const before = await dev(owner, 'with', 'site', '--timeout=2', '--', 'true');
      ok('`with` and no dev-stack running: refused after its timeout, saying how to get one', before.code !== 0 && /no running site:dev-stack stack/.test(before.out));
      const e2eStack = spawn('sh', [join(engine, 'dev'), 'serve', 'site', '--no-shared-browser', '--task=site:dev-stack'], { cwd: repo, detached: true, stdio: 'ignore', env: { ...process.env, ...owner } });
      const seen = await dev(owner, 'with', 'site', '--', 'node', '-e', 'console.log("SEEN " + process.env.BASE_URL + " " + process.env.PORT_OFFSET + " " + process.env.DEV_STACK); fetch(process.env.BASE_URL).then((r) => process.exit(r.ok ? 7 : 1))');
      const m = /SEEN (\S+) (\S+) (\S+)/.exec(seen.out) ?? [];
      ok(`with: the e2e is told ITS stack's address (${m[1]}, offset ${m[2]}), not the developer's :${port}`, m[1] && m[1] !== `http://localhost:${port}` && Number(m[2]) > 0 && m[3] === `site@${m[2]}`);
      ok('…it waited until that stack answered, reached it, and its exit status is the command\'s', seen.code === 7);
      for (const p of [developer, e2eStack]) {
        try {
          process.kill(-p.pid, 'SIGKILL');
        } catch {
          /* gone */
        }
      }
    } finally {
      for (const e of serves) {
        try {
          process.kill(-e.pid, 'SIGKILL');
        } catch {
          /* stopped by the test */
        }
      }
    }
  }

  console.log('detached work: a stop waits for what a process detached (an emulator export), and a crash is named');
  {
    // A process that, like tools/emulators.sh, runs slow shutdown work OUTSIDE the tree and registers it in the
    // stack's state dir. The work notices its owner is gone, "saves" for 1.5 s, records its result and exits.
    writeFileSync(
      join(repo, 'detacher.mjs'),
      `import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
const [port, mode] = process.argv.slice(2);
const work = \`
const fs = require('fs'), path = require('path');
// It keeps the stack alive while it saves — as the emulator keeper does: it holds the stack's lock (DEV_STACK_LOCK).
const lockFd = fs.openSync(process.env.DEV_STACK_LOCK, 'r'); require('child_process').spawnSync('flock', ['-s', '-n', '3'], { stdio: ['ignore', 'ignore', 'ignore', lockFd] });
const dir = path.join(process.env.DEV_STACK_DIR, 'detached'); fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, 'saver.json');
const start = () => { const s = fs.readFileSync('/proc/self/stat', 'utf8'); return s.slice(s.lastIndexOf(')') + 2).split(' ')[19]; };
const owner = Number(process.argv[1]);
const saveMs = Number(process.argv[2]);
const deaf = process.argv[3] === 'deaf';
process.on('SIGUSR1', () => { if (deaf) return; write({ status: 'exited', code: 1, result: 'ABANDONED (dev stop --abandon)' }); process.exit(1); });
const write = (e) => { fs.writeFileSync(file + '.tmp', JSON.stringify({ id: 'saver', pid: process.pid, procStart: start(), log: '/tmp/saver.log', ...e })); fs.renameSync(file + '.tmp', file); };
write({ status: 'running' });
const tick = setInterval(() => {
  try { process.kill(owner, 0); return; } catch {}
  clearInterval(tick);
  write({ status: 'stopping', doing: 'saving test data' });
  setTimeout(() => { write({ status: 'exited', code: 0, result: 'saved to the test dir' }); process.exit(0); }, saveMs);
}, 100);
\`;
const saveMs = mode === 'slow' || mode === 'deaf' ? 60000 : 1500;
spawn(process.execPath, ['-e', work, String(process.pid), String(saveMs), mode], { detached: true, stdio: 'ignore' }).unref();
const server = createServer((_, res) => res.end('ok')).listen(Number(port), '127.0.0.1');
if (mode === 'crash') setTimeout(() => process.exit(3), 600);
process.on('SIGTERM', () => { server.close(); process.exit(0); });
`,
    );
    const port = await freePort();
    const human = { DEV_OWNER: 'user:dev', CLAUDE_CODE_SESSION_ID: '' };
    const declare = (mode) =>
      writeFileSync(join(repo, '.bespunky', 'dev.json'), JSON.stringify({ apps: { site: { processes: [{ id: 'app', cmd: ['node', join(repo, 'detacher.mjs'), '${PORT:app}', mode], ports: { app: port } }] } } }));
    const run = (args, env) =>
      new Promise((res) => {
        const p = spawn('sh', [join(engine, 'dev'), ...args], { cwd: repo, env: { ...process.env, ...human, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        p.stdout.on('data', (d) => (out += d));
        p.stderr.on('data', (d) => (out += d));
        p.on('exit', (code) => res({ code, out }));
      });
    const entry = join(repo, '.bespunky', 'run', 'site@0', 'detached', 'saver.json');

    declare('ok');
    let eng = spawn('sh', [join(engine, 'dev'), 'serve', '--no-shared-browser', '--port-offset=0'], { cwd: repo, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...human } });
    let served = '';
    eng.stdout.on('data', (d) => (served += d));
    eng.stderr.on('data', (d) => (served += d));
    try {
      ok('a stack with detached work came up', await until(() => listening(port), 10000) && (await until(() => existsSync(entry), 5000)));
      const t0 = Date.now();
      const stopped = await run(['stop']);
      ok('dev stop returns only AFTER the detached work finished (not in 0.7 s)', stopped.code === 0 && Date.now() - t0 >= 1400 && /ports free/.test(stopped.out));
      ok('…the serve reported the work and its result', /saver: saved to the test dir/.test(served));
      ok('…and then removed the record and state dir', !existsSync(join(repo, '.bespunky', 'run', 'site@0.json')) && !existsSync(join(repo, '.bespunky', 'run', 'site@0')));

      // The supervisor dies outright (Nx's SIGKILL after its grace): the work outlives it, and stays visible.
      eng = spawn('sh', [join(engine, 'dev'), 'serve', '--no-shared-browser', '--port-offset=0'], { cwd: repo, detached: true, stdio: 'ignore', env: { ...process.env, ...human } });
      await until(() => listening(port), 10000);
      await until(() => existsSync(entry), 5000);
      process.kill(-eng.pid, 'SIGKILL');
      await sleep(300);
      const ps = JSON.parse((await run(['ps', '--json'])).out);
      ok('a stack whose serve was SIGKILLed mid-save is FINISHING — kept, not pruned', ps.length === 1 && ps[0].state === 'finishing' && ps[0].detached?.[0]?.doing === 'saving test data');
      const waited = await run(['stop']);
      ok('dev stop on a finishing stack signals nothing, waits for the save, reports it', waited.code === 0 && /already stopped and finishing/.test(waited.out) && /saved to the test dir/.test(waited.out));
      ok('…and the record is gone after', JSON.parse((await run(['ps', '--json'])).out).length === 0);

      // R3-3: a save that would take a minute (or never end) is not waited on forever: --abandon ends it now. Work
      // that honours SIGUSR1 records the abandonment itself; work that ignores it has its process group killed.
      for (const mode of ['slow', 'deaf']) {
        declare(mode);
        eng = spawn('sh', [join(engine, 'dev'), 'serve', '--no-shared-browser', '--port-offset=0'], { cwd: repo, detached: true, stdio: 'ignore', env: { ...process.env, ...human } });
        await until(() => listening(port), 10000);
        await until(() => existsSync(entry), 5000);
        process.kill(-eng.pid, 'SIGKILL');
        await until(async () => JSON.parse((await run(['ps', '--json'])).out)[0]?.state === 'finishing', 5000);
        const saverPid = JSON.parse(readFileSync(entry, 'utf8')).pid;
        const t1 = Date.now();
        const ended = await run(['stop', '--abandon']);
        const gone = !isAliveHere(saverPid);
        ok(`--abandon on a finishing stack whose save ${mode === 'deaf' ? 'IGNORES SIGUSR1' : 'honours SIGUSR1'}: ended in ${Math.round((Date.now() - t1) / 1000)}s, not a minute; the work is gone`, Date.now() - t1 < 20000 && gone && /abandoning saver/.test(ended.out));
        ok(`…${mode === 'deaf' ? 'its process group killed, said so' : 'its own result reported'}, and the record pruned`, (mode === 'deaf' ? /killing its process group/.test(ended.out) : /ABANDONED/.test(ended.out)) && JSON.parse((await run(['ps', '--json'])).out).length === 0);
      }

      // A process that dies on its own fails the stack — and the engine says WHICH, with the command it ran.
      declare('crash');
      const crashed = await run(['serve', '--no-shared-browser', '--port-offset=0']);
      ok('a crashed process: the engine exits non-zero and names it, its exit code and its command', crashed.code !== 0 && /the stack FAILED/.test(crashed.out) && /app exited with code 3 — it ran: node /.test(crashed.out));
    } finally {
      try {
        process.kill(-eng.pid, 'SIGKILL');
      } catch {
        /* already down */
      }
    }
  }
} finally {
  rmSync(repo, { recursive: true, force: true });
}

process.exit(failed);
