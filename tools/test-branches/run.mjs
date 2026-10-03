#!/usr/bin/env node
// Behaviour tests for the branch-model engine (plugins/workflow/skills/branch-and-release/scripts/branches.mjs).
//
// The engine decides nothing, but everything downstream trusts what it says: which copy of the model is in
// force, whether a repo is following it, and the exact commands for a move. Each of those is a promise about
// real git history, so each case builds a throwaway repo (init, commits, merges, cherry-picks, tags — no
// network) and runs the engine as a user would, through its CLI.
//
// Needs only node and git. Run: node tools/test-branches/run.mjs
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ENGINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../plugins/workflow/skills/branch-and-release/scripts/branches.mjs');
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'branches-test-'));
const GH_HOME = path.join(SCRATCH, 'gh-config'); // an empty gh config: `gh auth status` fails, never prompts

const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_CONFIG_NOSYSTEM: '1', GH_CONFIG_DIR: GH_HOME, GH_PROMPT_DISABLED: '1' };
for (const k of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'GIT_DIR', 'GIT_WORK_TREE']) delete ENV[k];

let seq = 0;
/** A throwaway repo on `main` with one commit. */
function repo() {
  const dir = path.join(SCRATCH, `r${++seq}`);
  fs.mkdirSync(dir);
  const git = (...args) => execFileSync('git', args, { cwd: dir, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'tag.gpgsign', 'false');
  let n = 0;
  const r = {
    dir,
    git,
    write(file, content) {
      fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      fs.writeFileSync(path.join(dir, file), content);
    },
    /** A commit touching its own file (so commits never conflict), returns its SHA. */
    commit(msg = `c${++n}`, file = `f-${msg.replace(/\W+/g, '-')}-${++n}.txt`, content = `${msg}\n`) {
      r.write(file, content);
      git('add', '-A');
      git('commit', '-q', '-m', msg);
      return git('rev-parse', 'HEAD');
    },
    sw: (b) => git('switch', '-q', b),
    branch: (b, from = 'HEAD') => git('branch', b, from),
    merge: (b, msg = `Merge ${b}`) => git('merge', '-q', '--no-ff', '-m', msg, b),
    ff: (b) => git('merge', '-q', '--ff-only', b),
    run(args, { cwd = dir } = {}) {
      const res = spawnSync(process.execPath, [ENGINE, ...args], { cwd, env: ENV, encoding: 'utf8' });
      return { code: res.status, out: res.stdout, err: res.stderr };
    },
    json(args) {
      const res = r.run(args);
      return { ...res, data: res.out ? JSON.parse(res.out) : null };
    },
    /** expand → write → commit the declaration on the integration line (where it is in force). */
    declare(preset, opts = [], edit) {
      const ex = r.run(['expand', '--preset', preset, ...opts]);
      assert.equal(ex.code, 0, ex.err);
      const decl = JSON.parse(ex.out);
      if (edit) edit(decl);
      const file = path.join(SCRATCH, `decl-${seq}-${++n}.json`);
      fs.writeFileSync(file, JSON.stringify(decl));
      // Landed as any change is: on a work branch, merged --no-ff into the integration line.
      const integ = decl.integration.branch;
      if (!git('for-each-ref', `refs/heads/${integ}`)) git('branch', integ);
      git('switch', '-q', '-c', 'chore/branch-model', integ);
      const w = r.run(['write', file]);
      assert.equal(w.code, 0, w.err + w.out);
      git('add', '.bespunky/branches.json');
      git('commit', '-q', '-m', `chore: declare the ${preset} branch model`);
      r.sw(integ);
      r.merge('chore/branch-model');
      git('branch', '-q', '-d', 'chore/branch-model');
      return { file, decl: r.model() };
    },
    model: () => JSON.parse(fs.readFileSync(path.join(dir, '.bespunky/branches.json'), 'utf8')),
    proposed(preset, opts = [], edit) {
      const ex = r.run(['expand', '--preset', preset, ...opts]);
      assert.equal(ex.code, 0, ex.err);
      const decl = JSON.parse(ex.out);
      if (edit) edit(decl);
      const file = path.join(SCRATCH, `prop-${seq}-${++n}.json`);
      fs.writeFileSync(file, JSON.stringify(decl));
      return file;
    },
    refs: () => git('for-each-ref', '--format=%(refname) %(objectname)'),
  };
  r.commit('initial');
  return r;
}

/** development → staging → main, all at the same commit, three-line declared. */
function threeLine(opts = [], edit) {
  const r = repo();
  r.branch('development');
  r.branch('staging');
  r.declare('three-line', opts, edit);
  // promote the declaration commit through the chain so every line starts aligned
  r.sw('staging');
  r.ff('development');
  r.sw('main');
  r.ff('staging');
  return r;
}

/** develop + main, gitflow declared on develop (and shipped to main through a first release). */
function gitflow() {
  const r = repo();
  r.branch('develop');
  r.declare('gitflow');
  r.sw('main');
  r.merge('develop', 'Merge develop (initial)');
  r.sw('develop');
  r.merge('main', 'Merge main back');
  // re-baseline so the setup merges above sit before the baselines
  return rebase(r);
}

/** Re-record every baseline at today's tips (write keeps recorded ones, so null them first). */
function rebase(r) {
  const m = r.model();
  m.integration.baseline = null;
  for (const s of m.stages) s.baseline = null;
  if (m.releases) m.releases.baselines = {};
  const integ = m.integration.branch;
  r.sw(integ);
  const file = path.join(SCRATCH, `rebase-${seq}.json`);
  fs.writeFileSync(file, JSON.stringify(m));
  // Baselines are taken at the tips BEFORE this commit; the commit itself is a direct commit on integration,
  // which a real model change lands as a merge. Do the same: write on a work branch and merge it.
  r.git('switch', '-q', '-c', 'chore/rebaseline');
  assert.equal(r.run(['write', file]).code, 0);
  r.git('add', '-A');
  r.git('commit', '-q', '-m', 'chore: re-baseline');
  r.sw(integ);
  r.merge('chore/rebaseline');
  r.git('branch', '-q', '-d', 'chore/rebaseline');
  // carry that merge down any ff chain / feed it to production so containment holds
  for (const s of m.stages) {
    r.sw(s.branch);
    if (s.promote === 'ff') r.ff(integ);
    else r.merge(integ, `Merge ${integ} (re-baseline)`);
  }
  if (m.stages.some((s) => s.promote !== 'ff')) {
    r.sw(integ);
    for (const s of m.stages) r.merge(s.branch, `Merge ${s.branch} back`);
  }
  r.sw(integ);
  return r;
}

const verifyJson = (r, args = []) => {
  const res = r.run(['verify', '--json', ...args]);
  return { ...res, data: JSON.parse(res.out) };
};
const find = (data, inv, line, status) => data.results.filter((x) => x.invariant === inv && (line === undefined || x.line === line) && (status === undefined || x.status === status));

// -------------------------------------------------------------------------------------------------------------
const cases = {
  'every preset expands, validates and writes the §2 projection'() {
    const expected = {
      trunk: { integration: 'main', chain: ['main'], production: ['main'], productionPatterns: [], protectedPatterns: [], branches: [] },
      'two-line': { integration: 'development', chain: ['development', 'main'], production: ['main'], productionPatterns: [], protectedPatterns: [], branches: ['development'] },
      'three-line': { integration: 'development', chain: ['development', 'staging', 'main'], production: ['main'], productionPatterns: [], protectedPatterns: [], branches: ['development', 'staging'] },
      gitflow: { integration: 'develop', chain: ['develop', 'main'], production: ['main'], productionPatterns: [], protectedPatterns: ['release/*'], branches: ['develop'] },
      'maintained-releases': { integration: 'main', chain: ['main'], production: ['main'], productionPatterns: ['release/*'], protectedPatterns: ['release/*'], branches: ['release/1.0'] },
    };
    const listed = repo().run(['presets']).out;
    for (const [id, e] of Object.entries(expected)) {
      assert.match(listed, new RegExp(`^${id} `, 'm'), `presets lists ${id}`);
      const r = repo();
      for (const b of e.branches) r.branch(b);
      const { decl } = r.declare(id);
      const p = decl.projection;
      assert.equal(p.schema, 1);
      assert.equal(p.remote, 'origin', `${id}: projection.remote defaults to origin`);
      assert.equal(p.integration, e.integration, id);
      assert.deepEqual(p.chain, e.chain, id);
      assert.deepEqual(p.protected, e.chain, id);
      assert.deepEqual(p.production, e.production, id);
      assert.deepEqual(p.productionPatterns, e.productionPatterns, id);
      assert.deepEqual(p.protectedPatterns, e.protectedPatterns, id);
      assert.equal(p.workBase, e.integration, id);
      assert.equal(typeof p.summary, 'string');
      assert.equal(decl.derivedFrom, id);
      assert.ok(decl.integration.baseline, `${id}: integration baseline recorded`);
      if (id === 'maintained-releases') assert.ok(decl.releases.baselines['release/1.0'], 'existing release line baseline recorded');
      assert.equal(r.run(['validate', path.join(r.dir, '.bespunky/branches.json')]).code, 0, `${id}: written file validates`);
      assert.equal(r.run(['verify']).code, 0, `${id}: fresh declaration verifies:\n${r.run(['verify']).out}`);
    }
    // the contract's own example, exactly
    const r = repo();
    r.branch('development');
    r.branch('staging');
    const p = r.declare('three-line').decl.projection;
    assert.deepEqual(p, { schema: 1, remote: 'origin', integration: 'development', production: ['main'], productionPatterns: [], chain: ['development', 'staging', 'main'], protected: ['development', 'staging', 'main'], protectedPatterns: [], workBase: 'development', summary: 'development → staging → main' });
  },

  'write: missing line → null baseline + note; a model remote reaches the projection'() {
    const r = repo();
    r.branch('development');
    const file = r.proposed('three-line', [], (d) => (d.remote = 'upstream'));
    r.sw('development');
    const w = r.run(['write', file]);
    assert.equal(w.code, 0, w.err);
    assert.match(w.err, /staging does not exist yet/);
    const m = r.model();
    assert.equal(m.stages[0].baseline, null);
    assert.equal(m.projection.remote, 'upstream');
  },

  'expand options rename lines and keep references consistent'() {
    const r = repo();
    const { code, out } = r.run(['expand', '--preset', 'gitflow', '--integration', 'dev', '--stages', 'prod', '--release-pattern', 'rel/{version}', '--landing', 'pr', '--pr-style', 'merge']);
    assert.equal(code, 0);
    const m = JSON.parse(out);
    assert.equal(m.integration.branch, 'dev');
    assert.equal(m.releases.cutFrom, 'dev');
    assert.equal(m.releases.shipsTo, 'prod');
    assert.equal(m.tags[0].on, 'prod');
    assert.equal(m.releases.pattern, 'rel/{version}');
    assert.deepEqual(m.landing, { via: 'pr', prStyle: 'merge' });
    assert.equal(r.run(['expand', '--preset', 'nope']).code, 2);
  },

  'validation names every broken field'() {
    const r = repo();
    const bad = (edit, field) => {
      const file = r.proposed('gitflow', [], edit);
      const res = r.run(['validate', file]);
      assert.equal(res.code, 1, `expected a validation failure for ${field}`);
      assert.match(res.err, new RegExp(field.replace(/[.[\]]/g, '\\$&')), res.err);
    };
    bad((d) => (d.fixFlow = null), 'fixFlow');
    bad((d) => (d.releases.shipsTo = 'nowhere'), 'releases.shipsTo');
    bad((d) => (d.releases.shipsTo = null), 'releases.shipsTo');
    bad((d) => (d.work.types = ['feat', 'release']), 'overlaps');
    bad((d) => (d.landing = { via: 'pr', prStyle: null }), 'landing.prStyle');
    bad((d) => (d.hotfixes.pattern = 'hotfix/{slug}'), 'hotfixes.pattern');
    bad((d) => (d.releases.cutFrom = 'elsewhere'), 'releases.cutFrom');
    bad((d) => (d.work.pattern = '{slug}'), 'matches the named line');
    bad((d) => (d.stages[0].promote = 'teleport'), 'stages[0].promote');
    bad((d) => (d.extra = 1), 'extra');
    bad((d) => (d.stages[0].branch = 'develop'), 'stages[0].branch');
  },

  'status: exit 3 when undeclared, listing what is protected meanwhile'() {
    const r = repo();
    r.branch('development');
    r.branch('feature-x');
    const res = r.run(['status']);
    assert.equal(res.code, 3);
    assert.match(res.out, /undeclared/);
    assert.match(res.out, /main, development/);
    const j = r.json(['status', '--json']);
    assert.equal(j.code, 3);
    assert.deepEqual(j.data, { declared: false, protected: ['main', 'development'] });
    for (const cmd of [['describe'], ['plan', 'promote', 'staging'], ['verify']]) assert.equal(r.run(cmd).code, 3, cmd.join(' '));
  },

  'resolution: the integration tip wins over a differing working-tree copy'() {
    const r = threeLine();
    r.git('switch', '-q', '-c', 'feat/x', 'development');
    const m = r.model();
    m.projection.summary = 'LOCAL EDIT';
    r.write('.bespunky/branches.json', JSON.stringify(m));
    const res = r.json(['status', '--json']);
    assert.equal(res.code, 0);
    assert.equal(res.data.summary, 'development → staging → main');
    assert.match(res.err, /differs from the one on "development"/);
  },

  'resolution: a copy whose integration line holds none → undeclared, with a note'() {
    const r = repo();
    r.branch('development');
    r.git('switch', '-q', '-c', 'feat/declare', 'development');
    const file = r.proposed('three-line');
    assert.equal(r.run(['write', file]).code, 0);
    const res = r.run(['status']);
    assert.equal(res.code, 3);
    assert.match(res.err, /not in force until it lands there/);
  },

  'resolution: integration line resolvable nowhere → the working-tree copy, with a note'() {
    const r = repo();
    const file = r.proposed('two-line', ['--integration', 'trunkline']);
    assert.equal(r.run(['write', file]).code, 0);
    const res = r.json(['status', '--json']);
    assert.equal(res.code, 0);
    assert.equal(res.data.integration, 'trunkline');
    assert.match(res.err, /could not be resolved/);
  },

  'resolution: no working-tree copy → self-confirming search (and a non-confirming copy is ignored)'() {
    const r = repo();
    r.branch('development');
    r.branch('staging');
    r.git('branch', 'feat/old', 'main'); // cut before the declaration
    r.declare('three-line');
    r.sw('feat/old');
    const res = r.json(['status', '--json']);
    assert.equal(res.code, 0, res.err);
    assert.equal(res.data.integration, 'development');
    assert.match(res.err, /refs\/heads\/development/);

    // A copy on staging naming development, while development has none, confirms nothing.
    const q = repo();
    q.branch('development');
    q.git('switch', '-q', '-c', 'staging');
    q.run(['write', q.proposed('three-line')]);
    q.git('add', '-A');
    q.git('commit', '-q', '-m', 'copy on staging only');
    q.sw('main');
    assert.equal(q.run(['status']).code, 3);
  },

  'resolution: projection.remote picks the remote-tracking tip'() {
    const r = repo();
    r.git('switch', '-q', '-c', 'development');
    const file = r.proposed('two-line', [], (d) => (d.remote = 'upstream'));
    assert.equal(r.run(['write', file]).code, 0);
    r.git('add', '-A');
    r.git('commit', '-q', '-m', 'declare');
    r.git('update-ref', 'refs/remotes/upstream/development', 'HEAD');
    r.git('switch', '-q', '-c', 'feat/y');
    r.git('branch', '-q', '-D', 'development');
    const m = r.model();
    m.projection.summary = 'stale';
    r.write('.bespunky/branches.json', JSON.stringify(m));
    const res = r.json(['status', '--json']);
    assert.equal(res.code, 0, res.err);
    assert.equal(res.data.summary, 'development → main');
    assert.match(res.err, /differs/);
  },

  'verify: a healthy ff chain passes'() {
    const r = threeLine();
    r.git('switch', '-q', '-c', 'feat/a', 'development');
    r.commit('feat: a');
    r.sw('development');
    r.merge('feat/a');
    r.sw('staging');
    r.ff('development');
    r.sw('main');
    r.ff('staging');
    const v = verifyJson(r);
    assert.equal(v.code, 0, v.out);
    assert.equal(find(v.data, 1, 'staging', 'ok').length, 1);
    assert.equal(find(v.data, 2, 'staging', 'ok').length, 1);
    assert.equal(find(v.data, 5, '*', 'ok').length, 1);
  },

  'verify: a direct commit on a stage is a violation'() {
    const r = threeLine();
    r.sw('staging');
    r.commit('oops: straight onto staging');
    const v = verifyJson(r);
    assert.equal(v.code, 1);
    assert.equal(find(v.data, 1, 'staging', 'violation').length, 1);
    assert.equal(find(v.data, 2, 'staging', 'violation').length, 1);
    assert.match(find(v.data, 1, 'staging')[0].commits[0], /oops/);
  },

  'verify: healthy gitflow passes no-regression (release merged into main and develop separately)'() {
    const r = gitflow();
    r.git('switch', '-q', '-c', 'feat/x', 'develop');
    r.commit('feat: x', 'package.json', '{\n  "name": "x",\n  "version": "0.9.0"\n}\n');
    r.sw('develop');
    r.merge('feat/x');
    r.git('branch', 'release/1.0', 'develop');
    r.sw('release/1.0');
    r.write('package.json', '{\n  "name": "x",\n  "version": "1.0.0"\n}\n');
    r.git('add', '-A');
    r.git('commit', '-q', '-m', 'chore: bump 1.0.0'); // a direct version bump: allowed on a release line
    r.sw('main');
    r.merge('release/1.0');
    r.git('tag', '-a', 'v1.0.0', '-m', 'v1.0.0');
    r.sw('develop');
    r.merge('release/1.0');
    // a hotfix, landed on main and carried by merge
    r.git('switch', '-q', '-c', 'hotfix/main/crash', 'main');
    r.commit('fix: crash');
    r.sw('main');
    r.merge('hotfix/main/crash');
    r.sw('develop');
    r.merge('hotfix/main/crash');
    const v = verifyJson(r);
    assert.equal(v.code, 0, v.out);
    assert.equal(find(v.data, 3, 'main', 'ok').length, 1);
    assert.match(find(v.data, 1, 'release/1.0', 'ok')[0].reason, /version-bump/);
    assert.ok(find(v.data, 4, undefined, 'warning').length >= 1, 'merged hotfix/release lines left behind are hygiene warnings');
  },

  'verify: an un-carried hotfix on main is a violation — unless it says Not-applicable-upstream'() {
    const r = gitflow();
    r.git('switch', '-q', '-c', 'hotfix/main/leak', 'main');
    r.commit('fix: leak');
    r.sw('main');
    r.merge('hotfix/main/leak');
    let v = verifyJson(r);
    assert.equal(v.code, 1);
    assert.equal(find(v.data, 3, 'main', 'violation').length, 1);
    assert.match(find(v.data, 3, 'main')[0].commits[0], /fix: leak/);

    const q = gitflow();
    q.git('switch', '-q', '-c', 'hotfix/main/old-api', 'main');
    q.commit('fix: old api\n\nNot-applicable-upstream: the old API is gone on develop');
    q.sw('main');
    q.merge('hotfix/main/old-api');
    v = verifyJson(q);
    assert.equal(v.code, 0, v.out);
    assert.match(find(v.data, 3, 'main', 'ok')[0].reason, /accepted/);
  },

  'verify: upstream-first cherry-pick -x passes by patch equivalence'() {
    const r = repo();
    r.branch('release/1.0');
    r.declare('maintained-releases');
    r.git('switch', '-q', '-c', 'fix/bug', 'main');
    const fix = r.commit('fix: bug', 'src/bug.txt', 'fixed\n');
    r.sw('main');
    r.merge('fix/bug');
    r.sw('release/1.0');
    r.git('cherry-pick', '-x', fix);
    const v = verifyJson(r);
    assert.equal(v.code, 0, v.out);
    assert.equal(find(v.data, 1, 'release/1.0', 'ok').length, 1);
    assert.equal(find(v.data, 3, 'release/1.0', 'ok').length, 1);

    // and a fix made only on the maintained line is a regression waiting to happen
    r.commit('fix: only on 1.0', 'src/only.txt', 'x\n');
    const w = verifyJson(r);
    assert.equal(w.code, 1);
    assert.equal(find(w.data, 3, 'release/1.0', 'violation').length, 1);
  },

  'verify: squash-PR landing makes direct-looking commits advisory, not violations'() {
    const r = threeLine(['--landing', 'pr', '--pr-style', 'squash']);
    r.sw('development');
    r.commit('feat: squashed (#12)');
    const v = verifyJson(r);
    assert.equal(v.code, 0, v.out);
    assert.equal(find(v.data, 1, 'development', 'advisory').length, 1);
  },

  'verify: projection drift is a violation'() {
    const r = threeLine();
    r.sw('development');
    const m = r.model();
    m.projection.protected = ['development'];
    r.write('.bespunky/branches.json', JSON.stringify(m, null, 2));
    r.git('commit', '-qam', 'hand-edit');
    const v = verifyJson(r);
    assert.equal(v.code, 1);
    assert.equal(find(v.data, 5, '*', 'violation').length, 1);
  },

  'verify --proposed: history before the model is forgiven for 1–2, never for 3'() {
    const r = repo();
    r.branch('development');
    r.branch('staging');
    r.sw('staging');
    r.commit('past direct commit on staging');
    const prop = r.proposed('three-line');
    let v = verifyJson(r, ['--proposed', prop]);
    assert.equal(v.code, 0, v.out);
    assert.equal(find(v.data, 5).length, 0, 'no projection check on a proposed model');

    const q = repo();
    q.branch('develop');
    q.sw('main');
    q.commit('fix: hotfix that never reached develop');
    v = verifyJson(q, ['--proposed', q.proposed('gitflow')]);
    assert.equal(v.code, 1);
    assert.match(find(v.data, 3, 'main', 'violation')[0].reason, /full history/);
  },

  'plan: three-line gates, printed and never executed'() {
    const r = threeLine();
    r.git('switch', '-q', '-c', 'feat/a', 'development');
    r.commit('feat: a');
    const before = r.refs();
    const land = r.run(['plan', 'land', 'feat/a']);
    assert.equal(land.code, 0, land.err);
    assert.match(land.out, /git rebase origin\/development/);
    assert.match(land.out, /git merge --no-ff feat\/a/);
    assert.match(land.out, /git push origin development/);
    const promote = r.run(['plan', 'promote', 'staging']);
    assert.match(promote.out, /git merge --ff-only origin\/development/);
    assert.match(promote.out, /git push origin staging/);
    assert.match(r.run(['plan', 'promote', 'main']).out, /git merge --ff-only origin\/staging/);
    const start = r.run(['plan', 'start', 'feat', 'thing']);
    assert.match(start.out, /git worktree add \.claude\/worktrees\/thing -b feat\/thing origin\/development/);
    assert.equal(r.run(['plan', 'start', 'wip', 'thing']).code, 2, 'undeclared work type refused');
    for (const g of [['cut-release', '1.0'], ['ship-release', '1.0'], ['hotfix', 'main', 'x'], ['carry', 'feat/a'], ['promote', 'qa'], ['teleport']]) {
      const res = r.run(['plan', ...g]);
      assert.equal(res.code, 2, `${g.join(' ')} refused`);
      assert.ok(res.err.length > 0);
    }
    assert.equal(r.refs(), before, 'plan changed no ref');
  },

  'plan: pr landing and pr promotion speak gh'() {
    const r = threeLine(['--landing', 'pr', '--pr-style', 'squash'], (d) => (d.stages[1].promote = 'pr'));
    r.git('switch', '-q', '-c', 'fix/b', 'development');
    assert.match(r.run(['plan', 'land', 'fix/b']).out, /gh pr create --base development --head fix\/b[\s\S]*gh pr merge fix\/b --squash/);
    assert.match(r.run(['plan', 'promote', 'main']).out, /gh pr create --base main --head staging/);
  },

  'plan: gitflow — cut, ship, hotfix, carry; promote refused on the release-fed stage'() {
    const r = gitflow();
    assert.match(r.run(['plan', 'cut-release', '1.1']).out, /git branch release\/1\.1 origin\/develop[\s\S]*git push -u origin release\/1\.1/);
    r.git('branch', 'release/1.0', 'develop');
    const ship = r.run(['plan', 'ship-release', '1.0']);
    assert.equal(ship.code, 0, ship.err);
    assert.match(ship.out, /git switch main[\s\S]*git merge --no-ff origin\/release\/1\.0[\s\S]*git tag -a v1\.0 main[\s\S]*git switch develop[\s\S]*git merge --no-ff origin\/release\/1\.0[\s\S]*git push origin --delete release\/1\.0/);
    assert.equal(r.run(['plan', 'ship-release', '9.9']).code, 2, 'shipping a release that does not exist is refused');
    const hot = r.run(['plan', 'hotfix', 'main', 'crash']);
    assert.match(hot.out, /git worktree add \.claude\/worktrees\/crash -b hotfix\/main\/crash origin\/main/);
    r.git('branch', 'hotfix/main/crash', 'main');
    r.sw('hotfix/main/crash');
    r.commit('fix: crash');
    const carry = r.run(['plan', 'carry', 'hotfix/main/crash']);
    assert.match(carry.out, /git switch develop[\s\S]*git merge --no-ff hotfix\/main\/crash/);
    assert.match(carry.out, /release\/1\.0/, 'open release lines are carried to as well');
    assert.equal(r.run(['plan', 'carry', 'HEAD']).code, 2, 'merge-forward carries a branch, not a commit');
    assert.match(r.run(['plan', 'promote', 'main']).err, /release-fed/);
    assert.match(r.run(['plan', 'land', 'hotfix/main/crash']).out, /git rebase origin\/main[\s\S]*plan carry hotfix\/main\/crash/);
  },

  'plan: maintained-releases — upstream-first hotfix and cherry-pick carry; trunk has nothing to promote'() {
    const r = repo();
    r.branch('release/1.0');
    r.declare('maintained-releases');
    const hot = r.run(['plan', 'hotfix', '1.0', 'cve']);
    assert.equal(hot.code, 0, hot.err);
    assert.match(hot.out, /-b hotfix\/1\.0\/cve origin\/main/);
    const fix = r.commit('fix: cve');
    const carry = r.run(['plan', 'carry', fix]);
    assert.equal(carry.code, 0, carry.err);
    assert.match(carry.out, /git switch release\/1\.0[\s\S]*git cherry-pick -x [0-9a-f]{12}/);
    assert.match(r.run(['plan', 'ship-release', '1.0']).out, /git tag -a v1\.0 origin\/release\/1\.0/);

    const t = repo();
    t.declare('trunk');
    assert.match(t.run(['plan', 'promote', 'main']).err, /no stages/);
  },

  'describe: names every line, role and how it advances'() {
    const r = gitflow();
    const d = r.run(['describe']);
    assert.equal(d.code, 0);
    for (const s of ['develop', 'main', 'release/{version}', 'hotfix/{line}/{slug}', 'merge-forward', 'v{version}']) assert.ok(d.out.includes(s), s);
  },

  'evidence: every fact is tagged; remote facts are unobservable without gh; bindings and shapes found'() {
    const r = gitflow();
    r.git('branch', 'release/2.0', 'develop');
    r.write('.github/workflows/deploy.yml', 'name: d\non:\n  push:\n    branches: [main]\n    tags:\n      - "v*"\njobs: {}\n');
    r.write('apphosting.staging.yaml', 'x: 1\n');
    r.git('add', '-A');
    r.git('commit', '-q', '-m', 'ci');
    r.git('tag', 'v1.0.0', 'main');
    const e = r.json(['evidence', '--json']);
    assert.equal(e.code, 0, e.err);
    const facts = e.data.facts;
    assert.ok(facts.every((f) => ['observed', 'inferred', 'unobservable'].includes(f.tag)), 'every fact tagged');
    assert.ok(facts.some((f) => f.area === 'remote' && f.tag === 'unobservable'), 'gh facts unobservable');
    const wf = facts.find((f) => f.subject === '.github/workflows/deploy.yml');
    assert.equal(wf.tag, 'inferred');
    assert.deepEqual(wf.value, [{ event: 'push', filter: 'branches', values: ['main'] }, { event: 'push', filter: 'tags', values: ['v*'] }]);
    assert.ok(facts.some((f) => f.area === 'bindings' && f.subject === 'apphosting.staging.yaml' && f.tag === 'observed'));
    assert.ok(facts.some((f) => f.area === 'shapes' && f.subject === 'release/2.0' && f.tag === 'observed'));
    assert.ok(facts.some((f) => f.area === 'regression' && f.subject === 'main'));
    assert.ok(facts.some((f) => f.area === 'advancement' && f.subject === 'main'));
  },

  'the engine refuses state-changing git, structurally'() {
    const src = fs.readFileSync(path.join(path.dirname(ENGINE), 'lib/git.mjs'), 'utf8');
    assert.ok(!/['"](merge|push|commit|reset|checkout|switch|branch|tag|update-ref)['"]/.test(src.split('const READ_ONLY')[1].split(']);')[0]), 'allowlist holds only read-only subcommands');
    const mode = fs.statSync(ENGINE).mode;
    assert.ok(mode & 0o111, 'branches.mjs is executable');
  },
};

let failed = 0;
const only = process.argv[2];
const selected = Object.entries(cases).filter(([name]) => !only || name.includes(only));
for (const [name, test] of selected) {
  try {
    test();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failed++;
    console.log(`  FAIL ${name}\n       ${String(error.stack || error.message).split("\n").slice(0, 40).join('\n       ')}`);
  }
}
fs.rmSync(SCRATCH, { recursive: true, force: true });
console.log(failed ? `${failed} of ${selected.length} branch-model tests failed` : `all ${selected.length} branch-model tests passed`);
process.exit(failed ? 1 : 0);
