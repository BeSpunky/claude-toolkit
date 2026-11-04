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
import { type CiDeployProvider, type CiDeployStage, type CiEnvironment } from '../../layers/descriptor';
import { LAYERS, detectLayers, layer } from '../../layers/registry';
import { branchModelFromOption, readBranchModel, type BranchModel, type BranchProjection } from '../_utils/branch-model';
import { nxInvocation } from '../_utils/nx-host';
import { pluginPointerValues } from '../_utils/plugin-pointers';
import { CI_SKILL_POINTERS } from './skill-pointers';
import { nodeVersionFile, projectNode } from '../_utils/node-version';
import { isYarnBerry } from '../_utils/package-manager';
import { updateProjectConfigurationInPlace } from '../_utils/project-files';
import { workflowDeploys } from './foreign-pipeline';
import { MARKER, ciConfiguration, renderWorkflow, WORKFLOW, WORKFLOW_HEADER, type WiredLine } from './workflow';

export { MARKER };

export interface CiSchema {
  /** The layers this run applies (the providers are theirs). Defaults to detecting them. */
  layers?: string[];
  /** The branch model the caller resolved (projection JSON, or `undeclared`); absent → the Tree's copy. */
  branchProjection?: string;
}

interface CloudEntry {
  target?: string;
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
  "`cloud` is what each provider's human-run setup was last rendered for (a change prints a HUMAN_STEP); `configurations` are the " +
  'ci-<environment> configurations it wrote on provider deploy targets. Never hand-edit.';

/** What a binding's `providers` would hold for these providers — how every message asks for one. */
const providersExample = (providers: readonly CiDeployProvider[]): string => {
  const targeted = providers.filter((p) => p.targetLabel !== undefined);
  return targeted.length ? `"providers": { ${targeted.map((p) => `"${p.id}": "<${p.targetLabel}>"`).join(', ')} }` : '"providers": {}';
};

/**
 * The providers these layers wear, and those of them that deploy: all but the ones another's `supersedes` names. Only a
 * layer that requires another may replace its provider, since that is what guarantees the two are worn together.
 */
function resolveProviders(layers: readonly string[]): { worn: CiDeployProvider[]; active: CiDeployProvider[] } {
  const wearing = layers.map((id) => layer(id)).filter((entry) => entry.ciDeploy);
  const superseded = new Set<string>();
  for (const entry of wearing) {
    const id = entry.ciDeploy?.supersedes;
    if (!id) continue;
    if (!entry.requires.some((required) => layer(required).ciDeploy?.id === id)) {
      throw new Error(`[ci] The ${entry.id} layer's provider supersedes "${id}", which no layer it requires provides.`);
    }
    superseded.add(id);
  }
  const worn = wearing.flatMap((entry) => (entry.ciDeploy ? [entry.ciDeploy] : []));
  return { worn, active: worn.filter((provider) => !superseded.has(provider.id)) };
}

export default async function ciGenerator(tree: Tree, options: CiSchema = {}): Promise<void> {
  const layers = options.layers?.length ? options.layers : detectLayers(tree);
  const { worn, active: providers } = resolveProviders(layers);
  const previous = readMarker(tree);
  const model: BranchModel =
    options.branchProjection !== undefined ? branchModelFromOption(options.branchProjection) : readBranchModel(tree);

  const notes: string[] = [];
  const { throughBranchModelSkill } = pluginPointerValues(tree, CI_SKILL_POINTERS);
  const { lines, environments, pending } = resolve(model, providers, worn, notes, throughBranchModelSkill);

  // ── environments no binding names any more, whose cloud setup is still recorded: kept until rolled back ──────
  // A superseded provider is worn and deploys nowhere, so what it set up in the cloud is rolled back the same way.
  const retired = new Map<string, CiEnvironment[]>();
  for (const provider of worn) {
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
  const ownedFiles = currentlyOwned(tree, previous.files);
  const foreign = foreignDeployWorkflows(tree, ownedFiles);
  const deployable = lines.filter((line) => !line.blocked);
  const blocked = lines.filter((line) => line.blocked);
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
        providerProjects: new Map(providers.map((p) => [p.id, p.deployTargets(tree).map((t) => t.project)])),
        nx: nx.command,
        packageManager: nx.packageManager,
        yarnBerry: isYarnBerry(tree),
        nodeVersionFile: nodeVersionFile(tree),
        throughBranchModelSkill,
      }),
    });
    if (ownedFiles.includes(WORKFLOW) && /^\s*id-token:\s*write/m.test(tree.read(WORKFLOW, 'utf8') ?? '') && !/^\s*id-token:\s*write/m.test(wanted.get(WORKFLOW)!.content)) {
      notes.push(`${WORKFLOW} no longer holds \`id-token: write\`: no provider this project wears exchanges GitHub's OIDC token. A deploy target of your own that fetches that token itself (npm provenance, cosign) now fails; if you have one, run the deploy from a workflow of your own, and the house steps aside.`);
    }
    if (projectNode(tree).state !== 'declared') notes.push(`the workflow reads Node from ${nodeVersionFile(tree)}, which declares none here — add .nvmrc (one line: the Node major) or the deploy job fails at setup-node.`);
  }
  // The providers' human-run setup is useful whoever runs the pipeline, so it follows the bindings (and the
  // retired environments still to roll back), not the workflow.
  for (const provider of worn) {
    const envs = [...(environments.get(provider.id) ?? []), ...(retired.get(provider.id) ?? [])];
    if (envs.length && provider.files) for (const file of provider.files(tree, envs)) wanted.set(file.path, file);
  }

  // ── write what is owned; never what is not ───────────────────────────────────────────────────────────────
  const owned = new Set(ownedFiles);
  const files: string[] = [];
  for (const [path, file] of wanted) {
    if (tree.exists(path) && !owned.has(path)) {
      notes.push(`${path} exists and the house did not write it — left untouched. Move it aside and upgrade to let the house own it.`);
      continue;
    }
    tree.write(path, file.content, file.mode ? { mode: file.mode } : undefined);
    files.push(path);
  }
  for (const path of ownedFiles) {
    if (!wanted.has(path) && tree.exists(path)) {
      tree.delete(path);
      notes.push(`removed ${path} — nothing in the branch model calls for it any more.`);
    }
  }

  // ── provider options reach provider targets only: a ci-<environment> configuration on each ────────────────
  const configurations = writeConfigurations(tree, providers, environments, previous.configurations, notes);

  // ── the cloud side cannot be regenerated: say what a human must run ──────────────────────────────────────
  const human: string[] = [];
  // A line failing every push is only loud once the upgrade says so too. With no house workflow here (the project's
  // own pipeline, or a file at its path) nothing has stopped, so it is an ordinary note.
  for (const line of blocked) (files.includes(WORKFLOW) ? human : notes).push(line.blocked!);
  const cloud: Marker['cloud'] = {};
  for (const provider of worn) {
    for (const env of environments.get(provider.id) ?? []) {
      (cloud[provider.id] ??= {})[env.name] = { ...(env.target === undefined ? {} : { target: env.target }), branches: env.branches };
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
  else logger.info(`[ci] ${WORKFLOW}: deploys ${deployable.map((l) => `${l.branch} → ${l.environment}`).join(', ') || 'nothing yet'}.`);
  for (const note of notes) logger.warn(`[ci] ${note}`);
  for (const step of human) logger.info(`HUMAN_STEP: ${step}`);

  await formatFiles(tree);
}

/**
 * The bindings this pipeline wires: protected branch lines and patterns with a `ci` binding, one line per environment.
 * Everything it must not wire is a NOTE saying why — never a silent gap.
 *
 * A binding that names no target for an active provider is the case a project walks into by adding a layer, on a line
 * that deploys today. It stays WIRED and BLOCKED: in the triggers, with resolve failing every push and saying what is
 * missing, so it cannot quietly stop. Why none of the alternatives:
 *   - dropping the line (or, if it was the last, the whole workflow) is a green repo that deploys nothing;
 *   - deploying what IS bound runs the new provider's target with no configuration, or skips it and ships code whose
 *     schema never landed;
 *   - throwing would fail the rest of the upgrade over a fact only a human can supply (the target), part-way through a
 *     plan of separate generator runs.
 * The environment stays held and its other providers keep their configurations and setup: nothing about them changed,
 * and treating it as retired would ask a human to roll back the identity of a line about to deploy again.
 *
 * Only a provider with a `targetLabel` can be missing. One without deploys on this line whether it is named or not.
 */
function resolve(
  model: BranchModel,
  providers: readonly CiDeployProvider[],
  worn: readonly CiDeployProvider[],
  notes: string[],
  throughBranchModelSkill: string,
): { lines: WiredLine[]; environments: Map<string, CiEnvironment[]>; pending?: string } {
  const environments = new Map<string, CiEnvironment[]>();
  if (!model.declared) {
    return {
      lines: [],
      environments,
      pending:
        'the branch model is not declared (.bespunky/branches.json), and the house never guesses which branch is production. ' +
        `Declare it${throughBranchModelSkill}, give each line that should deploy a \`ci\` binding, then upgrade.`,
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
    for (const id of Object.keys(binding.ci.providers)) {
      const active = providers.find((p) => p.id === id);
      if (active && active.targetLabel === undefined && !active.deployOptions) notes.push(`${binding.line}: provider "${id}" takes no target — the value is ignored, and it deploys here all the same.`);
      if (active) continue;
      const replacedBy = worn.some((p) => p.id === id) ? providers.find((p) => p.supersedes === id) : undefined;
      notes.push(replacedBy ? `${binding.line}: provider "${id}" is superseded by "${replacedBy.id}" here — ignored. Name "${replacedBy.id}" instead.` : `${binding.line}: provider "${id}" is not a layer this project wears — ignored.`);
    }
    bound.set(binding.ci.environment, binding.line);
    const missing = providers.filter((p) => p.targetLabel !== undefined && !(p.id in binding.ci!.providers));
    for (const provider of providers.filter((p) => !missing.includes(p))) {
      const envs = environments.get(provider.id) ?? [];
      const target = binding.ci.providers[provider.id];
      envs.push({ name: binding.ci.environment, ...(target === undefined ? {} : { target }), branches: [binding.line] });
      environments.set(provider.id, envs);
    }
    lines.push({
      branch: binding.line,
      environment: binding.ci.environment,
      full: binding.kind === 'pattern',
      ...(missing.length
        ? {
            blocked:
              `${binding.line} deploys nothing until its \`ci\` binding names a target for ${missing.map((p) => p.id).join(', ')}: every push to it fails. ` +
              `In .bespunky/branches.json, add to that line's \`deploys.ci.providers\`, beside what it already names: ${missing.map((p) => `"${p.id}": "<${p.targetLabel}>"`).join(', ')}${throughBranchModelSkill}, then upgrade. ` +
              `If this line should not deploy from CI at all, replace its \`ci\` with a \`note\`.`,
          }
        : {}),
    });
  }
  if (lines.length) return { lines, environments };
  return {
    lines,
    environments,
    pending:
      'no protected line in the branch model has a `ci` deploy binding. Add one to each line that should deploy ' +
      `(e.g. "deploys": { "ci": { "environment": "production", ${providersExample(providers)} } })${throughBranchModelSkill}, then upgrade.`,
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

/** What a provider's deploy targets take in an environment. A targeted provider is in an environment only with its target. */
function optionsFor(provider: CiDeployProvider, env: CiEnvironment): Record<string, unknown> {
  if (provider.targetLabel === undefined) return provider.deployOptions?.(env.target) ?? {};
  if (env.target === undefined) throw new Error(`[ci] ${provider.id} reached "${env.name}" with no target.`);
  return provider.deployOptions(env.target);
}

/**
 * Two providers' options on ONE deploy target, in one configuration, because Nx applies only one: each provider's `args`
 * reach the deploy, in provider order. Any other option has one value, so two providers disagreeing on it is refused:
 * dropping either would deploy with the wrong one and say nothing. Toolkit code decides this, never a project.
 */
function composeOptions(current: Record<string, unknown>, next: Record<string, unknown>, where: string): Record<string, unknown> {
  const composed = { ...current };
  for (const [key, value] of Object.entries(next)) {
    if (!(key in composed) || composed[key] === value) composed[key] = value;
    else if (key === 'args' && typeof composed[key] === 'string' && typeof value === 'string') composed[key] = `${composed[key]} ${value}`;
    else throw new Error(`[ci] Two providers set the option "${key}" on ${where} differently; one configuration holds one value.`);
  }
  return composed;
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
  const stages = new Map<string, { stage: CiDeployStage; id: string }>();
  for (const provider of providers) {
    const envs = environments.get(provider.id) ?? [];
    if (!envs.length) continue;
    const stage = provider.deployStage ?? 'code';
    for (const { project, target } of provider.deployTargets(tree)) {
      const key = `${project}:${target}`;
      // A project deploys once, in one step, holding that stage's credentials: the other provider's would be missing.
      const sharing = stages.get(key);
      if (sharing && sharing.stage !== stage) throw new Error(`[ci] ${sharing.id} (${sharing.stage}) and ${provider.id} (${stage}) share ${key}, and a deploy target runs in one stage.`);
      stages.set(key, { stage, id: provider.id });
      const entry = wanted.get(key) ?? { project, target, configs: new Map() };
      for (const env of envs) {
        const name = ciConfiguration(env.name);
        const options = optionsFor(provider, env);
        if (Object.keys(options).length) entry.configs.set(name, composeOptions(entry.configs.get(name) ?? {}, options, key));
      }
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

/**
 * What the house owns now: the marker's record, but the workflow only while it is what the generator wrote. Its header
 * answers both ways: a project that replaced the file keeps it though the marker still lists it, and a generated file
 * whose marker was lost is still recognised, instead of being taken for a pipeline of the project's own because it deploys.
 */
function currentlyOwned(tree: Tree, recorded: readonly string[]): string[] {
  const generated = tree.exists(WORKFLOW) && (tree.read(WORKFLOW, 'utf8') ?? '').startsWith(`${WORKFLOW_HEADER}\n`);
  const others = recorded.filter((path) => path !== WORKFLOW);
  return generated ? [...others, WORKFLOW] : others;
}

/** Workflows the house did not write that already deploy — the project's own pipeline. */
function foreignDeployWorkflows(tree: Tree, ownedFiles: readonly string[]): string[] {
  const dir = '.github/workflows';
  if (!tree.exists(dir)) return [];
  // Nx takes a target list after -t or --target(s), by `=` or a space, split by commas or spaces and maybe quoted.
  const DEPLOYS = [/(?:^|\s)(?:-t|--targets?)[=\s]+["']?(?:[\w:][\w:-]*[,\s]+)*deploy\b/, /\bnx\s+run\s+\S+:deploy\b/, /\bnx\s+deploy\b/, ...LAYERS.flatMap((l) => l.ciDeploy?.deploySignals ?? [])];
  return tree
    .children(dir)
    .filter((name) => /\.ya?ml$/.test(name))
    .map((name) => `${dir}/${name}`)
    .filter((path) => !ownedFiles.includes(path))
    .filter((path) => workflowDeploys(tree.read(path, 'utf8') ?? '', DEPLOYS));
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
