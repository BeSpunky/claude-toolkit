// The project's DECLARED BRANCH MODEL, as the generators may see it.
//
// The model lives in `.bespunky/branches.json` and is written by ONE thing only: the branch-and-release skill's
// engine (`branches.mjs write`), after a human decision. That engine is the only code that INTERPRETS the model —
// how a line advances, what a release or hotfix line means, which fix flow applies. Everything else reads the
// flat, derived `projection` block the engine writes beside it (the same arrangement as `layers.sh` beside the
// layer registry): names and globs, nothing to interpret. This module is that reader for the payload, so it
// reads `projection` and nothing else — a generator that parsed `stages` or `releases` would be a second
// interpreter, pinned per project while the engine auto-updates, and the two would drift.
//
// TWO STATES, and the second is not an error:
//   - DECLARED — the file exists and carries a projection whose schema major this payload knows.
//   - UNDECLARED — no file. Nothing is assumed (no "it's probably development → staging → main"): the house
//     docs render the protective rule instead — every existing long-lived branch protected, investigate and ask.
//     Nothing here writes the file to leave that state; declaring a model is a human decision.
//
// A file that exists but cannot be read as a projection we understand — malformed JSON, no projection, an
// unknown `projection.schema` major — is REFUSED with an error that says what to do. Guessing would render
// rules for a model the project did not declare, into a document that is always in context.
//
// WHO RESOLVES. Which copy of the file is in force (the integration tip's, local or remote, vs the working tree's)
// is a git question, and an Nx `Tree` has no git — so this module does NOT resolve. A sync resolves once
// (house-branches.sh, the same rule as the engine) and hands the result in: `branchModelFromOption` reads that
// (the projection JSON, or `undeclared`). Only a STANDALONE generator call, with nothing handed in, falls back to
// `readBranchModel` — the working tree's copy, which is the right answer only when nobody resolved anything.
import type { Tree } from '@nx/devkit';

/** Where the declaration lives, relative to the workspace root. */
export const BRANCH_MODEL_FILE = '.bespunky/branches.json';

/** The projection schema MAJOR this payload can read. Anything else is refused, never guessed at. */
export const PROJECTION_SCHEMA = 1;

/** The literal a caller passes (`branchProjection`) for a model it resolved as UNDECLARED. */
export const UNDECLARED = 'undeclared';

/**
 * The names protected while the model is UNDECLARED, wherever a branch by that name exists: every name the
 * toolkit ever forced, plus gitflow's. Protect, never promote.
 */
export const UNDECLARED_PROTECTED = ['main', 'master', 'development', 'develop', 'staging'] as const;

/** The derived, flat projection (schema 1) — the only part of the model a reader may parse. */
export interface BranchProjection {
  schema: 1;
  /** The one integration line — where finished work lands. */
  integration: string;
  /** The production lines by name (the last stage, or integration when there are none). */
  production: string[];
  /** Production line patterns, as shell globs (maintained release lines). */
  productionPatterns: string[];
  /** Integration followed by the stages, in order. */
  chain: string[];
  /** Integration + every stage — never committed onto directly. */
  protected: string[];
  /** Protected line patterns, as shell globs. */
  protectedPatterns: string[];
  /** The line new work branches (and worktrees) start from. */
  workBase: string;
  /** One human line describing the model, used verbatim. */
  summary: string;
  /**
   * The STRUCTURED deploy bindings — what a push to a line (a branch name), a line pattern (a branch glob) or a tag
   * series (a tag glob) deploys. Optional in the file (the engine writes the key only when something is bound, so
   * every projection written before bindings existed still reads); always an array here.
   */
  deploys: DeployBinding[];
}

/** One structured deploy binding, as the engine projects it (`branches.mjs`, model.mjs `deployBindings`). */
export interface DeployBinding {
  /** `line` — a named branch; `pattern` — a branch glob (release / hotfix lines); `tag` — a tag glob. */
  kind: 'line' | 'pattern' | 'tag';
  /** The branch name, or the glob. */
  line: string;
  /** The project's own CI deploys a push here into `environment`, with each provider's target there. */
  ci?: { environment: string; providers: Record<string, string> };
  /** Firebase App Hosting backends that roll out on a push here (Firebase's own integration, not CI). */
  appHosting?: { project: string; backend: string }[];
}

export type BranchModel =
  | { declared: true; projection: BranchProjection }
  | { declared: false };

/**
 * The branch model as RESOLVED by the caller (the generator's `branchProjection` option): the projection JSON, or
 * `undeclared`. Throws on a value this payload cannot read honestly — the caller resolved it, so a bad value is a
 * caller bug or a newer schema, never a reason to fall back to the Tree.
 */
export function branchModelFromOption(value: string): BranchModel {
  if (value === UNDECLARED) return { declared: false };
  const source = 'the resolved branch model (branchProjection)';
  let projection: unknown;
  try {
    projection = JSON.parse(value);
  } catch (error) {
    throw refusal(source, `it is not valid JSON (${(error as Error).message})`);
  }
  if (!isRecord(projection)) throw refusal(source, `it is neither a projection object nor "${UNDECLARED}"`);
  return parseProjection(projection, source);
}

/** Read the project's branch model from the tree (standalone use only — see above). Throws on a file this payload cannot read honestly. */
export function readBranchModel(tree: Tree): BranchModel {
  if (!tree.exists(BRANCH_MODEL_FILE)) return { declared: false };
  const source = BRANCH_MODEL_FILE;

  let file: unknown;
  try {
    file = JSON.parse(tree.read(BRANCH_MODEL_FILE, 'utf8') ?? '');
  } catch (error) {
    throw refusal(source, `it is not valid JSON (${(error as Error).message})`);
  }
  const projection = isRecord(file) ? file['projection'] : undefined;
  if (!isRecord(projection)) throw refusal(source, 'it has no `projection` block — re-write it with the skill (`branches.mjs write`)');
  return parseProjection(projection, source);
}

/** Validate a projection block. The schema check is on the MAJOR (`1`, `1.1` … are readable; `2` is not). */
function parseProjection(projection: Record<string, unknown>, source: string): BranchModel {
  const refuse = (why: string) => refusal(source, why);
  if (String(projection['schema']).split('.')[0] !== String(PROJECTION_SCHEMA)) {
    throw refuse(
      `its \`projection.schema\` is ${JSON.stringify(projection['schema'])}, and this @bespunky/nx-tools reads only schema major ${PROJECTION_SCHEMA}. ` +
        'A newer toolkit wrote it: update @bespunky/nx-tools (a sync with the current toolkit) rather than guessing at the model',
    );
  }

  const strings = (field: keyof BranchProjection): string[] => {
    const value = projection[field];
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item === '')) {
      throw refuse(`\`projection.${field}\` must be an array of branch names or globs`);
    }
    return value as string[];
  };
  const string = (field: keyof BranchProjection): string => {
    const value = projection[field];
    if (typeof value !== 'string' || value === '') throw refuse(`\`projection.${field}\` must be a non-empty string`);
    return value;
  };

  return {
    declared: true,
    projection: {
      schema: PROJECTION_SCHEMA,
      integration: string('integration'),
      production: strings('production'),
      productionPatterns: strings('productionPatterns'),
      chain: strings('chain'),
      protected: strings('protected'),
      protectedPatterns: strings('protectedPatterns'),
      workBase: string('workBase'),
      summary: string('summary'),
      deploys: deployBindings(projection['deploys'], refuse),
    },
  };
}

const KINDS: readonly DeployBinding['kind'][] = ['line', 'pattern', 'tag'];
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const GLOB = /^[A-Za-z0-9._\-/*]+$/;

/** `projection.deploys`, validated — absent reads as none; anything malformed is refused like the rest. */
function deployBindings(value: unknown, refuse: (why: string) => Error): DeployBinding[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw refuse('`projection.deploys` must be an array of deploy bindings');
  return value.map((entry, index) => {
    const at = `\`projection.deploys[${index}]\``;
    if (!isRecord(entry)) throw refuse(`${at} must be an object`);
    const kind = entry['kind'];
    const line = entry['line'];
    if (!KINDS.includes(kind as DeployBinding['kind'])) throw refuse(`${at}.kind must be one of ${KINDS.join(', ')}`);
    if (typeof line !== 'string' || !GLOB.test(line)) throw refuse(`${at}.line must be a branch name or glob`);
    const binding: DeployBinding = { kind: kind as DeployBinding['kind'], line };
    const ci = entry['ci'];
    if (ci !== undefined) {
      const environment = isRecord(ci) ? ci['environment'] : undefined;
      const providers = isRecord(ci) ? (ci['providers'] ?? {}) : undefined;
      if (typeof environment !== 'string' || !TOKEN.test(environment)) throw refuse(`${at}.ci.environment must name an environment`);
      if (!isRecord(providers) || Object.values(providers).some((target) => typeof target !== 'string' || !TOKEN.test(target))) {
        throw refuse(`${at}.ci.providers must map provider ids to targets`);
      }
      binding.ci = { environment, providers: providers as Record<string, string> };
    }
    const appHosting = entry['appHosting'];
    if (appHosting !== undefined) {
      if (!Array.isArray(appHosting) || appHosting.some((b) => !isRecord(b) || typeof b['project'] !== 'string' || typeof b['backend'] !== 'string')) {
        throw refuse(`${at}.appHosting must be a list of { project, backend }`);
      }
      binding.appHosting = appHosting.map((b) => ({ project: String(b['project']), backend: String(b['backend']) }));
    }
    return binding;
  });
}

function refusal(source: string, why: string): Error {
  return new Error(`Cannot read the branch model in ${source}: ${why}.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
