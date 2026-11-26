#!/usr/bin/env node
// Test of the inferred `test` targets (plugin.js). Needs only node and `yarn install` (it asks Nx what it infers).
//   1. Real repo: the projects `nx show projects --with-target test` lists, each project's `run.mjs --project=<p> --list`,
//      must select exactly the suites the root runner's own `--list` selects, which is what `nx run-many -t test` runs.
//   2. Fixture list: adding a suite for a project gives it a test target with no other edit; a project with no suite gets none.
//   3. A suite whose owning project names no real Nx project is reported by name, with a non-zero exit (this file run with
//      --suites/--projects as a checker is the thing asserted on).
// Run: node tools/nx-test-suites/test/run.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const RUNNER = join(REPO, 'tools', 'test-suites', 'run.mjs');
const { createNodesV2, owningProjects } = createRequire(import.meta.url)('../plugin.js');

const runner = (...args) => spawnSync('node', [RUNNER, ...args], { cwd: REPO, encoding: 'utf8' });
const selected = (listOutput) => listOutput.split('\n').filter((l) => /^(run|skip): /.test(l)).map((l) => l.replace(/^(run|skip): (\S+).*/, '$2')).sort();

/** The mismatches between a list and the real project names, as messages; empty when every suite has an owner. */
function unownedSuites(list, projects) {
  return list.suites.filter((s) => !projects.includes(s.project)).map((s) => `suite "${s.name}" is owned by "${s.project}", which is not an Nx project`);
}

// ── checker mode: node run.mjs --suites=<list> --projects=<a,b> ─────────────────────────────────────────────
const opt = (k) => process.argv.slice(2).find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
if (opt('suites')) {
  const problems = unownedSuites(JSON.parse(readFileSync(opt('suites'), 'utf8')), (opt('projects') ?? '').split(',').filter(Boolean));
  for (const p of problems) console.error(p);
  process.exit(problems.length ? 1 : 0);
}

const tmp = mkdtempSync(join(tmpdir(), 'nx-test-suites-'));
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));
const cases = [];
const test = (name, fn) => cases.push([name, fn]);

/** What the plugin infers for a workspace of fixture projects { name: dir } under a fixture list. */
function infer(projects, suites) {
  const root = mkdtempSync(join(tmp, 'ws-'));
  for (const [name, dir] of Object.entries(projects)) {
    mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, dir, 'project.json'), JSON.stringify({ name }));
  }
  writeFileSync(join(root, 'suites.json'), JSON.stringify({ needs: {}, suites }));
  const [, fn] = createNodesV2;
  const results = fn(Object.values(projects).map((d) => `${d}/project.json`), { suites: 'suites.json' }, { workspaceRoot: root });
  return Object.fromEntries(results.map(([, r]) => Object.values(r.projects)).flat().map((p, i) => [Object.keys(projects)[i], p.targets]));
}
const suite = (name, project) => ({ name, project, command: ['true'], needs: ['none'] });

test('nx run-many -t test selects the same suites as the root runner', () => {
  const nx = spawnSync('yarn', ['-s', 'nx', 'show', 'projects', '--with-target', 'test'], { cwd: REPO, encoding: 'utf8', env: { ...process.env, NX_DAEMON: 'false' } });
  assert.equal(nx.status, 0, nx.stderr);
  const projects = nx.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  assert.ok(projects.length > 0, 'no project has a test target');
  const viaNx = projects.flatMap((p) => selected(runner(`--project=${p}`, '--list').stdout)).sort();
  const viaRoot = selected(runner('--list').stdout);
  assert.ok(viaRoot.length > 0);
  assert.deepEqual(viaNx, viaRoot);
});

test('the real list names only real Nx projects', () => {
  const nx = spawnSync('yarn', ['-s', 'nx', 'show', 'projects'], { cwd: REPO, encoding: 'utf8', env: { ...process.env, NX_DAEMON: 'false' } });
  assert.deepEqual(unownedSuites(JSON.parse(readFileSync(join(REPO, 'tools/test-suites/suites.json'), 'utf8')), nx.stdout.split('\n').map((l) => l.trim())), []);
});

test('adding a suite for a project gives it a test target with no other edit', () => {
  const projects = { alpha: 'p/alpha', beta: 'p/beta' };
  const before = infer(projects, [suite('a1', 'alpha')]);
  assert.ok(before.alpha.test && !before.beta.test);
  const after = infer(projects, [suite('a1', 'alpha'), suite('b1', 'beta')]);
  assert.ok(after.alpha.test && after.beta.test);
  assert.equal(after.beta.test.cache, false);
  assert.match(after.beta.test.options.command, /run\.mjs --project=beta$/);
});

test('owningProjects lists each owner once', () => {
  assert.deepEqual(owningProjects({ suites: [suite('x', 'a'), suite('y', 'a'), suite('z', 'b')] }), ['a', 'b']);
});

test('a suite whose project is no real Nx project is reported by name with a non-zero exit', () => {
  const f = join(tmp, 'bad.json');
  writeFileSync(f, JSON.stringify({ suites: [suite('fine', 'real'), suite('orphan-suite', 'ghost-project')] }));
  const r = spawnSync('node', [fileURLToPath(import.meta.url), `--suites=${f}`, '--projects=real'], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /orphan-suite/);
  assert.doesNotMatch(r.stderr, /"fine"/);
  assert.equal(spawnSync('node', [fileURLToPath(import.meta.url), `--suites=${f}`, '--projects=real,ghost-project']).status, 0);
});

let failed = 0;
for (const [name, fn] of cases) {
  try { fn(); console.log(`ok - ${name}`); } catch (e) { failed++; console.log(`not ok - ${name}\n${e.stack}`); }
}
console.log(failed ? `${failed} failed` : `all ${cases.length} passed`);
process.exit(failed ? 1 : 0);
