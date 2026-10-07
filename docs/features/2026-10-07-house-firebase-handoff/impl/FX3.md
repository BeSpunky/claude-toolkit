# FX3

## Fix 1 — outdated deploys notice

Dogfood D4: on a feature branch that had already run the house upgrade (its working-tree `.bespunky/branches.json` has `"deploys": { "note": … }`), the copy in force — the integration line's — still had the bare string, and every notice still said "run the house upgrade". What was left was only to land the branch.

- **One concept, decided once:** `model.mjs` now returns outdated problems as `{ field, problem, rewrite }` and renders them through `outdatedMessage(o, remedy)`; `outdatedRemedy` is `rewrite` (nothing migrated it) or `lands(<integration>)` (this branch already carries it). The resolver (`resolve.mjs`) picks the remedy: when the in-force copy is the integration line's and the working-tree copy has no outdated problem → `lands`; otherwise (same string here, no working-tree copy, bootstrap) → `rewrite`.
- **Every reader gets it:** `status`/`plan` notes, the `describe`/`verify` refusal (its closing line differs per case), and `status --json`, which gains an `outdated` field (`null` or `{ resolution, line, problems }`). `validate`/`write`/`verify --proposed` check the file itself, so they keep the `rewrite` remedy.
- Rendered (a): `stages[0].deploys: a bare string is no longer a deploys value on the integration line's copy — this branch's copy already has the object form ("deploys": { "note": "…" }); it resolves when this branch lands on "development". Nothing else to do: no upgrade, no edit.`
- Rendered (b): `stages[0].deploys: a bare string is no longer a deploys value — replace it with "deploys": { "note": "…" } (same meaning: a note binds nothing). Run the house upgrade (/bespunky-house:upgrade, @bespunky/nx-tools 0.50.0+), whose migration applies it, or propose this exact rewrite to the human.`
- `SKILL.md` tells Claude how to act on each. Tests: a new `tools/test-branches` case covers both on status/plan/describe/verify and landing; 51/51 pass.
- Not touched (out of this fix's paths): `docs/features/2026-10-03-branch-model/CONTRACT.md` still lists the Amendment 2 `status --json` keys without `outdated` (additive; every consumer checks only the keys it needs).

## Fix 2 — the road to a first deploy (D5)

- **The missing concept was the road, not a better error line.** New owned runner `tools/firebase-deploy.mjs`
  (`firebase-emulators/firebase-deploy.mjs.tpl`). Both deploy targets run the CLI through it:
  `functions:deploy` = `node tools/firebase-deploy.mjs --only functions` (was a bare `firebase deploy --only functions`),
  and `firebase-deploy-rules.mjs` imports its `deploy()`. Nothing gates the CLI: only a FAILED deploy prints the road,
  so a credential source the runner doesn't know can never block a deploy. `--check` prints it on demand.
- The road: 1 `npx firebase login` · 2 `npx firebase use --add` (alias, commit `.firebaserc`) · 3 `nx run … -P <alias>`
  and what each target does · 4 `/bespunky-house:add-layer ci` · 5 a human `gcloud auth login` + `! bash tools/setup-gcp.sh`
  · 6 the two repo variables. Each step says how to tell it worked; steps 1, 2, 4 are ticked from local facts (configstore
  login / GOOGLE_APPLICATION_CREDENTIALS / FIREBASE_TOKEN / gcloud ADC; `.firebaserc`; `.bespunky/ci.json`). The failure
  header names the first unmet step (no login → 1; no project → 2; an alias not in `.firebaserc`).
- Also: HOUSE.md *Deploying the backend* gains the same road (CI step gated on `ci`); the CI section names the
  `gcloud auth login` precondition and how to tell the variables worked; the welcome banner, the `new` skill and a tip
  point at `--check`.
- **Consequence for the first 0.50 upgrade (no record):** `functions:deploy`'s `options.command` changes from the old
  house value, so the merge reports it once ("cannot tell an edit from an older house value"). Honest, one-time; the
  test now asserts exactly that one report. No migration owed (owned target key, re-asserted every run).
- Generator touch (FX2's area, minimal): `firebase-emulators/generator.ts` writes the runner and changes the
  functions deploy command + inputs. Tests: `test-generators/cases/firebase-deploy.mjs` (runner success, no-login,
  no-alias, `--check`), `test-scaffold/firebase-banner.test.sh`.

## Fixes 3–5 — HOUSE docs gating, stale test text

- `HOUSE.md.tpl:14` — "the image tag follow it": rewritten as "it sets the devcontainer's image tag / Node feature (and
  seeds Cloud Functions' `engines.node`)" — reads right in every combination, and is more accurate (engines.node is
  seeded, then only reported). Also gated "(the Playwright browsers among them)" on `web`.
- `HOUSE.md.tpl:473` — the *House targets are yours to extend* bullet is gated on EVIDENCE: the record
  `.bespunky/house-targets.json` (new `recordedHouseProjects()` in `_utils/house-targets.ts`), and it names the actual
  house projects from it instead of a layer-guessed list.
- `HOUSE.rules.md.tpl` Generator-first: "the house generators (listed in HOUSE.md)" was false without `js` — now
  `nx list @bespunky/nx-tools`, with the HOUSE.md pointer only under `js`.
- Rendered and read HOUSE.md + HOUSE.rules.md for agent-only, node, angular, angular+firebase+ci (scratch script over the
  house-doc generator).
- `test-scaffold/render.test.sh:106` — the `--nodeMajor` example is now explicitly the 0.29.0 line, with neither retired
  flag presented as current. Swept every `nx-tools:<gen> --flag` in tools/test-* against the generator schemas: no other
  retired flag (the `--sync`/`--ensure` hits are refusal tests and legacy fixtures, deliberately).

## Left

- `docs/features/2026-10-03-branch-model/CONTRACT.md` doesn't list `status --json`'s new `outdated` key — a dated package,
  not rewritten here.
