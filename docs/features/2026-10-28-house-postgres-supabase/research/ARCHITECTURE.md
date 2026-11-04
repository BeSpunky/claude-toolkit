# Postgres and Supabase as house layers: proposed architecture

> 2026-11-04, amended after the spikes. Proposal, not yet confirmed, except decision 9. Nothing is implemented. Synthesis of the five files beside this one, which carry the citations and the file:line anchors. Where a claim here has no evidence behind it yet, it is listed under *Must be proven first*.

## What the research changed

| Going in (`INBOUND-HANDOFF.md`) | Now |
|---|---|
| Most Firebase iterations disappear behind a backend-held connection | **Not supported.** Browser addressing and client SDK are 15–21% of 114 iterations, and almost none of the worst incidents. Plan for the rest (`firebase-history.md`) |
| Supabase's local stack needs Docker: the biggest design question | **Outdated.** CLI 3.0.0 (2026-11-02) has an alpha native runtime. It ran here with no engine: 63 s cold, about 310 MB idle, 1.7 GB on disk (`supabase.md`) |
| Postgres comes through `os-packages` or a feature | **Cannot work.** Debian has 17 only with pgvector 0.8.0, no official feature exists, and PGDG's main index keeps about three versions, so a pin there expires (`postgres.md`) |
| One connection string | **Two:** runtime and direct. Migrations and replication need direct |
| The `postgres` server underlies `supabase` | **No.** Auth, Storage and Realtime cannot be pointed at an external server. The stack's own Postgres is the local database |
| Supabase is the easier half | **It is a Firebase-class effort:** 12 of 13 failure families recur. It lands separately, after Postgres |

## The shape

```
postgres   the CONTRACT: migrations, seed, connection, safety, targets, deploy
  └─ local server provider (a port, like stack adapters)
       ├─ native     Debian binaries + dbmate. The default.
       └─ supabase   the CLI's stack. Registered by the supabase layer.
supabase   requires postgres. Adds the provider, CLI, config.toml keys, types, secrets, functions.
```

**A provider answers one question: how does this stack get a local server?** A hosted database is not a provider; Neon, Cloud SQL, RDS or hosted Supabase are deploy targets, reached by URLs that only the deploy path sees. So the core stays free of vendor code, and adding a vendor means a deploy binding.

Layers: `postgres` requires `agent`, not `node`, since dbmate is a bare binary and the launcher uses Node built-ins only. Evidence `postgres/project.json`. `supabase` requires `postgres`, evidence `supabase/config.toml`. Its fragment function omits the Debian server when `supabase` is worn (`descriptor.ts:156` already allows a function).

## Decisions and why

**1. One server per stack, on the offset port. This overrules the Postgres research's recommendation of one shared server with a database per stack.** That research judged lifecycle the deciding factor and treated N servers as a burden. But the dev engine already handles N stacks: offsets, `ps`, stop, orphans. The shared server is what needs new machinery: a process lifetime beyond the stack, an unshifted port, cross-stack identity, an ensure verb, a name substitution, a prune hook and an ownership model (`layer-infra.md` §4.5, S1–S9). History's clearest warning is against new coordination, and `serve` has already changed shape eight times. Supabase also gives a server per stack, so one model covers both providers. Cost: about 21 MB idle and 700 ms to create. The 35 ms template clone stays available inside each stack's server for `reset` and per-test databases.

**2. Data lives under `~/.local/share`, keyed by tree and stack, for both providers (amended; was: in the tree).** In-tree data is sound on Linux, but a Windows Docker Desktop bind mount is broken by mechanism (777, root) and macOS has no evidence either way, with a bad history. The spike suggested gating on the tree's filesystem; that would be two roads, the shape Firebase's history warns about. One road instead: the persisted home, which is where `SUPABASE_HOME` goes too. Cost: the launcher sweeps, on start, data whose tree no longer exists, and reports what it dropped. On an adopted image `~/.local` is not persisted, so a rebuild loses local data and the seed world restores it; said in `HOUSE.md`.

**3. The major is a per-project declared fact, seeded once, default 18.** The reason is parity: local must match the production host, and only PGDG offers every major. Debian's 17 would avoid the installer work, but could not match an 18 host and carries a pgvector that predates the 0.8.7 security fix. Not 19: GA is planned for 2026-11-19 and no surveyed host offers it. With `supabase` worn the major is 17, from `config.toml`. Adding `supabase` to a project on 18 is refused by the preflight, since `uuidv7()` and virtual generated columns would not run there.

**4. Install by pinned package closure, projected by a tool.** Extend the `archives` mechanism to a `.deb` closure with sha256s from `apt-archive`, per Debian codename and architecture, **extracted to a versioned directory** with generated wrappers (amended; `apt-get install ./*.deb` removed `libpq-dev` here, and a configured archive repo floated `libpq5` to `19~rc1`). PGDG's six packages are pinned; Debian's libraries float by name, because superseded ones return 404. Projected and checked weekly like `firebase-compat`, plus a weekly check that each pin still downloads. It keeps the decision that retired apt repositories (`descriptor.ts:252-258`). Any unpinned package floats onto a prerelease: `libpq5` resolved to `19~rc1`. This is the one new installer path, and it is forced, so it gets the first spike.

**5. Migrations: one folder, one runner per provider.** Forward-only `<14 digits>_<name>.sql` with an empty `-- migrate:down`. A non-empty down is run as part of the migration by the Supabase CLI, and it reported no error.
- Native: `postgres/migrations`, run by dbmate 2.37.0 (MIT, bare binary, lock held under four parallel runs). `rollback` is not exposed.
- Supabase: `supabase/migrations`, a path the CLI hard-codes, run by the CLI.
- Adding `supabase` moves the folder with `git mv`, so there are never two. A hosted database already tracked by dbmate needs the Supabase ledger seeded, or `db push` re-applies everything: reported, a human step.

**6. Project surface: one launcher, the same targets on both providers.** `postgres:start | migrate | new-migration | seed | reset | psql | deploy`, through one owned launch script, not 644 lines of bash with inline programs like `emulators.sh`. Per-class ownership:
- A: launcher and tooling.
- B: `postgres/project.json` targets the project added, by three-way merge.
- C: migrations and `seed/world`.
- `config.toml`: only a few keys owned; no comment-preserving TOML merger exists, so those edits must be line-level and tested.

**7. Safety is identity, not host strings.** This is the part that does not transfer from Firebase: `demo-` works because Google refuses that id, and a connection string has no such property.
- Local verbs take no URL. They compute it from the stack.
- Destructive verbs compare `system_identifier` with the value recorded when this stack's server was created. Multi-host URLs, `PGHOST` and tunnels get past string checks.
- Only the declared `deploy` target may reach a remote URL, from CI or an explicit human environment, never a file.
- The launcher validates URLs itself: an empty port silently became 5432, and `db reset --remote --yes` wiped a table.
- dbmate and goose auto-load `.env`, and `SUPABASE_*` in a project `.env` overrides config. The launcher shuts both doors.

**6a. What the native launcher must do (from the lifecycle spike).** Stay the parent of `postgres`, never `exec` it: with `exec`, `dev stop` hung on smart shutdown with a client open (61 s observed). On any stop, send the server SIGTERM (smart shutdown, which waits for clients, so a backend can still write while it stops) with a bound, then SIGINT (amended by the review: the engine signals a dependency and its dependents together, and this works on every stop road). Key data by `${APP}@${OFFSET}`. `dynamic_shared_memory_type=mmap`. `initdb` to a sibling, then rename. Socket in `DEV_STACK_TMP`. Ready only after identity, migrate and seed. Run dbmate with a generated empty `--env-file`, a full-host `--url`, explicit `-d` and scrubbed `PG*`/`DBMATE_*`: `--url` alone does not shut out `.env`. Pass fd 3 to the server: without it, a launcher killed outright leaves a server that holds the port and that neither `dev ps` nor `dev stop` can see (`spike-lifecycle.md`, requirement 2; reproduced in the Landing 1 review).

**6b. What the Supabase launcher must do (from the concurrency spike).** No limit on the number of stacks. Hold a per-stack lock around `stop` and `db reset`, and let a reset finish: interrupting one can wedge the stack, or leave it reporting healthy with no migrations. After every `start`, check on a new connection that the ledger exists, and reset if not. Only the launcher calls `start`, and it compares reported ports with requested ones. Pin with `SUPABASE_*_PORT`, not `env()`. Keep offset blocks out of 20000–32767. Never `--eager`. Never treat `status` as database health. Never sweep `/dev/shm/PostgreSQL.*`. The stack daemonises with no foreground mode, so a foreground keeper holds the dev engine's lock, polls the owner, and stops the stack on a signal. **Accepted gap:** `kill -9` of the keeper leaves the stack running and invisible to `dev ps`; the next `start` adopts it. Stacks share identical keys, so the URL is the whole isolation: local only, never a security boundary.

**8. No hosted write access for agents by default.** The official Supabase plugin bundles an MCP connection, so the layer points at the local `MCP_URL`, or a project ref with `read_only=true`.

**9. Supabase runs on the native runtime. Confirmed by the user.** Pinned exactly, guarded by the tripwire (`research/spike-native-tripwire.mjs`, 43 s from nothing).

## Seams to build first (neutral, land before either layer)

| Seam | Today | Change |
|---|---|---|
| **Dependency process** | All processes spawn at once, a one-shot exit stops the stack, readiness is HTTP and primary-only, exports never reach siblings (D1–D4) | A process may declare itself a stack dependency: it starts first, must pass a `tcp` or `cmd` readiness, and its exports reach every sibling. The launcher does create, migrate and seed before it reports ready, so no one-shot concept. This is how `DATABASE_URL` reaches a backend without editing the project's process |
| **Dev engine gate** | `dev/generator.ts:68` names Firebase | A descriptor field; any capability can ask for `tools/dev` |
| **Browser firewall** | Inserted only by `firebase-emulators/generator.ts:435` | `ensurePlatformFirewall`, called by any capability, so `pg` stays out of browser bundles |
| **Script claim** | Inline in `emulators.sh` | `tools/dev/dev run` |
| **Deploy contract** | Inside the Firebase generator | `_utils/deploy-contract.ts` |
| **CI** | `ci/generator.ts:209-216` silently stops a line's deploys when a new provider is unbound; `:314` knows only `firebase deploy`; no secrets slot; `workflow.ts:197` always sets `id-token` | Refuse loudly, generalise foreign-pipeline detection, add secrets, id-token per provider. **Schema before code** needs explicit `dependsOn`: `parallelism:false` does not order |
| **Per-app steps** | `cli.ts:142` skips server apps; `fragments/index.ts:7-9` | Let a capability attach to a server app |
| **Installer** | Refuses `=`, tarballs only | The `.deb` closure of decision 4 |

## Sequence

1. **Spikes that can kill the design** (below).
2. **Neutral seams**, Firebase-only behaviour unchanged. Migration question answered explicitly.
3. **`postgres`** with the native provider: release, dogfood, rebuild.
4. **`supabase`**: its own landing. Tripwire on the alpha: start, migrate, diff, reset, status JSON. Parse JSON output in one place only.

Deliberately not first: a supabase-js client port, cloud setup automation, mixed local and hosted modes (the most expensive feature in Firebase's history; the handoff's "serve against plain Postgres until Supabase-only services are used" is that feature), and Firebase moving onto the new seams beyond what they need.

**Separate efforts:** the server-app stack adapter and the `tauri` and sync layers. The consumer needs the adapter too: no `nx serve <backend>` path exists yet, and a hand-written `dev.json` makes a project wear `web`. The dependency process above is what that adapter will attach to; dogfood proves it with a fixture backend process. `wal_level=logical` stays on for the sync layer (about +24% WAL, finite `max_slot_wal_keep_size`).

## What the spikes proved

| Question | Result |
|---|---|
| Pinned package closure | **Works unprivileged**, on 4 codename and major combinations. 190 packages passed sha256; nothing floats on the PGDG side |
| Postgres under the real dev engine | **Holds:** 52 stop scenarios, rows intact; `dev ps` and `dev stop` clear every orphan with no engine change. 19 MB idle per server, about 900 ms cold, 70 ms warm. The shared server was never run, so that comparison stays reasoned |
| Dependency process seam | Prototype +41/-5 lines, stop matrix re-passed. Its first version wrongly started siblings after a dependency failed: the real seam needs that test |
| Parallel native Supabase | **Safe as the default:** 0 isolation violations in 18 minutes: 217 resets, 14,621 writes, 915 sign-ups, 910 uploads. Four stacks: about 600 MB idle, 2.3 GB peak, 1.7 GB shared artifacts |

## Still unproven

**Needs a rebuild:** root extraction and `apt-get satisfy` in a real image, running as the remote user, a real bookworm container, `SUPABASE_HOME` and Postgres data on the real volume. **Needs a non-Linux host or arm64:** Docker Desktop, arm64 execution. **Needs a real account:** link, push, deploy, secrets. **Not exercised:** a real `nx serve` runner, Supabase uptime past 18 minutes, Realtime, Functions and Studio under load, walsenders, a major bump.

## Also found

- `CLAUDE.md:61` still describes the apt `repository` road, and the code has `archives`. Fix in this effort. The layer list also omits `ci`, and "only through ports" is untrue of the dev loop.
- `firebase:reset` appears to reset the wrong directory in a worktree (read, not reproduced). Separate fix, to check.
- `agent.ts:73` uses a version-less `github-cli` feature, against the stated rule.
- Coverage to do better than: `dogfood-consumer` never boots the suite; 51 of 114 Firebase iterations reached a human first and one was found by a test.

---

## Note, 2026-11-04: evidence is a tag (amends *The shape*)

*The shape* above says evidence is `postgres/project.json`. The Landing 2 review reproduced that misreading both ways: a library named `postgres` took the verbs while the layer read as absent, and a project of the repo's own at `postgres/` made a plain upgrade start wearing the layer. Decided at the review's list (D3): evidence is the tag `type:postgres`, as `design-system` does; the project is resolved by that tag, and something else holding the name or the folder is refused with the way out. The text above stands as what was proposed.

---

## Note, 2026-11-04: what the real CLI changed, building `supabase` (amends 6b and 7)

Found running the pinned CLI 3.0.0 under the real dev engine (`tools/test-supabase/run.mjs`). The text above stands as what was proposed.

- **Offset blocks stay out of 10000-32767, not 20000-32767.** The native runtime also refuses a public port in 10000-19999: `Public port 15432 … is inside 10000-19999, which is reserved for native service backends`. The spike's block was 41000, so it never met this. Blocks therefore mostly sit above 32767, in Linux's ephemeral range; `auto` probes every port and a clash is loud. Accepted by the orchestrator.
- **Identity on Supabase is `data_directory`, not `system_identifier`.** Every `db reset` changes the identifier, a hand's reset included, so a recorded value would refuse a healthy stack. A verb checks that the CLI answers on this stack's port, and that the server keeps its data inside this stack's directory.
- **"After every start, check the ledger; reset if absent" is narrowed.** A project with no migrations has no ledger at all, and one writing its first migration has rows to keep, so read literally the rule resets every start. A stack is rebuilt only with migrations present, no ledger AND no table in `public`, which is what an interrupted reset leaves.
