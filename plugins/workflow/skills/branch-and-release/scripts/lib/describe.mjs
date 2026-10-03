// The model in words: one line per line kind, with its role, how it advances, and what it is bound to.
import { chainOf, feederOf, productionLine } from './model.mjs';
import { toGlob } from './patterns.mjs';

export function describe(model) {
  const integration = model.integration.branch;
  const landing = model.landing.via === 'pr' ? `a PR, merged with ${model.landing.prStyle}` : 'a --no-ff merge of the rebased work branch';
  const prod = productionLine(model);
  const rows = [];
  rows.push([integration, prod === integration ? 'integration + production' : 'integration', `work lands by ${landing}`, '—']);
  for (const s of model.stages) {
    const f = feederOf(model, s.branch);
    const how =
      f.kind === 'releases'
        ? 'merging a shipped release line'
        : { ff: `--ff-only from ${f.predecessor}`, merge: `--no-ff merge of ${f.predecessor}`, pr: `a PR from ${f.predecessor}, merged with ${model.landing.prStyle}` }[s.promote];
    rows.push([s.branch, s.branch === prod ? 'stage + production' : 'stage', how, s.deploys ?? '—']);
  }
  const r = model.releases;
  if (r) {
    rows.push([
      r.pattern,
      r.maintained ? 'release (maintained — each is production for its version)' : 'release',
      `cut from ${r.cutFrom}; stabilisation work merges in${r.allowDirect?.includes('version-bump') ? '; direct version bumps allowed' : ''}${r.shipsTo ? `; ships into ${r.shipsTo}` : ''}`,
      r.deploys ?? '—',
    ]);
  }
  if (model.hotfixes) rows.push([model.hotfixes.pattern, 'hotfix', model.fixFlow === 'upstream-first' ? `a work branch off ${integration}; cherry-picked -x back to {line}` : 'off its production {line}; lands back on it, then carried', model.hotfixes.deploys ?? '—']);
  rows.push([model.work.pattern, 'work', `off ${integration}${r ? ' (or a release line)' : ''}; one per effort${model.work.types?.length ? `; types: ${model.work.types.join(', ')}` : ''}`, '—']);
  for (const t of model.tags) rows.push([t.pattern, 'tag', `on ${t.on}`, t.deploys ?? '—']);

  const head = ['line', 'role', 'advances by', 'deploys'];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((row) => String(row[i]).length)));
  const fmt = (row) => row.map((c, i) => String(c).padEnd(widths[i])).join('  ').trimEnd();

  const words = [];
  words.push(`Branch model${model.derivedFrom ? ` (derived from "${model.derivedFrom}")` : ''}: ${chainOf(model).join(' → ')}${model.stages.length ? '' : ' (trunk: integration is production)'}.`);
  words.push(`Work lands on ${integration}; production is ${[prod, ...(r?.maintained ? [`every ${toGlob(r.pattern)} line`] : [])].join(' and ')}.`);
  if (model.fixFlow)
    words.push(
      model.fixFlow === 'merge-forward'
        ? `Fix flow: merge-forward — a fix lands at its source, then that line is merged into ${integration} and every newer open release line.`
        : `Fix flow: upstream-first — a fix lands on ${integration} first, then is cherry-picked (-x) back to each maintained line that needs it.`,
    );
  words.push(`Remote: ${model.remote || 'origin'}.`);
  return [...words, '', fmt(head), fmt(widths.map((w) => '-'.repeat(w))), ...rows.map(fmt)].join('\n');
}
