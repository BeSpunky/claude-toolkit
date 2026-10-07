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
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
  ok('env: declared + PORT_<NAME>, no bare PORT, no PORT_OFFSET at base', p0.primary.added.NX_WORKSPACE_ROOT_PATH === '/t' && p0.primary.added.PORT_APP === '4200' && !('PORT' in p0.primary.added) && p0.primary.added.PORT_AUTH === '9099' && !('PORT_OFFSET' in p0.primary.added));
  const p6 = planApp(decl, 'web', { offset: 6000, tree: '/t', passthrough: ['--buildTarget=web:build:production'] });
  ok('shifted: every port moves, the offset url param added, PORT_OFFSET exported', p6.primaryPort === 10200 && p6.processes[1].ports.auth === 15099 && p6.localUrl === 'http://localhost:10200/?shift=6000' && p6.primary.added.PORT_OFFSET === '6000');
  ok('passthrough lands on the primary only', p6.primary.args.at(-1) === '--buildTarget=web:build:production' && !p6.processes[1].args.includes('--buildTarget=web:build:production'));
  const pSkip = planApp(decl, 'web', { offset: 6000, tree: '/t', skip: ['emulators', 'nope'] });
  ok('skipped: not run, ?emulate=none, the offset url param kept', pSkip.running.length === 1 && pSkip.localUrl.endsWith('?shift=6000&emulate=none'));
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
  ok('Ctrl+C (SIGINT to the group): child got exactly ONE SIGINT — nothing forwarded — engine exits 0', ctrlC && ctrlC.result?.code === 0 && ctrlC.got === 'SIGINT' && !ctrlC.stillUp);
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
    // As under Nx: the engine leaves an exit record for the invocation (this process stands in for the invoking nx).
    const underNx = { DEV_NX_ROOT: repo, NX_INVOCATION_ROOT_PID: String(process.pid) };
    const eng = spawn('sh', [join(engine, 'dev'), 'serve', 'site', '--no-shared-browser', '--port-offset=0'], { cwd: repo, detached: true, stdio: 'ignore', env: { ...process.env, ...human, ...underNx } });
    try {
      ok('the stack came up', await until(() => listening(port), 10000));
      const rec = JSON.parse(readFileSync(join(repo, '.bespunky', 'run', 'site@0.json'), 'utf8'));
      ok('the run record names the serve, its owner, its ports and its child', rec.pid === eng.pid && rec.owner === 'user:dev' && rec.ports.app === port && rec.processes.length === 1);
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
      ok('…and the record and state dir are gone', !existsSync(join(repo, '.bespunky', 'run', 'site@0.json')) && !existsSync(join(repo, '.bespunky', 'run', 'site@0')));
      // NB2: a run attached to this stack says who stopped it — from the exit record.
      const exit = JSON.parse(readFileSync(join(repo, '.bespunky', 'run', 'exits', `${process.pid}@site.json`), 'utf8'));
      ok(`…and the exit record says it ended cleanly, and who stopped it (${exit.stoppedBy})`, exit.code === 0 && exit.stoppedBy === 'user:dev, with tools/dev/dev stop' && exit.pid === eng.pid);
      // A record whose PID now belongs to someone else (the kernel reuses PIDs) is stale, never a handle.
      writeFileSync(join(repo, '.bespunky', 'run', 'site@9000.json'), JSON.stringify({ ...rec, key: 'site@9000', offset: 9000, pid: process.pid, procStart: 'not-this-one', processes: [] }));
      const stale = JSON.parse((await dev({}, 'ps', '--json')).out);
      ok('a record whose PID was reused is pruned, never trusted', stale.length === 0 && !existsSync(join(repo, '.bespunky', 'run', 'site@9000.json')));
    } finally {
      try {
        process.kill(-eng.pid, 'SIGKILL');
      } catch {
        /* already down — the point of the test */
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
const dir = path.join(process.env.DEV_STACK_DIR, 'detached'); fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, 'saver.json');
const start = () => { const s = fs.readFileSync('/proc/self/stat', 'utf8'); return s.slice(s.lastIndexOf(')') + 2).split(' ')[19]; };
const owner = Number(process.argv[1]);
const write = (e) => { fs.writeFileSync(file + '.tmp', JSON.stringify({ id: 'saver', pid: process.pid, procStart: start(), log: '/tmp/saver.log', ...e })); fs.renameSync(file + '.tmp', file); };
write({ status: 'running' });
const tick = setInterval(() => {
  try { process.kill(owner, 0); return; } catch {}
  clearInterval(tick);
  write({ status: 'stopping', doing: 'saving test data' });
  setTimeout(() => { write({ status: 'exited', code: 0, result: 'saved to the test dir' }); process.exit(0); }, 1500);
}, 100);
\`;
spawn(process.execPath, ['-e', work, String(process.pid)], { detached: true, stdio: 'ignore' }).unref();
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
