// House generator: the `ci` layer — continuous DEPLOYMENT driven by the branch model.
//
// The contract is two facts the project already owns, and nothing else:
//   - WHEN and WHERE: the branch model's `ci` deploy bindings (`.bespunky/branches.json` → projection.deploys) —
//     which lines deploy, into which environment, with which target per deploy provider;
//   - WHAT: every project's `deploy` target. `nx affected -t deploy` ships what changed; nothing here knows a stack.
// What differs per cloud is a PROVIDER the active layers contribute (`LayerDescriptor.ciDeploy` — Firebase today):
// its auth steps, the options ITS deploy targets take per environment (a `ci-<environment>` Nx configuration this
// generator writes on those targets only — never on anyone else's), and the cloud setup only a HUMAN may run (IAM).
//
// SECURITY RULES, re-checked here on the projection (the engine refuses them in the declaration; a hand-edited
// projection must not get past this generator either): a `ci` binding is wired only on a PROTECTED line — never
// a hotfix (work) pattern, a maintained release pattern, or a tag — and ONE line per environment.
//
// OWNED, with adoption — like the devcontainer. Everything written here is regenerated on every upgrade, because the
// workflow's triggers and the cloud identity's conditions are both DERIVED from the branch model and must move with
// it. The marker (`.bespunky/ci.json`, also the layer's evidence) lists the files the house wrote; only those are
// ever rewritten or removed. A file at one of those paths the house did NOT write is never touched, and an existing
// workflow that already deploys (the project's own pipeline) keeps the house from writing a second one — two
// workflows deploying on the same push is the one outcome worse than none. Both are reported with the switch.
//
// UNDECLARED model, or no `ci` binding: no workflow — the toolkit never guesses a production branch (a deploy
// trigger guessed wrong ships from the wrong line). The marker still records the layer, so the upgrade after the
// model gains a binding writes it without being asked again.
import { type Tree, formatFiles, logger, readProjectConfiguration } from '@nx/devkit';
import { type CiDeployProvider, type CiEnvironment } from '../../layers/descriptor';
import { detectLayers, layer } from '../../layers/registry';
import { branchModelFromOption, readBranchModel, type BranchModel, type BranchProjection } from '../_utils/branch-model';
import { nxInvocation } from '../_utils/nx-host';
import { updateProjectConfigurationInPlace } from '../_utils/project-files';
import { MARKER, ciConfiguration, renderWorkflow, WORKFLOW, type WiredLine } from './workflow';

export { MARKER };

export interface CiSchema {
  /** The layers this run applies (the providers are theirs). Defaults to detecting them. */
  layers?: string[];
  /** The branch model the caller resolved (projection JSON, or `undeclared`); absent → the Tree's copy. */
  branchProjection?: string;
}

interface CloudEntry {
  target: string;
  branches: string[];
  /** No binding names it any more; rendered only so its recorded setup can be rolled back. */
  retired?: boolean;
}

interface Marker {
  about?: string;
  /** Every file the house wrote and still owns. */
  files: string[];
  /** What each provider's human-run setup was last rendered for: provider → environment → target + branches. */
  cloud: Record<string, Record<string, CloudEntry>>;
  /** The `ci-<environment>` configurations this layer wrote on provider deploy targets: `project:target` → names. */
  configurations: Record<string, string[]>;
  /** Why there is no workflow (undeclared model, no binding, a pipeline of the project's own). */
  pending?: string;
}

const ABOUT =
  'Written by @bespunky/nx-tools (the ci layer). `files` are the files the house owns and rewrites on every upgrade; ' +
  '`cloud` is what tools/setup-gcp.sh was last rendered for (a change prints a HUMAN_STEP); `configurations` are the ' +
  'ci-<environment> configurations it wrote on provider deploy targets. Never hand-edit.';

export default async function ciGenerator(tree: Tree, options: CiSchema = {}): Promise<void> {
  const layers = options.layers?.length ? options.layers : detectLayers(tree);
  const providers = layers.map((id) => layer(id).ciDeploy).filter((p): p is CiDeployProvider => Boolean(p));
  const previous = readMarker(tree);
  const model: BranchModel =
    options.branchProjection !== undefined ? branchModelFromOption(options.branchProjection) : readBranchModel(tree);

  const notes: string[] = [];
  const { lines, environments, pending } = resolve(model, providers, notes);

  // ── environments no binding names any more, whose cloud setup is still recorded: kept until rolled back ──────
  const retired = new Map<string, CiEnvironment[]>();
  for (const provider of providers) {
    const active = new Set((environments.get(provider.id) ?? []).map((env) => env.name));
    for (const [name, entry] of Object.entries(previous.cloud[provider.id] ?? {})) {
      if (active.has(name)) continue;
      if (provider.isSetUp?.(tree, name)) {
        (retired.get(provider.id) ?? retired.set(provider.id, []).get(provider.id)!).push({ name, target: entry.target, branches: entry.branches, retired: true });
      } else if (!entry.retired) {
        notes.push(`${provider.id}: no line deploys into "${name}" any more, and no setup is recorded for it — nothing in the cloud to undo.`);
      } else {
        notes.push(`${provider.id}: "${name}" was rolled back (its setup record is gone) — dropped from the setup script.`);
      }
    }
  }

  // ── what the house writes this run ──────────────────────────────────────────────────────────────────────
  const wanted = new Map<string, { content: string; mode?: number }>();
  const foreign = foreignDeployWorkflows(tree, previous.files);
  let reason = pending;
  if (lines.length && foreign.length) {
    reason =
      `this repo already deploys from ${foreign.join(', ')} — the house writes no second deploy workflow (two would deploy on the same push). ` +
      `To hand deployment to the house: delete ${foreign.length > 1 ? 'them' : 'it'}, then upgrade.`;
  } else if (lines.length) {
    const nx = nxInvocation(tree);
    wanted.set(WORKFLOW, {
      content: renderWorkflow({
        lines,
        providers,
        nx: nx.command,
        packageManager: nx.packageManager,
        yarnBerry: tree.exists('.yarnrc.yml') || /"packageManager"\s*:\s*"yarn@[2-9]/.test(tree.read('package.json', 'utf8') ?? ''),
      }),
    });
    if (!tree.exists('.nvmrc')) notes.push(`the workflow reads Node from .nvmrc, which this repo does not have — add it (one line: the Node major) or the deploy job fails at setup-node.`);
  }
  // The providers' human-run setup is useful whoever runs the pipeline, so it follows the bindings (and the
  // retired environments still to roll back), not the workflow.
  for (const provider of providers) {
    const envs = [...(environments.get(provider.id) ?? []), ...(retired.get(provider.id) ?? [])];
    if (envs.length && provider.files) for (const file of provider.files(tree, envs)) wanted.set(file.path, file);
  }

  // ── write what is owned; never what is not ───────────────────────────────────────────────────────────────
  const owned = new Set(previous.files);
  const files: string[] = [];
  for (const [path, file] of wanted) {
    if (tree.exists(path) && !owned.has(path)) {
      notes.push(`${path} exists and the house did not write it — left untouched. Move it aside and upgrade to let the house own it.`);
      continue;
    }
    tree.write(path, file.content, file.mode ? { mode: file.mode } : undefined);
    files.push(path);
  }
  for (const path of previous.files) {
    if (!wanted.has(path) && tree.exists(path)) {
      tree.delete(path);
      notes.push(`removed ${path} — nothing in the branch model calls for it any more.`);
    }
  }

  // ── provider options reach provider targets only: a ci-<environment> configuration on each ────────────────
  const configurations = writeConfigurations(tree, providers, environments, previous.configurations, notes);

  // ── the cloud side cannot be regenerated: say what a human must run ──────────────────────────────────────
  const human: string[] = [];
  const cloud: Marker['cloud'] = {};
  for (const provider of providers) {
    for (const env of environments.get(provider.id) ?? []) {
      (cloud[provider.id] ??= {})[env.name] = { target: env.target, branches: env.branches };
      const before = previous.cloud[provider.id]?.[env.name];
      const changed = !before || before.retired || before.target !== env.target || before.branches.join(',') !== env.branches.join(',');
      if (changed && provider.humanStep && files.length) human.push(provider.humanStep(env));
    }
    for (const env of retired.get(provider.id) ?? []) {
      (cloud[provider.id] ??= {})[env.name] = { target: env.target, branches: env.branches, retired: true };
      if (provider.retireStep && files.length) human.push(provider.retireStep(env));
    }
  }

  const marker: Marker = { about: ABOUT, files, cloud, configurations, ...(reason ? { pending: reason } : {}) };
  tree.write(MARKER, `${JSON.stringify(marker, null, 2)}\n`);

  if (reason) logger.warn(`[ci] No deploy workflow: ${reason}`);
  else logger.info(`[ci] ${WORKFLOW}: deploys ${lines.map((l) => `${l.branch} → ${l.environment}`).join(', ')}.`);
  for (const note of notes) logger.warn(`[ci] ${note}`);
  for (const step of human) logger.info(`HUMAN_STEP: ${step}`);

  await formatFiles(tree);
}

/**
 * The bindings this pipeline wires: protected branch lines and patterns with a `ci` binding naming every active
 * provider, one line per environment. Everything it cannot (or must not) wire is a NOTE saying why — never a
 * silent gap.
 */
function resolve(
  model: BranchModel,
  providers: readonly CiDeployProvider[],
  notes: string[],
): { lines: WiredLine[]; environments: Map<string, CiEnvironment[]>; pending?: string } {
  const environments = new Map<string, CiEnvironment[]>();
  if (!model.declared) {
    return {
      lines: [],
      environments,
      pending:
        'the branch model is not declared (.bespunky/branches.json), and the house never guesses which branch is production. ' +
        'Declare it (the bespunky-workflow:branch-and-release skill), give each line that should deploy a `ci` binding, then upgrade.',
    };
  }
  const lines: WiredLine[] = [];
  const bound = new Map<string, string>(); // environment → the line that holds it
  for (const binding of model.projection.deploys) {
    if (!binding.ci) continue;
    const refused = unprotected(binding, model.projection);
    if (refused) {
      notes.push(`${binding.line}: its \`ci\` binding is NOT wired — ${refused}`);
      continue;
    }
    const holder = bound.get(binding.ci.environment);
    if (holder) {
      notes.push(`${binding.line}: its \`ci\` binding is NOT wired — environment "${binding.ci.environment}" is already bound by ${holder}. One line per environment: two lines deploying into one environment race, and leave it running code neither line has.`);
      continue;
    }
    const missing = providers.filter((p) => !(p.id in binding.ci!.providers));
    if (missing.length) {
      notes.push(
        `${binding.line}: its \`ci\` binding names no target for ${missing.map((p) => p.id).join(', ')} — not wired. ` +
          `Add "providers": { ${missing.map((p) => `"${p.id}": "<${p.id === 'firebase' ? '.firebaserc alias' : 'target'}>"`).join(', ')} } to it (branch-and-release: changing the model).`,
      );
      continue;
    }
    for (const id of Object.keys(binding.ci.providers)) {
      if (!providers.some((p) => p.id === id)) notes.push(`${binding.line}: provider "${id}" is not a layer this project wears — ignored.`);
    }
    bound.set(binding.ci.environment, binding.line);
    for (const provider of providers) {
      const envs = environments.get(provider.id) ?? [];
      envs.push({ name: binding.ci.environment, target: binding.ci.providers[provider.id], branches: [binding.line] });
      environments.set(provider.id, envs);
    }
    lines.push({ branch: binding.line, environment: binding.ci.environment, full: binding.kind === 'pattern' });
  }
  if (lines.length) return { lines, environments };
  return {
    lines,
    environments,
    pending:
      'no protected line in the branch model has a `ci` deploy binding. Add one to each line that should deploy ' +
      '(e.g. "deploys": { "ci": { "environment": "production", "providers": { "firebase": "default" } } }) through the branch-and-release skill, then upgrade.',
  };
}

/** Why a binding must not deploy (it is not a protected line), or undefined when it may. */
function unprotected(binding: BranchProjection['deploys'][number], projection: BranchProjection): string | undefined {
  if (binding.kind === 'tag') return `tags ${binding.line} are not a protected line (anyone with push access creates one), and CI deploys from branches only. Bind the line the tag is on.`;
  if (binding.kind === 'pattern' && projection.productionPatterns.includes(binding.line)) {
    return `${binding.line} are maintained release lines, each its own production — one environment bound to all of them is rolled back to whichever old line was pushed last.`;
  }
  const isProtected = binding.kind === 'line' ? projection.protected.includes(binding.line) : projection.protectedPatterns.includes(binding.line);
  if (!isProtected) return `${binding.line} is not a protected line (a work or hotfix branch: anyone who can push creates one, and nothing reviews it), so it would deploy unreviewed code. Bind the protected line it lands on.`;
  return undefined;
}

/**
 * The `ci-<environment>` configuration on every provider deploy target, for every environment — and the removal of
 * every one this layer wrote that is no longer wanted. A configuration of that name the house did not write is
 * the project's: never overwritten, reported.
 */
function writeConfigurations(
  tree: Tree,
  providers: readonly CiDeployProvider[],
  environments: Map<string, CiEnvironment[]>,
  previous: Record<string, string[]>,
  notes: string[],
): Record<string, string[]> {
  const wanted = new Map<string, { project: string; target: string; configs: Map<string, Record<string, unknown>> }>();
  for (const provider of providers) {
    const envs = environments.get(provider.id) ?? [];
    if (!envs.length) continue;
    for (const { project, target } of provider.deployTargets(tree)) {
      const key = `${project}:${target}`;
      const entry = wanted.get(key) ?? { project, target, configs: new Map() };
      for (const env of envs) entry.configs.set(ciConfiguration(env.name), provider.deployOptions(env.target));
      wanted.set(key, entry);
    }
  }
  const written: Record<string, string[]> = {};
  const keys = new Set([...wanted.keys(), ...Object.keys(previous)]);
  for (const key of keys) {
    const [project, target] = splitKey(key);
    let config;
    try {
      config = readProjectConfiguration(tree, project);
    } catch {
      continue; // the project is gone — so are its configurations
    }
    const t = config.targets?.[target];
    if (!t) continue;
    const mine = new Set(previous[key] ?? []);
    const want = wanted.get(key)?.configs ?? new Map();
    const configurations = { ...(t.configurations ?? {}) };
    const kept: string[] = [];
    for (const name of mine) if (!want.has(name)) delete configurations[name];
    for (const [name, options] of want) {
      if (configurations[name] && !mine.has(name)) {
        notes.push(`${key} already has a "${name}" configuration the house did not write — left as it is; the deploy in that environment runs it.`);
        continue;
      }
      configurations[name] = options;
      kept.push(name);
    }
    const next = { ...config, targets: { ...config.targets, [target]: { ...t, configurations } } };
    if (!Object.keys(configurations).length) delete next.targets[target].configurations;
    updateProjectConfigurationInPlace(tree, project, next);
    if (kept.length) written[key] = kept.sort();
  }
  return written;
}

const splitKey = (key: string): [string, string] => {
  const at = key.lastIndexOf(':');
  return [key.slice(0, at), key.slice(at + 1)];
};

/** Workflows the house did not write that already deploy on push — the project's own pipeline. */
function foreignDeployWorkflows(tree: Tree, ownedFiles: readonly string[]): string[] {
  const dir = '.github/workflows';
  if (!tree.exists(dir)) return [];
  const DEPLOYS = [/\bfirebase\s+deploy\b/, /-t\s+deploy\b/, /--targets?[= ]deploy\b/, /\bnx\s+run\s+\S+:deploy\b/];
  return tree
    .children(dir)
    .filter((name) => /\.ya?ml$/.test(name))
    .map((name) => `${dir}/${name}`)
    .filter((path) => !ownedFiles.includes(path))
    .filter((path) =>
      (tree.read(path, 'utf8') ?? '')
        .split('\n')
        .map((line) => line.replace(/(^|\s)#.*$/, ''))
        .some((line) => DEPLOYS.some((re) => re.test(line))),
    );
}

function readMarker(tree: Tree): Marker {
  try {
    const raw = JSON.parse(tree.read(MARKER, 'utf8') ?? '{}') as Partial<Marker>;
    return {
      files: Array.isArray(raw.files) ? raw.files.filter((f) => typeof f === 'string') : [],
      cloud: raw.cloud ?? {},
      configurations: raw.configurations ?? {},
    };
  } catch {
    return { files: [], cloud: {}, configurations: {} };
  }
}
