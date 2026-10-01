// THE LAYER DESCRIPTOR — what a layer IS, as data the whole toolkit reads.
//
// A project is a stack of layers (`nx`, `agent`, `web`, `angular`, …). Each one used to be described in eight
// places at once: a closed `LayerId` union here, and in scaffold.sh a `KNOWN_LAYERS` list, two `*_ENSURABLE`
// lists, two hint `case`s, the `--help` text, hard-coded `if layer_active X; then nx g …` blocks, and the
// SessionStart hook's drift greps. Adding a stack was an edit in all of them, and they drifted.
//
// Now a layer is ONE file (`layers/<id>.ts`) exporting one `LayerDescriptor`, registered by one line in
// `registry.ts`. Everything else is DERIVED from the registered set:
//   - generators guard on it (`requireLayer`) and house-doc renders from it (`detectLayers`);
//   - scaffold.sh's outer shell (validation, --help, ensure hints) and the SessionStart hook read
//     `assets/layers.sh`, a GENERATED shell projection of these descriptors (`cli.ts shell`), because both run
//     before — or entirely without — any node_modules;
//   - scaffold.sh's rendered sequence asks the installed CLI (`cli.ts plan`) which generators to run, with
//     which arguments, instead of hard-coding them.
//
// This file has NO runtime imports, deliberately: a descriptor is a statement about a layer, and the
// machinery that evaluates it (evidence.ts, plan.ts) lives beside it rather than inside it.
//
// See docs/features/2026-10-01-stack-agnostic/contracts/layers.md for the contract later phases build on.
import type { Tree } from '@nx/devkit';

/**
 * A layer id. OPEN, not a closed union: a layer exists because it is registered, and a registry lookup of an
 * unknown id throws (`layer()`), which is where a typo is caught.
 */
export type LayerId = string;

/**
 * Cheap, DECLARATIVE evidence that a layer is present — the half of detection that can be evaluated without
 * Node, because the SessionStart hook must stay a few greps (it runs at the start of every session in every
 * project, often with no node_modules at all). Each kind has one meaning, evaluated exactly on a Tree by
 * `evidence.ts` and approximately (by grep, erring towards silence) in the shell projection:
 *
 *   files       — any of these paths exists at the workspace root
 *   dependencies— any of these packages is declared in the root package.json (either block)
 *   targets     — any project declares a target by one of these names
 *   tags        — any project carries one of these tags
 *   projects    — a project by one of these names exists
 *   executors   — any target runs an executor starting with one of these prefixes (`@nx/js:`)
 *
 * A layer is present when ANY evidence matches, or when its `detect` refinement says so.
 */
export interface LayerEvidence {
  files?: readonly string[];
  dependencies?: readonly string[];
  targets?: readonly string[];
  tags?: readonly string[];
  projects?: readonly string[];
  executors?: readonly string[];
}

/**
 * Can this run BRING the layer into being?
 *   true            — yes, this mode has a step that creates it.
 *   false           — no; the layer can only be detected (add it natively, then sync).
 *   { via: <id> }   — only together with that layer, whose creation produces this one (a scaffold's `web`
 *                     exists because the Angular app it creates has a dev-server).
 */
export type Ensurability = boolean | { via: LayerId };

/** Everything a plan step may read: the workspace, the resolved layer sets, and the run's own parameters. */
export interface PlanContext {
  tree: Tree;
  mode: 'scaffold' | 'sync';
  /** Detected ∪ ensured. */
  active: ReadonlySet<LayerId>;
  /** Only what this run was explicitly asked to create — the baseline acts (provider wiring) key off it. */
  ensured: ReadonlySet<LayerId>;
  /** The project (workspace) name. */
  project: string;
  /** The app the per-app generators target. */
  app: string;
  /** Node major the devcontainer image is pinned to. */
  nodeMajor: string;
  /** --voice on this run (the devcontainer also carries a previous answer forward from its marker). */
  voice: boolean;
  /** --staging on this run. */
  staging: boolean;
}

/**
 * One house generator run. `args` returns argv words — each ONE shell word, never containing whitespace or
 * shell metacharacters (the plan refuses one that does), because the rendered sequence word-splits them.
 *
 * `skip` is the per-step precondition: return a sentence to SKIP the step and say why; with `partial: true`
 * the sync is reported as SYNC_PARTIAL (a step that should have run did not).
 */
export interface GeneratorStep {
  /** Generator name inside @bespunky/nx-tools. */
  generator: string;
  args?(ctx: PlanContext): string[];
  skip?(ctx: PlanContext): { reason: string; partial: boolean } | null;
}

export interface LayerDescriptor {
  id: LayerId;
  /** One line, for progress output and error messages. */
  title: string;
  /** Layers that must be present for this one to mean anything. A partial order, not a ladder. */
  requires: readonly LayerId[];
  /** Declarative evidence — shared with the hook through the shell projection. */
  evidence: LayerEvidence;
  /**
   * Refinement over the evidence, for what grep cannot express (e.g. the design system's tag-OR-name rule).
   * PURE — reads, never writes. Present ⇔ evidence matches OR detect returns true.
   */
  detect?(tree: Tree): boolean;
  /** Can a scaffold / a sync create this layer? */
  ensurable: { scaffold: Ensurability; sync: Ensurability };
  /** How a human brings this layer into being. Quoted verbatim when a precondition fails. */
  ensureHint: string;
  /** What the house tooling for this layer brings — one line, shown when the hook reports drift. */
  brings: string;
  /**
   * The generators this layer runs on every sync (and on a scaffold).
   *   workspace — once per workspace, in registry order.
   *   app       — against the sync's app (`ctx.app`). Sync only: a scaffold's `app` generator composes them.
   */
  generators?: { workspace?: readonly GeneratorStep[]; app?: readonly GeneratorStep[] };

  // ── EXTENSION POINTS for later phases. Declared now so parallel work agrees on where things go; nothing
  //    reads them yet. Each is OPTIONAL: a layer that contributes nothing simply omits the field.
  /** Phase 2 — this layer's devcontainer fragment (features, extensions, mounts, ports, OS packages, …). */
  devcontainer?: Readonly<Record<string, unknown>>;
  /** Phase 2 — HOUSE.md / HOUSE.rules.md section flags this layer switches on. */
  docSections?: readonly string[];
  /** Phase 2 — Claude Code plugins this layer enables (`plugin@marketplace`). */
  claudePlugins?: readonly string[];
  /** Phase 1/4 — the migration `layer` scope this layer answers to (defaults to its id). */
  migrationScope?: LayerId;
}
