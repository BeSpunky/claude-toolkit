---
name: nx-monorepo-and-dx
description: Nx monorepo architecture and developer-experience techniques - the workspace-level expression of the architect mindset. Use when structuring an Nx (or general monorepo) workspace beyond a trivial change - organizing apps and libraries, drawing library boundaries and entry points, enforcing module boundaries with tags, configuring the cache and task pipeline, writing generators or automation, setting up testing, releasing/versioning packages, or making the dev environment and commands reproducible and one-step. This skill is a router - it indexes technique clusters and points to a reference file for each; read only the cluster you need. BeSpunky is generator-first; the project-starter plugin scaffolds the house standard.
---

# Nx Monorepo & DX

Workspace-level techniques that put the architect mindset into practice across a monorepo and its developer experience. The *why* lives in the **`architect-mentality`** skill. **This skill is the *how*, in Nx** — and two mentality principles dominate here:

- **Everything is a black box with deliberate, directed connections** → libraries with explicit entry points and **enforced**, one-directional dependency rules.
- **Automate every repeated process** → caching, generators, one-command pipelines, and reproducible environments so no one ever does the same thing by hand twice.

Most examples are Nx-specific (modern Nx: `targetDefaults`, `namedInputs`, `nx affected`, `nx release`), but the ideas carry to any monorepo. BeSpunky is **generator-first** — never hand-create what a generator can produce; the `project-starter` plugin scaffolds the house standard and ships house generators you can learn from.

## How to use this skill

1. Identify which **cluster** (below) your decision belongs to.
2. **Read the matching `reference/<file>.md`** for the full technique: what it is, the mentality it serves, modern config/code, when to use it, when *not* to, and pitfalls.
3. Apply it — and keep every cross-library dependency a deliberate, sanctioned, one-directional connection (`architect-mentality` → *Everything is a black box*).

Read only the cluster(s) you need; don't load them all.

## Technique clusters

| Cluster | Reference | Covers | Serves (architect-mentality) |
| --- | --- | --- | --- |
| **Library boundaries & entry points** | `reference/library-boundaries-and-entry-points.md` | one folder = one entry point (ng-packagr secondary entry points / package `exports`), `/testing` siblings, minimal public-API barrels, tsconfig path mapping to dogfood your own subpaths | Everything is a black box · Place everything on purpose · Design for the consumer |
| **Module-boundary enforcement** | `reference/module-boundary-enforcement.md` | project **tags** taxonomy (`type:` / `scope:`), `@nx/enforce-module-boundaries`, one-directional `depConstraints`, buildable-lib rules | Everything is a black box (directed connections) |
| **Caching & the task pipeline** | `reference/caching-and-task-pipeline.md` | cacheable targets, `targetDefaults` + `dependsOn: ["^build"]`, `namedInputs` (a `production` input that excludes tests), shared-config inputs, `nx affected`, remote cache hygiene | Work smart · Automate every repeated process · Compensate for weaknesses |
| **Generators & automation** | `reference/generators-and-automation.md` | generator-first scaffolding (`nx g`), house generators/executors in a local plugin, generate-from-source-of-truth artifacts, small `tools/` scripts as build steps | Automate every repeated process · Work smart · Place everything on purpose |
| **Testing setup** | `reference/testing-setup.md` | layered config (framework preset → workspace → per-project), `/testing` entry points with reusable harnesses & spec factories, mocks that reuse real infrastructure, test the contract not the implementation | Concentrate complexity · Understanding & verification first-class |
| **Release, versioning & environments** | `reference/release-versioning-and-environments.md` | `nx release` (or composed `run-commands` pipelines), per-package versioning, one-command/one-click env serving (serve configurations), reproducible devcontainers, docs as a deployable artifact | Automate every repeated process · Compensate for weaknesses · Understanding first-class |

Read only the one(s) you need.

## Related skills

- **`architect-mentality`** — the agnostic mindset every technique here expresses (especially *Everything is a black box* and *Automate every repeated process*).
- **`architecture-first`** — the operational discipline (root-cause, no patches, design-and-confirm refactors) that governs changes inside the workspace.
- **`project-starter`** (separate plugin) — scaffolds the house Nx standard and ships example house generators.
- **`bespunky-design-system:design-tokens-and-theming`** (separate plugin) — the styling layer of a publishable design-system library: which entry points it publishes (the SASS API, the primary TS surface, one per component), how public-vs-internal is enforced at both the folder and the export level, and how each is consumed in-repo versus published.
