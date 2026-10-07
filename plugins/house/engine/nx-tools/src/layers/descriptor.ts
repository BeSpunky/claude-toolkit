// THE LAYER DESCRIPTOR — what a layer IS, as data the whole toolkit reads.
//
// A project is a stack of layers (`nx`, `agent`, `web`, `angular`, …). Each one used to be described in eight
// places at once: a closed `LayerId` union here, and in house.sh a `KNOWN_LAYERS` list, two `*_ENSURABLE`
// lists, two hint `case`s, the `--help` text, hard-coded `if layer_active X; then nx g …` blocks, and the
// SessionStart hook's drift greps. Adding a stack was an edit in all of them, and they drifted.
//
// Now a layer is ONE file (`layers/<id>.ts`) exporting one `LayerDescriptor`, registered by one line in
// `registry.ts`. Everything else is DERIVED from the registered set:
//   - generators guard on it (`requireLayer`) and house-doc renders from it (`detectLayers`);
//   - house.sh's outer shell (validation, --help, ensure hints) and the SessionStart hook read
//     `engine/layers.sh`, a GENERATED shell projection of these descriptors (`cli.ts shell`), because both run
//     before — or entirely without — any node_modules;
//   - house.sh's rendered sequence asks the installed CLI (`cli.ts plan`) which generators to run, with
//     which arguments, instead of hard-coding them.
//
// This file has NO runtime imports, deliberately: a descriptor is a statement about a layer, and the
// machinery that evaluates it (evidence.ts, plan.ts) lives beside it rather than inside it.
//
// See docs/features/2026-10-01-stack-agnostic/contracts/layers.md for the contract later phases build on.
import type { Tree } from '@nx/devkit';
import type { DevFragment } from '../generators/dev/declaration';

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
 *   false           — no; the layer can only be detected (add it natively, then upgrade).
 *   { via: <id> }   — only together with that layer, whose creation produces this one (a `new` run's `web`
 *                     exists because the Angular app it creates has a dev-server).
 */
export type Ensurability = boolean | { via: LayerId };

/**
 * The two run shapes, named after the house commands: `new` creates a workspace; `upgrade` moves an existing one
 * (`house.sh upgrade` and `house.sh add-layer`, which is an upgrade with an ensure set).
 */
export const RUN_MODES = ['new', 'upgrade'] as const;
export type RunMode = (typeof RUN_MODES)[number];

/** Everything a plan step may read: the workspace, the resolved layer sets, and the run's own parameters. */
export interface PlanContext {
  tree: Tree;
  mode: RunMode;
  /** Detected ∪ ensured. */
  active: ReadonlySet<LayerId>;
  /** Only what this run was explicitly asked to create — the baseline acts (provider wiring) key off it. */
  ensured: ReadonlySet<LayerId>;
  /** The project (workspace) name. */
  project: string;
  /** The app the per-app generators target. */
  app: string;
  /** --voice on this run (the devcontainer also carries a previous answer forward from its marker). */
  voice: boolean;
  /** --staging on this run. */
  staging: boolean;
  /**
   * The branch model the run RESOLVED (house-branches.sh): the projection as JSON, or `undeclared`; absent when
   * nothing was resolved (a step then reads the Tree). Set by the planner from `StampOptions` — the same value
   * house-doc receives — for the steps that render from the model (the `ci` layer's deploy workflow).
   */
  branchProjection?: string;
}

/**
 * One house generator run. `args` returns argv words — each ONE argument, carried as one TAB-separated field of
 * the plan and passed quoted (never word-split), so it may hold spaces; the plan refuses a TAB, newline or other
 * control character, which would split or corrupt the line.
 *
 * `skip` is the per-step precondition: return a sentence to SKIP the step and say why; with `partial: true`
 * the sync is reported as UPGRADE_PARTIAL (a step that should have run did not).
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
  /** Can a `new` / an `upgrade` (`add-layer`) run create this layer? */
  ensurable: Record<RunMode, Ensurability>;
  /** How a human brings this layer into being. Quoted verbatim when a precondition fails. */
  ensureHint: string;
  /**
   * The Nx plugin whose installation brings this layer into being (`nx add <it>`) — what a SCAFFOLD that ensures
   * the layer runs before any generator. (Whether the layer then creates the first app is not declared here: it
   * is the stack adapter's `apps` port — see adapters/registry.)
   */
  nxPlugin?: string;
  /** What the house tooling for this layer brings — one line, shown when the hook reports drift. */
  brings: string;
  /**
   * The generators this layer runs on every sync (and on a scaffold).
   *   workspace — once per workspace, in registry order.
   *   app       — against the sync's app (`ctx.app`). Sync only: a scaffold's `app` generator composes them.
   */
  generators?: { workspace?: readonly GeneratorStep[]; app?: readonly GeneratorStep[] };

  // ── AGENT ARTIFACTS (phase 2) — what this layer contributes to the files the `agent` layer's generators own.
  //    Each is OPTIONAL: a layer that contributes nothing omits the field. The generators COMPOSE the
  //    contributions of the ACTIVE layers (registry order), so a layer's tooling arrives with the layer and
  //    leaves with it — no generator carries a flag per layer.
  /**
   * This layer's devcontainer fragment — composed by the `devcontainer` generator. See `DevcontainerFragment`.
   * DATA, or a pure function of the workspace when part of it is a fact about the project (the emulator ports in
   * firebase.json) rather than about the layer.
   */
  devcontainer?: DevcontainerFragment | ((tree: Tree) => DevcontainerFragment);
  /**
   * The HOUSE.md / HOUSE.rules.md / CLAUDE.md section flags this layer switches on (`{{#flag}}…{{/flag}}` in the
   * house-doc templates). Usually the layer's own id; a layer may also switch on a shared section (`ui`).
   */
  docSections?: readonly string[];
  /**
   * Claude Code plugins this layer enables, as `plugin@marketplace`. ONE list feeds both `.claude/settings.json`
   * (`enabledPlugins`) and the devcontainer's plugin pre-install, so the two can never disagree. The marketplace
   * must be one the house knows (`generators/_utils/layer-contributions.ts`).
   */
  claudePlugins?: readonly string[];
  /** `.gitignore` entries this layer's tooling makes necessary, under one heading per block. */
  gitignore?: readonly GitignoreBlock[];
  /**
   * The processes this CAPABILITY runs beside a served app (Firebase: the emulator suite) — seeded into the app's
   * `.bespunky/dev.json` entry by the `dev` generator, only where the layer is present and the app is served.
   */
  devFragment?(tree: Tree, project: string): DevFragment;
  /**
   * This layer as a DEPLOY PROVIDER for the `ci` layer's workflow: how a CI job authenticates to it, what its
   * `deploy` targets are told about the environment, and the setup a HUMAN runs once to create the cloud identity.
   * The `ci` layer knows no provider — it composes the contributions of the active layers. See `CiDeployProvider`.
   */
  ciDeploy?: CiDeployProvider;
}

// ── THE CI DEPLOY PROVIDER ────────────────────────────────────────────────────────────────────────────────────
//
// The `ci` layer owns the stack-agnostic pipeline (push to a line the branch model binds → deploy what changed, in
// that line's environment). What differs per cloud is contributed here: a line's `ci` binding names, per provider
// id, the provider's TARGET there (`{"firebase": "prod"}` — a .firebaserc alias), and the provider turns it into
// the options ITS OWN deploy targets take in that environment, the steps that authenticate the job, and the
// one-time cloud setup. A provider's options reach only its own targets (a `ci-<environment>` Nx configuration on
// each), so several providers — and a project's own deploy targets — compose without seeing each other's flags.

/** One environment a provider deploys into, as the `ci` layer resolved it from the branch model. */
export interface CiEnvironment {
  /** The deployment environment (a GitHub environment) — the binding's `ci.environment`. */
  name: string;
  /** This provider's target in it (the binding's `ci.providers.<id>`). */
  target: string;
  /** The branches that deploy into it, as names and globs. */
  branches: string[];
  /**
   * No binding names it any more, but its cloud setup is still recorded as applied: rendered only so a human can
   * roll it back (`retireStep`), never set up again.
   */
  retired?: boolean;
}

export interface CiDeployProvider {
  /** The provider id a binding names (`ci.providers.<id>`). */
  id: string;
  title: string;
  /** The deploy targets this provider's layer owns in this workspace — the ONLY targets its options reach. */
  deployTargets(tree: Tree): { project: string; target: string }[];
  /** The options a deploy target of this provider takes in an environment whose provider target is `target`. */
  deployOptions(target: string): Record<string, unknown>;
  /** GitHub Actions steps (YAML, as a list of `- …` items at column 0) that authenticate the deploy job. */
  authSteps(): string;
  /**
   * Owned files this provider adds (the human-run cloud setup), rendered from the resolved environments — retired
   * ones included, so the tool that undoes their setup outlives their binding.
   */
  files?(tree: Tree, environments: readonly CiEnvironment[]): { path: string; content: string; mode?: number }[];
  /** Whether the environment's cloud setup is recorded as applied (and not rolled back) in this workspace. */
  isSetUp?(tree: Tree, environment: string): boolean;
  /** The HUMAN_STEP that (re-)applies an environment's cloud setup — printed when what it was rendered for changed. */
  humanStep?(environment: CiEnvironment): string;
  /** The HUMAN_STEP that undoes a retired environment's cloud setup — printed on every upgrade until it is done. */
  retireStep?(environment: CiEnvironment): string;
}

/** A `.gitignore` block: a `#` heading (without the `#`) and the entries under it. */
export interface GitignoreBlock {
  heading: string;
  entries: readonly string[];
}

// ── THE DEVCONTAINER FRAGMENT ─────────────────────────────────────────────────────────────────────────────────
//
// A layer's share of the devcontainer, as DATA. The `devcontainer` generator composes the fragments of the active
// layers (registry order, then the voice intent) into `.devcontainer/devcontainer.json` and ONE composed
// `.devcontainer/post-create.sh`. Every contribution may carry a `why`, rendered as a `//` (or `#`) comment above
// it in the generated file — the generated devcontainer is READ by the people who live in it, and the reasons
// for a mount or a forwarded port are the part they need most.
//
// STRING TOKENS, substituted by the composer in every string a fragment contributes:
//   {{home}}        the remote user's home (`/home/<remoteUser>` — it follows the image, never hard-coded)
//   {{remoteUser}}  the user the container runs as
//   {{nodeMajor}}   the Node major the image / Node feature is pinned to — the project's `.nvmrc` (_utils/node-version)

/** A third-party apt repository an `osPackages` group installs from (see `DevcontainerFragment.osPackages`). */
export interface AptRepository {
  /** Names the keyring and the sources.list.d file: `[a-z0-9-]+`. */
  id: string;
  /** HTTPS URL of the repository's signing key (ASCII-armored or binary). */
  key: string;
  /** The `deb` line after `deb [signed-by=…]`: `<https url> <suite> <component…>`. */
  source: string;
}

/** A JSON value as it may appear in devcontainer.json. */
export type DevcontainerJson =
  | string
  | number
  | boolean
  | null
  | readonly DevcontainerJson[]
  | { readonly [key: string]: DevcontainerJson };

/** Every contribution may say WHY — rendered as a comment above it in the generated file. */
export interface Explained {
  why?: string;
}

export interface DevcontainerPort extends Explained {
  port: number;
  label: string;
  onAutoForward: 'silent' | 'notify' | 'openPreview' | 'openBrowser' | 'ignore';
  /**
   * Forward at the SAME host number? Only for ports something OUTSIDE the container dials by a hardcoded
   * address. Everything else is left to auto-forward. Two layers may name one port: `forward` is OR-ed, the
   * label and behaviour come from the first contributor in registry order.
   */
  forward?: boolean;
  /** Prompt instead of silently remapping when the host port is taken (exact-port keys only). */
  requireLocalPort?: boolean;
}

/**
 * When a post-create piece runs. The composed script runs the phases in this order, and within a phase the
 * pieces in registry order:
 *   (the volume-ownership reclaim — DERIVED from the composed mounts, see `VolumeOwnership` — runs first)
 *   prepare   — fix-ups the rest relies on; before anything installs
 *   (the OS packages — every active layer's `osPackages` — are built into the IMAGE as one cached layer; here the
 *    same installer installs only what is missing: nothing in a house-built image)
 *   install   — the project's own dependencies (the Nx wrapper's installation, the package-manager install)
 *   plugins   — the Claude Code plugin pre-install
 *   provision — layer tooling that needs the above (browsers, agent skills, banners)
 */
export type PostCreatePhase = 'prepare' | 'install' | 'plugins' | 'provision';

export interface PostCreatePiece {
  phase: PostCreatePhase;
  /**
   * The piece's script: `generators/devcontainer/post-create/<piece>.sh.tpl`, shipped beside the generator.
   * POSIX-parseable bash fragments (the composed script may be chained from a project's own `/bin/sh`
   * postCreateCommand), best-effort (a failure WARNS, never aborts the container create).
   */
  piece: string;
}

/**
 * Who a `type=volume` mount point must belong to once the container exists. The composed post-create's FIRST
 * section is derived from these — one policy per volume, so no layer ever scripts its own reclaim again (the
 * hand-listed ones each covered some volumes and missed others: `node_modules` had none, and failed every
 * node-hosted project's first rebuild with EACCES).
 *
 *   user    — the DEFAULT, for a volume under the workspace or the remote user's home: the mount point (recursively
 *             — a fresh volume is empty, an older root-populated one needs it) and every directory Docker created
 *             on the way to it (non-recursively — their other contents are not the volume's) are chowned to the
 *             remote user.
 *   shared  — a volume SEVERAL containers mount, whose remote users may have different UIDs: made world-writable +
 *             sticky (1777) instead, because a chown would let the second container take it away from the first.
 *
 * A volume mounted anywhere else must DECLARE its policy — the composer refuses to guess whose it is.
 */
export type VolumeOwnership = 'user' | 'shared';

export interface DevcontainerFragment {
  /**
   * The base image this layer's STACK runs on, and the user it runs as. The last active layer (registry
   * order) that declares one wins — a stack layer specialises the neutral default. A layer that only needs a
   * tool on PATH contributes a `features` entry instead, which composes.
   */
  image?: {
    ref: string;
    remoteUser: string;
    /** Features that belong to THIS image (the runtime it lacks) — dropped with it when a later layer replaces it. */
    features?: DevcontainerFragment['features'];
  } & Explained;
  /** Devcontainer features, by id. */
  features?: readonly ({ id: string; options?: { readonly [key: string]: DevcontainerJson } } & Explained)[];
  /** VS Code extension ids. */
  extensions?: readonly string[];
  /** VS Code settings at the container (Remote) scope. */
  settings?: readonly ({ key: string; value: DevcontainerJson } & Explained)[];
  /**
   * Mount specs (`source=…,target=…,type=…`). A `type=volume` mount's OWNERSHIP is derived, never hand-scripted:
   * Docker creates a fresh named volume — and every missing directory on the way to its mount point — owned by
   * root, so the composed post-create reclaims each one before anything installs (see `VolumeOwnership`).
   */
  mounts?: readonly ({
    mount: string;
    ownership?: VolumeOwnership;
    /**
     * The target is a directory an image may itself populate (a home's `~/.local`): a named volume mounted over it
     * freezes the image's copy at the first create. Safe on an image the house knows ships nothing there; left out
     * on an adopted devcontainer's foreign image.
     */
    onHouseImageOnly?: true;
  } & Explained)[];
  /**
   * Directories this layer puts IN FRONT of the image's PATH. Never a `remoteEnv` `PATH` of a layer's own: two
   * layers each setting `PATH` would collide (first wins, the other's directory silently gone), so the composer
   * owns the one `PATH` and builds it from every active layer's entries, in registry order, ahead of
   * `${containerEnv:PATH}`. Written with `{{home}}` (the composer resolves it for the user the container runs as)
   * and devcontainer variables like `${containerWorkspaceFolder}` — never `${containerEnv:HOME}`, which is empty:
   * a container's environment carries no HOME.
   */
  path?: readonly ({ dir: string } & Explained)[];
  /** Environment for editor-spawned processes. Never `PATH` — that is composed from `path` (above). */
  remoteEnv?: readonly ({ name: string; value: string } & Explained)[];
  /** Environment for EVERY process in the container. */
  containerEnv?: readonly ({ name: string; value: string } & Explained)[];
  /** `docker run` arguments (image- or Dockerfile-based devcontainers; not Compose). */
  runArgs?: readonly ({ args: readonly string[] } & Explained)[];
  /** Ports this layer serves — `forwardPorts` and `portsAttributes` are both derived from ONE list. */
  ports?: readonly DevcontainerPort[];
  /** Named `initializeCommand` entries (object form — they run side by side, on the HOST). */
  initializeCommand?: readonly ({ name: string; command: string } & Explained)[];
  /** Debian packages — composed into the one installer (house.packages.sh) the image build runs as ONE cached layer. Never an apt step in a postCreate piece: that reinstalls on every rebuild. */
  osPackages?: readonly ({
    /** Debian package names; `name=version` pins one exactly (a tool that is a build input must not float). */
    packages: readonly string[];
    /**
     * The third-party apt repository these packages come from (a tool Debian does not ship, at a version Debian
     * does not carry). The installer adds it before installing — its key dearmored into `/usr/share/keyrings/<id>.gpg`
     * and the source line `signed-by=` it, the modern method (no `apt-key`, which Debian 13 no longer has).
     */
    repository?: AptRepository;
    /**
     * Names that are right only for the HOUSE images' distro (a projection for Debian 13, like Chromium's libraries):
     * left out on an adopted devcontainer's foreign image, whose distro the house cannot know — one wrong name fails
     * the whole apt transaction. Such a group's post-create counterpart installs them by the tool's own means there.
     */
    onHouseImageOnly?: true;
  } & Explained)[];
  /** Post-create pieces. */
  postCreate?: readonly PostCreatePiece[];
}
