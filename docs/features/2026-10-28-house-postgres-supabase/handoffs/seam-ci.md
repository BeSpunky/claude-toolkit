# seam-ci: what was built (branch feat/hps-ci)

**The fields on `CiDeployProvider`** (`layers/descriptor.ts`):

| Field | Required | Replaces | Firebase |
|---|---|---|---|
| `targetLabel` | yes | `generator.ts:213`, and the example at `:234` | `.firebaserc alias` |
| `deploySignals` | yes | `generator.ts:314` | `/\bfirebase\s+deploy\b/` |
| `deployStage` (`schema`, `code`) | no, default `code` | nothing: ordering is new | absent |
| `deployEnv` (name → GitHub expression) | no | `workflow.ts:213-215` | absent |
| `oidc: { why }` | no | `workflow.ts:197` | the same comment text as before |

`deploySignals` are read from **every registered** provider, not the active ones. Reading only the active ones would have lost the detection a project with its own `firebase deploy` and no `firebase` layer has today.

## The silent failure: blocked, not dropped

A binding that names no target for an active provider keeps its line in the triggers, and `resolve` fails every push to that line with `::error::`, naming what to add. The generator also prints a `HUMAN_STEP` on every upgrade until it is fixed. It is a plain note when the house wrote no workflow, because then nothing of the house's has stopped.

Beyond the note the old path was worse than reported in `layer-infra.md` §8.1:
- With its last line gone, the **workflow was deleted**.
- The environment read as retired, so the generator told a human to **roll back the production identity**, and removed `ci-<environment>` from the provider's targets.

A blocked line still holds its environment, and its named providers keep their configurations and setup.

Rejected:
- **Deploy what is bound.** The new provider's target runs with no configuration (Nx falls back to the default), or is skipped and code ships without its schema.
- **Throw from the generator.** It fails the rest of the upgrade part-way through a plan of separate generator runs, over a fact only a human has.

Cost, accepted: from the upgrade until the binding is completed, that line deploys nothing, loudly. This also applies to a Firebase project whose binding names no `firebase` target: it used to get a note and no line, and now gets the red line.

## Order: stages in the workflow, not `dependsOn`

`PLAN.md` said `dependsOn`; the brief allowed the workflow's equivalent. Chosen: a provider states what it deploys (`deployStage`), and the workflow renders one step per stage, each deploying its share of what `prepare` selected.

- `dependsOn` would have to be written into deploy targets this generator does not own. A project's own backend `deploy` is class B, and the backend is the very thing that must wait for the schema. Stages order those with no edit.
- It keeps "a provider's reach ends at its own targets", and providers do not name each other.
- `deployEnv` scopes per stage, so a schema credential never reaches a code deploy step.
- With no earlier stage in play the output is the old single step.

**Known limit:** the order lives in the workflow. A hand-run `nx run-many -t deploy` has no such order, and `HOUSE.md` says so. Landing 2 can add `dependsOn` inside its own project if it wants that too.

The stage's project list is rendered at upgrade time, like the `ci-<environment>` configurations, so a project renamed without an upgrade falls into the last stage.

## Other behaviour changes

- A project with **no OIDC provider** no longer gets `id-token: write`, per the brief. A project's own deploy script that fetched the token itself would stop working; no toolkit path does this.
- `.bespunky/ci.json`'s `about` is neutral, and `pending`'s example shows `<.firebaserc alias>` instead of `default`.
- Text outside `ci/`, to keep it true: `HOUSE.md.tpl` (two bullets), `commands/upgrade.md` (the new step). Both are `plugins/house` shipped content, so the release owes a bump.

## Evidence

- Byte-identity: `generators/ci` compiled before and after through `tools/test-support/payload.mjs`, 5 package-manager shapes × 2 models. `deploy.yml` 10/10, `setup-gcp.sh` 10/10, `project.json` 30/30 identical. `ci.json` differs only in the `about` line.
- `tools/test-generators/cases/ci-providers.mjs`: 15 cases with a fake second provider. The generated bash is run under `bash --noprofile --norc -eo pipefail` against a stub `yarn`.
- Branch engine: `model.mjs` accepts any lowercase provider id (`PROVIDER`, `:154`) and projects it. Verified by running it. No workflow plugin edit needed.

## Migration finding

Nothing to migrate. `deploy.yml`, `.bespunky/ci.json` and the `ci-*` configurations are owned and re-asserted by every upgrade; the marker's shape and every path are unchanged. The one on-disk change an existing project can see is the blocked line, and that is regenerated state, not a one-way shape.

## Not verified

GitHub Actions itself: no run on a real runner, and no `actionlint` here. "A failed step stops the next", the red run's notification and secrets in environment scope are GitHub's documented behaviour, not observed. `dogfood-consumer` was not run; it belongs to the landing gate.
