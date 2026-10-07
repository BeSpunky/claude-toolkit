// House generator: the `ci` layer — continuous DEPLOYMENT driven by the branch model.
//
// The contract is two facts the project already owns, and nothing else:
//   - WHEN and WHERE: the branch model's `ci` deploy bindings (`.bespunky/branches.json` → projection.deploys) —
//     which lines deploy, into which environment, with which target per deploy provider;
//   - WHAT: every project's `deploy` target. `nx affected -t deploy` ships what changed; nothing here knows a stack.
// What differs per cloud is a PROVIDER the active layers contribute (`LayerDescriptor.ciDeploy` — Firebase today):
// its auth steps, the args its deploy targets take, and the cloud setup only a HUMAN may run (IAM).
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
import { type Tree, formatFiles, logger } from '@nx/devkit';
import { type CiDeployProvider, type CiEnvironment } from '../../layers/descriptor';
import { detectLayers, layer } from '../../layers/registry';
import { branchModelFromOption, readBranchModel, type BranchModel } from '../_utils/branch-model';
import { nxInvocation } from '../_utils/nx-host';
import { MARKER, renderWorkflow, WORKFLOW, type WiredLine } from './workflow';

export { MARKER };

export interface CiSchema {
  /** The layers this run applies (the providers are theirs). Defaults to detecting them. */
  layers?: string[];
  /** The branch model the caller resolved (projection JSON, or `undeclared`); absent → the Tree's copy. */
  branchProjection?: string;
}

interface Marker {
  about?: string;
  /** Every file the house wrote and still owns. */
  files: string[];
  /** What each provider's human-run setup was last rendered for: provider → environment → target + branches. */
  cloud: Record<string, Record<string, { target: string; branches: string[] }>>;
  /** Why there is no workflow (undeclared model, no binding, a pipeline of the project's own). */
  pending?: string;
}

const ABOUT =
  'Written by @bespunky/nx-tools (the ci layer). `files` are the files the house owns and rewrites on every upgrade; ' +
  '`cloud` is what tools/setup-gcp.sh was last rendered for (a change prints a HUMAN_STEP). Never hand-edit.';

export default async function ciGenerator(tree: Tree, options: CiSchema = {}): Promise<void> {
  const layers = options.layers?.length ? options.layers : detectLayers(tree);
  const providers = layers.map((id) => layer(id).ciDeploy).filter((p): p is CiDeployProvider => Boolean(p));
  const previous = readMarker(tree);
  const model: BranchModel =
    options.branchProjection !== undefined ? branchModelFromOption(options.branchProjection) : readBranchModel(tree);

  const notes: string[] = [];
  const { lines, environments, pending } = resolve(model, providers, notes);

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
  // The providers' human-run setup is useful whoever runs the pipeline, so it follows the bindings, not the workflow.
  for (const provider of providers) {
    const envs = environments.get(provider.id) ?? [];
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

  // ── the cloud side cannot be regenerated: say what a human must re-run ───────────────────────────────────
  const human: string[] = [];
  const cloud: Marker['cloud'] = {};
  for (const provider of providers) {
    for (const env of environments.get(provider.id) ?? []) {
      (cloud[provider.id] ??= {})[env.name] = { target: env.target, branches: env.branches };
      const before = previous.cloud[provider.id]?.[env.name];
      const changed = !before || before.target !== env.target || before.branches.join(',') !== env.branches.join(',');
      if (changed && provider.humanStep && files.length) human.push(provider.humanStep(env));
    }
  }

  const marker: Marker = { about: ABOUT, files, cloud, ...(reason ? { pending: reason } : {}) };
  tree.write(MARKER, `${JSON.stringify(marker, null, 2)}\n`);

  if (reason) logger.warn(`[ci] No deploy workflow: ${reason}`);
  else logger.info(`[ci] ${WORKFLOW}: deploys ${lines.map((l) => `${l.branch} → ${l.environment}`).join(', ')}.`);
  for (const note of notes) logger.warn(`[ci] ${note}`);
  for (const step of human) logger.info(`HUMAN_STEP: ${step}`);

  await formatFiles(tree);
}

/**
 * The bindings this pipeline wires: branch lines and patterns with a `ci` binding naming every active provider.
 * Everything it cannot wire is a NOTE saying why — never a silent gap.
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
  // Every args-contributing provider's args reach EVERY deploy target (`nx affected -t deploy -- <args>`). One such
  // provider is sound; two would hand each one's flags to the other's targets — refuse, loudly, rather than ship that.
  if (providers.length > 1) {
    throw new Error(
      `[ci] Several deploy providers are active (${providers.map((p) => p.id).join(', ')}), and their deploy args would reach each other's targets. ` +
        'The ci layer needs a per-provider run before it can compose them.',
    );
  }
  const lines: WiredLine[] = [];
  for (const binding of model.projection.deploys) {
    if (!binding.ci) continue;
    if (binding.kind === 'tag') {
      notes.push(`the \`ci\` binding on tags ${binding.line} is not wired — the house deploy workflow deploys from branches only.`);
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
    let clash = false;
    for (const provider of providers) {
      const target = binding.ci.providers[provider.id];
      const envs = environments.get(provider.id) ?? [];
      const existing = envs.find((env) => env.name === binding.ci!.environment);
      if (existing && existing.target !== target) {
        notes.push(`${binding.line}: environment "${existing.name}" is bound to ${provider.id} "${existing.target}" elsewhere and "${target}" here — not wired. One environment, one target.`);
        clash = true;
      } else if (existing) existing.branches.push(binding.line);
      else envs.push({ name: binding.ci.environment, target, branches: [binding.line] });
      environments.set(provider.id, envs);
    }
    if (clash) continue;
    lines.push({
      branch: binding.line,
      environment: binding.ci.environment,
      args: providers.flatMap((p) => p.deployArgs(binding.ci!.providers[p.id])),
    });
  }
  if (lines.length) return { lines, environments };
  return {
    lines,
    environments,
    pending:
      'no line in the branch model has a `ci` deploy binding. Add one to each line that should deploy ' +
      '(e.g. "deploys": { "ci": { "environment": "production", "providers": { "firebase": "default" } } }) through the branch-and-release skill, then upgrade.',
  };
}

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
    return { files: Array.isArray(raw.files) ? raw.files.filter((f) => typeof f === 'string') : [], cloud: raw.cloud ?? {} };
  } catch {
    return { files: [], cloud: {} };
  }
}
