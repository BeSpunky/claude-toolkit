// The gates: the exact commands for one move, derived from the model — printed, NEVER executed.
//
// Every move between lines is human-gated; the engine's part is to make the move exact and model-true (the
// right base, the right merge style, every line a fix must be carried to) so nobody runs it from memory. A gate
// the model does not have is refused, not approximated.
import { chainOf, feederOf, productionLine, releaseLines, resolveLine, UsageError } from './model.mjs';
import { fill, match, placeholders } from './patterns.mjs';
import { landed } from './landed.mjs';

export const GATES = {
  land: '<work-branch> [--onto <line>]',
  promote: '<stage>',
  'cut-release': '<version>',
  'ship-release': '<version>',
  hotfix: '<line> <slug>',
  carry: '<branch | commit…>',
  start: '<type> <slug> [--on <line>]',
};

const refuse = (msg) => {
  throw new UsageError(msg);
};
const WORKTREES = '.claude/worktrees';

export function plan(git, model, gate, args, opts = {}) {
  if (!GATES[gate]) refuse(`unknown gate "${gate}" (gates: ${Object.keys(GATES).join(', ')})`);
  const R = model.remote || 'origin';
  const integration = model.integration.branch;
  const branches = git.branchNames(R);
  const releases = releaseLines(model, branches);
  const steps = [];
  const run = (cmd, where) => steps.push({ cmd, ...(where ? { where } : {}) });
  const note = (text) => steps.push({ note: text });
  const tip = (name) => {
    const ref = git.ref(name, R);
    return ref ? git.sha(ref) : null;
  };
  const prStyle = model.landing.prStyle;

  /** Bring `source` into `target` the way the model says lines are joined. */
  const join = (target, source, { via = model.landing.via, ff = false, title } = {}) => {
    if (via === 'pr') {
      run(`gh pr create --base ${target} --head ${source} --title "${title ?? `${source} → ${target}`}" --fill`);
      run(`gh pr merge ${source} --${prStyle}`);
      run(`git fetch ${R}`);
      return;
    }
    run(`git switch ${target}`, `the checkout that holds ${target}`);
    run(`git merge --ff-only ${R}/${target}`);
    run(ff ? `git merge --ff-only ${source}` : `git merge --no-ff ${source}`);
    run(`git push ${R} ${target}`);
  };
  const need = (cond, msg) => cond || refuse(msg);
  const releaseName = (version) => {
    need(model.releases, `this model has no release lines — "${gate}" is not one of its gates`);
    const ph = placeholders(model.releases.pattern);
    need(ph.length === 1, `the release pattern "${model.releases.pattern}" has more than one placeholder; name the line directly`);
    need(version, `usage: plan ${gate} ${GATES[gate]}`);
    return fill(model.releases.pattern, { [ph[0]]: version });
  };
  const tagsFor = (line, version) =>
    model.tags.filter((t) => t.on === line || (model.releases && t.on === model.releases.pattern && match(model.releases.pattern, line))).map((t) => fill(t.pattern, { version }));
  const isReleaseLine = (name) => model.releases && match(model.releases.pattern, name);
  const carryNote = (what) => note(`not done until carried — next: plan carry ${what}`);
  const upstreamFirst = model.fixFlow === 'upstream-first';
  // Upstream-first MEANS a change lands on integration first and is carried back; a gate that put work straight
  // onto a release line would leave a commit integration lacks, which carry (cherry-pick FROM integration) can
  // never fix and land (onto a release line) refuses — a dead end. Refuse it at the door instead.
  const notOnReleaseUnderUpstreamFirst = (line, verb) =>
    need(!(upstreamFirst && isReleaseLine(line)), `under upstream-first, work never ${verb} a release line ("${line}"): it lands on ${integration} first and is carried back with cherry-pick -x (plan carry <commit|branch>)`);
  const hasLocal = (name) => git.ok(['show-ref', '--verify', '--quiet', `refs/heads/${name}`]);
  const hasRemote = (name) => git.ok(['show-ref', '--verify', '--quiet', `refs/remotes/${R}/${name}`]);
  /** How `line` already holds everything `what` carries — 'ancestry' · 'patch' (every commit it lacks by
   *  ancestry has a patch-equivalent there, git cherry) · 'content' (merging it would change nothing: every path
   *  `what` changed since they forked is already identical on `line`) — or null when it lacks something. Ancestry
   *  alone is not enough: a squash or rebase PR carries content without it, and re-carrying then plans a no-op. */
  const holds = (line, what) => {
    const [s, t] = [tip(what), tip(line)];
    if (!s || git.isAncestor(s, t)) return 'ancestry';
    const lacking = git.lines(['cherry', t, s]);
    if (lacking.length && lacking.every((l) => l.startsWith('- '))) return 'patch';
    const base = git.try(['merge-base', s, t]);
    if (!base) return null;
    const paths = git.lines(['diff', '--name-only', '--no-renames', base, s]);
    return git.ok(['diff', '--quiet', s, t, '--', ...paths.map((p) => `:(literal)${p}`)]) ? 'content' : null;
  };
  /** Merge-forward: merge the branch `what` (named as `source`) into every line that still lacks it, except
   *  `skip`; a line that already holds it is skipped with a note saying how, never handed a no-op merge or PR. */
  const mergeForward = (what, source, skip, { newerThan = `the line ${what} landed on` } = {}) => {
    const targets = [];
    for (const t of [integration, ...releases].filter((l) => !skip.includes(l) && tip(l))) {
      const how = holds(t, what);
      if (how === 'ancestry') continue;
      if (how) {
        note(`${t} already has everything ${what} carries (${how === 'patch' ? 'every commit, by patch-id' : 'every file it changed, by content'}) — nothing to carry there`);
        continue;
      }
      if (isReleaseLine(t)) note(`only if ${t} is NEWER than ${newerThan}:`);
      join(t, source, { title: `Carry ${what} → ${t}` });
      targets.push(t);
    }
    return targets;
  };
  /** Remove a finished branch: its worktree (if any), the local branch, then its remote copy — in that order, so
   *  `git branch -d` still sees the upstream it was merged into. */
  const cleanup = (branch, { worktree, local = true, remote = model.landing.via === 'pr', force = false } = {}) => {
    if (worktree) run(`git worktree remove ${WORKTREES}/${worktree}`);
    if (local) run(`git branch ${force ? '-D' : '-d'} ${branch}`);
    if (remote) run(`git push ${R} --delete ${branch}`);
  };

  switch (gate) {
    case 'start': {
      const [type, slug] = args;
      need(type && slug, `usage: plan start ${GATES.start}`);
      const types = model.work.types;
      if (placeholders(model.work.pattern).includes('type')) need(!types?.length || types.includes(type), `"${type}" is not a declared work type (${types.join(', ')})`);
      const base = opts.on ?? integration;
      need(base === integration || isReleaseLine(base), `work starts on ${integration}${model.releases && !upstreamFirst ? ` or a release line (${model.releases.pattern})` : ''}, not on "${base}"`);
      notOnReleaseUnderUpstreamFirst(base, 'starts on');
      const branch = fill(model.work.pattern, { type, slug });
      run(`git fetch ${R}`);
      run(`git worktree add ${WORKTREES}/${slug} -b ${branch} ${R}/${base}`);
      break;
    }

    case 'land': {
      const [branch] = args;
      need(branch, `usage: plan land ${GATES.land}`);
      let target;
      let carry = false;
      let slug;
      const work = match(model.work.pattern, branch, model.work.types?.length ? { type: model.work.types } : {});
      const hot = model.hotfixes && match(model.hotfixes.pattern, branch);
      if (work) {
        slug = work.slug;
        target = opts.onto ?? integration;
        need(target === integration || isReleaseLine(target), `work lands on ${integration}${upstreamFirst ? '' : ' or a release line'}, not on "${target}"`);
        notOnReleaseUnderUpstreamFirst(target, 'lands on');
        carry = target !== integration;
      } else if (hot) {
        slug = hot.slug;
        if (model.fixFlow === 'upstream-first') target = integration;
        else {
          target = resolveLine(model, hot.line);
          need(target, `"${branch}" targets "${hot.line}", which is not a declared line`);
          carry = true;
        }
      } else refuse(`"${branch}" is neither a work branch (${model.work.pattern}) nor a hotfix (${model.hotfixes?.pattern ?? 'none declared'}) under this model`);
      run(`git fetch ${R}`);
      run(`git rebase ${R}/${target}`, `the ${branch} worktree`);
      note('re-run the effort’s verification on the rebased branch before going on');
      if (model.landing.via === 'pr') run(`git push --force-with-lease -u ${R} ${branch}`, `the ${branch} worktree`);
      join(target, branch);
      if (hot && !upstreamFirst) {
        // Merge-forward: the hotfix is carried by merging ITS branch onward — so that happens here, before the
        // branch is deleted (a plan that deleted first and then said "carry it" could not be followed).
        mergeForward(branch, branch, [target]);
        cleanup(branch, { worktree: slug });
      } else if (hot) {
        // Upstream-first: carried back by cherry-pick -x from integration. Which commits those are is a fact of
        // the landing just made — under a squash or rebase PR, commits that did not exist until the PR merged —
        // so the branch stays until `plan carry` has read them off it, and that plan removes it.
        const back = resolveLine(model, hot.line) ?? hot.line;
        run(`git worktree remove ${WORKTREES}/${slug}`);
        const found = model.landing.via === 'pr' && prStyle !== 'merge' ? `finds the commit(s) the ${prStyle} merge created on ${integration}, ` : '';
        carryNote(`${branch} (it ${found}cherry-picks the fix back to ${back}, then deletes the branch)`);
      } else {
        cleanup(branch, { worktree: slug });
        if (carry) carryNote(target);
      }
      break;
    }

    case 'promote': {
      const [stage] = args;
      need(stage, `usage: plan promote ${GATES.promote}`);
      const s = model.stages.find((x) => x.branch === stage);
      need(s, model.stages.length ? `"${stage}" is not a stage (stages: ${model.stages.map((x) => x.branch).join(', ')})` : 'this model has no stages (trunk) — there is nothing to promote to');
      const f = feederOf(model, stage);
      need(f.kind === 'chain', `${stage} is release-fed: it advances by "plan ship-release <version>", not by promotion`);
      run(`git fetch ${R}`);
      note(`guard first: branches.mjs verify (a violation means stop and reconcile, never --force)`);
      if (s.promote === 'pr') join(stage, f.predecessor, { via: 'pr', title: `Promote ${f.predecessor} → ${stage}` });
      else join(stage, `${R}/${f.predecessor}`, { via: 'merge', ff: s.promote === 'ff' });
      break;
    }

    case 'cut-release': {
      const name = releaseName(args[0]);
      need(!branches.includes(name), `${name} already exists`);
      run(`git fetch ${R}`);
      run(`git branch ${name} ${R}/${model.releases.cutFrom}`);
      run(`git push -u ${R} ${name}`);
      if (upstreamFirst) note(`stabilisation fixes land on ${integration} and are carried back: plan carry <fix-branch> once it has landed`);
      else note(`stabilisation work: plan start <type> <slug> --on ${name}`);
      break;
    }

    case 'ship-release': {
      const version = args[0];
      const name = releaseName(version);
      need(branches.includes(name), `${name} does not exist — cut it first (plan cut-release ${version})`);
      run(`git fetch ${R}`);
      const target = model.releases.shipsTo;
      if (target) {
        note('guard first: branches.mjs verify');
        join(target, model.landing.via === 'pr' ? name : `${R}/${name}`, { title: `Release ${version}` });
        for (const tag of tagsFor(target, version)) {
          // The fetched remote line: a PR merge never touches the local one, and a merge just pushed it.
          run(`git tag -a ${tag} ${R}/${target} -m "${tag}"`);
          run(`git push ${R} ${tag}`);
        }
      } else {
        const tags = tagsFor(name, version);
        need(tags.length, `${name} is a maintained line that ships by tag, and the model declares no tag on it`);
        for (const tag of tags) {
          run(`git tag -a ${tag} ${R}/${name} -m "${tag}"`);
          run(`git push ${R} ${tag}`);
        }
      }
      if (model.fixFlow === 'merge-forward') mergeForward(name, model.landing.via === 'pr' ? name : `${R}/${name}`, [name], { newerThan: name });
      else note(`upstream-first: every fix on ${name} should already be on ${integration} — branches.mjs verify confirms`);
      if (!model.releases.maintained) cleanup(name, { local: hasLocal(name), remote: true });
      break;
    }

    case 'hotfix': {
      need(model.hotfixes, 'this model declares no hotfix lines — fix on integration and let it ship with the next promotion');
      const [lineArg, slug] = args;
      need(lineArg && slug, `usage: plan hotfix ${GATES.hotfix}`);
      const line = resolveLine(model, lineArg);
      const prod = [productionLine(model), ...(model.releases?.maintained ? releases : [])];
      need(line && (prod.includes(line) || (model.releases?.maintained && isReleaseLine(line))), `"${lineArg}" is not a production line (${prod.join(', ')})`);
      const lineValue = isReleaseLine(line) ? Object.values(match(model.releases.pattern, line))[0] : line;
      need(!lineValue.includes('/'), `"${line}" cannot be named inside ${model.hotfixes.pattern}`);
      const branch = fill(model.hotfixes.pattern, { line: lineValue, slug });
      const base = model.fixFlow === 'upstream-first' ? integration : line;
      run(`git fetch ${R}`);
      run(`git worktree add ${WORKTREES}/${slug} -b ${branch} ${R}/${base}`);
      if (model.fixFlow === 'upstream-first') note(`upstream-first: the fix lands on ${integration} (plan land ${branch}), then is cherry-picked back to ${line} (plan carry ${branch})`);
      else note(`merge-forward: the fix lands on ${line} (plan land ${branch}), then is carried (plan carry ${branch})`);
      break;
    }

    case 'carry': {
      need(model.fixFlow, 'this model has no release or hotfix lines — every change already lands on integration; there is nothing to carry');
      const [what] = args;
      need(what, `usage: plan carry ${GATES.carry}`);
      const ref = git.ref(what, R);
      need(!ref || args.length === 1, `name ONE branch to carry, or the commit(s) themselves — not both`);
      const shas = ref ? [git.sha(ref)] : args.map((a) => git.sha(a));
      args.forEach((a, i) => need(shas[i], `"${a}" is neither a branch nor a commit`));
      const [sha] = shas;
      const intTip = tip(integration);
      if (model.fixFlow === 'merge-forward') {
        need(ref, `under merge-forward a fix is carried by merging the line that holds it — name the branch (hotfix or release line), not a commit`);
        run(`git fetch ${R}`);
        const carried = mergeForward(what, model.landing.via === 'pr' ? what : ref.startsWith('refs/remotes/') ? `${R}/${what}` : what, [what]);
        if (!carried.length) note(`${what} is already in ${integration} and every open release line — nothing to carry`);
      } else {
        let commits;
        let targets;
        let rewritten = false;
        const hot = model.hotfixes && ref && match(model.hotfixes.pattern, what);
        if (ref) {
          need(intTip, `upstream-first: ${integration} does not exist`);
          // What landed it — the branch's own commits after a merge, the NEW commits a squash or rebase PR made.
          const l = landed(git, what, sha, intTip, integration);
          need(!l.refused, `cannot tell which commit(s) on ${integration} landed ${what}: ${l.refused}.\nIf it has not landed yet: plan land ${what}. If it has, name what landed it: plan carry <commit> [<commit>…]`);
          commits = l.pick;
          rewritten = l.how !== 'ancestry';
          if (l.how === 'squash' || l.how === 'rebase') note(`${what} landed on ${integration} by a ${l.how} merge: ${l.shas.map((c) => `${c.slice(0, 12)} ${git.subject(c)}`).join(' · ')} (matched by patch-id)`);
          if (l.how === 'pr') note(`${what} landed on ${integration} as ${l.shas[0].slice(0, 12)} ${git.subject(l.shas[0])} — matched by its PR reference, NOT by content (the merge changed the patch): check it before picking`);
          targets = hot ? [resolveLine(model, hot.line)] : releases;
        } else {
          shas.forEach((c, i) => need(intTip && git.isAncestor(c, intTip), `upstream-first: ${args[i].slice(0, 9)} is not on ${integration} — land it there first`));
          commits = shas.map((c) => c.slice(0, 12)).join(' ');
          // A line needs the carry while it lacks any of the commits — by ancestry, and by patch (git cherry '-').
          const lacks = (l, c) => !git.isAncestor(c, tip(l)) && !git.lines(['cherry', tip(l), c, `${c}^`]).some((x) => x.startsWith('- '));
          targets = releases.filter((l) => shas.some((c) => lacks(l, c)));
        }
        targets = targets.filter((t) => t && tip(t));
        need(targets.length, `no maintained line still needs ${args.join(' ')}`);
        run(`git fetch ${R}`);
        for (const t of targets) {
          note(`only if ${t} carries the code the fix touches; if it cannot apply, record why with a "Not-applicable-upstream:" trailer instead`);
          run(`git switch ${t}`, `the checkout that holds ${t}`);
          run(`git merge --ff-only ${R}/${t}`);
          run(`git cherry-pick -x ${commits}`);
          run(`git push ${R} ${t}`);
        }
        // A hotfix branch outlives its landing until it is carried (see land) — this is where it goes.
        if (hot) {
          run(`git switch ${integration}`, `the checkout that holds ${integration}`);
          run(`git merge --ff-only ${R}/${integration}`);
          // A squash or rebase landing leaves the branch unmerged as far as git can see; its content was matched
          // above, which is what makes forcing the delete safe.
          if (rewritten && hasLocal(what)) note(`git cannot see a ${model.landing.prStyle}-landed branch as merged — its content was matched above, so it is deleted with -D`);
          cleanup(what, { local: hasLocal(what), remote: hasRemote(what), force: rewritten });
        }
      }
      break;
    }
  }
  return steps;
}

/** Numbered commands; notes as indented comments; the checkout to run in, where it matters. */
export function format(steps) {
  let n = 0;
  return steps
    .map((s) => (s.note ? `   # ${s.note}` : `${String(++n).padStart(2)}. ${s.cmd}${s.where ? `    # in ${s.where}` : ''}`))
    .join('\n');
}
