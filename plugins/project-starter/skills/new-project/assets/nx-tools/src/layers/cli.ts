// THE LAYER CLI — how a shell asks the registry anything.
//
//   node <nx-tools>/src/layers/cli.js detect
//       The layers present in the workspace at cwd, comma-separated, in registry order.
//   node <nx-tools>/src/layers/cli.js plan --mode=sync|scaffold --active=<csv> --ensured=<csv> --project=<p>
//       --app=<a> --node-major=<n> --voice=0|1 --staging=0|1 --nx-tools-version=<v> --plugin-version=<v>
//       --package-manager=<pm>
//       The generator sequence for this run, one TAB-separated line per step (see PlanLine):
//         gen<TAB><generator><TAB><space-separated argv words>
//         warn<TAB><sentence>
//         partial
//   node <nx-tools>/src/layers/cli.js shell
//       The SHELL PROJECTION of the registry (assets/layers.sh): data + pure-bash functions for the two
//       consumers that cannot load this package — scaffold.sh's outer shell (it validates --ensure BEFORE
//       anything is installed, and on the Docker path the host may have no usable Node) and the SessionStart
//       hook (a few greps at the start of every session, in projects that may have no node_modules at all).
//
// `detect` and `plan` run INSIDE the target workspace, from the installed package — so `nx` and `@nx/devkit`
// resolve from this file's own location, which is the workspace's node_modules on the package.json path and
// `.nx/installation/node_modules` on the Nx-wrapper path. One CLI, both hosting models, no path arguments.
import { FsTree } from 'nx/src/generators/tree';
import type { LayerDescriptor, LayerEvidence } from './descriptor';
import { FLOOR, LAYERS, detectLayers, inRegistryOrder } from './registry';
import { plan } from './plan';
import { DEFAULT_PRESET, PRESETS } from './presets';
import { ADAPTERS } from '../adapters/registry';

function main(argv: string[]): void {
  const [command, ...rest] = argv;
  const flags = parseFlags(rest);
  switch (command) {
    case 'detect':
      process.stdout.write(`${detectLayers(workspace()).join(',')}\n`);
      return;
    case 'plan': {
      const csv = (key: string) => (flags[key] ?? '').split(',').filter(Boolean);
      const lines = plan(
        {
          tree: workspace(),
          mode: flags.mode === 'scaffold' ? 'scaffold' : 'sync',
          active: new Set(inRegistryOrder(csv('active'))),
          ensured: new Set(inRegistryOrder(csv('ensured'))),
          project: required(flags, 'project'),
          app: required(flags, 'app'),
          nodeMajor: flags['node-major'] ?? '22',
          voice: flags.voice === '1',
          staging: flags.staging === '1',
        },
        {
          nxToolsVersion: flags['nx-tools-version'] ?? 'unknown',
          pluginVersion: flags['plugin-version'] ?? 'unknown',
          packageManager: flags['package-manager'] ?? 'npm',
        },
      );
      for (const line of lines) {
        if (line.kind === 'gen') process.stdout.write(`gen\t${line.generator}\t${line.args.join(' ')}\n`);
        else if (line.kind === 'warn') process.stdout.write(`warn\t${line.message.replace(/[\t\n]/g, ' ')}\n`);
        else process.stdout.write('partial\n');
      }
      return;
    }
    case 'shell':
      process.stdout.write(shellProjection());
      return;
    default:
      process.stderr.write('usage: cli.js detect | plan --mode=… | shell\n');
      process.exit(2);
  }
}

function workspace(): FsTree {
  return new FsTree(process.cwd(), false);
}

function parseFlags(args: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const arg of args) {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (!match) throw new Error(`[layers] unexpected argument ${JSON.stringify(arg)} (expected --key=value)`);
    out[match[1]] = match[2];
  }
  return out;
}

function required(flags: Record<string, string>, key: string): string {
  const value = flags[key];
  if (!value) throw new Error(`[layers] plan needs --${key}=…`);
  return value;
}

// ── the shell projection ──────────────────────────────────────────────────────────────────────────────────

/** Single-quote a string for bash. */
const q = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

/** Escape a literal for a grep BASIC regex. */
const bre = (value: string) => value.replace(/[.[\]*^$\\]/g, '\\$&');

/** A `case "$1" in id) … ;; esac` function over `entries` (anything with an id). */
function caseFunction<T extends { id: string }>(name: string, doc: string, entries: readonly T[], value: (entry: T) => string | null): string {
  const arms = entries.map((entry) => {
    const v = value(entry);
    return v === null ? null : `    ${entry.id}) printf '%s\\n' ${q(v)} ;;`;
  }).filter(Boolean);
  return `# ${doc}\n${name}() {\n  case "$1" in\n${arms.join('\n')}\n  esac\n}\n`;
}

/** A `case` function over the registered layers. */
const byIdFunction = (name: string, doc: string, value: (entry: LayerDescriptor) => string | null): string =>
  caseFunction(name, doc, LAYERS, value);

/**
 * Evidence as `<kind> <grep pattern | path>` lines. `file` is a root-relative path; `dependency` is a fixed
 * string to find in the root package.json; `project-json` is a grep BRE to find in any project.json. The
 * mapping from each LayerEvidence kind to one of these three is THE place the shell's approximation of
 * evidence.ts lives — keep the two in step.
 */
function evidenceLines(evidence: LayerEvidence): string {
  const lines: string[] = [];
  for (const path of evidence.files ?? []) lines.push(`file ${path}`);
  for (const pkg of evidence.dependencies ?? []) lines.push(`dependency "${pkg}"`);
  for (const target of evidence.targets ?? []) lines.push(`project-json "${bre(target)}"[[:space:]]*:`);
  for (const tag of evidence.tags ?? []) lines.push(`project-json "${bre(tag)}"`);
  for (const name of evidence.projects ?? []) lines.push(`project-json "name"[[:space:]]*:[[:space:]]*"${bre(name)}"`);
  for (const prefix of evidence.executors ?? []) {
    lines.push(`project-json "executor"[[:space:]]*:[[:space:]]*"${bre(prefix)}`);
  }
  return lines.join('\n');
}

function ensurability(entry: LayerDescriptor, mode: 'scaffold' | 'sync'): string {
  const spec = entry.ensurable[mode];
  return typeof spec === 'object' ? `via:${spec.via}` : spec ? 'yes' : 'no';
}

export function shellProjection(): string {
  const ids = LAYERS.map((entry) => entry.id);
  const ensurableIn = (mode: 'scaffold' | 'sync') =>
    LAYERS.filter((entry) => ensurability(entry, mode) !== 'no')
      .map((entry) => entry.id)
      .join(',');
  return [
    '# shellcheck shell=bash',
    '# GENERATED from the @bespunky/nx-tools layer registry (src/layers/*.ts, via `cli.js shell`). DO NOT EDIT.',
    '# Regenerate with:  node tools/test-layers/run.mjs --write   (CI fails when this file drifts from the registry.)',
    '#',
    '# The pure-bash view of the registry for the two readers that cannot load the package: scaffold.sh, which',
    '# validates --ensure before anything is installed, and the SessionStart hook, which must stay a few greps.',
    '# Sourcing it defines variables and functions only; it runs nothing.',
    '',
    `HOUSE_LAYERS=${q(ids.join(','))}`,
    `HOUSE_LAYER_FLOOR=${q(FLOOR)}`,
    `HOUSE_LAYERS_ENSURABLE_SCAFFOLD=${q(ensurableIn('scaffold'))}`,
    `HOUSE_LAYERS_ENSURABLE_SYNC=${q(ensurableIn('sync'))}`,
    `HOUSE_PRESETS=${q(PRESETS.map((p) => p.id).join(','))}`,
    `HOUSE_PRESET_DEFAULT=${q(DEFAULT_PRESET)}`,
    '',
    byIdFunction('house_layer_title', 'house_layer_title <id> — one line naming the layer.', (e) => e.title),
    byIdFunction('house_layer_requires', 'house_layer_requires <id> — comma-separated required layers.', (e) =>
      e.requires.join(','),
    ),
    byIdFunction('house_layer_hint', 'house_layer_hint <id> — how a human brings the layer into being.', (e) => e.ensureHint),
    byIdFunction('house_layer_brings', 'house_layer_brings <id> — what its house tooling brings (hook drift notice).', (e) =>
      e.brings,
    ),
    byIdFunction('house_layer_ensurable_scaffold', 'house_layer_ensurable_scaffold <id> — yes | no | via:<id>.', (e) =>
      ensurability(e, 'scaffold'),
    ),
    byIdFunction('house_layer_ensurable_sync', 'house_layer_ensurable_sync <id> — yes | no | via:<id>.', (e) =>
      ensurability(e, 'sync'),
    ),
    byIdFunction('house_layer_nx_plugin', 'house_layer_nx_plugin <id> — the Nx plugin a scaffold `nx add`s to create it (or nothing).', (e) =>
      e.nxPlugin ?? null,
    ),
    byIdFunction(
      'house_layer_app_stack',
      'house_layer_app_stack <id> — the stack adapter that creates the first app when a scaffold ensures this layer (or nothing).',
      (e) => ADAPTERS.find((stack) => stack.layer === e.id && stack.apps)?.id ?? null,
    ),
    byIdFunction(
      'house_layer_evidence',
      'house_layer_evidence <id> — `file <path>` | `dependency <fixed string>` | `project-json <grep BRE>` lines.',
      (e) => evidenceLines(e.evidence) || null,
    ),
    caseFunction('house_preset_title', 'house_preset_title <preset> — one line naming the preset.', PRESETS, (p) => p.title),
    caseFunction('house_preset_layers', 'house_preset_layers <preset> — its ensure set, comma-separated.', PRESETS, (p) =>
      p.layers.join(','),
    ),
    EVIDENT_FUNCTION,
  ].join('\n');
}

/**
 * The evidence EVALUATOR, in bash — shipped inside the projection so the hook and the tests run the very same
 * code. Approximate by design (a grep over package.json and the concatenated project.json files), and wrong
 * only in the quiet direction where it can be: a missed layer costs a notice, a false one costs trust in it.
 *
 * ONE traversal, whatever the number of layers: every project.json is read once, concatenated, and each
 * pattern greps that. (`-exec cat {} +` hands paths over as arguments, so a space in a path is a non-event.)
 */
const EVIDENT_FUNCTION = `# house_layers_evident <dir> — the registered layers whose evidence <dir> carries, comma-separated.
house_layers_evident() {
  local dir="$1" id kind pat found='' pj
  pj="$(find "$dir" \\( -name node_modules -o -name .git -o -name dist -o -name .nx -o -name .angular -o -name tmp \\
         -o -name vendor -o -name target -o -name build -o -name out -o -name coverage -o -name .venv \\) -prune -o \\
         -name project.json -exec cat {} + 2>/dev/null)"
  for id in $(printf '%s' "$HOUSE_LAYERS" | tr ',' ' '); do
    while IFS=' ' read -r kind pat; do
      [ -n "$kind" ] || continue
      case "$kind" in
        file)         [ -f "$dir/$pat" ] ;;
        dependency)   grep -qF -- "$pat" "$dir/package.json" 2>/dev/null ;;
        project-json) printf '%s' "$pj" | grep -q -- "$pat" ;;
        *)            false ;;
      esac && { found="\${found:+\$found,}$id"; break; }
    done <<HOUSE_EVIDENCE
$(house_layer_evidence "$id")
HOUSE_EVIDENCE
  done
  printf '%s\\n' "$found"
}
`;

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
