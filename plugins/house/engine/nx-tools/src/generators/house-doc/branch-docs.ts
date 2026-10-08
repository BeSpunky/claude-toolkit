// The branch & release sections of the house docs, as template FLAGS and TOKENS.
//
// The prose stays in the templates (HOUSE.rules.md.tpl, HOUSE.md.tpl) where every other house directive lives;
// what this module supplies is only what the mustache subset cannot express — lists and a table whose length
// depends on the declared model — plus the one flag that picks between the declared and undeclared wording.
//
// ROLE WORDS PLUS NAMES, NEVER SEMANTICS. The projection says which lines exist and which role each plays
// (integration, stage, production, protected pattern), and its STRUCTURED deploy bindings (`deploys`); it does not
// say how a line advances or what a release line is for — and neither may these docs. Those are the model's semantics, owned by the
// skill's engine (`branches.mjs describe`), which auto-updates; a doc that restated them would be a second,
// pinned copy that drifts the first time the model changes.
import { type BranchModel, BRANCH_MODEL_FILE, UNDECLARED_PROTECTED } from '../_utils/branch-model';

export interface BranchDocs {
  flags: Record<string, boolean>;
  tokens: Record<string, string>;
}

const code = (name: string) => `\`${name}\``;

/** `a`, `a and b`, `a, b and c` (or `… or c`) — in code spans. */
function list(names: readonly string[], conjunction: 'and' | 'or' = 'and'): string {
  const spans = names.map(code);
  return spans.length <= 1 ? (spans[0] ?? '') : `${spans.slice(0, -1).join(', ')} ${conjunction} ${spans[spans.length - 1]}`;
}

/** Names, then "every branch matching" the globs — the one phrase every protected/production list uses. */
function namesAndPatterns(names: readonly string[], patterns: readonly string[]): string {
  const parts = [names.length ? list(names) : '', patterns.length ? `every branch matching ${list(patterns)}` : ''];
  return parts.filter(Boolean).join(', plus ');
}

export function branchDocs(model: BranchModel): BranchDocs {
  if (!model.declared) {
    return {
      flags: { 'branches-declared': false },
      tokens: {
        BRANCH_MODEL_FILE,
        BRANCH_UNDECLARED_PROTECTED: list(UNDECLARED_PROTECTED, 'or'),
      },
    };
  }

  const p = model.projection;
  // Every named line, in chain order first (integration, then stages), then any other protected name.
  const lines = [...p.chain, ...p.protected.filter((name) => !p.chain.includes(name))];
  const rows = lines.map((name) => {
    const roles = [
      name === p.integration ? 'integration' : 'stage',
      ...(p.production.includes(name) ? ['production'] : []),
      ...(name === p.workBase ? ['new work branches from here'] : []),
    ];
    return `| ${code(name)} | ${roles.join(' · ')} |`;
  });
  const patterns = [...p.protectedPatterns, ...p.productionPatterns.filter((glob) => !p.protectedPatterns.includes(glob))];
  for (const glob of patterns) {
    const roles = [
      ...(p.protectedPatterns.includes(glob) ? ['protected line (pattern)'] : []),
      ...(p.productionPatterns.includes(glob) ? ['production'] : []),
    ];
    rows.push(`| ${code(glob)} | ${roles.join(' · ')} |`);
  }

  // The STRUCTURED deploy bindings (projection.deploys) — facts the model states and tooling reads (the `ci` layer's
  // workflow is rendered from them), so this page may show them. A free-text note stays the engine's to describe.
  const bound = p.deploys.filter((binding) => binding.ci || binding.appHosting);
  const deployRows = bound.map((binding) => {
    const where = binding.kind === 'tag' ? `tags ${code(binding.line)}` : code(binding.line);
    const ci = binding.ci
      ? `${code(binding.ci.environment)}${Object.keys(binding.ci.providers).length ? ` (${Object.entries(binding.ci.providers).map(([id, target]) => `${id}: ${code(target)}`).join(', ')})` : ''}`
      : '—';
    const appHosting = binding.appHosting?.map((b) => code(`${b.project}/${b.backend}`)).join(', ') ?? '—';
    return `| ${where} | ${ci} | ${appHosting} |`;
  });

  return {
    flags: { 'branches-declared': true, 'deploys-bound': bound.length > 0 },
    tokens: {
      BRANCH_MODEL_FILE,
      BRANCH_SUMMARY: p.summary,
      BRANCH_INTEGRATION: code(p.integration),
      BRANCH_WORK_BASE: code(p.workBase),
      BRANCH_PROTECTED: namesAndPatterns(p.protected, p.protectedPatterns),
      BRANCH_PRODUCTION: namesAndPatterns(p.production, p.productionPatterns),
      BRANCH_TABLE: ['| Line | Role |', '| --- | --- |', ...rows].join('\n'),
      BRANCH_DEPLOYS: ['| Line | CI deploys into (provider: target) | App Hosting auto-rollout |', '| --- | --- | --- |', ...deployRows].join('\n'),
    },
  };
}
