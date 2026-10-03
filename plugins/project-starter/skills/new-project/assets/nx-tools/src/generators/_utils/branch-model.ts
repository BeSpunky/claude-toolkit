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
// Reads the working tree (an Nx `Tree` has no git). The contract's authoritative copy is the integration tip;
// the working-tree copy is its stated fallback, and a sync runs on the tree it is about to commit.
import type { Tree } from '@nx/devkit';

/** Where the declaration lives, relative to the workspace root. */
export const BRANCH_MODEL_FILE = '.bespunky/branches.json';

/** The projection schema MAJOR this payload can read. Anything else is refused, never guessed at. */
export const PROJECTION_SCHEMA = 1;

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
}

export type BranchModel =
  | { declared: true; projection: BranchProjection }
  | { declared: false };

/** Read the project's branch model from the tree. Throws on a file this payload cannot read honestly. */
export function readBranchModel(tree: Tree): BranchModel {
  if (!tree.exists(BRANCH_MODEL_FILE)) return { declared: false };

  let file: unknown;
  try {
    file = JSON.parse(tree.read(BRANCH_MODEL_FILE, 'utf8') ?? '');
  } catch (error) {
    throw refusal(`it is not valid JSON (${(error as Error).message})`);
  }
  const projection = isRecord(file) ? file['projection'] : undefined;
  if (!isRecord(projection)) throw refusal('it has no `projection` block — re-write it with the skill (`branches.mjs write`)');

  if (projection['schema'] !== PROJECTION_SCHEMA) {
    throw refusal(
      `its \`projection.schema\` is ${JSON.stringify(projection['schema'])}, and this @bespunky/nx-tools reads only schema ${PROJECTION_SCHEMA}. ` +
        'A newer toolkit wrote it: update @bespunky/nx-tools (a sync with the current toolkit) rather than guessing at the model',
    );
  }

  const strings = (field: keyof BranchProjection): string[] => {
    const value = projection[field];
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item === '')) {
      throw refusal(`\`projection.${field}\` must be an array of branch names or globs`);
    }
    return value as string[];
  };
  const string = (field: keyof BranchProjection): string => {
    const value = projection[field];
    if (typeof value !== 'string' || value === '') throw refusal(`\`projection.${field}\` must be a non-empty string`);
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
    },
  };
}

function refusal(why: string): Error {
  return new Error(`Cannot read the branch model in ${BRANCH_MODEL_FILE}: ${why}.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
