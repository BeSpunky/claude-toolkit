// Which commit(s) landed a branch on a line — read from history, AFTER the fact.
//
// A merge landing keeps the branch's own commits, and ancestry says so. A squash or rebase PR landing replaces
// them with NEW commits on the line, so what to carry cannot be known before the PR merges — but afterwards it
// can, from content: a squash is ONE commit whose patch equals the branch's combined diff (merge-base..tip); a
// rebase is one commit per branch commit, each with that commit's patch. Only when content cannot decide (the
// merge resolved a conflict, so the patch moved) does a PR number in the subject count — and only on a commit
// that names the branch. Anything else is refused: carrying the wrong commit is worse than asking.
const PR_REF = /\(#(\d+)\)\s*$/;
const short = (s) => s.slice(0, 12);

/**
 * → { how: 'ancestry'|'squash'|'rebase'|'pr', pick: string (cherry-pick args), shas: string[], pr? }
 *   | { refused: string } (why it cannot be decided; the caller says how to name the commits instead)
 */
export function landed(git, branch, sha, lineTip, line) {
  if (git.isAncestor(sha, lineTip)) {
    // The fix's own commits: from where the landing merge forked to the branch tip.
    const landing = git.lines(['rev-list', '--first-parent', '--ancestry-path', `${sha}..${lineTip}`]).at(-1);
    const parents = landing ? git.parents(landing) : [];
    const pick = parents.length > 1 && !git.isAncestor(sha, parents[0]) ? `${short(parents[0])}..${short(sha)}` : short(sha);
    return { how: 'ancestry', pick, shas: [sha] };
  }
  const base = git.try(['merge-base', sha, lineTip]);
  if (!base) return { refused: `${branch} shares no history with ${line}` };
  const own = git.patchIds(['log', '-p', '--reverse', '--no-merges', `${base}..${sha}`]);
  if (!own.length) return { refused: `${branch} has no changes of its own since it forked from ${line}` };
  // What arrived on the line since the branch forked — where a squash or rebase landing must be.
  const arrived = git.patchIds(['log', '-p', '--reverse', '--first-parent', '--no-merges', `${base}..${lineTip}`]);
  const withPatch = (p) => arrived.filter((c) => c.patch === p);
  const found = (how, shas, extra) => ({ how, pick: shas.map(short).join(' '), shas, ...extra });

  const whole = git.patchIds(['diff', base, sha])[0]?.patch;
  const squash = whole ? withPatch(whole) : [];
  if (squash.length === 1) return found('squash', [squash[0].commit]);
  if (squash.length > 1) return { refused: `${squash.length} commits on ${line} carry ${branch}'s combined change (${squash.map((c) => short(c.commit)).join(', ')}) — it landed more than once` };

  const each = own.map((c) => withPatch(c.patch));
  if (each.every((m) => m.length === 1) && new Set(each.map((m) => m[0].commit)).size === own.length) {
    return found('rebase', each.map((m) => m[0].commit));
  }

  // Content could not decide. A PR reference counts only on a commit that names this branch (or repeats the
  // subject of one of its commits, which is what a single-commit PR's default title is).
  const subjects = new Set(git.lines(['log', '--no-merges', '--format=%s', `${base}..${sha}`]));
  const named = git.lines(['rev-list', '--first-parent', '--no-merges', `${base}..${lineTip}`])
    .filter((c) => {
      const subject = git.subject(c);
      if (!PR_REF.test(subject)) return false;
      return git.message(c).includes(branch) || subjects.has(subject.replace(PR_REF, '').trim());
    });
  // Reached only when content did not decide, so a PR-tied commit is the conflict-resolved landing.
  if (named.length === 1) return found('pr', named, { pr: git.subject(named[0]).match(PR_REF)[1] });
  if (named.length > 1) return { refused: `${named.length} PR commits on ${line} name ${branch} (${named.map(short).join(', ')})` };
  const partial = each.filter((m) => m.length === 1).length;
  return {
    refused: partial
      ? `only ${partial} of its ${own.length} commit(s) have a patch-equivalent on ${line}, and no PR commit there names it`
      : `no commit on ${line} since ${short(base)} carries its changes (by combined patch, per-commit patch, or a PR reference that names it) — it has not landed`,
  };
}
