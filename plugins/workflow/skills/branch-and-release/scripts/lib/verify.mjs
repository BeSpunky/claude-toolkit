// The invariants (CONTRACT §5) — what "this repo is following its declared model" means, checked from history.
//
// Every result is one of: ok · violation (fails the run) · advisory (the history cannot answer — said why) ·
// warning (hygiene, never a failure). Each check starts at its line's BASELINE (the tip when the model was
// written), so history from before a model never fails it; `proposed` mode sets every baseline to today's tip,
// except no-regression, which reads the full history — an un-carried fix is a live bug whatever model is picked.
import { chainOf, feederOf, productionLine, releaseLines, resolveLine, project, canonical } from './model.mjs';
import { match } from './patterns.mjs';

const TRAILER_NA = /^Not-applicable-upstream:/m;
const CHERRY_FROM = /\(cherry picked from commit ([0-9a-f]{7,64})\)/g;
const SHOW = 5; // commits listed per result

export function verify(git, model, { proposed = false, branches = git.branchNames(model.remote || 'origin') } = {}) {
  const remote = model.remote || 'origin';
  const results = [];
  const add = (invariant, line, status, reason, commits) => results.push({ invariant, line, status, reason, ...(commits?.length ? { commits } : {}) });
  const tip = (name) => {
    const ref = git.ref(name, remote);
    return ref ? git.sha(ref) : null;
  };
  const integration = model.integration.branch;
  const intTip = tip(integration);
  const releases = releaseLines(model, branches);
  const hotfixes = model.hotfixes ? branches.filter((b) => match(model.hotfixes.pattern, b)) : [];
  const describe = (shas) => shas.slice(0, SHOW).map((s) => `${s.slice(0, 9)} ${git.subject(s)}`).concat(shas.length > SHOW ? [`… and ${shas.length - SHOW} more`] : []);
  const squashy = (style) => style === 'squash' || style === 'rebase';
  const landingSquashy = model.landing.via === 'pr' && squashy(model.landing.prStyle);

  // ---- baselines ---------------------------------------------------------------------------------------
  const recorded = (name) => {
    if (name === integration) return model.integration.baseline ?? null;
    const s = model.stages.find((x) => x.branch === name);
    if (s) return s.baseline ?? null;
    return model.releases?.baselines?.[name] ?? null;
  };
  /** The commit a line's checks start after; undefined = skip the line (with a warning already added). */
  const baselineOf = (name, t, invariant) => {
    if (proposed) return t;
    let b = recorded(name);
    if (!b) {
      // A line created after the model was written: its own history starts where it forked.
      const from = name === integration ? null : model.stages.some((s) => s.branch === name) ? feederBase(name) : model.releases?.cutFrom;
      const fromTip = from && tip(from);
      b = fromTip ? forkPoint(t, fromTip) : null;
      if (!b) {
        add(invariant, name, 'warning', 'no baseline recorded and none derivable — re-run `write` to record one');
        return undefined;
      }
    } else if (!git.sha(b)) {
      add(invariant, name, 'violation', `baseline ${b.slice(0, 9)} does not exist in this repo (history rewritten, or a shallow clone)`);
      return undefined;
    } else if (!git.isAncestor(b, t)) {
      add(invariant, name, 'violation', `baseline ${b.slice(0, 9)} is no longer in ${name}'s history — the line was rewritten (force-push or reset)`);
      return undefined;
    }
    return b;
  };
  /** Where a line forked from its source: the first commit of its first-parent walk that is also on the
   *  source's first-parent history. Not merge-base — once the line is merged back, that is its own tip. */
  const forkPoint = (t, fromTip) => {
    const onSource = new Set(git.lines(['rev-list', '--first-parent', fromTip]));
    return git.lines(['rev-list', '--first-parent', t]).find((c) => onSource.has(c)) ?? git.try(['merge-base', t, fromTip]);
  };
  const feederBase = (name) => {
    const f = feederOf(model, name);
    return f.kind === 'chain' ? f.predecessor : integration;
  };

  /** Commits patch-equivalent to something in `upstream` (git cherry '-'), limited to after `limit`. */
  const equivalent = (upstream, head, limit) => {
    const set = new Set();
    for (const l of git.lines(['cherry', upstream, head, ...(limit ? [limit] : [])])) if (l.startsWith('- ')) set.add(l.slice(2));
    return set;
  };
  const pickedFromUpstream = (sha, upstreamTip) => [...git.message(sha).matchAll(CHERRY_FROM)].some((m) => git.sha(m[1]) && git.isAncestor(m[1], upstreamTip));
  const versionBumpOnly = (sha) => {
    const files = git.lines(['diff-tree', '--no-commit-id', '-r', '--name-only', '--root', sha]);
    if (!files.length) return false;
    return files.every((f) => {
      const baseName = f.split('/').pop();
      if (/^CHANGELOG/i.test(baseName)) return true;
      if (!baseName.endsWith('.json')) return false;
      const diff = git.lines(['diff-tree', '-p', '-U0', '--root', '--no-commit-id', sha, '--', f]);
      const changed = diff.filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---) /.test(l));
      return changed.length > 0 && changed.every((l) => /^[+-]\s*"version"\s*:/.test(l));
    });
  };
  const allowsBump = (name) => releases.includes(name) && model.releases?.allowDirect?.includes('version-bump');

  // ---- 1. no direct commits ------------------------------------------------------------------------------
  const protectedLines = [...chainOf(model), ...releases];
  for (const name of protectedLines) {
    const t = tip(name);
    if (!t) {
      add(1, name, 'warning', 'line does not exist (yet)');
      continue;
    }
    const b = baselineOf(name, t, 1);
    if (b === undefined) continue;
    const firstParent = git.lines(['rev-list', '--first-parent', '--parents', `${b}..${t}`]).map((l) => l.split(' '));
    const singles = firstParent.filter((p) => p.length <= 2).map((p) => p[0]);
    if (!singles.length) {
      add(1, name, 'ok', firstParent.length ? `${firstParent.length} arrival(s) since baseline, all merges` : 'nothing new since baseline');
      continue;
    }
    // What legitimately arrives on this line without a merge commit (a fast-forward from its feeder).
    let feeders = [];
    let squash = landingSquashy;
    const isStage = model.stages.find((s) => s.branch === name);
    const lineHotfixes = hotfixes.filter((h) => resolveLine(model, match(model.hotfixes.pattern, h).line) === name);
    if (isStage) {
      const f = feederOf(model, name);
      feeders = f.kind === 'chain' ? [f.predecessor] : [...releases, ...lineHotfixes];
      squash = isStage.promote === 'pr' && squashy(model.landing.prStyle);
      if (f.kind === 'releases') squash = landingSquashy;
    } else if (name !== integration) feeders = lineHotfixes;
    const feederTips = feeders.map(tip).filter(Boolean);
    const upstreamFirst = releases.includes(name) && model.fixFlow === 'upstream-first';
    const equiv = upstreamFirst && intTip ? equivalent(intTip, t, b) : new Set();

    const direct = [];
    const bumps = [];
    for (const c of singles) {
      if (feederTips.some((ft) => git.isAncestor(c, ft))) continue;
      if (upstreamFirst && (equiv.has(c) || pickedFromUpstream(c, intTip))) continue;
      if (allowsBump(name) && versionBumpOnly(c)) {
        bumps.push(c);
        continue;
      }
      direct.push(c);
    }
    const note = bumps.length ? ` (${bumps.length} version-bump commit(s) allowed)` : '';
    if (!direct.length) add(1, name, 'ok', `no direct commits since baseline${note}`);
    else if (squash) add(1, name, 'advisory', `${direct.length} non-merge arrival(s): under PR ${model.landing.prStyle} merges a landed PR and a direct commit look the same, so this cannot be decided from history${note}`, describe(direct));
    else add(1, name, 'violation', `${direct.length} direct commit(s) since baseline — they arrived outside the line's declared move${note}`, describe(direct));
  }

  // ---- 2. chain containment ------------------------------------------------------------------------------
  for (const s of model.stages) {
    const f = feederOf(model, s.branch);
    if (f.kind !== 'chain') continue;
    const st = tip(s.branch);
    const pt = tip(f.predecessor);
    if (!st || !pt) {
      add(2, s.branch, 'warning', `cannot check: ${!st ? s.branch : f.predecessor} does not exist`);
      continue;
    }
    const b = baselineOf(s.branch, st, 2);
    if (b === undefined) continue;
    if (s.promote === 'ff') {
      const extra = git.lines(['rev-list', st, `^${pt}`, `^${b}`]);
      if (!extra.length) add(2, s.branch, 'ok', `contained in ${f.predecessor} (ancestry)`);
      else add(2, s.branch, 'violation', `${extra.length} commit(s) on ${s.branch} that ${f.predecessor} lacks — a fast-forward chain must be strict ancestry`, describe(extra));
      continue;
    }
    const extra = git.lines(['rev-list', '--no-merges', st, `^${pt}`, `^${b}`]);
    if (!extra.length) {
      add(2, s.branch, 'ok', `contained in ${f.predecessor} (no commit it lacks)`);
      continue;
    }
    const tree = git.try(['rev-parse', `${st}^{tree}`]);
    const same = git.lines(['log', '--first-parent', '--format=%H %T', pt]).find((l) => l.endsWith(` ${tree}`));
    if (same) {
      add(2, s.branch, 'ok', `content equals ${f.predecessor} at ${same.slice(0, 9)} (tree match)`);
      continue;
    }
    const equiv = equivalent(pt, st, b);
    const missing = extra.filter((c) => !equiv.has(c));
    if (!missing.length) add(2, s.branch, 'ok', `contained in ${f.predecessor} (patch equivalence)`);
    else if (s.promote === 'pr' && squashy(model.landing.prStyle)) add(2, s.branch, 'advisory', `${missing.length} commit(s) not found in ${f.predecessor} by ancestry or patch-id — expected under PR ${model.landing.prStyle} promotions, which rewrite commits`, describe(missing));
    else add(2, s.branch, 'violation', `${missing.length} commit(s) on ${s.branch} that ${f.predecessor} lacks`, describe(missing));
  }

  // ---- 3. no regression ----------------------------------------------------------------------------------
  const prodLines = [productionLine(model), ...(model.releases?.maintained ? releases : [])];
  for (const name of prodLines) {
    if (name === integration) {
      add(3, name, 'ok', 'production is integration');
      continue;
    }
    const t = tip(name);
    if (!t || !intTip) {
      add(3, name, 'warning', `cannot check: ${!t ? name : integration} does not exist`);
      continue;
    }
    let b = null;
    if (!proposed) {
      b = baselineOf(name, t, 3);
      if (b === undefined) continue;
    }
    const candidates = git.lines(['rev-list', '--no-merges', t, `^${intTip}`, ...(b ? [`^${b}`] : [])]);
    const equiv = candidates.length ? equivalent(intTip, t, b) : new Set();
    const missing = [];
    let accepted = 0;
    for (const c of candidates) {
      if (equiv.has(c) || pickedFromUpstream(c, intTip)) continue;
      if (TRAILER_NA.test(git.message(c)) || (allowsBump(name) && versionBumpOnly(c))) {
        accepted++;
        continue;
      }
      missing.push(c);
    }
    const note = accepted ? ` (${accepted} accepted: Not-applicable-upstream or version bump)` : '';
    const scope = proposed ? 'in its full history' : 'since baseline';
    if (!missing.length) add(3, name, 'ok', `everything on ${name} ${scope} is in ${integration}${note}`);
    else add(3, name, 'violation', `${missing.length} fix(es) on ${name} ${scope} never carried to ${integration} — a later release would regress them${note}`, describe(missing));
  }

  // ---- 4. hygiene ----------------------------------------------------------------------------------------
  let hygiene = 0;
  const prodNow = new Set(prodLines);
  for (const h of hotfixes) {
    const target = resolveLine(model, match(model.hotfixes.pattern, h).line);
    const targetTip = target && tip(target);
    if (!target || !(prodNow.has(target) || releases.includes(target)) || !targetTip) {
      hygiene++;
      add(4, h, 'warning', `targets "${match(model.hotfixes.pattern, h).line}", which is not a declared production line`);
    } else if (git.isAncestor(tip(h), targetTip)) {
      hygiene++;
      add(4, h, 'warning', `already merged into ${target} — delete it once it is carried`);
    }
  }
  if (model.releases) {
    for (const r of releases) {
      const rt = tip(r);
      const cut = tip(model.releases.cutFrom);
      if (cut && !git.try(['merge-base', rt, cut])) {
        hygiene++;
        add(4, r, 'warning', `shares no history with ${model.releases.cutFrom}, the line releases are cut from`);
      } else if (!model.releases.maintained && model.releases.shipsTo) {
        const st = tip(model.releases.shipsTo);
        if (st && git.isAncestor(rt, st)) {
          hygiene++;
          add(4, r, 'warning', `already shipped into ${model.releases.shipsTo} — delete it once it is carried`);
        }
      }
    }
  }
  if (!hygiene) add(4, '*', 'ok', 'nothing stranded');

  // ---- 5. projection fresh -------------------------------------------------------------------------------
  if (!proposed) {
    if (!model.projection) add(5, '*', 'violation', 'no projection — run `write` to compute it');
    else if (canonical(model.projection) !== canonical(project(model))) add(5, '*', 'violation', 'the stored projection has drifted from the model — run `write` again (never hand-edit it)');
    else add(5, '*', 'ok', 'projection matches the model');
  }

  return results;
}

export const NAMES = { 1: 'no direct commits', 2: 'chain containment', 3: 'no regression', 4: 'hygiene', 5: 'projection fresh' };
