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
// A layer whose `requires` are not all active contributes no steps; the plan says so (a WARNING + SYNC_PARTIAL),
// because something the project's layers call for was not applied.
import type { GeneratorStep, LayerId, PlanContext } from './descriptor';
import { LAYERS, inRegistryOrder } from './registry';

export type PlanLine =
  | { kind: 'gen'; generator: string; args: string[] }
  | { kind: 'warn'; message: string }
  | { kind: 'partial' };

export interface StampOptions {
  nxToolsVersion: string;
  pluginVersion: string;
  packageManager: string;
}

/** One argv word, safe to word-split into `nx g` in the rendered sequence: no whitespace, no shell syntax. */
const SAFE_WORD = /^[A-Za-z0-9@._/,=:+-]+$/;

export function plan(ctx: PlanContext, stamp: StampOptions): PlanLine[] {
  const lines: PlanLine[] = [];
  const active = inRegistryOrder(ctx.active);

  const runnable = (id: LayerId): boolean => {
    const entry = LAYERS.find((candidate) => candidate.id === id)!;
    const missing = entry.requires.filter((required) => !ctx.active.has(required));
    if (missing.length === 0) return true;
    lines.push({
      kind: 'warn',
      message:
        `the ${id} layer is present but needs ${missing.join(', ')}, which this project does not have — ` +
        `SKIPPING its generators. Add it (scaffold.sh --sync --ensure=${missing.join(',')} <project>, where a sync ` +
        `can ensure it) and re-run.`,
    });
    lines.push({ kind: 'partial' });
    return false;
  };
  const eligible = active.filter(runnable);

  const emit = (step: GeneratorStep) => {
    const skipped = step.skip?.(ctx);
    if (skipped) {
      lines.push({ kind: 'warn', message: skipped.reason });
      if (skipped.partial) lines.push({ kind: 'partial' });
      return;
    }
    lines.push({ kind: 'gen', generator: step.generator, args: checked(step.generator, step.args?.(ctx) ?? []) });
  };

  const byId = new Map(LAYERS.map((entry) => [entry.id, entry]));
  if (ctx.mode === 'sync') {
    for (const id of eligible) for (const step of byId.get(id)!.generators?.app ?? []) emit(step);
  }
  for (const id of eligible) for (const step of byId.get(id)!.generators?.workspace ?? []) emit(step);

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
      `--layers=${active.join(',')}`,
    ]),
  });
  return lines;
}

/**
 * Refuse an argv word the rendered sequence would mis-split — and a flag passed twice, which `nx g` coerces to
 * an array and rejects against a boolean schema, taking every later generator down under `set -e` (it shipped
 * once, in 0.29.0, as a devcontainer `--firebase=true` with two authors).
 */
function checked(generator: string, args: string[]): string[] {
  const flags = new Set<string>();
  for (const arg of args) {
    if (!SAFE_WORD.test(arg)) throw new Error(`[layers] ${generator}: unsafe argument ${JSON.stringify(arg)}.`);
    const flag = /^--([^=]+)/.exec(arg)?.[1];
    if (flag) {
      if (flags.has(flag)) throw new Error(`[layers] ${generator}: --${flag} is passed twice.`);
      flags.add(flag);
    }
  }
  return args;
}
