// Which branches are LONG-LIVED LINES when no model says so — one rule, shared by the investigation (evidence)
// and by `verify --proposed` (which warns when a proposal would leave one of them unmodelled).
//
// The investigation exists for repos that differ from our assumptions, so a fixed name list cannot be the rule —
// a repo running `uat → live` would be invisible. The name list is one signal among several; a branch is a line
// when ANY of these holds, and each detected line carries the reasons it was picked:
//   declared   — the model in force names it
//   name       — a conventional line name (development, staging, main, …)
//   default    — the remote's default branch (<remote>/HEAD)
//   ci         — named literally as a push-trigger target in a CI workflow
//   promotion  — it repeatedly (≥ PROMOTIONS times) RECEIVES another line — merges `Merge branch '<line>'` on its
//                first-parent history, or fast-forwards from it in the local reflog — while advancing mostly that
//                way (fewer commits of its own than arrivals: a work branch that syncs from its base is not a line);
//                or it repeatedly FEEDS a line the same way.
// Seeds are the first four; promotion spreads from them to a fixed point.
import { workflows, pushTargets } from './workflows.mjs';

export const LONG_LIVED = ['development', 'develop', 'staging', 'qa', 'main', 'master', 'production', 'trunk'];

/** Pipeline position by name: integration-like lines first, production-like last. */
export const RANK = { development: 0, develop: 0, trunk: 0, staging: 1, qa: 1, main: 2, master: 2, production: 2 };

const PROMOTIONS = 2; // arrivals between two branches before the pair reads as a pipeline, not a one-off merge
const WALK = 400; // first-parent commits read per branch

/**
 * @returns {{ lines: string[], reasons: Record<string, string[]>, edges: Array<{ from, to, count }> }}
 *          `lines` in pipeline order (upstream first).
 */
export function detectLongLived(git, top, { model = null, remote = 'origin', branches = git.branchNames(remote) } = {}) {
  const names = new Set(branches);
  const reasons = new Map();
  const mark = (n, why) => {
    if (!names.has(n)) return;
    if (!reasons.has(n)) reasons.set(n, []);
    if (!reasons.get(n).includes(why)) reasons.get(n).push(why);
  };

  if (model) for (const n of [model.integration.branch, ...model.stages.map((s) => s.branch)]) mark(n, 'declared');
  for (const n of LONG_LIVED) mark(n, 'name');
  const head = git.try(['rev-parse', '--abbrev-ref', `refs/remotes/${remote}/HEAD`]);
  if (head && head.startsWith(`${remote}/`)) mark(head.slice(remote.length + 1), `default branch of ${remote}`);
  const ci = new Map();
  if (top) for (const { file, text } of workflows(git, top)) for (const n of pushTargets(text)) ci.set(n, [...(ci.get(n) ?? []), file]);
  for (const [n, files] of ci) mark(n, files.length === 1 ? `ci: push target in ${files[0]}` : `ci: push target in ${files.length} workflows`);

  const edges = promotionEdges(git, [...names], remote);
  for (let changed = true; changed; ) {
    changed = false;
    for (const e of edges) {
      if (reasons.has(e.from) && !reasons.has(e.to) && ownCommits(git, e.to, e.from, remote) < e.count) {
        mark(e.to, `promotion: receives ${e.from} (${e.count}×)`);
        changed = true;
      } else if (reasons.has(e.to) && !reasons.has(e.from)) {
        mark(e.from, `promotion: feeds ${e.to} (${e.count}×)`);
        changed = true;
      }
    }
  }

  const lines = order([...reasons.keys()], edges.filter((e) => reasons.has(e.from) && reasons.has(e.to)));
  return { lines, reasons: Object.fromEntries(lines.map((n) => [n, reasons.get(n)])), edges };
}

/** Repeated arrivals of one branch on another: first-parent merge subjects + local fast-forward reflog entries. */
function promotionEdges(git, names, remote) {
  const known = new Set(names);
  const strip = (s) => s.replace(new RegExp(`^(refs/(heads|remotes)/)?(${remote}/)?`), '');
  const counts = new Map();
  const add = (from, to) => {
    from = strip(from);
    if (from === to || !known.has(from)) return;
    const k = `${from}\u0000${to}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  };
  for (const to of names) {
    const ref = git.ref(to, remote);
    if (!ref) continue;
    for (const s of git.lines(['log', '--first-parent', '--merges', '-n', String(WALK), '--format=%s', ref])) {
      const m = /^Merge (?:remote-tracking )?branch '([^']+)'(?! of )/.exec(s);
      if (m) add(m[1], to);
    }
    for (const s of git.lines(['log', '-g', '--format=%gs', `refs/heads/${to}`])) {
      const m = /^merge (\S+): Fast-forward/.exec(s) ?? /^fetch \S* (\S+?):\S+: fast-forward/.exec(s);
      if (m) add(m[1], to);
    }
  }
  return [...counts].filter(([, c]) => c >= PROMOTIONS).map(([k, count]) => {
    const [from, to] = k.split('\u0000');
    return { from, to, count };
  });
}

/** First-parent non-merge commits on `branch` that `source` lacks — the work it did itself. */
function ownCommits(git, branch, source, remote) {
  const [b, s] = [git.ref(branch, remote), git.ref(source, remote)];
  return Number(git.try(['rev-list', '--first-parent', '--no-merges', '--count', '-n', String(WALK), b, `^${s}`]) ?? 0);
}

/** Upstream first: a conventional name has its RANK; an unknown name takes its rank from the promotions around it
 *  (one after what feeds it, one before what it feeds), a pipeline of unknown names starts at 0 where nothing
 *  feeds it. Anything still unplaced goes last. */
function order(lines, edges) {
  const rank = new Map(lines.filter((n) => n in RANK).map((n) => [n, RANK[n]]));
  const settle = () => {
    for (let changed = true; changed; ) {
      changed = false;
      for (const { from, to } of edges) {
        if (rank.has(from) && !rank.has(to)) (rank.set(to, rank.get(from) + 1), (changed = true));
        else if (rank.has(to) && !rank.has(from)) (rank.set(from, rank.get(to) - 1), (changed = true));
      }
    }
  };
  settle();
  for (const n of lines) if (!rank.has(n) && edges.some((e) => e.from === n) && !edges.some((e) => e.to === n)) rank.set(n, 0);
  settle();
  return [...lines].sort((a, b) => (rank.get(a) ?? 9) - (rank.get(b) ?? 9) || lines.indexOf(a) - lines.indexOf(b));
}
