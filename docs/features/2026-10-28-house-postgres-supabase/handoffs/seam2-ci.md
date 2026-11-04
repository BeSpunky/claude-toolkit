# seam2-ci: what was built (branch feat/hps2-ci)

Debts F4, F8, F7 and F14 from `reviews/2026-11-04-landing1-sanity-review.md`, ahead of the `postgres` layer.

## F4: the provider shape (`layers/descriptor.ts`, `ci/generator.ts`)

`CiDeployProvider` is now a union:

| | `targetLabel` | `deployOptions` | A line that does not name it |
|---|---|---|---|
| `TargetedCiDeployProvider` (Firebase) | string | `(target: string)`, required | blocked, as before |
| `TargetlessCiDeployProvider` (a database on `DATABASE_URL`) | absent | `(target?: string)`, optional | deploys |

- **`supersedes: '<provider id>'`:** the named provider is not active wherever this one is worn: no auth, credentials, options or target demand. It must belong to a layer this layer directly `requires`, or the generator throws. A replaced provider with a recorded cloud setup is offered for rollback, like a retired environment.
- **The reproduced bug:** two providers on one deploy target now compose in one `ci-<environment>`: their `args` join in provider order (identical `args` are said once). Any other option they disagree on throws, naming the option and the target. So does sharing a target across stages, because a target deploys in one step, holding one stage's credentials.
- **For Landing 2:** a provider written to the old shape still type-checks as a targeted one. A `postgres` that reads `DATABASE_URL` from the GitHub environment should leave out `targetLabel` and `deployOptions`. A `supabase` that needs a project ref sets `targetLabel`, `supersedes: 'postgres'`.

**How I read "a line may name only some providers".** A line may leave out a provider with no target or a superseded one. A provider WITH a `targetLabel` left out still blocks the line, because the user settled that at the Landing 1 gate (*"yes, fail CI"*, `DECISION.md`). There is still no way for a line to say "this targeted provider does not deploy here". If that is wanted, it needs a new decision and a binding shape.

**Limit found, not changed.** "Whatever the target's name" holds for the configuration: composition is keyed on `project:target`. But the workflow only ever runs `-t deploy`, so a provider declaring a target under another name is configured and never run. Today every provider declares `deploy`.

## F8: foreign-pipeline detection (`ci/foreign-pipeline.ts`, new)

- Only commands in a step's `run` count. Step names, env values, `with:` values and `defaults.run` do not.
- A run script is cut at unquoted `;`, `&`, `|` and comments, joined across `\` continuations. `echo`, `printf` and `:` are skipped, and so are heredoc bodies unless the heredoc feeds a shell. `bash -c "firebase deploy"` still counts.
- **Departure:** `yaml` becomes a payload dependency (`^2.8.3`; Nx already pins 2.9.0, so it adds nothing to an install). A line scanner cannot read `run: >-`, quoted scalars or `defaults.run`.
- Stated limit: a deploy inside a quoted `$(...)` of an `echo` goes unseen. An unknown command that mentions a signal counts, because mistaking a real pipeline for an unrelated one is the worse error.
- **The owned workflow is known by its first line (`WORKFLOW_HEADER`), not the marker alone.** That line has not changed since the file first shipped (`ebf910f7`, the only commit that touches it). A generated file whose marker was lost is rewritten and owned again. A file the project put at that path is kept though the marker lists it, whether or not it deploys, and is dropped from the marker.

## F7: a firewall meeting a later stack (`platform/index.ts`, `platform/firewall.ts`)

`ensurePlatformFirewall` on an existing firewall adds a newly worn stack's `webOnlyImports` to `platform:server` and `platform:shared` through `addFirewallBans`.

**Departure, beyond the brief:** a one-line comment above `platformConstraints` records the stacks a firewall has met (`// House: this firewall has been given the web-only bans of these stacks: angular`). Without it, a ban a project deliberately removed would return on every upgrade, which reshapes project state. It is also what makes "a rung is still owed when a stack's own list changes" true: a met stack is never read again.

- Costs: an Angular firewall gains that one comment line on its next upgrade (a stack with an empty list writes nothing). A firewall from before the record cannot say what it removed, so a removed ban returns once, reported, and stays removed after that.
- The rung rule still holds: the table test is untouched and passes, and a new case goes red if an adapter's `webOnlyImports` moves.

## F14: image codename

- **Installer:** it already refused an unknown codename by name and exited non-zero. The refusal now gives the way out: upgrade the toolkit, or use a tag on a covered release if the devcontainer names its own image.
- **Tripwire:** `tools/postgres-debs/image-codenames.mjs`, wired into `upstream-tables.yml`. It reads images from `ref:` in `layers/*.ts` and majors from `node-facts.ts`. It needs no Docker: a floating tag has the same digest as the tag naming its release. Exit 1: no closure. Exit 2: could not tell.
- **Run for real against MCR today:** `base:debian`, `typescript-node:20`, `22`, `24`, `26` are on trixie; `16`, `18` on bookworm.
- **Exemption:** `typescript-node:14` is on bullseye, which has no closure. It is a printed exemption in `KNOWN_OUTSIDE`, valid for that codename only.
- Not in `publish.sh`: nothing about a publish makes an image move.

## The migrations question

| Change | Alters a shape projects have? | Answer |
|---|---|---|
| F4 | No. `deploy.yml`, `ci.json` and `ci-*` configurations are owned and re-asserted; a Firebase project's output is unchanged | nothing to migrate |
| F8 | No. The generated workflow is unchanged, and the marker's shape is unchanged | nothing to migrate |
| F7 | Adds to project state on the next upgrade, through the generator, additively, only where a capability asks | nothing to migrate; no list moved, so no rung |
| F14 | No. The installer's text changes only inside `DEB_ARCHIVES`, which no project renders yet | nothing to migrate |

## Doc changes

Done: `CLAUDE.md`, the "CI deploy" sentence, because it stated a changed fact.

Owed by the docs unit:
- `CLAUDE.md` commands table: a row for `tools/postgres-debs/image-codenames.mjs`.
- `CLAUDE.md`: the `.deb` closures sentence could name the tripwire.
- `HOUSE.md.tpl`: the CI section, if it should say a provider may need no target.

## Not verified

- `yaml` resolving in a real consumer install: `dogfood-consumer` belongs to the landing gate.
- A real GitHub run.
- The tripwire's exit 1 path end to end: its verdict logic is tested offline in `tools/test-layers`, and today's real run was green.
