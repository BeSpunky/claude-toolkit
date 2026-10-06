// THE LAYER CLI — how a shell asks the registry anything.
//
//   node <nx-tools>/src/layers/cli.js detect
//       The layers present in the workspace at cwd, comma-separated, in registry order.
//   node <nx-tools>/src/layers/cli.js plan --mode=new|upgrade --active=<csv> --ensured=<csv> --project=<p>
//       --app=<a> --node-major=<n> --voice=0|1 --staging=0|1 --nx-tools-version=<v> --plugin-version=<v>
//       --package-manager=<pm> [--branch-projection=<projection JSON>|undeclared]
//       The generator sequence for this run, one TAB-separated line per step (see PlanLine):
//         gen<TAB><generator>[<TAB><arg>]…        (each argument one field — it may hold spaces, never a TAB)
//         warn<TAB><sentence>
//         partial
//   node <nx-tools>/src/layers/cli.js apps
//       The apps an upgrade's per-app steps are for — one per line as `<project name><TAB><project root>`: the
//       client applications the project DECLARES it serves (`.bespunky/dev.json`), else every client application
//       in the graph. Layout- and linking-agnostic: read from the project graph (project.json and package.json
//       projects alike) and classified by `projectRole`, never by where a directory sits.
//   node <nx-tools>/src/layers/cli.js shell
//       The SHELL PROJECTION of the registry (engine/layers.sh): data + pure-bash functions for the two
//       consumers that cannot load this package — house.sh's outer shell (it validates the layers to add BEFORE
//       anything is installed, and on the Docker path the host may have no usable Node) and the SessionStart
//       hook (a few greps at the start of every session, in projects that may have no node_modules at all).
//
// `detect` and `plan` run INSIDE the target workspace, from the installed package — so `nx` and `@nx/devkit`
// resolve from this file's own location, which is the workspace's node_modules on the package.json path and
// `.nx/installation/node_modules` on the Nx-wrapper path. One CLI, both hosting models, no path arguments.
import { FsTree } from 'nx/src/generators/tree';
import { RUN_MODES, type LayerDescriptor, type LayerEvidence, type RunMode } from './descriptor';
import { FLOOR, LAYERS, detectLayers, inRegistryOrder } from './registry';
import { plan } from './plan';
import { DEFAULT_PRESET, PRESETS } from './presets';
import { ADAPTERS, projectRole } from '../adapters/registry';
import { getProjects, type Tree } from '@nx/devkit';
import { DEFAULT_LAYOUT, LAYOUTS, type LayoutId } from '../generators/_utils/workspace-layout';
import type { LinkingKind } from '../generators/_utils/linking';
import { readDeclaration } from '../generators/dev/declaration';

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
          mode: runMode(flags.mode),
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
          branchProjection: flags['branch-projection'] || undefined,
        },
      );
      for (const line of lines) {
        if (line.kind === 'gen') process.stdout.write(`${['gen', line.generator, ...line.args].join('\t')}\n`);
        else if (line.kind === 'warn') process.stdout.write(`warn\t${line.message.replace(/[\t\n]/g, ' ')}\n`);
        else process.stdout.write('partial\n');
      }
      return;
    }
    case 'apps':
      for (const app of appsToRefresh(workspace())) process.stdout.write(`${app.name}\t${app.root}\n`);
      return;
    case 'shell':
      process.stdout.write(shellProjection());
      return;
    default:
      process.stderr.write('usage: cli.js detect | plan --mode=… | apps | shell\n');
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

/** The run mode, named after the house command — refused when it is anything else (never guessed). */
function runMode(value: string | undefined): RunMode {
  const mode = RUN_MODES.find((known) => known === value);
  if (!mode) throw new Error(`[layers] plan needs --mode=${RUN_MODES.join('|')} (got ${JSON.stringify(value ?? '')}).`);
  return mode;
}

function required(flags: Record<string, string>, key: string): string {
  const value = flags[key];
  if (!value) throw new Error(`[layers] plan needs --${key}=…`);
  return value;
}

// ── the workspace's apps ──────────────────────────────────────────────────────────────────────────────────

/**
 * The apps an upgrade refreshes when none is named.
 *
 * The CANDIDATES are every APPLICATION (`projectRole` — a stack recognising its own build, the declared
 * `projectType`, Nx's tsconfig convention; so a package.json-defined project counts too) that is not SERVER-side.
 * The graph cannot say more than that: a Windows service, an HTTP API or a test-fixture tool is an application
 * no stack recognises as server-side unless someone tagged it, and a workspace with four of them made inference
 * decline and every per-app step skip. The project, though, has already SAID which of its apps it serves — its
 * `.bespunky/dev.json` names them — and the per-app steps (the dev-server, the worktree tab label, the design
 * system's sass channel, the Firebase client) are about exactly that. So a declaration that names any candidate
 * narrows the candidates to those it names; a declaration that names none of them (a dev.json serving only
 * non-Nx processes) or no declaration at all leaves the graph's answer standing. A declared FACT outranks an
 * inferred one, and the inference still covers the projects that have not declared anything.
 *
 * Why the server exclusion, and why by tag: the per-app steps a sync runs (the dev-server, the design system's
 * sass channel, the Firebase client) are all for something a browser loads. The house's own server app — Cloud
 * Functions, created by firebase-emulators — is an application all the same, and it used to be excluded by its
 * NAME (`functions`) from a glob over `apps/*`. What it IS is declared on it: the house tags its deployable
 * surfaces by platform (`platform:server` on the functions project, `platform:web` on every client the Firebase
 * client attaches to — the same tags the ESLint platform firewall enforces). So the rule is the tag, wherever the
 * project lives and whatever it is called; a renamed or relocated functions app is still excluded, and an
 * untagged app (no Firebase in the workspace at all) is a candidate, exactly as before.
 */
export function appsToRefresh(tree: Tree): Array<{ name: string; root: string }> {
  if (!tree.exists('nx.json')) return [];
  const apps: Array<{ name: string; root: string }> = [];
  for (const [name, project] of getProjects(tree)) {
    if (projectRole(tree, name) !== 'application') continue;
    if (project.tags?.includes(SERVER_PLATFORM_TAG)) continue;
    apps.push({ name, root: project.root });
  }
  const served = new Set(Object.keys(readDeclaration(tree)?.apps ?? {}));
  const declared = apps.filter((app) => served.has(app.name));
  return (declared.length > 0 ? declared : apps).sort((a, b) => a.name.localeCompare(b.name));
}

/** The house's tag for a server-side deployable (firebase-emulators sets it on Cloud Functions). */
const SERVER_PLATFORM_TAG = 'platform:server';

// ── the workspace shape a scaffold may choose ─────────────────────────────────────────────────────────────

/** The named layouts, for the projection. Typed over `LayoutId`, so a layout added to LAYOUTS is a compile error here until titled. */
const LAYOUT_TITLES: Readonly<Record<LayoutId, string>> = {
  'apps-libs': 'apps under apps/, libraries under libs/ — the classic integrated Nx convention',
  packages: 'every project under packages/ — the package-based convention',
};

/** The linking strategies, for the projection. Typed over `LinkingKind` for the same reason. */
const LINKINGS: Readonly<Record<LinkingKind, string>> = {
  paths: 'project.json projects reached through tsconfig `paths` aliases',
  workspaces: 'a TS-solution workspace — package.json projects, package-manager workspaces, TS project references',
};

/** What a scaffold that names no linking gets: today's output. */
const DEFAULT_LINKING: LinkingKind = 'paths';

const asEntries = <K extends string>(record: Readonly<Record<K, string>>) =>
  (Object.entries(record) as Array<[K, string]>).map(([id, title]) => ({ id, title }));

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
 * string to find in the root package.json; `project-json` is a grep BRE to find in any PROJECT CONFIGURATION —
 * a project.json, or the package.json of a package-manager workspace member (see `house_project_jsons`). The
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

function ensurability(entry: LayerDescriptor, mode: RunMode): string {
  const spec = entry.ensurable[mode];
  return typeof spec === 'object' ? `via:${spec.via}` : spec ? 'yes' : 'no';
}

export function shellProjection(): string {
  const ids = LAYERS.map((entry) => entry.id);
  const ensurableIn = (mode: RunMode) =>
    LAYERS.filter((entry) => ensurability(entry, mode) !== 'no')
      .map((entry) => entry.id)
      .join(',');
  return [
    '# shellcheck shell=bash',
    '# GENERATED from the @bespunky/nx-tools layer registry (src/layers/*.ts, via `cli.js shell`). DO NOT EDIT.',
    '# Regenerate with:  node tools/test-layers/run.mjs --write   (CI fails when this file drifts from the registry.)',
    '#',
    '# The pure-bash view of the registry for the two readers that cannot load the package: house.sh, which',
    '# validates the layers to add before anything is installed, and the SessionStart hook, which must stay a few greps.',
    '# Sourcing it defines variables and functions only; it runs nothing.',
    '',
    `HOUSE_LAYERS=${q(ids.join(','))}`,
    `HOUSE_LAYER_FLOOR=${q(FLOOR)}`,
    `HOUSE_LAYERS_ENSURABLE_NEW=${q(ensurableIn('new'))}`,
    `HOUSE_LAYERS_ENSURABLE_UPGRADE=${q(ensurableIn('upgrade'))}`,
    `HOUSE_PRESETS=${q(PRESETS.map((p) => p.id).join(','))}`,
    `HOUSE_PRESET_DEFAULT=${q(DEFAULT_PRESET)}`,
    `HOUSE_LAYOUTS=${q(Object.keys(LAYOUTS).join(','))}`,
    `HOUSE_LAYOUT_DEFAULT_APPS_DIR=${q(DEFAULT_LAYOUT.appsDir)}`,
    `HOUSE_LINKINGS=${q(Object.keys(LINKINGS).join(','))}`,
    `HOUSE_LINKING_DEFAULT=${q(DEFAULT_LINKING)}`,
    '',
    byIdFunction('house_layer_title', 'house_layer_title <id> — one line naming the layer.', (e) => e.title),
    byIdFunction('house_layer_requires', 'house_layer_requires <id> — comma-separated required layers.', (e) =>
      e.requires.join(','),
    ),
    byIdFunction('house_layer_hint', 'house_layer_hint <id> — how a human brings the layer into being.', (e) => e.ensureHint),
    byIdFunction('house_layer_brings', 'house_layer_brings <id> — what its house tooling brings (hook drift notice).', (e) =>
      e.brings,
    ),
    byIdFunction('house_layer_ensurable_new', 'house_layer_ensurable_new <id> — yes | no | via:<id>.', (e) =>
      ensurability(e, 'new'),
    ),
    byIdFunction('house_layer_ensurable_upgrade', 'house_layer_ensurable_upgrade <id> — yes | no | via:<id>.', (e) =>
      ensurability(e, 'upgrade'),
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
    caseFunction('house_layout_title', 'house_layout_title <layout> — one line naming the layout.', asEntries(LAYOUT_TITLES), (l) => l.title),
    caseFunction(
      'house_layout_apps_dir',
      'house_layout_apps_dir <layout> — where it keeps applications (a scaffold\'s first app lands there).',
      asEntries(LAYOUT_TITLES),
      (l) => LAYOUTS[l.id].appsDir,
    ),
    caseFunction('house_linking_title', 'house_linking_title <linking> — one line naming the linking strategy.', asEntries(LINKINGS), (l) => l.title),
    EVIDENT_FUNCTION,
  ].join('\n');
}

/**
 * The evidence EVALUATOR, in bash — shipped inside the projection so the hook and the tests run the very same
 * code. Approximate by design (a grep over package.json and the concatenated project.json files), and wrong
 * only in the quiet direction where it can be: a missed layer costs a notice, a false one costs trust in it.
 *
 * WHICH FILES: the project configurations Nx itself would read — every project.json, AND the package.json of every
 * package-manager workspace member (package.json `workspaces`, pnpm-workspace.yaml `packages`), which is how a
 * TS-solution workspace defines its projects: Nx's package-json plugin turns exactly those manifests into projects
 * (their `nx` block, their scripts as targets). Reading project.json alone left every layer such a workspace
 * declares invisible to the hook. The root package.json is NOT read as a project here — it is the `dependency`
 * kind's file, and its scripts are the workspace's, not a project's (missing a root project is the quiet direction).
 * Same quiet direction without git: the pruned `find` reads project.json files only.
 *
 * And only the ones Nx would read — so the hook can never report a layer the sync
 * (`getProjects`) does not detect, and then nag about it every session. Nx skips what git ignores; so does this:
 * inside a git work tree the list is `git ls-files` (tracked + untracked, minus ignored — and git never descends
 * into a nested work tree, which is what `.claude/worktrees/*` are). A directory that is no work tree is read the
 * same way through a throwaway repository, because Nx honours its .gitignore all the same. Only with no git at
 * all does a pruned `find` stand in (the usual build/dependency dirs, `.claude/worktrees`, nested work trees).
 *
 * ONE traversal, whatever the number of layers: every project.json is read once, concatenated, and each
 * pattern greps that. (Paths go through NUL-separated xargs / `-exec … +`, so a space in a path is a non-event.)
 */
const EVIDENT_FUNCTION = `# house_workspace_globs <dir> — the package-manager workspace globs <dir> declares, one per line (\`!\` kept).
house_workspace_globs() {
  local dir="$1"
  [ -f "$dir/package.json" ] && tr -d '\\n\\r' < "$dir/package.json" \\
    | grep -o '"workspaces"[[:space:]]*:[[:space:]]*[[{][^]}]*' | head -1 \\
    | sed 's/^"workspaces"[[:space:]]*:[[:space:]]*//; s/^{[[:space:]]*"packages"[[:space:]]*:[[:space:]]*//' \\
    | grep -o '"[^"]*"' | tr -d '"'
  [ -f "$dir/pnpm-workspace.yaml" ] && sed -n '/^packages:/,/^[^[:space:]-]/s/^[[:space:]]*-[[:space:]]*//p' "$dir/pnpm-workspace.yaml" \\
    | sed 's/[[:space:]]*#.*$//' | tr -d "\\"'"
  return 0
}

# house_project_jsons <dir> — every project configuration Nx would read under <dir> (project.json files and the
# package.json of each workspace member), concatenated.
house_project_jsons() {
  local dir="$1" scratch='' glob
  set -- -z --cached --others --exclude-standard -- project.json '*/project.json'
  while IFS= read -r glob; do
    glob="\${glob#./}"; glob="\${glob%/}"
    case "$glob" in
      ''|'.') ;;
      '!'*) set -- "$@" ":(exclude,glob)\${glob#!}/package.json" ;;
      *)    set -- "$@" ":(glob)$glob/package.json" ;;
    esac
  done <<HOUSE_WORKSPACES
$(house_workspace_globs "$dir")
HOUSE_WORKSPACES
  if git -C "$dir" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    ( cd "$dir" && git ls-files "$@" 2>/dev/null | xargs -0 cat 2>/dev/null )
  elif scratch="$(mktemp -d 2>/dev/null)" && git init -q --bare "$scratch" >/dev/null 2>&1; then
    # Not a work tree — but Nx still honours .gitignore there, so lend git a throwaway repository to read it with.
    ( cd "$dir" && git --git-dir="$scratch" --work-tree=. ls-files "$@" 2>/dev/null | xargs -0 cat 2>/dev/null )
    rm -rf "$scratch"
  else
    # No git at all: the usual build/dependency dirs, the house worktree home and nested work trees, pruned.
    [ -z "$scratch" ] || rm -rf "$scratch"
    find "$dir" -mindepth 1 \\( -name node_modules -o -name .git -o -name dist -o -name .nx -o -name .angular -o -name tmp \\
           -o -name vendor -o -name target -o -name build -o -name out -o -name coverage -o -name .venv \\
           -o -path '*/.claude/worktrees' -o \\( -type d -exec test -e '{}/.git' \\; \\) \\) -prune -o \\
           -name project.json -exec cat {} + 2>/dev/null
  fi
}

# house_layers_evident <dir> — the registered layers whose evidence <dir> carries, comma-separated.
house_layers_evident() {
  local dir="$1" id kind pat found='' pj
  pj="$(house_project_jsons "$dir")"
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
