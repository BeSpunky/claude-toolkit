#!/usr/bin/env node
// The runner's own test. Every case but the last runs `run.mjs` against a FIXTURE suite list (never the real suites),
// through its CLI, as `yarn test` does. The last case is the one against the real repo: the real list must declare every
// tools/test-* and tools/check-* directory that has a runnable entry. Needs only node and git. Run: node tools/test-suites/test/run.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SUITES = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = join(SUITES, '..', '..');
const RUNNER = join(SUITES, 'run.mjs');
const tmp = mkdtempSync(join(tmpdir(), 'test-suites-'));
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));

const PASS = ['node', '-e', 'console.log("hello from a passing suite")'];
const FAIL = ['node', '-e', 'console.log("failed: not me, I am suite output"); process.exit(3)'];
const NEEDS = {
  none: { probe: null },
  workspace: { probe: ['node', '-e', 'process.exit(require("fs").existsSync("MARKER") ? 0 : 1)'] },
  network: { probe: ['node', '-e', 'console.log("fixture network is down"); process.exit(1)'] },
  docker: { probe: null, never: 'fixture: no docker here' },
};
const suite = (name, command, needs = ['none'], project = 'proj-a') => ({ name, dir: `tools/${name}`, command, project, needs });
let n = 0;
const list = (suites, needs = NEEDS) => { const f = join(tmp, `list-${++n}.json`); writeFileSync(f, JSON.stringify({ needs, suites })); return f; };
const root = () => { const d = join(tmp, `root-${++n}`); mkdirSync(d); return d; };
const run = (args, opts = {}) => spawnSync('node', [RUNNER, ...args], { encoding: 'utf8', cwd: tmp, ...opts });
const lines = (r) => r.stdout.split('\n');

const cases = [];
const test = (name, fn) => cases.push([name, fn]);

test('a list of one passing suite exits 0', () => {
  const r = run([`--suites=${list([suite('ok', PASS)])}`]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /passed 1, failed 0, skipped 0/);
});

test('a list with one failing suite exits non-zero and names it, alone, on a failed: line', () => {
  const r = run([`--suites=${list([suite('good', PASS), suite('bad', FAIL)])}`]);
  assert.equal(r.status, 1);
  assert.deepEqual(lines(r).filter((l) => /^\s*failed:/.test(l)), ['  failed: bad'], 'suite output must not forge a failed: line');
});

test('an empty list exits non-zero', () => {
  const r = run([`--suites=${list([])}`]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /declares no suites/);
});

test('an unreadable list exits non-zero', () => {
  const r = run([`--suites=${join(tmp, 'does-not-exist.json')}`]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /cannot read/);
});

test('a malformed list exits non-zero (bad JSON, missing command, unknown need, duplicate name)', () => {
  const junk = join(tmp, 'junk.json'); writeFileSync(junk, '{ not json');
  assert.equal(run([`--suites=${junk}`]).status, 2);
  assert.equal(run([`--suites=${list([{ name: 'x', project: 'p', needs: ['none'] }])}`]).status, 2);
  assert.equal(run([`--suites=${list([suite('x', PASS, ['telepathy'])])}`]).status, 2);
  const dup = run([`--suites=${list([suite('x', PASS), suite('x', PASS)])}`]);
  assert.equal(dup.status, 2);
  assert.match(dup.stderr, /declared twice/);
});

test('a suite that needs the network, with the network unavailable, is named with its need, not run, not counted as passed', () => {
  const marker = join(tmp, `ran-${++n}`);
  const touch = ['node', '-e', `require("fs").writeFileSync(${JSON.stringify(marker)}, "ran")`];
  const r = run([`--suites=${list([suite('fine', PASS), suite('wants-net', touch, ['network'])])}`]);
  assert.equal(r.status, 0, 'the suite that could run passed');
  assert.ok(!existsSync(marker), 'the skipped suite must not run');
  assert.match(r.stdout, /skipped: wants-net \(unmet need: network: fixture network is down\)/);
  assert.match(r.stdout, /passed 1, failed 0, skipped 1/);
  assert.ok(!/passed: wants-net/.test(r.stdout));
});

test('a list whose every suite is skipped exits non-zero', () => {
  const r = run([`--suites=${list([suite('wants-net', PASS, ['network'])])}`]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /passed 0, failed 0, skipped 1/);
  assert.match(r.stdout, /nothing ran/);
});

test('a docker-needing suite is always skipped, with docker named', () => {
  const r = run([`--suites=${list([suite('fine', PASS), suite('in-docker', PASS, ['docker'])])}`]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /skipped: in-docker \(unmet need: docker: fixture: no docker here\)/);
});

test('a suite needing several needs names every unmet one', () => {
  const r = run([`--suites=${list([suite('fine', PASS), suite('both', PASS, ['network', 'docker'])])}`]);
  assert.match(r.stdout, /skipped: both \(unmet need: network: .*; docker: /);
});

test('the workspace need is judged by observation: met where the probe sees the marker, unmet where it does not', () => {
  const l = list([suite('fine', PASS), suite('needs-ws', PASS, ['workspace'])]);
  const without = run([`--suites=${l}`, `--root=${root()}`]);
  assert.match(without.stdout, /skipped: needs-ws \(unmet need: workspace/);
  const withWs = root(); writeFileSync(join(withWs, 'MARKER'), '');
  const met = run([`--suites=${l}`, `--root=${withWs}`]);
  assert.match(met.stdout, /passed 2, failed 0, skipped 0/);
});

test('the real probes observe the real box: workspace follows node_modules, network answers 0 or 1 with a reason', () => {
  const ws = spawnSync('node', [join(SUITES, 'probes.mjs'), 'workspace'], { cwd: tmp, encoding: 'utf8' });
  assert.equal(ws.status, 1, 'an empty directory has no workspace');
  assert.match(ws.stdout, /missing node_modules\/\.bin\/nx/);
  const net = spawnSync('node', [join(SUITES, 'probes.mjs'), 'network'], { cwd: tmp, encoding: 'utf8' });
  assert.ok([0, 1].includes(net.status) && net.stdout.trim().length > 0, `network probe said: ${net.stdout}${net.stderr}`);
  assert.equal(spawnSync('node', [join(SUITES, 'probes.mjs'), 'nope'], { cwd: tmp }).status, 2);
});

test('--project runs only that project\'s suites; an unknown project is a failure, not a pass', () => {
  const marker = join(tmp, `ran-${++n}`);
  const touch = ['node', '-e', `require("fs").writeFileSync(${JSON.stringify(marker)}, "ran")`];
  const l = list([suite('in-a', PASS, ['none'], 'proj-a'), suite('in-b', touch, ['none'], 'proj-b')]);
  const r = run([`--suites=${l}`, '--project=proj-a']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /passed: in-a/);
  assert.ok(!/in-b/.test(r.stdout) && !existsSync(marker));
  assert.equal(run([`--suites=${l}`, '--project=nope']).status, 1);
});

test('--list prints what would run and what would be skipped with the need, one per line, and runs nothing', () => {
  const marker = join(tmp, `ran-${++n}`);
  const touch = ['node', '-e', `require("fs").writeFileSync(${JSON.stringify(marker)}, "ran")`];
  const l = list([suite('would-run', touch), suite('would-skip', touch, ['network']), suite('other', touch, ['none'], 'proj-b')]);
  const r = run([`--suites=${l}`, '--list', '--project=proj-a']);
  assert.equal(r.status, 0);
  assert.deepEqual(lines(r).filter(Boolean), ['run: would-run (proj-a)', 'skip: would-skip (proj-a) needs: network']);
  assert.ok(!existsSync(marker), '--list must not run anything');
});

test('an unknown argument is refused', () => {
  assert.equal(run([`--suites=${list([suite('ok', PASS)])}`, '--projct=x']).status, 2);
});

// ── the one case against the real repo: no suite on disk goes undeclared ───────────────────────────────────────
const ENTRY = { 'tools/test-': /^run\.(mjs|cjs|js|sh)$/, 'tools/check-': /^(check|test)\.(mjs|cjs|js|sh)$/ };
/** The directories under `repoRoot/tools` that hold something runnable, as tools/<dir> paths. */
const runnableDirs = (repoRoot) => readdirSync(join(repoRoot, 'tools'), { withFileTypes: true })
  .filter((d) => d.isDirectory()).map((d) => `tools/${d.name}`)
  .filter((dir) => Object.entries(ENTRY).some(([prefix, re]) => dir.startsWith(prefix) && readdirSync(join(repoRoot, dir)).some((f) => re.test(f))));
/** Directories with a runnable entry that the list neither declares nor excludes. */
const undeclared = (repoRoot, listFile) => {
  const l = JSON.parse(readFileSync(listFile, 'utf8'));
  const known = new Set([...l.suites.map((s) => s.dir), ...l.excluded.map((e) => e.dir)]);
  return runnableDirs(repoRoot).filter((d) => !known.has(d));
};

test('coverage: a fixture tree with an undeclared suite is caught', () => {
  const tree = root(); mkdirSync(join(tree, 'tools/test-declared'), { recursive: true }); mkdirSync(join(tree, 'tools/test-forgotten'), { recursive: true });
  mkdirSync(join(tree, 'tools/test-support'), { recursive: true });
  for (const d of ['test-declared', 'test-forgotten']) writeFileSync(join(tree, 'tools', d, 'run.mjs'), '');
  writeFileSync(join(tree, 'tools/test-support/payload.mjs'), '');
  const f = join(tmp, 'cov.json');
  writeFileSync(f, JSON.stringify({ suites: [{ dir: 'tools/test-declared' }], excluded: [{ dir: 'tools/test-support', reason: 'x' }] }));
  assert.deepEqual(undeclared(tree, f), ['tools/test-forgotten']);
});

test('coverage: the real repo declares every tools/test-* and tools/check-* directory with a runnable entry', () => {
  assert.deepEqual(undeclared(REPO, join(SUITES, 'suites.json')), []);
  const l = JSON.parse(readFileSync(join(SUITES, 'suites.json'), 'utf8'));
  for (const s of l.suites) assert.ok(existsSync(join(REPO, s.dir)), `${s.name}: ${s.dir} does not exist`);
  for (const s of l.suites) assert.ok(s.command.some((a) => a.startsWith(`${s.dir}/`) && existsSync(join(REPO, a))), `${s.name}: its command runs nothing under ${s.dir}`);
  for (const e of l.excluded) assert.ok(e.reason && existsSync(join(REPO, e.dir)), `${e.dir}: an exclusion needs a reason and a directory`);
});

test('the real list names real Nx projects and the root test script is this runner', () => {
  const l = JSON.parse(readFileSync(join(SUITES, 'suites.json'), 'utf8'));
  const projects = new Set(readdirSync(join(REPO, 'plugins')).map((p) => JSON.parse(readFileSync(join(REPO, 'plugins', p, 'project.json'), 'utf8')).name));
  for (const s of l.suites) assert.ok(projects.has(s.project), `${s.name}: ${s.project} is not an Nx project`);
  assert.match(JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).scripts.test, /tools\/test-suites\/run\.mjs/);
});

let failed = 0;
for (const [name, fn] of cases) {
  try { fn(); console.log(`  ok   ${name}`); } catch (e) { failed++; console.log(`  FAIL ${name}\n${String(e.stack ?? e).replace(/^/gm, '       ')}`); }
}
console.log(failed ? `\n${failed} of ${cases.length} failed` : `\nall ${cases.length} passed`);
process.exit(failed ? 1 : 0);
