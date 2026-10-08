# DF1 — `house.sh upgrade --local .` on this repo (the release gate's self-dogfood)

Worktree `hfh-df1`, branch `chore/hfh-dogfood-self` (= `feat/house-firebase-handoff` at `fe20945`). Written as it
happened, 2026-10-07. Nothing pushed, published or bumped; no toolkit source touched.

**Verdict: PASS.** Two cosmetic template defects and one stale comment are listed under *Findings*. Nothing blocks
the release. This repo wears `nx,agent,node` and **no firebase layer**, so its rebuild cannot observe the firebase
image changes (gcloud apt repo, firebase-tools on PATH). DF2 (the Firebase fixture) has to.

## The run

- `yarn install` succeeded, then `house.sh upgrade --local .`, which refused: *"refusing to upgrade without consent —
  nothing is attached to this shell to ask"*. I re-ran it with `--yes`, on the authority of CLAUDE.md's dogfood gate
  (it prescribes this exact run in a worktree) and the user's standing "Claude does the verification" instruction.
  The orchestrator's message was not treated as consent.
- The probe reported `house tooling 0.49.0 -> 0.50.0`. **16 migrations were collected** from the working tree. All
  ran, and **2 produced changes**: `declare-node-version` and `deploys-object-form`. The other 14 reported
  "No changes were made", which is correct here because there is no Firebase, Angular, design system or apps.
- Generators that ran: gitignore, devcontainer (adopted, `added: nothing`), claude-settings, window-identity, and
  house-doc last. Final lines: `UPGRADE_OK`, `UPGRADE_NEXT: rebuild-container`, `UPGRADE_RELOAD: HOUSE.md HOUSE.rules.md`.

## Every file the upgrade touched (vs `fe20945`)

| File | Change | Verdict |
| --- | --- | --- |
| `.bespunky/branches.json` | `stages[0].deploys` changed from a string to `{ "note": <same text> }`. Every other byte is kept and the **projection is byte-identical** (checked with JSON compare) | intended (W9) |
| `.nvmrc` | **created**, `22`. The log says it came from `house.Dockerfile FROM typescript-node:22`, which matches the running container (`node v22.23.2`) | intended (W1) |
| `.devcontainer/house.packages.sh` | adds an empty `HOUSE_REPOSITORIES` block, `name=version` pin validation, the `present()` version-aware check and the `repositories()` keyring installer | intended (W1 follow-up 2). The empty block renders as `'\n\n'`, which is cosmetic |
| `HOUSE.md` | stamp `nx-tools=0.50.0 plugin=0.47.2`; the `.nvmrc` sentence; the rewritten *Deploy bindings* paragraph (note / `ci` / `appHosting`); *Moving Nx is this project's job* (W7); *House targets are yours to extend* (W5) | intended, with 2 cosmetic findings below. `plugin=0.47.2` is correct because the plugin bump is still owed |
| `HOUSE.rules.md` | *Local servers*: teardown by handle, never by name, and confirm the ports are free | intended (W3) |
| `package.json` | `@bespunky/nx-tools` `0.49.0` → `0.50.0` | intended |
| `yarn.lock` | the `@bespunky/nx-tools@0.49.0` entry is **removed** and nothing replaces it, because `--local` installs a tarball that no registry resolves. house.sh warns about this ("Do not commit the lockfile from this run") | expected for `--local` |
| `CLAUDE.md` pointer block | **unchanged**, as it should be: `CLAUDE.md` pointer template has no diff in this release | intended |
| `.bespunky/house-targets.json` | **not created** | correct. Only `firebase-emulators`, `shared-browser` and `worktree-domains` create house projects, and this repo has none |
| `house.Dockerfile`, `devcontainer.json`, `devcontainer-lock.json`, `post-create.sh`, `.bespunky-devcontainer.json` | unchanged | intended (no features retired here) |
| Deleted | **nothing** | — |

Commits on the branch: `58f7644` (Nx checkpoint), `903ef67` (`.nvmrc`), `7de0de5` (`branches.json`), and `ddcca3e`
(the generator output, committed by me for review only).

## `branches.mjs` on the migrated model

- In this worktree, `verify` and `describe` **refuse (exit 1)**. That is correct: the copy in force is the one on
  `development`, which still has the string. W9 predicted it, and it clears when this lands.
- The tree's own copy passes: `validate .bespunky/branches.json` says **valid**, and `verify --proposed` reports
  **no violations**.
- I also cloned into the scratchpad and set `development` to the migrated commit, so the migrated copy was the one in
  force. There, `describe` **exits 0** and lists the note under `main`, and `verify` reports *projection fresh: ok*.
  Its one violation, "direct commits on development", comes from the simulation itself, which put `development` on
  the feature tip without a merge.

## Idempotency

A second `house.sh upgrade --local --yes .` gave `house tooling already at 0.50.0 — no migrations to run` and
`UPGRADE_NEXT: none`, and the diff was **empty** (clean tree). This run proves the generators are idempotent. The
migrations' idempotence is covered by the test-migrations harness.

## Sweep (the identifiers this change retired)

| Identifier | Hits outside `docs/` and frozen migrations or their fixtures | Verdict |
| --- | --- | --- |
| `proxied` | `worktree-domains/proxy.mjs.tpl:8`, `worktree-domains.tpl:379`, `generators.json:77` | legitimate: they mean "reverse-proxied", not the retired switch |
| `nodeMajor` | `_utils/node-version.ts`, `devcontainer/compose.ts` + `generator.ts`, `layers/{agent,node,descriptor}.ts`, `tools/test-layers` | legitimate: the internal `{{nodeMajor}}` token, now fed from `.nvmrc`. The schema option is gone (`devcontainer/schema.json` has no hit) |
| `nodeMajor` | `tools/test-scaffold/render.test.sh:106` | **stale comment**: it quotes a `--nodeMajor=22` invocation, the flag no longer exists, and it illustrates the 0.29.0 duplicate-flag bug. Historical, so harmless, but worth rewording |
| `--node-major` | none (docs only) | clean |
| `features/firebase-cli`, `jajera` | `migrations.json` + the 0.50.0 rungs + their fixtures | legitimate (frozen) |
| `--environment staging` | 0.50.0 `correct-app-hosting-guidance` + its fixture/stock template; `skills/firebase-app-hosting/SKILL.md` | legitimate: the skill states that the flag never existed |
| `resolvePortOffset` | `dev/files/dev.mjs.tpl`, `dev/files/lib/ports.mjs.tpl`, `test-scaffold/dev-engine.checks.mjs` | legitimate: the dev engine's own resolver. There are **no hits in browser/client code** |
| `portOffset=` | `_utils/inline-house-sections.ts:165` | legitimate: frozen matching text for the pre-0.5 inline sections it retires. The rest are frozen rungs (0.25.0, 0.35.0, 0.50.0), fixtures, and `docs/shared-browser-DESIGN.md` (a dated record) |

## Findings (none blocking; reported, not fixed)

1. **`HOUSE.md.tpl:14`, a grammar error without the firebase layer.** The sentence renders as "the devcontainer's
   image tag **follow** it". The verb is plural because the singular subject only becomes compound in the
   `{{#firebase}}` branch ("…and Cloud Functions' `engines.node`").
2. **`HOUSE.md.tpl:473`, the *House targets are yours to extend* bullet, is not gated.** It renders in projects with
   no house project at all, like this one. There it points at `.bespunky/house-targets.json`, which this project
   will never have, and at "the house tooling" projects, which only `web` and `firebase` bring.
3. **`tools/test-scaffold/render.test.sh:106`**: the stale `--nodeMajor=22` comment (see the sweep table).
4. **A `--local` side effect that predates this release.** Nx's checkpoint commit (`58f7644`) commits `package.json` as
   `file:/tmp/tmp.…/bespunky-nx-tools-0.50.0.tgz`, along with the matching `yarn.lock` entry. house.sh restores
   `0.50.0` afterwards but leaves that uncommitted. The same message is on `development`'s house.sh, so this is not
   a regression. It only matters if a `--local` branch were ever landed.

## Container rebuild from this branch: what changes, what to observe

Docker is not available here, so a human has to do the rebuild. What a rebuild of **this repo** changes:

- **Image**: still `FROM mcr.microsoft.com/devcontainers/typescript-node:22`, so **Node stays on major 22**
  (`.nvmrc` = 22).
- **Package layer**: `house.packages.sh` changed, and house.Dockerfile `COPY`s it, so that layer's cache is busted and
  the same packages reinstall once: tmux, curl, pulseaudio-utils, espeak-ng, plus `os-packages.txt`. No repository
  is added, because `HOUSE_REPOSITORIES` is empty here.
- **Features**: unchanged (`github-cli`, `./features/bespunky-house-setup`, and the voice bits from post-create).
  **PATH**: unchanged (no containerEnv change).
- **This container's gcloud disappears.** `/usr/bin/gcloud` 588.0.0-0 and `/etc/apt/sources.list.d/google-cloud-sdk.list`
  exist today only because W1 ran the installer here by hand. This repo has no firebase layer, so after a rebuild
  they are expected to be gone.

Observe after the rebuild:

- `which -a node`: only the image's node.
- `node -v`: `v22.x`.
- `cat .nvmrc`: `22`.
- `which -a firebase gcloud`: **expected empty** in this repo.
- `ls /etc/apt/sources.list.d/`: no `google-cloud-sdk.list`.
- `ls ~/.config/gcloud ~/.config/configstore`: both still there, since `~/.config` is a persisted volume. Then
  `gh auth status` and `claude` should both still be logged in.
- The post-create log shows `[os-packages] all present — nothing to install`.
- `tmux -V` and `espeak-ng --version` both work.

**The firebase half still needs observing:** the gcloud apt repo + pin installed by root during the IMAGE build, and
`which -a firebase` resolving to `node_modules/.bin`. This repo's rebuild cannot show either. DF2's Firebase fixture
project has to be rebuilt for that.
