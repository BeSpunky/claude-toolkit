// THE PLAN — which house generators a run executes, in what order, with which arguments.
//
// This is what scaffold.sh used to hard-code as `if layer_active X; then nx g … fi` blocks. It is now derived
// from the registered descriptors, so a new layer's generators run because the layer is registered — not
// because someone remembered to add a block to a shell string.
//
// ORDER (unchanged from the hand-written sequence it replaces):
//   1. per-app steps, sync only, in registry order — a scaffold's `app` generator composes them itself;
//   2. workspace steps, in registry order;
//   3. the STAMP — `house-doc`, layer-independent and LAST, because it records the layer set this run applied
//      and must see every layer above have its turn.
//
// A layer whose `requires` are not all APPLIED contributes no steps — and is applied by nothing downstream: not
// composed into the devcontainer, not enabled in the Claude settings, not stamped. The plan says so (a WARNING +
// SYNC_PARTIAL), because something the project's layers call for was not applied, and says how to fix it in a
// sentence the reader can act on — never a command this mode would refuse.
import type { GeneratorStep, LayerId, PlanContext } from './descriptor';
import { inRegistryOrder, layer } from './registry';

export type PlanLine =
  | { kind: 'gen'; generator: string; args: string[] }
  | { kind: 'warn'; message: string }
  | { kind: 'partial' };

export interface StampOptions {
  nxToolsVersion: string;
  pluginVersion: string;
  packageManager: string;
  /**
   * The branch model the run RESOLVED (house-branches.sh): the projection as JSON, or the literal `undeclared`.
   * Passed to house-doc as `--branchProjection` so it renders the model in force rather than re-resolving it from
   * the working tree. Absent/empty (an unreadable model, or a caller with nothing resolved) → house-doc reads the
   * Tree itself, as it does standalone.
   */
  branchProjection?: string;
}

/**
 * One argument, safe to carry as one TAB-separated FIELD of a plan line: the rendered sequence reads the fields into
 * an array and passes them quoted, so spaces and shell syntax are inert — only a TAB, a newline or another control
 * character could split or corrupt the line. Non-empty, because an empty field collapses under TAB splitting.
 */
const SAFE_FIELD = /^[^\u0000-\u001f\u007f]+$/;

export function plan(ctx: PlanContext, stamp: StampOptions): PlanLine[] {
  const lines: PlanLine[] = [];

  // THE APPLIED SET — the layers whose steps this run actually executes. A layer whose `requires` are not all
  // APPLIED (not merely active: a requirement that is itself skipped takes its dependants down with it) runs no
  // steps — and then nothing downstream may claim it either. The devcontainer composes, claude-settings enables
  // and the stamp records THIS set, never `ctx.active`: composing an unmet layer's fragment ships its tooling
  // (a JDK, emulator ports) for a layer that was never wired, and stamping it tells every later reader — the
  // hook, the next sync — that it was. Registry order is a topological order, so one pass decides it.
  const applied = new Set<LayerId>();
  for (const id of inRegistryOrder(ctx.active)) {
    const missing = layer(id).requires.filter((required) => !applied.has(required));
    if (missing.length === 0) {
      applied.add(id);
      continue;
    }
    lines.push({ kind: 'warn', message: unmet(ctx, id, missing) });
    lines.push({ kind: 'partial' });
  }
  // Every step reads the run through THIS context, so no step can see a layer the plan did not apply.
  const run: PlanContext = { ...ctx, active: applied, ensured: new Set([...ctx.ensured].filter((id) => applied.has(id))) };
  const eligible = [...applied];

  const emit = (step: GeneratorStep) => {
    const skipped = step.skip?.(run);
    if (skipped) {
      lines.push({ kind: 'warn', message: skipped.reason });
      if (skipped.partial) lines.push({ kind: 'partial' });
      return;
    }
    lines.push({ kind: 'gen', generator: step.generator, args: checked(step.generator, step.args?.(run) ?? []) });
  };

  if (ctx.mode === 'sync') {
    for (const id of eligible) for (const step of layer(id).generators?.app ?? []) emit(step);
  }
  for (const id of eligible) for (const step of layer(id).generators?.workspace ?? []) emit(step);

  // THE STAMP. Ungated: HOUSE.rules.md is how the house directives reach a session at all (CLAUDE.md
  // `@`-imports it), and that must not be contingent on wanting the agent tooling. Section-level gating inside
  // house-doc (by --layers) is what makes running it everywhere safe.
  lines.push({
    kind: 'gen',
    generator: 'house-doc',
    args: checked('house-doc', [
      `--nxToolsVersion=${stamp.nxToolsVersion}`,
      `--pluginVersion=${stamp.pluginVersion}`,
      `--packageManager=${stamp.packageManager}`,
      `--layers=${eligible.join(',')}`,
      ...(stamp.branchProjection ? [`--branchProjection=${stamp.branchProjection}`] : []),
    ]),
  });
  return lines;
}

/**
 * Refuse an argument the rendered sequence would mis-split — and a flag passed twice, which `nx g` coerces to
 * an array and rejects against a boolean schema, taking every later generator down under `set -e` (it shipped
 * once, in 0.29.0, as a devcontainer `--firebase=true` with two authors).
 */
function checked(generator: string, args: string[]): string[] {
  const flags = new Set<string>();
  for (const arg of args) {
    if (!SAFE_FIELD.test(arg)) throw new Error(`[layers] ${generator}: unsafe argument ${JSON.stringify(arg)}.`);
    const flag = /^--([^=]+)/.exec(arg)?.[1];
    if (flag) {
      if (flags.has(flag)) throw new Error(`[layers] ${generator}: --${flag} is passed twice.`);
      flags.add(flag);
    }
  }
  return args;
}

/**
 * Why `id` was skipped, and how to bring what it lacks — per missing layer, the remedy THIS mode actually
 * accepts: `--ensure=<it>` only where the mode can ensure it (a sync refuses `--ensure=node`), else the layer's
 * own hint. A requirement that is active but itself skipped is named as such; its own warning carries the fix.
 */
function unmet(ctx: PlanContext, id: LayerId, missing: readonly LayerId[]): string {
  const remedies = missing.map((required) => {
    if (ctx.active.has(required)) return `${required} (itself skipped above)`;
    const spec = layer(required).ensurable[ctx.mode];
    if (spec === true) {
      return ctx.mode === 'sync'
        ? `${required} — re-run with \`scaffold.sh --sync --ensure=${required} <project>\``
        : `${required} — add it to --ensure`;
    }
    return `${required} — ${layer(required).ensureHint}`;
  });
  return `the ${id} layer is present but needs ${missing.join(', ')}, which this run does not apply — SKIPPING its generators (and leaving it out of the devcontainer, the Claude settings and the stamp). To bring it: ${remedies.join('; ')}.`;
}
