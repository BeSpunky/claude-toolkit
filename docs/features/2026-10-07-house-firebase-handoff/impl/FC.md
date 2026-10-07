# FC — review fixes for R6 (CI security, setup-gcp, branch-model deploys)

Branch `feat/house-firebase-handoff--fc`. Binding decision: DECISION.md → "CI: security first" + the orchestrator's
R6 brief (R6-1..14, D1..D3). Rule: reproduce each finding before fixing it; reject with evidence when it does not hold.

## Plan / ledger (written before dispatch; updated as it happens)

| unit | scope | who | status |
| --- | --- | --- | --- |
| FC-r | research: firebase-tools IAM for functions deploy (secrets, HTTPS invoker); action SHAs; actionlint + shellcheck binaries | sub-agent (read-only on repo) | done (distilled under R6-7 / R6-5) |
| FC-e | engine: R6-11 (`lands` remedy), R6-13 (`evidence --app-hosting`) — resolve.mjs, evidence.mjs only | sub-agent (path-bounded, same tree) | done — ec08c0c, fe8ee8a |
| FC-1 | engine `ci` only on protected, non-maintained lines; one line per environment (R6-1, R6-4) — model.mjs | me | done — e8d400f |
| FC-2 | generator: defence in depth (R6-1, R6-4), job split + SHA pins (R6-5), D1 configurations, D2 variables, R6-14 | me | done — 0d96ac0 |
| FC-3 | setup-gcp.sh: R6-2, R6-3, R6-6, R6-7, R6-8, R6-9, R6-10, D3 | me | done — 0d96ac0 |
| FC-4 | R6-12 resolver divergence; docs sweep; engine tests | me | done (this commit) |

## Findings — each reproduced first

| id | verdict | evidence before → after |
| --- | --- | --- |
| R6-1 | FIXED | `expand --preset gitflow --maintained` + `ci` on stages/releases/hotfixes → `validate`: **valid**. Now the engine refuses `ci` on hotfixes, tags and maintained releases (message says why + where to bind instead); the generator re-checks the projection (`protected` / `protectedPatterns`, minus `productionPatterns`, no tags) and refuses with a note. Tests: test-branches "ci binding only on protected…", test-generators "defence in depth". |
| R6-4 | FIXED | Same model with `main` and `release/*` both on `production` validated. Now: one line per environment (engine + generator); `concurrency: deploy-<environment>` on the deploy job; a PATTERN line deploys everything every run (affected's base is per branch, the environment's last deploy may be a sibling's). |
| R6-2 | FIXED | Old: `principalSet` on `github-actions/attribute.repository` in an adoptable shared pool. Now: a pool per repo+environment (`gh-<env>-<cksum6 of repo_id/env>`) with one provider `github`; an unrecorded ACTIVE pool or a foreign provider in it is refused; SA per environment; principal bound on `attribute.repository_id`. Simulator run: both refusals observed. |
| R6-3 | FIXED | Old rollback removed by CURRENT firebase.json and deleted the shared SA. Now `.bespunky/gcp/<env>.tsv` (committed: must outlive the machine and the person, reviewable as an IAM change; GCP has no per-binding "added by" field) records each created resource and each ADDED grant; rollback undoes only that; pre-existing grants untouched (simulator: a pre-existing `run.invoker` survived); runtime grants are LEFT with their removal commands (rolling back CI must not break production). |
| R6-5 | FIXED | Old: one job with `id-token: write` ran `yarn install` and tag-pinned actions. Now resolve / prepare (install, nx-set-shas, `actions: read`, no id-token) / deploy (id-token, restores prepare's install via actions/cache, never installs). Pins in one table `ci/actions.ts` (`@<sha> # vX.Y.Z`). Test asserts every `uses:` is a 40-hex SHA. |
| R6-6 | FIXED | Old: removing a binding deleted the script silently. Now an environment still recorded as set up stays in the script as `retired` (setup refused, rollback allowed) and a `HUMAN_STEP: … --rollback --environment <env>` prints every upgrade until its record is gone; then it is dropped. Tests: two cases. |
| R6-7 | FIXED (verified in source) | firebase-tools 15.32.1: `ensureServiceAgentRole` reads the SECRET's policy, `setIamPolicy` if missing → project-wide grant does not help, deploy 403s. Now `secretAccessor` per secret (names parsed from `defineSecret`/`secrets: [...]`) to the runtime SA; missing secret → INCOMPLETE, exit 1. Also from source: `checkHttpIam` needs `cloudfunctions.functions.setIamPolicy` → `cloudfunctions.admin`; event service-agent grants pre-granted; image cleanup policy set where gcf-artifacts exists (else the exact command). Not verified against a live project. |
| R6-8 | FIXED | Condition: `repository_id`, `environment`, `event_name in ['push','workflow_dispatch']`, `workflow_ref == '<repo>/.github/workflows/deploy.yml@' + assertion.ref`, refs. `in [...]` in a GCP condition is standard CEL but unobserved live. |
| R6-9 | FIXED | Without node: dies (observed). Alias not in .firebaserc: dies. A skipped grant (secret missing, cleanup policy failed) → "INCOMPLETE", exit 1. A missing appspot account is NOT a skip: the CLI's `checkServiceAccountIam` passes when it errors. |
| R6-10 | FIXED | Re-run removes recorded grants no longer wanted (simulator: storage viewer removed after `storage` left firebase.json); the header no longer claims more. |
| R6-11 | FIXED (sub-agent) | `lands` only when the local copy holds the exact rewrite at every outdated path and checks clean — ec08c0c. |
| R6-12 | FIXED (documented + defended) | The divergence is real and by design (bash reads only the projection, which only `write` produces after validation). Documented in house-branches.sh; the `ci` generator re-checks every security rule on the projection. |
| R6-13 | FIXED (sub-agent; one part rejected) | Token off argv (fetch in a child, token on stdin); CLI-missing / not-logged-in / other error told apart; pattern bindings glob-matched. "Declared nowhere" ignored the branch already — did not hold — fe8ee8a. |
| R6-14 | FIXED | `case "release/a/b" in release/*)` matches (bash `*` crosses `/`). Now one regex source (`ci/refs.ts`) for the resolve step (`[[ $GITHUB_REF =~ $1 ]]`) and the CEL; rendered step run: `release/a/b`, `mainx`, `feat/x` → no binding; `release/1.2` → uat. |
| D1 | FIXED | Nx 23.1.0 checked: `run-many -t deploy -c ci-prod` runs `a:deploy:ci-prod` (args appended) and falls back to the default configuration elsewhere. Provider declares `deployTargets` + `deployOptions`; the generator writes/removes `ci-<env>` configurations (recorded in the marker; a project's own same-named configuration is left and reported). The ">1 provider → throw" is gone. |
| D2 | FIXED | `variables` deleted; names live in `CI_VARIABLES` (provider), rendered into setup-gcp.sh; HOUSE.md and the deploy runner refer to "the variables it prints". |
| D3 | FIXED | Setup prints `gh api PUT …/environments/<env>` (custom branch policies + required reviewer, the gh user's id resolved) and one `deployment-branch-policies` POST per bound branch, with the plan caveat. |

Kept intact: `actions: read` (now on prepare, where nx-set-shas runs); `serviceAccountUser` on appspot.
Migrations: none owed — the `ci` layer and its outputs are new in the unreleased 0.50.0; no project has the old shape.
Persistence: the record is a committed repo file, not container state.

## Verified
test-branches 55/55 · test-generators 187 ok, 23 skipped (framework plugins) · test-migrations 224 · test-layers 100 ·
test-scaffold · check-descriptions · check-script-modes · actionlint 1.7.12 (+shellcheck) on four rendered workflows ·
shellcheck 0.11.0 on rendered setup-gcp.sh · setup-gcp.sh dry runs, and real runs against a stateful gcloud simulator
(setup, convergence, rollback, re-setup after rollback, three refusals).

## Not verified
A live GCP project: the role set, `in [...]` in the attribute condition, and the cleanup-policy step. The first real
setup + CI deploy on a throwaway project is the remaining gate.

### Research distillation (FC-r, firebase-tools 15.32.1 `lib/`, read from `npm pack`)

- Secrets: `release/fabricator.js` → `ensure.grantSecretAccess` → `gcp/secretManager.js:ensureServiceAgentRole` reads the
  SECRET's own policy (`secrets/S:getIamPolicy`) — a project-level grant is not read — and calls `:setIamPolicy` when the
  runtime SA is missing from it. `setIamPolicy` is only in secretmanager.admin; the error is uncaught → the deploy fails.
  Validation (`validate.js:validateSecretVersions`, `params.js:ensureSecret`) needs secrets.get + versions.get (viewer).
  → R6-7 holds: grant secretAccessor PER SECRET to the runtime SA; the deployer keeps secretmanager.viewer.
- HTTPS: `checkIam.js:checkHttpIam` tests `cloudfunctions.functions.setIamPolicy` (new onRequest, gen1 and gen2) — only in
  cloudfunctions.admin. → new HTTPS functions fail with cloudfunctions.developer. Gen2 invoker: `run.services.setIamPolicy` (run.admin).
- `checkServiceAccountIam`: actAs on `<id>@appspot`; an ERROR (e.g. the account does not exist) is logged and passes —
  so a missing appspot account needs no grant (not a skip).
- `ensureServiceAgentRoles` (first event-triggered function): pubsub agent tokenCreator, compute run.invoker and
  eventarc.eventReceiver, GCS agent pubsub.publisher (storage triggers) — via projects.setIamPolicy only when missing → pre-grant.
- `setupArtifactCleanupPolicies` → `promptForCleanupPolicyDays` THROWS under `--non-interactive` without `--force` when
  gcf-artifacts has no cleanup policy (after deploying). Fix: set it once (`firebase functions:artifacts:setpolicy`).
- Pins (latest in the current major): checkout 11d5960a… v4.4.0, setup-node 49933ea5… v4.4.0, cache 0057852b… v4.3.0,
  nx-set-shas 3e9ad737… v4.4.0, google-github-actions/auth c200f369… v2.1.13. Newer majors exist (checkout v7,
  setup-node v7, cache v6, nx-set-shas v5, auth v3) — a major move is a separate, reviewed change.
- GitHub: required reviewers need a public repo or Pro/Team+ for private ones; custom branch policies need Pro/Team+ for private.
