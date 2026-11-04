# seam2-docs: the docs of the `postgres` layer (on feat/house-postgres-supabase)

## What changed
- `house-doc/HOUSE.md.tpl`, `HOUSE.rules.md.tpl`: fixed the seed claim; added the deploy's agent refusal, the pooler's shapes, the provable sweep, the role and database, the CI schema stage and its secret, `dev stop`'s exit, the public `ps --json`.
- `CLAUDE.md`: layer and capability lists, the `binary` format, the clean-stop exit, `ps --json`, commands rows for `test-postgres` and `image-codenames`. `deployTarget`'s signature is not stated anywhere in it, so nothing to change.
- `README.md`: catalog, layer table, capability list, engine step, an opt-in section.
- `plugins/house`: `skills/new/SKILL.md` (description, a `postgres` section, question 5a, planner line, a common shape), `commands/add-layer.md`, `plugin.json` description, `tips.txt`.
- `plugins/workflow/skills/local-server-isolation`: `reference/postgres.md`, a pointer in SKILL.md.

## Decisions
- **No new skill.** `firebase-app-hosting` holds a third party's operational truth (Root Directory, rollout modes, yaml lookup), which a project cannot derive. Everything here is the house's own and lives in the generated `HOUSE.md`. A hosted provider's quirks may justify one with `supabase`.
- **Question 5a in the skill.** Asked only when the intentions suggest relational data, default no, so a user learns the layer exists without a new mandatory question.
- **Tips name the launcher, not Nx.** `node tools/postgres/postgres.mjs <verb>` works on both hosts; bare `nx` does not on the wrapper host.

## Wrong claims found
- HOUSE.md said a seed needing its own transaction control "goes through `postgres:reset`". `reset` applies the world through `applySeeds`, the same `--single-transaction`. Corrected: a seed file writes no `BEGIN` or `COMMIT`.
- HOUSE.md's CI section said a binding must name a target for every provider. Postgres takes none.

## Stated limits, for the review
- **"An agent cannot run the deploy" holds only while `CI` is unset.** `humanConfirms` returns at once if `CI` is set, so an agent that has the URL and sets `CI=1` gets through. HOUSE.rules forbids it; the code does not prevent it.
- **A verb does not check the owner.** With one stack running in a tree, `postgres:reset` acts on it whoever started it. `reference/postgres.md` says so.
- **Nothing tells a human to set the secret.** The `ci` generator prints no `HUMAN_STEP` for `POSTGRES_DEPLOY_URL`; the docs state `gh secret set`, and the deploy fails naming the variable.
- `gh secret set POSTGRES_DEPLOY_URL --env <environment>` is from `gh`'s documented interface, not run here.
- `tools/test-postgres` has no CI wiring as of this note, so its commands row claims none.

## Owed
`bespunky-house` and `bespunky-workflow` bumps. The `plugin.json` description changed, so `marketplace.json` drifts until `nx release` derives it.
