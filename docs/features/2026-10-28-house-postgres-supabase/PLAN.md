# Plan: Postgres and Supabase as house layers

The design and its reasoning are in `research/ARCHITECTURE.md`, confirmed by the user 2026-11-04. This file is the order of work. Three landings, each on the user's signal.

## Landing 1: neutral seams (no new layer; Firebase behaviour unchanged)

| Unit | Scope | Done when |
|---|---|---|
| `seam-engine` | Dependency process: starts first, `tcp`/`cmd` readiness, exports reach siblings, a failed dependency starts nothing. Dev step no longer names Firebase (`dev/generator.ts:68`). `fragments/index.ts` allows a capability with no served app. `dev claim --label` replaces `dev.mjs:798`. Script claim extracted to `dev run`, and `emulators.sh` uses it, so one copy | `tools/test-scaffold` and `test-generators` pass with new cases, including dependency failure and two dependencies |
| `seam-platform` | `StackAdapter.webOnlyImports` replaces `platform/index.ts:37`. A neutral firewall step, used by Firebase. DB drivers in `externals.ts`. `_utils/deploy-contract.ts` extracted from the Firebase generator | Firebase's generated output is byte-identical apart from generated comment wording that named Firebase |
| `seam-ci` | `CiDeployProvider` gains `targetLabel`, `deploySignals`, `deployEnv`, OIDC need. An unbound new provider is refused loudly, never a silent unwired line. Schema-before-code ordering via `dependsOn` | A Firebase project's workflow is unchanged; a fake second provider exercises every field |
| `seam-installer` | `archives` extended: `.deb` closure by codename and arch, sha256, versioned directory, wrappers, `systemDepends`, `prune`. `tools/postgres-debs/project.mjs [--write]`, weekly and pre-publish, plus a pin-still-downloads check. No layer uses it yet except a test fragment | `tools/test-layers` persistence and projection cases; the generated script runs unprivileged against a fixture root |
| docs | `CLAUDE.md:61` and the layer list; `agent.ts:73` version-less feature; `firebase:reset` wrong directory, reproduced first | |

Not in Landing 1, deliberately: `cli.ts:142` per-app platforms. `postgres` has no per-app step, because `DATABASE_URL` arrives through the dependency process. It belongs to the server-app adapter effort, its first consumer. This narrows *Seams to build first* in `ARCHITECTURE.md`.

**Migrations question, to answer per unit:** expected "nothing to migrate" (owned artifacts regenerate; internal seams), stated in the release commit only after checking.

**Gate:** sweep; `house.sh upgrade --local .` in a worktree with the whole diff read; `tools/dogfood-consumer`. Sanity review before landing.

## Landing 2: `postgres`

Descriptor, generator, launcher (`ARCHITECTURE.md` 6, 6a, 7), `.bespunky` major declaration, pins, `new` skill, README, tips, house-doc sections, `tools/test-*` cases, a real-binary tripwire, a real boot in `dogfood-consumer`, CI provider. **Needs a user rebuild before release.**

**Owed by this landing, from the Landing 1 review** (`reviews/2026-11-04-landing1-sanity-review.md`):
- Provider shape (F4): target optional; a layer can declare it supersedes a required layer's provider; a line can name only some providers. Reproduced: two providers on one `postgres:deploy` leave `ci-production` with the last one's args.
- A `dev run` stack has no address (E6): `dev run --export=` matched by app, or the launcher owns it. Decide before the launcher.
- Closures key on codename while `base:debian` and `typescript-node:<major>` float (F14): tags naming the codename plus a migration, or a tripwire.
- An existing firewall never gains a later stack's `webOnlyImports` (F7). An unrelated workflow with a deploy signal in an `echo` deletes the owned `deploy.yml` (F8, pre-existing; new signals raise the odds). A bare-directory `watches` is silent (F5).
- "stopped cleanly" printed over a dependent's failed shutdown (E1). Launcher stop policy is in `ARCHITECTURE.md` 6a; it is untested.

## Landing 3: `supabase`

Descriptor, provider, launcher and keeper (6b), `config.toml` keys, CLI pin and `supabase.lock`, tripwire from `research/spike-native-tripwire.mjs`, folder move on `add-layer`, major-mismatch preflight, CI provider, persistence. **Needs a user rebuild and a real hosted project before release.**

## Separate efforts

Server-app stack adapter (the consumer needs it next), `tauri`, sync layer.
