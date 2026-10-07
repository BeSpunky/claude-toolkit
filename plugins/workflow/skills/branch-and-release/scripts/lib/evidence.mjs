// The investigation's raw facts (CONTRACT §6) — the input to "which model does this repo actually run?".
//
// Projects scaffolded under the old fixed model all HAVE development/staging/main whether they use them or not,
// so the branch list alone proves nothing. Each fact is tagged by how it is known:
//   observed     — read directly (refs, history, files, an authenticated API answer)
//   inferred     — derived by a heuristic that can be wrong (a crude YAML read, a history pattern)
//   unobservable — cannot be known from here; it becomes a question to the user, never an assumption
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { verify } from './verify.mjs';
import { SCHEMA, deployBindings } from './model.mjs';
import { match } from './patterns.mjs';
import { detectLongLived } from './long-lived.mjs';
import { WORKFLOW, triggerScope, deploySignals, workflowTriggers } from './workflows.mjs';

const HISTORY = 400; // first-parent commits examined per line
const RECENT_DAYS = 90; // direct commits older than this are history, not a live practice
const DAY = 86400;

export function evidence(git, top, resolved, { appHosting = false } = {}) {
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
  // Which of them are LINES: not a name list — the declared lines, conventional names, the remote default, CI
  // push targets, and whatever repeatedly promotes into or out of those (lib/long-lived.mjs). Reasons per line.
  const detected = detectLongLived(git, top, { model, remote, branches: names });
  const longLived = detected.lines;
  for (const n of longLived) fact('long-lived', n, { reasons: detected.reasons[n] }, detected.reasons[n].every((r) => r === 'declared') ? 'observed' : 'inferred');
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
  const ordered = model ? [model.integration.branch, ...model.stages.map((s) => s.branch)].filter((n) => longLived.includes(n)) : longLived;
  const upstreamOf = (n) => {
    const i = ordered.indexOf(n);
    return i > 0 ? ordered[i - 1] : null;
  };
  // Every count names its unit: COMMITS walked on a line's first-parent history, or promotion EVENTS (moves).
  const now = Math.floor(Date.now() / 1000);
  for (const n of longLived) {
    const fp = git.lines(['log', '--first-parent', '-n', String(HISTORY), '--format=%H %P%x09%ct', tip(n)]).map((l) => {
      const [shas, time] = l.split('\t');
      return { parents: shas.split(' ').length - 1, sha: shas.split(' ')[0], time: Number(time) };
    });
    const merges = fp.filter((c) => c.parents > 1).length;
    const singles = fp.filter((c) => c.parents <= 1);
    const up = upstreamOf(n);
    const upTip = up && tip(up);
    const ffArrived = upTip ? singles.filter((c) => git.isAncestor(c.sha, upTip)) : [];
    const direct = singles.filter((c) => !ffArrived.includes(c));
    const recent = direct.filter((c) => now - c.time <= RECENT_DAYS * DAY).length;
    fact(
      'advancement',
      n,
      {
        examinedCommits: fp.length,
        mergeCommits: merges,
        ffArrivedFrom: up,
        ffArrivedCommits: ffArrived.length,
        directCommits: { total: direct.length, [`last${RECENT_DAYS}Days`]: recent, older: direct.length - recent, newest: direct.length ? isoDay(Math.max(...direct.map((c) => c.time))) : null },
      },
      'inferred',
    );

    // How long the downstream line sat behind: arrival times come only from the LOCAL reflog.
    if (up) {
      const arrivals = reflog(git, n).filter((a) => a.kind === 'moved');
      const upArrivals = new Map(reflog(git, up).map((a) => [a.sha, a.time]));
      const lags = [];
      for (const { sha, time } of arrivals) {
        const upT = upArrivals.get(sha);
        if (upT !== undefined && time >= upT) lags.push(time - upT);
      }
      if (lags.length) {
        lags.sort((a, b) => a - b);
        const median = lags[Math.floor(lags.length / 2)];
        fact('lag', `${up} → ${n}`, { promotionEvents: lags.length, medianSeconds: median, maxSeconds: lags.at(-1), reading: median < 600 ? 'back-to-back (ceremony?)' : 'separated (a gate in use?)' }, 'inferred');
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
  const onALine = new Set(longLived.flatMap((n) => git.lines(['for-each-ref', `--merged=${tip(n)}`, '--format=%(refname:short)', 'refs/tags'])));
  const loose = tags.filter((t) => !onALine.has(t));
  if (loose.length) fact('tags', 'not on any line', { count: loose.length, examples: loose.slice(0, 5), reading: 'no long-lived line contains them — e.g. restore points, or tags on work that never landed' }, 'observed');

  const picked = git.lines(['log', '--all', '--format=%H', '--grep=cherry picked from commit']);
  fact('cherry-picks', '(cherry picked from commit …) trailers', { count: picked.length }, 'observed');
  const prMerges = git.lines(['log', '--all', '--merges', '--format=%s', '--grep=^Merge pull request #']).length;
  const squashLike = git.lines(['log', '--all', '--no-merges', '--format=%s']).filter((s) => / \(#\d+\)$/.test(s)).length;
  fact('landing', 'merge commits "Merge pull request #…"', { count: prMerges }, 'observed');
  fact('landing', 'single commits ending "(#N)" (squash/rebase PR merges)', { count: squashLike }, 'inferred');

  // ---- bindings (working tree, tracked files only) -------------------------------------------------------
  // A repo that SHIPS templates (a generator payload, vendored deps) carries files that are someone else's
  // bindings, not its own — see `shipped()`.
  const tracked = git.lines(['ls-files']);
  const files = tracked.filter((f) => !shipped(f));
  const skipped = tracked.filter((f) => shipped(f) && BINDING_LIKE.some((re) => re.test(f)));
  for (const f of files.filter((x) => WORKFLOW.test(x))) {
    const text = fs.readFileSync(path.join(top, f), 'utf8');
    const triggers = workflowTriggers(text).map((t) => ({ ...t, ...triggerScope(t, longLived) }));
    const signals = deploySignals(text);
    fact('bindings', f, triggers.length ? { triggers, deploys: signals.length > 0, deploySignals: signals } : 'no branch/tag filters', 'inferred');
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
  for (const f of files.filter((x) => ENV_FILE.test(x) && /(staging|production|prod)/i.test(path.basename(x)))) fact('bindings', f, 'environment file', 'observed');
  if (skipped.length) fact('bindings', '(shipped templates skipped)', { count: skipped.length, examples: skipped.slice(0, 3), rule: SHIPPED_RULE }, 'observed');
  if (appHosting) appHostingFacts(fact, top, files, model);
  else fact('bindings', 'App Hosting backends / console-only deploy targets', 'live in the cloud console — re-run with `evidence --app-hosting` (a logged-in firebase CLI) to observe them, or ask', 'unobservable');

  // ---- remote side ---------------------------------------------------------------------------------------
  remoteFacts(fact, longLived);

  // ---- invariant 3 over full history ---------------------------------------------------------------------
  const probe = model ?? provisional(longLived);
  if (probe) {
    for (const r of verify(git, probe, { proposed: true, branches: names, longLived }).filter((x) => x.invariant === 3))
      fact('regression', r.line, { status: r.status, reason: r.reason, ...(r.commits ? { commits: r.commits } : {}) }, model ? 'observed' : 'inferred');
  } else fact('regression', '*', 'fewer than two long-lived lines detected — no integration/production pair to compare', 'unobservable');

  return facts;
}

/** A branch's local reflog, newest first: { sha, time, kind }. Only a `moved` entry can be a promotion: a
 *  `created` one is where the branch came into existence (branch/clone/rename) and a `committed` one was made
 *  ON the line — counting either reads the line's birth or its own work as a promotion. */
function reflog(git, name) {
  return git
    .lines(['log', '-g', '--date=unix', '--format=%H %gd%x09%gs', `refs/heads/${name}`])
    .map((l) => {
      const m = /^([0-9a-f]+) .*@\{(\d+)\}\t(.*)$/.exec(l);
      if (!m) return null;
      const kind = /^(branch: Created from|clone: from|Branch: renamed)/.test(m[3]) ? 'created' : /^commit\b/.test(m[3]) ? 'committed' : 'moved';
      return { sha: m[1], time: Number(m[2]), kind };
    })
    .filter(Boolean);
}

const isoDay = (t) => new Date(t * 1000).toISOString().slice(0, 10);

const ENV_FILE = /(env|environment)[^/]*$/i;
/** What would read as a binding if it were the repo's own (used only to report what `shipped()` skipped). */
const BINDING_LIKE = [/(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/, /(^|\/)apphosting[^/]*\.ya?ml$/, /(^|\/)firebase\.json$/, /(^|\/)\.firebaserc$/, ENV_FILE];

const SHIPPED_RULE = 'template or payload files the repo ships, not bindings of its own: *.tpl / *.template, anything under node_modules/ or vendor/, and files/ or templates/ directories below a generators/ directory';
/** True for a tracked file that is a template or payload this repo SHIPS to others (SHIPPED_RULE). */
export function shipped(file) {
  const segs = file.split('/');
  if (/\.(tpl|template)$/i.test(segs.at(-1))) return true;
  if (segs.some((s) => s === 'node_modules' || s === 'vendor')) return true;
  const gen = segs.findIndex((s) => s === 'generators');
  return gen >= 0 && segs.slice(gen + 1, -1).some((s) => s === 'files' || s === 'templates');
}

/** A model guessed from the detected lines alone, only to run the regression probe on an undeclared repo: the
 *  most upstream line as integration, the most downstream as production. */
function provisional(lines) {
  if (lines.length < 2) return null;
  return { schema: SCHEMA, remote: 'origin', integration: { branch: lines[0], baseline: null }, stages: [{ branch: lines.at(-1), promote: 'ff', baseline: null }], releases: null, hotfixes: null, work: { pattern: '{type}/{slug}' }, fixFlow: null, landing: { via: 'merge', prStyle: null }, tags: [] };
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

// ---- App Hosting (opt-in: `evidence --app-hosting`) ----------------------------------------------------------
//
// The one binding the repo cannot show: a GitHub-linked App Hosting backend rolls out on a push to its live branch,
// and that link lives in Firebase. Asked the same way `remoteFacts` asks GitHub — an authenticated CLI, read-only,
// degrading to `unobservable` (→ a question) when it cannot see. OPT-IN, because every call is a network round trip
// of seconds and needs a login; the investigation turns it on when the repo has Firebase.
//
// What it reports per backend: id, region, linked repository (none → it deploys from local source,
// `firebase deploy --only apphosting`), root directory, environment name — `apphosting:backends:list --json`. The
// LIVE BRANCH is not on the backend: it is the backend's traffic `rolloutPolicy.codebaseBranch`, which no firebase
// command prints, so it is read from the App Hosting API with a gcloud access token when one is available (sent in a
// header from a child process that receives it on stdin — never on a command line, where `ps` shows it), and is
// otherwise its own `unobservable` fact. When the CLI cannot list backends, WHY is the fact: not installed, not
// logged in, or Firebase's own first error line (an API not enabled, a permission denied) — each asks something else. With a declared model, each declared `appHosting` binding is checked against
// what was observed (`drift`) — the case that once went stale silently: auto-rollout switched on, `deploys` unchanged.
const APPHOSTING_API = 'https://firebaseapphosting.googleapis.com/v1beta';

function appHostingFacts(fact, top, files, model) {
  let projects = [];
  if (files.includes('.firebaserc')) {
    try {
      projects = [...new Set(Object.values(JSON.parse(fs.readFileSync(path.join(top, '.firebaserc'), 'utf8')).projects ?? {}))].filter((p) => typeof p === 'string' && p);
    } catch {
      /* reported as unparseable above */
    }
  }
  if (!projects.length) return fact('app hosting', 'backends', 'no project in .firebaserc to ask — name the Firebase project, or ask', 'unobservable');

  const firebase = firebaseCli(top);
  const token = accessToken();
  const observed = []; // { project, backend, branch|undefined }
  for (const project of projects) {
    const listed = listBackends(firebase, project);
    if (listed.unobservable) {
      fact('app hosting', project, `${listed.unobservable} — ask`, 'unobservable');
      continue;
    }
    const { backends } = listed;
    if (!backends.length) fact('app hosting', project, 'no App Hosting backends', 'observed');
    for (const b of backends) {
      const m = /^projects\/([^/]+)\/locations\/([^/]+)\/backends\/([^/]+)$/.exec(b.name ?? '');
      if (!m) continue;
      const [, , region, id] = m;
      const repository = b.codebase?.repository ? b.codebase.repository.split('/').pop() : null;
      fact(
        'app hosting',
        `${project}/${id}`,
        {
          region,
          repository: repository ?? 'none — deploys from local source (`firebase deploy --only apphosting`)',
          rootDirectory: b.codebase?.rootDirectory ?? '/',
          environment: b.environment || '(none — reads only apphosting.yaml)',
        },
        'observed',
      );
      let branch;
      if (repository) {
        branch = liveBranch(token, project, region, id);
        if (branch === undefined) fact('app hosting', `${project}/${id} live branch`, 'not printed by the firebase CLI, and no gcloud token to read it from the API — ask (backend settings → Deployment)', 'unobservable');
        else fact('app hosting', `${project}/${id} live branch`, branch ?? 'none — automatic rollouts are off', 'observed');
      }
      observed.push({ project, backend: id, linked: Boolean(repository), branch });
    }
  }

  // Declared vs observed — only for the projects that were actually observed.
  if (!model) return;
  const seen = new Set(observed.map((o) => o.project));
  const aliases = firebaseAliases(top);
  const bindings = deployBindings(model);
  for (const binding of bindings) {
    for (const want of binding.appHosting ?? []) {
      const project = aliases[want.project] ?? want.project;
      if (!seen.has(project)) continue;
      const got = observed.find((o) => o.project === project && o.backend === want.backend);
      const subject = `${binding.line} → ${want.project}/${want.backend}`;
      if (!got) fact('drift', subject, 'declared, but no such backend exists', 'observed');
      else if (!got.linked) fact('drift', subject, 'declared as rolling out from this line, but the backend has no linked repository (local-source deploys)', 'observed');
      else if (got.branch !== undefined && !(got.branch && covers(binding, got.branch))) fact('drift', subject, `declared on ${binding.line}, but it rolls out from ${got.branch ?? 'no branch (automatic rollouts off)'}`, 'observed');
    }
  }
  for (const o of observed.filter((x) => x.linked && typeof x.branch === 'string')) {
    const declared = bindings.some((b) => (b.appHosting ?? []).some((w) => (aliases[w.project] ?? w.project) === o.project && w.backend === o.backend));
    if (!declared) fact('drift', `${o.project}/${o.backend}`, `rolls out from ${o.branch}, but no line's deploys declares it — propose an appHosting binding`, 'observed');
  }
}

/**
 * Whether a deploy binding covers a concrete branch: a line by name, a pattern binding by its glob (as GitHub's branch
 * filter reads it — a `*` never crosses `/`; read through patterns.mjs by naming each `*` a one-segment placeholder),
 * and a tag series never (App Hosting rolls out from a branch).
 */
function covers(binding, branch) {
  if (binding.kind === 'line') return binding.line === branch;
  if (binding.kind === 'pattern') return match(binding.line.replaceAll('*', '{part}'), branch) !== null;
  return false;
}

/**
 * `apphosting:backends:list` for one project: `{ backends }`, or `{ unobservable }` — why it could not be read. With
 * `--json`, firebase-tools prints its error on stdout as `{ status: 'error', error }` and exits non-zero.
 */
function listBackends(firebase, project) {
  const res = spawnSync(firebase[0], [...firebase.slice(1), 'apphosting:backends:list', '--project', project, '--json', '--non-interactive'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 90000, env: { ...process.env, NO_UPDATE_NOTIFIER: '1', CI: process.env.CI ?? '1' },
  });
  if (res.error?.code === 'ENOENT') return { unobservable: 'the firebase CLI is not installed (no node_modules/.bin/firebase, none on PATH)' };
  if (res.error) return { unobservable: `the firebase CLI could not list backends: ${res.error.message}` };
  let out = null;
  try {
    out = JSON.parse(res.stdout);
  } catch {
    /* no JSON answer — its stderr says why */
  }
  if (res.status === 0 && out && (!out.status || out.status === 'success')) {
    return { backends: Array.isArray(out.result) ? out.result : (out.result?.backends ?? []) };
  }
  const said = typeof out?.error === 'string' ? out.error : (out?.error?.message ?? res.stderr ?? res.stdout ?? '');
  const first = said.split('\n').map((l) => l.trim()).find(Boolean) ?? `exit ${res.status}`;
  if (/firebase login/.test(said)) return { unobservable: 'the firebase CLI is not logged in (`firebase login`)' };
  return { unobservable: `the firebase CLI could not list backends: ${first}` };
}

/** The project's pinned firebase CLI when it has one (house projects do), else whatever is on PATH. */
function firebaseCli(top) {
  const local = path.join(top, 'node_modules', '.bin', 'firebase');
  return [fs.existsSync(local) ? local : 'firebase'];
}

function firebaseAliases(top) {
  try {
    return JSON.parse(fs.readFileSync(path.join(top, '.firebaserc'), 'utf8')).projects ?? {};
  } catch {
    return {};
  }
}

function accessToken() {
  try {
    return run('gcloud', ['auth', 'print-access-token', '--quiet'], 20000) || null;
  } catch {
    return null;
  }
}

/** The backend's live branch: a string, `null` (rollouts off), or `undefined` (could not read it). */
function liveBranch(token, project, region, backend) {
  if (!token) return undefined;
  try {
    const traffic = JSON.parse(authorizedGet(`${APPHOSTING_API}/projects/${project}/locations/${region}/backends/${backend}/traffic`, token));
    const policy = traffic.rolloutPolicy;
    if (!policy || policy.disabled || !policy.codebaseBranch) return null;
    return policy.codebaseBranch;
  } catch {
    return undefined;
  }
}

// `evidence` is a synchronous read, like every other probe here (git, gh, firebase — each a child process), so the
// API call runs in a child too: Node's own fetch, the token handed over on STDIN, so it appears in no argv.
const AUTHORIZED_GET = `
let input = '';
for await (const chunk of process.stdin) input += chunk;
const { url, token } = JSON.parse(input);
const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(20000) });
if (!res.ok) process.exit(1);
process.stdout.write(await res.text());
`;

/** GET `url` with a bearer token; the body, or throws. */
function authorizedGet(url, token) {
  return execFileSync(process.execPath, ['--input-type=module', '-e', AUTHORIZED_GET], { input: JSON.stringify({ url, token }), encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 25000 });
}

function run(cmd, args, timeout) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout, env: { ...process.env, NO_UPDATE_NOTIFIER: '1', CI: process.env.CI ?? '1' } }).trim();
}
