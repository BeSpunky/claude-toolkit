#!/usr/bin/env node
// THE ONE TEST COMMAND (`yarn test`): runs every suite in suites.json whose needs are met, names every suite it skipped
// with the need that was not met, and fails when anything failed or nothing ran. It derives everything from the list: no
// suite, command, project or need is written here. README.md has the list's format and how each need is judged.
//
//   node tools/test-suites/run.mjs [--project=<nx project>] [--list] [--suites=<list file>] [--root=<dir>]
//
//   --project  only that Nx project's suites (an unknown project selects nothing, which is a failure, never a pass)
//   --list     print what would run and what would be skipped, one suite per line, and run nothing
//   --suites   another list (the runner's own test uses fixtures); --root: where commands and probes run (default: the repo)
//
// Exit: 0 every selected suite that could run passed and at least one ran; 1 a suite failed, or nothing ran (an empty
// selection, or every suite skipped: that is never a pass); 2 the list is unreadable or malformed, or the usage is wrong.
// Suites run one at a time, because several of them (test-voice, test-scaffold) are not safe side by side.
// A suite's own output is shown with a `  | ` prefix, so that only the runner prints `failed:` lines.
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const options = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = /^--([a-z]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] ?? true] : [a, undefined];
}));
const KNOWN_OPTIONS = ['project', 'list', 'suites', 'root'];
const bad = Object.keys(options).filter((o) => !KNOWN_OPTIONS.includes(o));
const refuse = (msg) => { console.error(`test-suites: ${msg}`); process.exit(2); };
if (bad.length) refuse(`unknown argument ${bad.join(', ')} (known: --${KNOWN_OPTIONS.join(', --')})`);
if (options.project === true || options.suites === true || options.root === true) refuse('--project, --suites and --root take a value');

const ROOT = resolve(options.root ?? join(HERE, '..', '..'));
const LIST = resolve(options.suites ?? join(HERE, 'suites.json'));

// ── the list ────────────────────────────────────────────────────────────────────────────────────────────────
function readList(file) {
  let list;
  try { list = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { refuse(`cannot read the suite list ${file}: ${e.message}`); }
  const isArgv = (v) => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string');
  const problems = [];
  if (typeof list?.needs !== 'object' || list.needs === null || Array.isArray(list.needs)) problems.push('"needs" must be an object');
  if (!Array.isArray(list?.suites)) problems.push('"suites" must be an array');
  for (const [need, def] of Object.entries(list?.needs ?? {})) {
    if (!(def?.probe === null || isArgv(def?.probe))) problems.push(`need "${need}": "probe" must be null or a command`);
  }
  for (const [i, s] of (Array.isArray(list?.suites) ? list.suites : []).entries()) {
    const at = `suite #${i + 1}${s?.name ? ` (${s.name})` : ''}`;
    if (typeof s?.name !== 'string' || !s.name) problems.push(`${at}: no name`);
    if (!isArgv(s?.command)) problems.push(`${at}: "command" must be a non-empty list of strings`);
    if (typeof s?.project !== 'string' || !s.project) problems.push(`${at}: no project`);
    if (!Array.isArray(s?.needs) || !s.needs.length) problems.push(`${at}: "needs" must list at least one need`);
    for (const n of s?.needs ?? []) if (!(n in (list.needs ?? {}))) problems.push(`${at}: unknown need "${n}"`);
  }
  const names = (list?.suites ?? []).map((s) => s?.name);
  for (const n of new Set(names.filter((n, i) => names.indexOf(n) !== i))) problems.push(`suite "${n}" is declared twice`);
  if (problems.length) refuse(`the suite list ${file} is malformed:\n  ${problems.join('\n  ')}`);
  if (!list.suites.length) refuse(`the suite list ${file} declares no suites: nothing would run, and that is not a pass`);
  return list;
}

// ── needs: judged once each, by the probe the list declares, never assumed ──────────────────────────────────────
const judged = new Map();
function judge(list, need) {
  if (judged.has(need)) return judged.get(need);
  const { probe, never } = list.needs[need];
  let verdict;
  if (never) verdict = { met: false, said: never };
  else if (probe === null) verdict = { met: true, said: 'nothing needed' };
  else {
    const r = spawnSync(probe[0], probe.slice(1), { cwd: ROOT, encoding: 'utf8', timeout: 30000 });
    verdict = { met: r.status === 0, said: (r.stdout || r.stderr || `probe ended with ${r.status ?? r.signal}`).trim() };
  }
  judged.set(need, verdict);
  return verdict;
}
const unmetNeeds = (list, suite) => suite.needs.filter((n) => !judge(list, n).met);

// ── running ─────────────────────────────────────────────────────────────────────────────────────────────────
const prefixed = (stream, out) => {
  let rest = '';
  stream.on('data', (d) => { const lines = (rest + d).split('\n'); rest = lines.pop(); for (const l of lines) out.write(`  | ${l}\n`); });
  stream.on('end', () => { if (rest) out.write(`  | ${rest}\n`); });
};
const runSuite = (suite) => new Promise((done) => {
  const t0 = Date.now();
  const child = spawn(suite.command[0], suite.command.slice(1), { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  prefixed(child.stdout, process.stdout);
  prefixed(child.stderr, process.stdout);
  const finish = (ok, why) => done({ ok, why, seconds: Math.round((Date.now() - t0) / 1000) });
  child.on('error', (e) => finish(false, `could not start: ${e.message}`));
  child.on('close', (code, signal) => finish(code === 0, code === null ? `killed by ${signal}` : `exit ${code}`));
});

// ── main ────────────────────────────────────────────────────────────────────────────────────────────────────
const list = readList(LIST);
const selected = list.suites.filter((s) => options.project === undefined || s.project === options.project);
const plan = selected.map((suite) => ({ suite, unmet: unmetNeeds(list, suite) }));
const runnable = plan.filter((p) => !p.unmet.length);
const skipped = plan.filter((p) => p.unmet.length);

if (options.list) {
  for (const { suite } of runnable) console.log(`run: ${suite.name} (${suite.project})`);
  for (const { suite, unmet } of skipped) console.log(`skip: ${suite.name} (${suite.project}) needs: ${unmet.join(', ')}`);
  if (!selected.length) { console.error(`test-suites: no suite belongs to project "${options.project}"`); process.exit(1); }
  process.exit(0);
}

if (!selected.length) { console.error(`test-suites: no suite belongs to project "${options.project}": nothing ran, which is not a pass`); process.exit(1); }

const passed = [];
const failed = [];
for (const { suite } of runnable) {
  console.log(`\n=== ${suite.name} (${suite.project}) ===`);
  const r = await runSuite(suite);
  (r.ok ? passed : failed).push({ suite, ...r });
  console.log(`=== ${suite.name}: ${r.ok ? 'passed' : `FAILED (${r.why})`} in ${r.seconds}s ===`);
}

console.log('\n=== summary ===');
console.log(`passed ${passed.length}, failed ${failed.length}, skipped ${skipped.length}`);
for (const { suite } of passed) console.log(`  passed: ${suite.name}`);
for (const { suite, unmet } of skipped) console.log(`  skipped: ${suite.name} (unmet need: ${unmet.map((n) => `${n}: ${judge(list, n).said}`).join('; ')})`);
for (const { suite } of failed) console.log(`  failed: ${suite.name}`);
if (!passed.length && !failed.length) console.log('nothing ran: every selected suite was skipped, which is not a pass');
process.exit(failed.length || !passed.length ? 1 : 0);
