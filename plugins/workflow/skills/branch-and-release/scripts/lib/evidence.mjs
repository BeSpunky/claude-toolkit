// The investigation's raw facts (CONTRACT §6) — the input to "which model does this repo actually run?".
//
// Projects scaffolded under the old fixed model all HAVE development/staging/main whether they use them or not,
// so the branch list alone proves nothing. Each fact is tagged by how it is known:
//   observed     — read directly (refs, history, files, an authenticated API answer)
//   inferred     — derived by a heuristic that can be wrong (a crude YAML read, a history pattern)
//   unobservable — cannot be known from here; it becomes a question to the user, never an assumption
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { verify } from './verify.mjs';
import { SCHEMA } from './model.mjs';

const LONG_LIVED = ['development', 'develop', 'staging', 'qa', 'main', 'master', 'production', 'trunk'];
const RANK = { development: 0, develop: 0, trunk: 0, staging: 1, qa: 1, main: 2, master: 2, production: 2 };
const HISTORY = 400; // first-parent commits examined per line

export function evidence(git, top, resolved) {
  const facts = [];
  const fact = (area, subject, value, tag) => facts.push({ area, subject, value, tag });
  const model = resolved.declared ? resolved.model : null;
  const remote = model?.remote || 'origin';

  // ---- branches ------------------------------------------------------------------------------------------
  const refs = git.lines(['for-each-ref', '--format=%(refname)\t%(objectname)\t%(committerdate:iso-strict)', 'refs/heads', 'refs/remotes']);
  for (const l of refs) {
    const [ref, sha, date] = l.split('\t');
    if (ref.endsWith('/HEAD')) continue;
    fact('branches', ref.replace(/^refs\/(heads|remotes)\//, (_, k) => (k === 'heads' ? '' : 'remote:')), { tip: sha.slice(0, 12), lastActivity: date }, 'observed');
  }
  const names = git.branchNames(remote);
  const longLived = [...new Set([...(model ? [model.integration.branch, ...model.stages.map((s) => s.branch)] : []), ...LONG_LIVED.filter((n) => names.includes(n))])].filter((n) => names.includes(n));
  const tip = (n) => git.sha(git.ref(n, remote) ?? n);

  // ---- ahead/behind matrix -------------------------------------------------------------------------------
  for (let i = 0; i < longLived.length; i++)
    for (let j = i + 1; j < longLived.length; j++) {
      const [a, b] = [longLived[i], longLived[j]];
      const out = git.try(['rev-list', '--left-right', '--count', `${tip(a)}...${tip(b)}`]);
      if (out) {
        const [ahead, behind] = out.split(/\s+/).map(Number);
        fact('matrix', `${a} vs ${b}`, { [`${a} ahead`]: ahead, [`${b} ahead`]: behind }, 'observed');
      }
    }

  // ---- how each long-lived line advanced -----------------------------------------------------------------
  const ordered = model ? [model.integration.branch, ...model.stages.map((s) => s.branch)].filter((n) => longLived.includes(n)) : [...longLived].sort((a, b) => (RANK[a] ?? 9) - (RANK[b] ?? 9));
  const upstreamOf = (n) => {
    const i = ordered.indexOf(n);
    return i > 0 ? ordered[i - 1] : null;
  };
  for (const n of longLived) {
    const fp = git.lines(['rev-list', '--first-parent', '--parents', '-n', String(HISTORY), tip(n)]).map((l) => l.split(' '));
    const merges = fp.filter((p) => p.length > 2).length;
    const singles = fp.filter((p) => p.length <= 2).map((p) => p[0]);
    const up = upstreamOf(n);
    const upTip = up && tip(up);
    const ffArrivals = upTip ? singles.filter((c) => git.isAncestor(c, upTip)).length : 0;
    fact('advancement', n, { examined: fp.length, mergeCommits: merges, ffArrivalsFrom: up, ffArrivals, directCommits: singles.length - ffArrivals }, 'inferred');

    // How long the downstream line sat behind: arrival times come only from the LOCAL reflog.
    if (up) {
      const arrivals = reflog(git, n);
      const upArrivals = new Map(reflog(git, up).map(([sha, t]) => [sha, t]));
      const lags = [];
      for (const [sha, t] of arrivals) {
        const upT = upArrivals.get(sha);
        if (upT !== undefined && t >= upT) lags.push(t - upT);
      }
      if (lags.length) {
        lags.sort((a, b) => a - b);
        const median = lags[Math.floor(lags.length / 2)];
        fact('lag', `${up} → ${n}`, { promotions: lags.length, medianSeconds: median, maxSeconds: lags.at(-1), reading: median < 600 ? 'back-to-back (ceremony?)' : 'separated (a gate in use?)' }, 'inferred');
      } else fact('lag', `${up} → ${n}`, 'promotion timing is not in this clone’s reflog (arrival times are local-only)', 'unobservable');
    }
  }

  // ---- release / hotfix shapes, tags, cherry-picks -------------------------------------------------------
  for (const n of names.filter((b) => /^(release|hotfix|releases|hotfixes)[/-]/.test(b))) fact('shapes', n, 'live branch', 'observed');
  const mergeNames = new Set();
  for (const s of git.lines(['log', '--all', '--merges', '--format=%s'])) for (const m of s.matchAll(/\b((?:release|hotfix)[/-][^\s'"`,]+)/g)) mergeNames.add(m[1]);
  for (const n of mergeNames) if (!names.includes(n)) fact('shapes', n, 'named in a merge message (branch gone)', 'observed');

  const tags = git.lines(['for-each-ref', '--sort=-creatordate', '--format=%(refname:short)', 'refs/tags']);
  const series = new Map();
  for (const t of tags) {
    const key = t.replace(/\d+/g, '#');
    series.set(key, (series.get(key) ?? 0) + 1);
  }
  for (const [key, count] of series) fact('tags', key, { count }, 'inferred');
  for (const t of tags.slice(0, 10)) fact('tags', t, { containedIn: longLived.filter((n) => git.isAncestor(`refs/tags/${t}^{commit}`, tip(n))) }, 'observed');

  const picked = git.lines(['log', '--all', '--format=%H', '--grep=cherry picked from commit']);
  fact('cherry-picks', '(cherry picked from commit …) trailers', { count: picked.length }, 'observed');
  const prMerges = git.lines(['log', '--all', '--merges', '--format=%s', '--grep=^Merge pull request #']).length;
  const squashLike = git.lines(['log', '--all', '--no-merges', '--format=%s']).filter((s) => / \(#\d+\)$/.test(s)).length;
  fact('landing', 'merge commits "Merge pull request #…"', { count: prMerges }, 'observed');
  fact('landing', 'single commits ending "(#N)" (squash/rebase PR merges)', { count: squashLike }, 'inferred');

  // ---- bindings (working tree, tracked files only) -------------------------------------------------------
  const files = git.lines(['ls-files']);
  for (const f of files.filter((x) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(x))) {
    const triggers = workflowTriggers(fs.readFileSync(path.join(top, f), 'utf8'));
    fact('bindings', f, triggers.length ? triggers : 'no branch/tag filters', 'inferred');
  }
  for (const f of files.filter((x) => /(^|\/)apphosting[^/]*\.ya?ml$/.test(x))) fact('bindings', f, 'App Hosting config', 'observed');
  if (files.includes('firebase.json')) fact('bindings', 'firebase.json', 'present', 'observed');
  if (files.includes('.firebaserc')) {
    try {
      const rc = JSON.parse(fs.readFileSync(path.join(top, '.firebaserc'), 'utf8'));
      fact('bindings', '.firebaserc', { projects: rc.projects ?? {} }, 'observed');
    } catch {
      fact('bindings', '.firebaserc', 'unparseable', 'observed');
    }
  }
  for (const f of files.filter((x) => /(env|environment)[^/]*$/i.test(x) && /(staging|production|prod)/i.test(path.basename(x)))) fact('bindings', f, 'environment file', 'observed');
  fact('bindings', 'App Hosting backends / console-only deploy targets', 'live in the cloud console — ask', 'unobservable');

  // ---- remote side ---------------------------------------------------------------------------------------
  remoteFacts(fact, longLived);

  // ---- invariant 3 over full history ---------------------------------------------------------------------
  const probe = model ?? provisional(names);
  if (probe) {
    for (const r of verify(git, probe, { proposed: true, branches: names }).filter((x) => x.invariant === 3))
      fact('regression', r.line, { status: r.status, reason: r.reason, ...(r.commits ? { commits: r.commits } : {}) }, model ? 'observed' : 'inferred');
  } else fact('regression', '*', 'no integration/production pair recognisable by name', 'unobservable');

  return facts;
}

function reflog(git, name) {
  return git
    .lines(['log', '-g', '--date=unix', '--format=%H %gd', `refs/heads/${name}`])
    .map((l) => {
      const m = /^([0-9a-f]+) .*@\{(\d+)\}$/.exec(l);
      return m ? [m[1], Number(m[2])] : null;
    })
    .filter(Boolean);
}

/** A model guessed from names alone, only to run the regression probe on an undeclared repo. */
function provisional(names) {
  const integration = ['development', 'develop'].find((n) => names.includes(n));
  const production = ['main', 'master'].find((n) => names.includes(n));
  if (!integration || !production) return null;
  return { schema: SCHEMA, remote: 'origin', integration: { branch: integration, baseline: null }, stages: [{ branch: production, promote: 'ff', baseline: null }], releases: null, hotfixes: null, work: { pattern: '{type}/{slug}' }, fixFlow: null, landing: { via: 'merge', prStyle: null }, tags: [] };
}

/** Crude `on:` read: [{ event, filter, values }]. Not a YAML parser — hence `inferred`. */
export function workflowTriggers(text) {
  const out = [];
  const lines = text.split('\n');
  let event = null;
  let eventIndent = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\s+#.*$/, '');
    const indent = line.search(/\S/);
    if (indent < 0) continue;
    const ev = /^\s*(push|pull_request|pull_request_target|release|workflow_run)\s*:/.exec(line);
    if (ev) {
      event = ev[1];
      eventIndent = indent;
      continue;
    }
    if (event && indent <= eventIndent) event = null;
    const f = /^\s*(branches|branches-ignore|tags|tags-ignore)\s*:\s*(.*)$/.exec(line);
    if (!f || !event) continue;
    let values = [];
    if (f[2].startsWith('[')) values = f[2].replace(/[[\]]/g, '').split(',');
    else if (f[2]) values = [f[2]];
    else
      for (let j = i + 1; j < lines.length; j++) {
        const item = /^\s*-\s*(.+)$/.exec(lines[j]);
        if (!item) break;
        values.push(item[1]);
      }
    out.push({ event, filter: f[1], values: values.map((v) => v.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) });
  }
  return out;
}

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000, env: { ...process.env, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1' } }).trim();
}

function remoteFacts(fact, longLived) {
  const unobservable = (why) => {
    for (const s of ['branch protection', 'required pull requests', 'GitHub environments', 'who pushes to protected lines']) fact('remote', s, why, 'unobservable');
  };
  let repo;
  try {
    gh(['auth', 'status']);
  } catch {
    return unobservable('gh is not installed or not authenticated — ask');
  }
  try {
    repo = gh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']);
  } catch {
    return unobservable('this repo has no GitHub remote gh can resolve — ask');
  }
  for (const b of longLived) {
    try {
      const p = JSON.parse(gh(['api', `repos/${repo}/branches/${b}/protection`]));
      fact('remote', `protection: ${b}`, { protected: true, requiredPullRequests: Boolean(p.required_pull_request_reviews), requiredChecks: p.required_status_checks?.contexts ?? [], linearHistory: Boolean(p.required_linear_history?.enabled) }, 'observed');
    } catch (e) {
      fact('remote', `protection: ${b}`, 'not protected, or not visible to this token', 'unobservable');
    }
  }
  try {
    fact('remote', 'GitHub environments', gh(['api', `repos/${repo}/environments`, '-q', '.environments[].name']).split('\n').filter(Boolean), 'observed');
  } catch {
    fact('remote', 'GitHub environments', 'not visible to this token', 'unobservable');
  }
  fact('remote', 'who pushes to protected lines', 'not in git history — ask', 'unobservable');
}
