// The gates: the exact commands for one move, derived from the model — printed, NEVER executed.
//
// Every move between lines is human-gated; the engine's part is to make the move exact and model-true (the
// right base, the right merge style, every line a fix must be carried to) so nobody runs it from memory. A gate
// the model does not have is refused, not approximated.
import { chainOf, feederOf, productionLine, releaseLines, resolveLine, UsageError } from './model.mjs';
import { fill, match, placeholders } from './patterns.mjs';

export const GATES = {
  land: '<work-branch> [--onto <line>]',
  promote: '<stage>',
  'cut-release': '<version>',
  'ship-release': '<version>',
  hotfix: '<line> <slug>',
  carry: '<commit|branch>',
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

  switch (gate) {
    case 'start': {
      const [type, slug] = args;
      need(type && slug, `usage: plan start ${GATES.start}`);
      const types = model.work.types;
      if (placeholders(model.work.pattern).includes('type')) need(!types?.length || types.includes(type), `"${type}" is not a declared work type (${types.join(', ')})`);
      const base = opts.on ?? integration;
      need(base === integration || isReleaseLine(base), `work starts on ${integration}${model.releases ? ` or a release line (${model.releases.pattern})` : ''}, not on "${base}"`);
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
        need(target === integration || isReleaseLine(target), `work lands on ${integration} or a release line, not on "${target}"`);
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
      run(`git worktree remove ${WORKTREES}/${slug}`);
      run(`git branch -d ${branch}`);
      if (model.landing.via === 'pr') run(`git push ${R} --delete ${branch}`);
      if (carry) carryNote(hot ? branch : target);
      if (hot && model.fixFlow === 'upstream-first') carryNote(`<the landed fix commit> (cherry-pick -x back to ${resolveLine(model, hot.line) ?? hot.line})`);
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
      note(`stabilisation work: plan start <type> <slug> --on ${name}`);
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
          run(`git tag -a ${tag} ${target} -m "${tag}"`);
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
      if (model.fixFlow === 'merge-forward') {
        join(integration, model.landing.via === 'pr' ? name : `${R}/${name}`, { title: `Carry ${name} → ${integration}` });
        for (const other of releases.filter((r) => r !== name)) {
          note(`only if ${other} is NEWER than ${name}:`);
          join(other, model.landing.via === 'pr' ? name : `${R}/${name}`, { title: `Carry ${name} → ${other}` });
        }
      } else note(`upstream-first: every fix on ${name} should already be on ${integration} — branches.mjs verify confirms`);
      if (!model.releases.maintained) {
        run(`git push ${R} --delete ${name}`);
        run(`git branch -d ${name}`);
      }
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
      if (model.fixFlow === 'upstream-first') note(`upstream-first: the fix lands on ${integration} (plan land ${branch}), then is cherry-picked back to ${line} (plan carry <commit>)`);
      else note(`merge-forward: the fix lands on ${line} (plan land ${branch}), then is carried (plan carry ${branch})`);
      break;
    }

    case 'carry': {
      need(model.fixFlow, 'this model has no release or hotfix lines — every change already lands on integration; there is nothing to carry');
      const [what] = args;
      need(what, `usage: plan carry ${GATES.carry}`);
      const ref = git.ref(what, R);
      const sha = ref ? git.sha(ref) : git.sha(what);
      need(sha, `"${what}" is neither a branch nor a commit`);
      const intTip = tip(integration);
      if (model.fixFlow === 'merge-forward') {
        need(ref, `under merge-forward a fix is carried by merging the line that holds it — name the branch (hotfix or release line), not a commit`);
        const targets = [integration, ...releases].filter((l) => l !== what && tip(l) && !git.isAncestor(sha, tip(l)));
        if (!targets.length) note(`${what} is already in ${integration} and every open release line — nothing to carry`);
        run(`git fetch ${R}`);
        for (const t of targets) {
          if (isReleaseLine(t)) note(`only if ${t} is NEWER than the line ${what} landed on:`);
          join(t, model.landing.via === 'pr' ? what : ref.startsWith('refs/remotes/') ? `${R}/${what}` : what, { title: `Carry ${what} → ${t}` });
        }
      } else {
        let commits;
        let targets;
        const hot = model.hotfixes && ref && match(model.hotfixes.pattern, what);
        if (ref) {
          need(intTip && git.isAncestor(sha, intTip), `upstream-first: land ${what} on ${integration} first (plan land ${what}), then carry it`);
          // The fix's own commits: from where the landing merge forked to the branch tip.
          const landing = git.lines(['rev-list', '--first-parent', '--ancestry-path', `${sha}..${intTip}`]).at(-1);
          const parents = landing ? git.parents(landing) : [];
          commits = parents.length > 1 && !git.isAncestor(sha, parents[0]) ? `${parents[0].slice(0, 12)}..${sha.slice(0, 12)}` : sha.slice(0, 12);
          targets = hot ? [resolveLine(model, hot.line)] : model.releases?.maintained ? releases : [];
        } else {
          need(intTip && git.isAncestor(sha, intTip), `upstream-first: ${what.slice(0, 9)} is not on ${integration} — land it there first`);
          commits = sha.slice(0, 12);
          targets = (model.releases?.maintained ? releases : []).filter((l) => {
            const equiv = git.lines(['cherry', tip(l), sha, `${sha}^`]);
            return !equiv.some((x) => x.startsWith('- '));
          });
        }
        targets = targets.filter((t) => t && tip(t));
        need(targets.length, `no maintained line still needs ${what}`);
        run(`git fetch ${R}`);
        for (const t of targets) {
          note(`only if ${t} carries the code the fix touches; if it cannot apply, record why with a "Not-applicable-upstream:" trailer instead`);
          run(`git switch ${t}`, `the checkout that holds ${t}`);
          run(`git merge --ff-only ${R}/${t}`);
          run(`git cherry-pick -x ${commits}`);
          run(`git push ${R} ${t}`);
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
