# Firebase layer history: what it actually teaches `postgres` and `supabase`

Unit `history-firebase` of the fan-out ledger `../handoffs/2026-11-04T0535Z-fanout.md`. Research only. Tests `../INBOUND-HANDOFF.md` §4.

**Method.** Read: every commit whose message matches firebase/emulator (223 non-doc, 341 with docs and releases; the ~110 that are real break-and-fix events are below), the Firebase effort's `BRIEF`, `PLAN`, `DECISION`, ledgers, `analysis/`, `review/` headings and `impl/` for the fixes cited, and the adjacent packages named at each row. Not read in full: all of `verification/V1-9`, `review/R1,R5,R6,R8,R9` bodies (ledger summaries used), `stack-agnostic/research/*`. Statements about Postgres and Supabase behaviour are **my general knowledge, not observed here**; `postgres.md` and `supabase.md` own that verification. They are tagged *(unverified)*.

An "iteration" below is one distinct break-and-fix or redesign event, not one commit: a fix and its test are one row, and one review item spread over two commits is one row.
Found-by for May-June rows is inferred from the commit messages, which describe real-run symptoms on the user's projects (love-coupons, kosher-travel-planner) rather than naming who saw them.

Found-by codes: **U** the user using or rebuilding · **C** a consumer project's report · **D** a dogfood run · **R** adversarial review · **T** a test, tripwire or publish check · **S** the author, while building.

## 1. Chronology, by root-cause family

### BR — the browser addresses a local service by port (the handoff's root cause)
| # | When / version | sha | What broke | Found | Root cause | Fix |
|---|---|---|---|---|---|---|
| 1 | 05-31 | `3d95313c` | Two open devcontainers fought over the same host ports | U | Identical `forwardPorts` | Dropped `forwardPorts` |
| 2 | 06-10 | `0d09453f` | Host browser `ERR_CONNECTION_REFUSED` | C our-journey | Auto-forward remaps a port the browser SDK cannot discover | **Reversed #1**: explicit same-number forwards |
| 3 | 07-13 0.7.0 | `eddc392b` | A worktree's callables reached another tree's emulator; squatted `:5001` | C crushit | Hardcoded port | `proxy.conf.mjs` relays Functions through the app origin |
| 4 | 07-13 0.8.0 | `83125462` | Squatted `:9099`: blank app and hanging sign-in | S | Same class, Auth | Auth joins the relay. Firestore explicitly deferred |
| 5 | 10-07 0.50.0 | `a5569121` | Host shifted ports by +1; Firestore and Storage missed the emulators | C shir-halili A3 | Those two still dialed directly; `requireLocalPort` cannot make a mismatch fail (V) | Everything through one origin; `proxied` and `?portOffset=` retired |
| 6 | 10-07 | handoff 2, `88f71fbc` | Sign-in popup to `localhost:9099`, blank and hung, at offset 12000 | C our-journey | Offset lived only in the URL; a 0.24.3 guard left `proxied?` undeclared | Dissolved by #5; guard fixed |
| 7 | 10-07 | `c89d81d7` `4a55825c` | An app with its own `proxyConfig` never loaded the relay; prefix routes shadowed app routes; SSR had no emulate decision | R R4-1..4 | Relay assumed sole ownership of the proxy | Exported routes, seeded `proxy.local.mjs`, segment-anchored keys |
| 8 | 10-07 | `05af2303` | A dev server that does not relay was silent | R FD | Wiring outcome unreported | Upgrade attention list |
| 9 | 10-07 | `ac0bab29` | Admin export leaked through the hub relay and crashed the suite; bare Vite ignored the seam | R S3-10,15,21 | Relay broader than needed | Exact hub relay, validated seam keys |
| 10 | 10-07 | `32d2b457` | Emulator UI's page dials every port itself | S W4 | Upstream UI | Forward only for the UI, none without it; banner says where it works |

### CL — client SDK and config living in application code
| # | When / version | sha | What broke | Found | Root cause | Fix |
|---|---|---|---|---|---|---|
| 11 | 05-29 | `2dde3bd8` `c14c3c5f` | Provider wiring produced a sparse array | S | Regex edit of `app.config.ts` | TS compiler API |
| 12 | 05-31 | `61069998` | `ngDevMode` + two consts judged poor | S | Config inside logic | Angular env files |
| 13 | 05-31 | `5d619831` | Four `localhost:<port>` literals in the prod bundle (grepped) | S | Dead-code elimination removes paths, not property values | `emulators?:`, omitted from prod |
| 14 | 06-25 | `703ca419` | `environment.production` not reliably inlined; resolver in prod bundle | S | Builder behaviour | **Reversed #12's gate** back to `ngDevMode`; per-service `EMULATE` and `emulator-overrides.ts` added |
| 15 | 06-26 | `8d5498b0` | Real service with demo config: cryptic `auth/api-key-not-valid` | S | Mixed mode | Throwing dev guard |
| 16 | 07-03 | `10538bad` | That guard white-screened the whole dev app | S | Guard threw in bootstrap | Log instead |
| 17 | 07-03 | `340b44fe` | Mixed mode: a still-emulated Firestore silently went offline | C crushit | `singleProjectMode` plus a hardcoded suite id | Derive id from `environment.ts` with a regex (see #59) |
| 18 | 07-12 0.6.0 | `46d64364` | Staging built prod; needed named Firestore DB | S | Config had no environment concept | `databaseId`, opt-in staging bundle |
| 19 | 07-29 0.24.2-3 | `5607eb3a` | Legacy env shapes | S | Client config shape moved repeatedly | Migrations |
| 20 | 08-10 0.33.0 | `37778d50` | 479 kB initial bundle whether services used or not | C | One file statically imported all services | One file per service |
| 21 | 08-10 0.33.1 | `664b7801` | Scaffolded apps never initialised Firebase at all | S built a throwaway | `app` generator omitted `wireProviders`; only the sync path passed it | Fixed, plus rung after review rejected "no migration owed" |
| 22 | 08-10 | `1ac9b196` | 0.33.0 rung: walked into `.claude/worktrees`, matched by identifier name, wrote imports of private symbols | R four reviews | Rung tested only on the author's shapes | Reworked; led to `tools/test-migrations` |
| 23 | 10-05 0.44.0 | `3daaad3f` | Apostrophe in a template: every Firebase app stopped compiling, and upgrade re-wrote it | C | Fixtures read output as text | Harness parses every written file |
| 24 | 11-02 | `2026-11-02-firebase-bundle-numbers` | Three published weight claims disproved by measuring | S | Upstream estimates quoted | Figures measured, each names its stack |

### LC — process lifecycle: who starts, supervises and stops the service
| # | When / version | sha | What broke | Found | Root cause | Fix |
|---|---|---|---|---|---|---|
| 25 | 05-31 | `498f5b08` | Firestore JVM orphaned holding 8080 | U | Signal chain yarn→nx→firebase→java unreliable | Shape 2: `emulators:exec` wrapper |
| 26 | 06-02 | `e76c12a6` | Next `nx serve` hung on "Waiting for <app>:serve in another nx process" | U | Nesting detached the tree, kept the Nx task lock | Shape 3: Nx continuous `dependsOn` |
| 27 | 06-03 | `2c421f9f` | Port in use after terminal close, OOM or SIGKILL | U | "No in-process trap can cover SIGKILL or a container restart" | `reap-emulators.sh` on start |
| 28 | 06-10 | `0d09453f` | Startup port and instance failures | C our-journey | Single-pass reap; `dependsOn` shape | Two-pass reaper; shape 4: parallel orchestrator, "self-heal is INVERTED from 0.5.x" |
| 29 | 06-25 | `b65399d1` | A target named `serve-no-emulators` could serve emulators | S | One target, two jobs | Shape 5: three targets |
| 30 | 07-10 0.3.0 | `60bd79f5` | Serve shapes multiplied | S | Composition in target config | Shape 6: one composing executor |
| 31 | 07-31 0.26 | `070e0f9f` | A second `nx serve` by Claude SIGKILLed the running suite; data gone | U consumer | Reaper equated "this project's" with "stale" | Kill only reparented-to-PID-1 |
| 32 | 07-31 | `7ff23001` | Second stack refused rather than coexisted | S | `auto` returned 0 for main tree | Base ports by preference, shift when busy |
| 33 | 10-01 0.35 | `f6a8b81b` | Lifecycle welded to Angular executor | S stack-agnostic | Wrong home | Shape 7: `dev.json` + stack-free engine |
| 34 | 10-07 | `c141ff85` `57944712` | `dev stop` and Ctrl+C left no export or an empty dir | D DF2 B2 | **Nx signals leaves first; the JVM exits 143, firebase-tools treats that as fatal** | Detached keeper that alone signals firebase-tools |
| 35 | 10-07 | `03b013b8` `75158b8d` | Clean stop exited 130; attached run reported failure; stop line lost under `>` | D DF2b NB1-3 | Follower design | Patched, then superseded by #36 |
| 36 | 10-07 | `8e18275d` | Stale exit records, per-app identity, `/proc` postscript | R R3 | Follower was patch-on-patch | Shape 8: `serve` is the engine, non-continuous. Retired preflight, follower, exit records |
| 37 | 10-07 | `882b231c` | Hung export wedged a stack forever | R R3-3 | No deadline | Keeper deadline, `dev stop --abandon`, reaper retired |
| 38 | 10-07 | `e75b6310` | ~9% of stops judged a live export dead; could SIGKILL it | R S1, a "flaky test" that was a product race | `$BASHPID` in a subshell | Keeper records itself |

### SI — stack identity: process-global state keyed by something stacks share
| # | When / version | sha | What broke | Found | Root cause | Fix |
|---|---|---|---|---|---|---|
| 39 | 07-09 | `4041924b` `ec7abcb2` | Worktrees and agents collided with the developer's server | U | No concept of a stack | `serve-worktree`, `--portOffset` |
| 40 | 10-07 | `239e6e79` | Worktree exported through main's hub: **both stop orders lose or swap data** (reproduced) | C D1, V | firebase-tools keys its hub by project id in `os.tmpdir()` | Private TMPDIR per stack |
| 41 | 10-07 | `7b6ad239` | Second `dev-server` waited on the first, then reported success having run nothing | C D2, V | Nx shares a continuous task by id; id lacks the offset | Leaf non-continuous; see #36 |
| 42 | 10-07 | `882b231c` | Per-stack TMPDIR overflowed the 107-byte socket path; Functions workers answered each other | R R3-2 run | Unix socket length limit in deep worktrees | Short hashed `/tmp/bespunky-<hash>` |
| 43 | 10-07 | `7b6ad239` `882b231c` | Concurrent serves lost handles; direct runs had no identity | R R3-1, D4 | Several claim paths | One claim through `tools/dev/dev` |
| 44 | 10-07 | `943e4686` | Two stacks both took a dead lock, same ports (2/20 rounds) | R S3-1 run | Hand-built lock, "a distributed lock manager" (S3) | Kernel `flock` |
| 45 | 10-07 | `184c4a95` | e2e on an `auto` offset could not find its stack | R S3-5 | No address contract | `tools/dev/dev with` exports the URL |
| 46 | 10-07 | `f7de07ab` | Firestore websocket did not shift | D D9 | Nested port outside the port table | Nested ports in the one table |

### DU — local data durability and seeding
| # | When / version | sha | What broke | Found | Root cause | Fix |
|---|---|---|---|---|---|---|
| 47 | 06-10 | `0d09453f` | Emulators started empty each run | C our-journey | No data model | `.emulator-data`, export on clean exit, declarative `world.mjs` |
| 48 | 07-31 | `28e8b6a5` | New worktree began from an empty world | U | Seeds gitignored | "Seeds shared, data isolated": cascade from main, primed by copy |
| 49 | 10-07 | `2a43abd9` `d3a5ce0e` | Seed banner empty; applier sat in user-owned `world.mjs`, so fixes never reached anyone | C D4, R R2-7 | Logic inside a seeded file | Owned `apply.mjs`, token-compared migration |
| 50 | 10-07 | `30a81488` | Interrupted export left data in repo root for `git add -A` | R | firebase-tools staging dir in cwd | Gitignored |

### PR — nothing local reaches production
| # | When / version | sha | What broke | Found | Root cause | Fix |
|---|---|---|---|---|---|---|
| 51 | 05-29 | `aee834b2` | Generator invented `.firebaserc` and a production config | S | Fabricated cloud state | Never fabricate. `firebase use --add` is the human's |
| 52 | 07-05 | `c95d8517` | **The design that caused #53**: one `.secret.local`, "two sinks"; "local and prod can never drift" | later | Real credentials as the emulator's default input | See #53 |
| 53 | 10-07 | `7dedc328` | **Functions emulator sent REAL Telegram messages**; worktrees borrowed main's secrets | C A2 | #52 plus a borrow cascade; a missing secret fetched the real one from Secret Manager | Inert placeholders, sandbox opt-in, Secret Manager sink, no borrowing |
| 54 | 10-07 | `8d4a6c3f` | Sandbox refusal bypassed by an inline comment; one bad key voided every placeholder | R R2-1,2 run | Hand-parsed dotenv | Port firebase's parser, round-trip check |
| 55 | 10-07 | `8d4a6c3f` | Live login passed through under a real id: Admin SDK reaches production | R R2-3 | Guarantee covered secrets only | Structural: `demo-` twin id by default |
| 56 | 10-07 | `2a43abd9` | `seed-world` fell back to `localhost:8080`, ran against any suite | C A2, U2 | Fallback | Refuses without hosts. R2-8 later: checks presence, not target |
| 57 | 10-07 | `2b637aba` | Tripwire checked a getter, not where it dials; the sink is undocumented | R R2-4, S3-11 | Upstream captures origin at module load | Real emulator through a recording proxy |
| 58 | 10-07 | `476b7b81` `a4d31ce8` | `push-secrets`: `p@ss#w0rd` pushed `p@ss` to production, exit 0 | R S3-4 run | Dotenv semantics applied to raw prod values | Refuse any value whose parsed form differs |
| 59 | 10-07 | `f5e86e64` | A comment inside `EMULATE` moved the suite to the REAL id; a typed map did the reverse | R S3-2,3 run | Regex read a value the browser evaluated | Evaluate `environment.ts`; one function for both sides |
| 60 | 10-07 | `9805075a` | `FIREBASE_EMULATOR_PROJECT` split suite and browser | R S3 | Launch-only override | Removed and refused. User: *"Remove it"* |
| 61 | 10-07 | `7df39bc1` | Seeded indexes plus `--force` could delete production indexes | R R5-1 | A seed reached a deploy path | Never seed indexes |

### VT — version truth and compatibility
| # | When / version | sha | What broke | Found | Root cause | Fix |
|---|---|---|---|---|---|---|
| 62 | 10-07 | `53cb79d3` `f555dc78` | `latest` of both: two `@firebase/app` copies, app/no-app crash | C A1, V reproduced | Floating versions from generators | One versions module, refusing seam, derived table |
| 63 | 10-07 | `79e7953b` | Container Node followed whoever ran the last upgrade; stated 3 times | C B5 | Host fact used as project fact | `.nvmrc` |
| 64 | 10-07 | `f555dc78` `d42e1169` | `firebase-cli` and gcloud features unpinned | C B5 | Version-less features | Dev dependency; image package |
| 65 | 10-07 | `63370c72` `2e2b39be` `b4111181` | **`new --preset=angular --firebase` failed outright** | R R1-0 run | Pinned Angular vs a DS step needing 21+; consumer dogfood used the released toolkit | Fixed; `tools/dogfood-consumer` |
| 66 | 10-07 | `a48aa2ba` `5bf7f220` | `firebase-tools` peer ERESOLVE; `.nvmrc` misparsed nvm grammar and image tags | R R1 | Grammar assumed | Probe before writing; `node-facts` |
| 67 | 10-07 | `e287e0ab` | Conflicting advice on the pair | D D1 | Two voices | One judge |
| 68 | 10-08 | `9699e617` | firebase 13, published that day, needs Node ≥24.12: every NEW project on the released `latest` broke | S | Table ignored Node | Table records engines of the closure |
| 69 | 11-02 0.51.1 | `217fb6be` | Publish stopped: `@angular/fire` 22 made firebase a peer | T upstream check | Upstream reshape | Read both. User chose *"yes"* over bypassing |
| 70 | 11-02 | `b27c4207` | Refreshed tables: `v27-alpha` counted as a release; TS pin refused by 3 packages | R | Projector naive | Fixed in projector |

### CN — container packaging and rebuild survival
| # | When / version | sha | What broke | Found | Root cause | Fix |
|---|---|---|---|---|---|---|
| 71 | 05-30 | `50f2a694` | Emulators exit with a generic error | U | Missing JVM | Java feature |
| 72 | 05-30 | `fcb45774` | Rebuild failed: TLS error on Microsoft JDK | U rebuild | SDKMAN `ms` | `tem` |
| 73 | 05-30 | `a3dd1edb` | Rebuild failed: github.com unreachable | U rebuild | "Structurally network-fragile" | apt in post-create |
| 74 | 06-01 | `6dd4e4e1` | `EACCES` on `~/.cache`; "from time to time" | U | **Docker creates mount parents root-owned** | chown |
| 75 | 06-05 | `17415641` | Fresh named volume root-owned | U | Same | chown |
| 76 | 06-05 | `f636b7fb` | DNS blip aborted post-create, half-provisioned | U | `set -e` plus network step | Retry, warn |
| 77 | 10-02 | `b088b406` | Welcome hook failed under dash | R | `source`, `BASH_SOURCE` | POSIX |
| 78 | 10-04 0.40.0 | `5ae28776` | Claude Code frozen at build day. *"It doesn't seem to update"* | U | Feature's copy shadowed updates on PATH | Native install, PATH first |
| 79 | 10-04 0.42.0 | `12acf36a` | `/.local/bin`, fix had no effect | U rebuild | `${containerEnv:HOME}` is empty | `{{home}}` |
| 80 | 10-04 0.43.0 | `163ef9cd` | Feature left in adopted devcontainers | U | "Might be theirs" test | Removed when superseded |
| 81 | 10-04 0.44.0 | `b09f8da1` | Lock pin left; rebuild left a diff; `parseTree` guards never fired | U | No sweep | `removeFeature`, `jsonc-strict`, finish gate |
| 82 | 10-06 0.47.0 | `a49634a1` | Logins lost on every rebuild | U | State beside mounts | `~/.config` volume, `CLAUDE_CONFIG_DIR` |
| 83 | 10-06 0.48.0 | `04842365` `f0d69059` | Every rebuild reinstalled OS packages | U | post-create apt | `house.Dockerfile`, one cached layer; five reviewers found data-loss shapes |
| 84 | 10-06 0.49.0 | `2026-10-06-playwright-deps-layer` | 0.48 left Chromium deps; first verify hung on a yarn prompt | U rebuild | Deferred gap; attended post-create | Projected deps, unattended stdin |
| 85 | 10-07 | `d42e1169` | gcloud needed a pin | C B5 | Feature | apt `repository` + exact pin |
| 86 | 10-07 | `c28408b3` | Apt pin would fail every cache-miss build after ~1 year | R R1-3 | **Google's apt index is a rolling window** | **#85 removed same day**: versioned sha-checked `archives` |

### OW — ownership between generator and project
| # | When / version | sha | What broke | Found | Root cause | Fix |
|---|---|---|---|---|---|---|
| 87 | 06-10 | `0d09453f` | `firebase.json` edits at risk | C | Whole-file thinking | Per-key: `emulators`, `functions` owned, rest preserved |
| 88 | 07-09 | `6b56f49a` | `--repair` clobbered app fields and stripped `.env` asset | C crushit | Blind rewrite of a file carrying project values | Interface write-if-absent |
| 89 | 07-13 | `eddc392b` | Customised `firebase.config.ts` froze silently | C crushit | **"Unnamed middle category"**: owned logic with project values, repair guessed by markers | Values moved out; file fully owned |
| 90 | 07-27 | `5812cb10` | Run after an adoption overwrote the merged devcontainer | S | Ownership inferred from marker existing | Explicit `owned`; `.bespunky-devcontainer.json` |
| 91 | 07-31 | `0143b3b2` | Sync re-added `provideAppFirebase()` above a comment saying it was deliberately absent; broke SSR | C | Writing into a class C file on every sync | Wire on ensure only |
| 92 | 10-07 | `902e3e90` | Upgrades wiped hand `inputs` and `args` on house targets (reproduced) | C B2, V | Owned targets replaced whole | Three-way merge against `.bespunky/house-targets.json` |
| 93 | 10-07 | `bb4dd3a8` `3d24235f` | First record-less upgrade kept stale keys and cried wolf | D, R | No base for the first merge | `record-house-targets` rung, frozen 0.49.2 baseline |
| 94 | 10-07 | `1f115d2a` `b8c59034` `4de9002b` | Upgrade diffs reflowed `forwardPorts` over nine lines, reordered deps | D DF2 | Formatting writes | Edit in place. "An upgrade's diff is its meaning" |

### UP — upstream behaviour assumed, not observed
| # | When / version | sha | What broke | Found | Root cause | Fix |
|---|---|---|---|---|---|---|
| 95 | 05-31 | `960f705e` | "Port 8080 is not open on localhost" | U | Misleading message, bind address in a container | Bind `0.0.0.0` |
| 96 | 06-10 | `0d09453f` | A configured emulator with no backend fatally aborts the suite | C our-journey | Upstream fail-all | Scaffold functions |
| 97 | 07-31 | `11957994` | `TIMEOUT: Port 5002`; "cost a real project an afternoon" | C | firebase-tools **infers** App Hosting from a root `apphosting.yaml` the house wrote | Derive `--only` from `firebase.json` at run time. Rejected adding a `dev` script: recursion |
| 98 | 10-07 | `6dc58f85` | Toolkit told users `backends:create --environment`, a flag that does not exist; first brief's C1 also wrong | V | Doc from assumption | Checked CLI source; walk-up confirmed |
| 99 | 10-07 | `6139149c` | `seed:build` always failed under Nx; port reclaim silently matched nothing | D DF2 B1 | Nx sets `FORCE_COLOR`; numbers logged coloured | Print strings |
| 100 | 10-07 | `8e18275d` | "Not continuous" relied on an absent key that Nx fills | R R3-5 | Upstream defaulting; a migration re-adds it | Written explicitly |
| 101 | 10-07 | `a8b825ef` | Secrets example claimed the emulator reads `.secret.local` | R | Unobserved | Corrected, rung `retell-secrets-example` |

### DP — deploy and cloud road
| # | When / version | sha | What broke | Found | Root cause | Fix |
|---|---|---|---|---|---|---|
| 102 | 10-07 | `902e3e90` | No rules deploy; Functions built twice; `nx affected` blind to root Firebase files | C B1, B2, B6 | Targets undeclared | Owned `firebase:deploy`, inputs on targets, Nx owns the build |
| 103 | 10-07 | `ebf910f7` | No backend CI; agents refused IAM | C B3, B4 | No capability | Opt-in `ci` layer, `setup-gcp.sh` the human runs |
| 104 | 10-07 | `0d96ac06` | Binding on unprotected lines deployed to prod; SA granted to a whole adopted pool; rollback removed grants it did not add | R R6 3 HIGH | Security unmodelled | Per-repo identities, recorded rollback, SHA pins |
| 105 | 10-07 | `7df39bc1` `fbb13812` | Readiness road misread `firebase use`; rules file `affected` cannot see | R R5, D | Guessing state | Reads real state, refuses |

### EN — engine, layer wiring and the migration ladder
| # | When / version | sha | What broke | Found | Root cause | Fix |
|---|---|---|---|---|---|---|
| 106 | 07-28 | `27bfce91` | Sync said firebase ACTIVE, `SYNC_OK`, ran nothing | C | Refresh gated on a flag, not detection | Detection drives refresh |
| 107 | 07-29 | `5607eb3a` `dae4194b` | Generators carried every legacy shape; rungs only added | S, audit | Convergence | Versioned migrations that clean up |
| 108 | 08-06 | `f29be905` | `--firebase=true --firebase=true` aborted everything after | C | Two authors of a flag | One authority; a guard for the class |
| 109 | 10-01 | `101af520` `373bd8a9` `6d28e0d8` `9a418349` | New app served without emulators; `apps/functions` taken as the app; esbuild missing outside Angular | S | Layer step order, stack assumptions | Seed on write; truthful summary; declare toolchain |
| 110 | 10-07 | `459ccbfd` `c3201bca` `8d8058bb` | A rung's "already current" guard keyed on one marker skipped historical shapes | C handoff 2, R | Idempotence never sees earlier shapes | `historicalShapes` in the harness |
| 111 | 10-07 | `59fc9f25` | `new` inside a repo committed into the outer repo | S container check | Inherited git detection | Own repository |

### DO — the house's own words false
| # | When / version | sha | What broke | Found | Root cause | Fix |
|---|---|---|---|---|---|---|
| 112 | 10-07 | `5b1b431a` `7d8c92ca` | Always-on rule falsely said launching emulators kills the suite; stale `--port-offset=auto` | R R7 | Rules not retold after changes | Corrected |
| 113 | 10-07 | `48f34705` `458b152f` `d675a58b` `50a1f937` `39f2df40` | Frozen text in seeded files; log lines claiming changes that did not happen | D, R | Words outlive shapes | Rungs retell; logs claim only actual changes |
| 114 | 10-28 | `94f13d27` `28908efd` | Generated text named skills whose plugin was not enabled | R | No gating | `plugin-pointers`, test |

### Counts

| Family | Iterations | Reached a human or consumer first (U + C) |
|---|---|---|
| BR browser addressing | 10 | 5 |
| CL client SDK and config | 14 | 3 |
| LC process lifecycle | 14 | 5 |
| SI stack identity | 8 | 3 |
| DU data durability, seed | 4 | 3 |
| PR nothing local reaches production | 11 | 2 |
| VT version truth | 9 | 3 |
| CN container, rebuild survival | 16 | 14 |
| OW ownership | 8 | 5 |
| UP upstream assumed | 7 | 3 |
| DP deploy, cloud | 4 | 2 |
| EN engine, ladder | 6 | 3 |
| DO the house's words | 3 | 0 |
| **13 families** | **114** | **51** |

Found by: consumer 30, review 30, author 22, user 21, dogfood 8, verification 1, test or tripwire 1, one row is a design later found wrong. The count is judgement: some rows could sit in two families (#34 is LC and DU; #40 is SI and DU), and each sits in the family of its root cause.

Things the counts hide:
- **Serve changed shape eight times** (#25-36): parallel run-commands, `emulators:exec`, continuous `dependsOn`, parallel orchestrator, three targets, an executor, the dev engine, then the engine as a non-continuous task. At least two were reversals: 0.6's commit calls its own self-heal "INVERTED from 0.5.x".
- **Other reversals:** forward ports then not then yes then only for the UI (#1, #2, #10); env-gated then `ngDevMode` (#12, #14); apt repository then archive within a day (#85, #86); ownership by marker then explicit (#90).
- **Weight is concentrated.** 0.50.0 alone has 23 rungs, 18 of which touch firebase or emulators. The handoff's "10 of the 24 migration folders" checks out (10 folders; 28 files, it said 27), but it reads as spread when it is mostly one version paying for one report.
- **The 0.50.0 reviews mostly found bugs in fixes written that week** (rows dated 10-07 marked R). Rewriting the dev loop in one day produced the follower design and the hand-built lock, and both were then thrown away.

## 2. Does each family recur, and how much does the handoff's claim explain?

*(unverified)* marks Postgres and Supabase facts from my general knowledge; `postgres.md` and `supabase.md` own them.

| Family | (a) apt Postgres behind a backend | (b) Supabase local stack |
|---|---|---|
| BR 10 | **Partly.** The database hop is gone. The **browser-to-backend hop is the same problem**: the backend is an offset process, and a web client needs the origin relay (#7, #8 reapply: foreign proxy config, relay unreported). Tauri on a phone reaching the container is harder than any of it. A host DB GUI is #10 | **Yes** once supabase-js is in a browser: a gateway URL by port, Realtime websocket (#46), Storage resumable upload URLs (#5's `x-goog-upload-url`) *(unverified)*, Auth redirect allow-list vs `<slug>.localhost` and offsets (#6). Backend-only: Studio is #10 |
| CL 14 | **No**, the mechanism goes. #21-23 are generic and stay (a layer never wired; a rung tested on the author's shapes; a template that does not parse) | **Partly.** One client, not four services, so no per-service files. Env shape, adapter port and prod-bundle cleanliness (#13) return. The handoff's own "serve against plain Postgres until a Supabase-only service is used" **is mixed mode**, the source of #15, #16, #17, #59 |
| LC 14 | **Partly.** The dev engine and `flock` already paid for #25-33. Export loss (#34, #37, #38) goes: WAL does not need a clean exit *(unverified)*. New: a **shared** server outlives every stack, so who stops it? Stale `postmaster.pid` over a persisted volume *(unverified)*. The handoff names the cause wrongly (see below) | **Yes, changed.** `supabase start` returns and leaves detached containers *(unverified)*: nothing for the engine to supervise, so stop, orphan and readiness are all new. With Docker-outside-of-Docker they outlive the devcontainer and collide across projects on the host (#1 again) |
| SI 8 | **Yes.** The handoff leaves it open. Per-stack server: socket path limit (#42), port-keyed lock files. Database per stack: naming, 63-char identifiers *(unverified)*, and nothing drops a database when its worktree goes | **Yes, the worst.** `project_id` keys containers and volumes *(unverified)*, which is literally #40's project-id-keyed hub. Ports live in `config.toml`, with no `PORT_OFFSET` knob. A stack is around ten containers, so stack-per-worktree may not be affordable |
| DU 4 | **Partly.** Durability improves. Seed cascade (#48), logic in a seeded file (#49), cold worktree all recur. New: **a persisted data dir is tied to the Postgres major**, so moving the pin stops the server *(unverified)*. Firebase's export never had this | **Yes.** Volumes, `db reset`, `seed.sql`, plus `auth.users` and Storage objects outside the migrations *(unverified)* |
| PR 11 | **Yes, and the handoff under-scopes it.** The incident was not a database. It was a local process holding live third-party credentials (#53). The consumer's backend holds Financy and Home Assistant credentials. There is no `demo-` equivalent. Host guards inherit #56's and #59's lessons | **Yes, worse than Firebase.** No offline project id; `supabase link` plus `--linked` commands aim at production *(unverified)*; Edge Functions and `pg_net` are #53 again; `secrets set` is #58 |
| VT 9 | **Partly.** No framework-to-SDK chain, so #62, #65, #67 shrink. Postgres major, pgvector and driver remain, and PGDG needs #86's check | **Yes.** CLI pins image tags, `db.major_version` must match the host, supabase-js moves fast, CLI's npm package downloads a binary at install (#72-73 fragility) *(unverified)* |
| CN 16 | **Yes, fully.** None of it was about Firebase. Named volume root ownership (#74, #75) is exactly the handoff's "named volume, like the Playwright cache": that cache is the one that broke. Postinst cluster shadowed by a volume, data dir mode 0700 *(unverified)* | **Yes, the worst.** Docker itself. The user declined DooD here (*"No. I'll do the rebuild"*, `2026-10-06-playwright-deps-layer`), and there is no Docker in the container, so **the "Claude does the verification" model has no road** |
| OW 8 | **Yes**, smaller surface: `dev.json` processes, targets, `postgresql.conf` fragment | **Yes.** `config.toml` per-key ownership. The house's non-destructive merger is `jsonc-parser`; there is no TOML equivalent preserving comments |
| UP 7 | **Partly.** Postgres is stable and documented; few surprises | **Yes.** Same character as firebase-tools: a fast CLI with inferred services and undocumented behaviour |
| DP 4 | **Partly.** A migrate target with correct `inputs`; no IAM if hosting is a connection string | **Yes.** `db push`, `functions deploy`, `secrets set`, link, types, branch-model mapping |
| EN 6 | **Yes.** No server adapter means nothing for a per-app step to attach to (§6 of the handoff), exactly #21's failure risk | **Yes** |
| DO 3 | **Yes** | **Yes** |

### Verdict on the handoff's claim

**"Most iterations trace to causes that a backend-held connection removes": not supported.**

- **The most generous honest count is 24 of 114 (21%):** all of BR and CL. Row by row it is nearer **17 (15%)**: BR #3, 4, 5, 6, 9, 10 and CL minus the three generic rows.
- **Adding its other two table rows does not reach "most":** LC + DU gives 42 of 114 (37%), and those causes are not removed by holding the connection in a backend. They are changed by Postgres being a different product.
- **Of the 22 items in the report behind 0.50.0, one is browser addressing (A3).** Handoff 2 adds one more.
- **Of the four things the 0.50.0 brief proved by running, none is:** two SDK copies (VT), data swap (SI), the waiting dev-server (SI), upgrades overwriting edits (OW).
- **Of 30 consumer-reported rows, 7 are BR or CL.**
- **Severity runs the other way.** Real messages sent (#53), production values truncated (#58), data loss (#31, #34, #40), `new` failing (#65), all outside BR and CL. The exception is #23.

Where it is right: rows 1, 3 and 5 of its table are correct for the database hop, and the per-service machinery really was expensive. Row by row:

| Handoff row | Finding |
|---|---|
| Ports, origin routing: "Gone" | True for Postgres, but moves to the backend's port |
| Reaping: "Emulators on the JVM leave orphans" | **Wrong cause.** Orphans come from a parent's ungraceful death (`2c421f9f`: "no in-process trap can cover SIGKILL or a container restart"), for any daemon. The data loss came from Nx signalling leaves first (`c141ff85`). Neither is about the JVM |
| Toggles, provider splitting: "Gone" | True for Postgres. Its own §5 suggestion brings mixed mode back for Supabase |
| Data, D1: "Replaced by a database per stack" | The durability half is true. D1's root cause was shared discovery state, which recurs. A database per stack is a new lifecycle |
| Env-shape migrations: "Gone" | True for Postgres; returns with a client port |

Its §4 table is headed Postgres, so it does not literally claim this for Supabase, but §5 treats Supabase as a thin layer on top. **The evidence says Supabase is a Firebase-class effort**: yes on 12 of 13 families (BR on condition of a browser client), partly on CL, and worst of all on the three that cost the most (SI, CN, PR), with Docker unsolved and no observation path. Plan it as a separate, later delivery. `postgres` carries real but bounded risk: expect CN, SI, PR, EN and OW.

## 3. Day-one guarantees

Each is a requirement on the new layer, with what paid for it.

**Nothing local reaches production**
- [ ] The local run's credentials are inert by default for **every** secret the backend or functions declare, not only the database URL. A real value is a loud opt-in Claude never arms. (#53)
- [ ] No tree borrows another tree's secrets. Seeds may cascade, secrets may not. (#53, `28e8b6a5` built the cascade; 0.50.0 removed it for secrets)
- [ ] `seed` and `reset` check the **target**, not the presence of a variable, and have no default fallback host. (#56, R2-8)
- [ ] Any decision about local vs real comes from evaluating or properly parsing the value with one function shared by all callers, never a regex. Parse `DATABASE_URL` as a URL, including socket and multi-host forms. (#54, #59)
- [ ] Prefer a structural guarantee over a checklist. Firebase's was the `demo-` id. Postgres needs its own, for example a role or network that cannot reach a host; Supabase must not have a linked project visible to local commands. Then **state the guarantee exactly as enforced**, including where it stops. (#55, `impl/FB.md` "where it stops")
- [ ] Never fabricate cloud state: link is the human's. (#51)
- [ ] A secrets push refuses any value whose parsed form differs from its raw text, via stdin, with key names only in output. (#58)
- [ ] An always-on rule in `HOUSE.rules.md`, because `HOUSE.md` is read on demand. (R2-9)
- [ ] No database config or local address in a client bundle, grepped from a real production build, and backend-only code kept out by the platform firewall. (#13, E4)

**Stack identity**
- [ ] Every piece of global state the service keeps (socket, lock, port, name, container, volume) is keyed by stack. Enumerate them by observing a running pair. (#40, #41, U3's "shared root cause")
- [ ] Two stacks up at once, written to, stopped in **both orders**, each keeping its own data, in a test. (#40)
- [ ] Deep-worktree paths fit socket limits. (#42)
- [ ] All ports, nested ones too, in one table the free-port check reads. (#46)
- [ ] Claim through `tools/dev/dev`, including direct runs and seed builds, which get their own stack. (#43, #44)
- [ ] Dependents get the address through `dev with`. (#45)
- [ ] An agent never takes base ports, in code. (S3-9)
- [ ] Two stacks' lifecycle includes cleanup when a worktree is removed: name who drops its database.

**Lifecycle**
- [ ] A stop verifiably leaves data intact when it comes via Ctrl+C, `dev stop`, and Nx's tree kill, each observed. (#34)
- [ ] Stop has a deadline and reports the outcome; a failure names the process. (#37)
- [ ] Never kill by name or port; a live holder means refuse and name it. (#31)
- [ ] Declare `continuous` explicitly on every target. (#100)
- [ ] Write the dev fragment and make the dev generator run for a backend-only workspace. (`882b231c`, `490d7bf3`)
- [ ] Tools print plain text under `FORCE_COLOR`, and exit codes and stop lines survive `>` capture. (#99, #35)

**Version truth**
- [ ] Every pin in `_utils/versions.ts`; no floating spec, enforced by `declareDependencies`. (#62)
- [ ] A derived compat table for anything that moves upstream (Postgres major ↔ pgvector ↔ host; for Supabase CLI ↔ `major_version` ↔ images), checked weekly and before publish, never per push. (`5ac02ef6`)
- [ ] Projectors skip prereleases and read peers. (#69, #70)
- [ ] Project-level pins are read from the project, never the machine. (#63)
- [ ] Refuse an impossible combination in the probe before anything is written. (`a48aa2ba`)

**Container**
- [ ] OS packages in the cached image layer, never post-create apt. (#83)
- [ ] **A pin must remain installable for its whole life.** Check the source is not a rolling index before pinning; the house's answer is `archives`, not an apt `repository`. Check PGDG against this explicitly. (#86, `layers/descriptor.ts:254`)
- [ ] Persistence audit in the same change: where each tool keeps state, by running it. Data dir, logins, config. Say "nothing to keep" in the commit. (#82, `CLAUDE.md` Conventions)
- [ ] Mount ownership checked on a fresh volume and on a rebuild over an old one. (#74, #75)
- [ ] Persist through the existing XDG homes where possible; a new mount only for a directory that must be kept whole. Decide what happens to a persisted data dir when the major moves. (user, persist-auth: *"reduce specificity if possible"*)
- [ ] post-create is unattended, and a network blip degrades instead of half-provisioning. (#76, #84)
- [ ] No unpinned features; use `{{home}}`, not `${containerEnv:HOME}`; add a PATH entry through the fragment. (#64, #79, `5ae28776`)
- [ ] A foreign image and an adopted devcontainer work or are refused, and record what was added with `houseWrote()`. (`f0d69059`)

**Ownership**
- [ ] Class every output A, B or C before writing the generator. No "unnamed middle category": a file is logic or values, never both. (#89)
- [ ] Per-key ownership of any shared config; project keys and comments survive; never rewrite whole. For TOML this needs a merger that does not yet exist. (#87, sync-fallout §6)
- [ ] Targets go through `house-targets` three-way merge. (#92)
- [ ] Seed once, on ensure, never on re-ensure of a project that has it; never write into `app.config.ts` on upgrade. (#91, R5)
- [ ] Logic never lives in a seeded file. A seed world stays data, and the applier stays owned. (#49)
- [ ] Nothing seeded can be deployed destructively. (#61)
- [ ] Reach existing projects' project-owned `dev.json` by a planned path, since it is seeded once. (`declaration.ts:7`, `101af520`)

**Upstream**
- [ ] Every undocumented or inferred upstream behaviour you rely on gets a named **tripwire** against the real pinned tool, run weekly, on a version bump and on dependent-code change. It observes the real effect, not a getter. (#57, `tools/test-firebase-tools`, `tools/test-angular-ts-solution`)
- [ ] Name the services you start; never rely on inference. (#97)
- [ ] Read messages suspiciously and check claims against source or by running. (#95, #98)

**Deploy**
- [ ] Owned target, correct `inputs`, one build, `cache: false`; `affected` sees schema changes; refuse a declared file the inputs cannot see. (#102, #105)
- [ ] A failed deploy prints the road to a first deploy, reading real state. (`fbb13812`)
- [ ] IAM-equivalent is a script the human runs. (B4)

**Process**
- [ ] **Run it the way a consumer does, before release:** `upgrade --local` on this repo, whole diff read, `tools/dogfood-consumer` with **a real `new --local`** for the preset. (#65, CLAUDE.md gate)
- [ ] Add dogfood data: real shapes reporting projects grew, and a second upgrade as a no-op.
- [ ] Container-reaching change: observed in a real rebuild, with a scripted self-check the user runs and Claude reads. (#79; 15/15 in `impl/FIREBASE-CONTAINER-CHECK.md`, 21/21 in playwright-deps)
- [ ] Observe a **running** system with data before calling safety done. Fixtures encode the author's assumption. (`CLAUDE.md`; every 0.50.0 gate find in `DECISION.md`)
- [ ] Adversarial review with a read-only reviewer **per area**, then a second round on the fixes. The second round found 5 more HIGHs. (`review/S3.md`)
- [ ] A "flaky" test is a suspect, not noise. (#38)
- [ ] Sweep with `git grep` before release. (#81)
- [ ] State "nothing to migrate" deliberately, then every later shape change is a rung with a fixture and `historicalShapes`. (#110, #22)
- [ ] The layer's docs, rules, tips and `new` verify table say what is true and are gated by layer. (#112, #113)
- [ ] Don't defer a known gap. (user, playwright-deps: *"Why would you not include it in the refactor??"*)

## 4. Decisions made and roads rejected

| Decision | Reasoning, source | Bearing on the new layers |
|---|---|---|
| **D1: seeds shared, data isolated** | "Fail in opposite directions." First designed as "first stack persists, extras import-only", **re-decided by the user mid-implementation** (`sync-fallout` table, `28e8b6a5`) | Base seed from main, cascaded and copied. Don't redesign. A shared world for extras was already rejected |
| Declarative user-owned seed world, owned applier | `0d09453f`, `2a43abd9`. Seed is "part of the schema contract" | Project's `world` and migrations class C; runner class A. Note: it took 4 months and a migration to get the applier out |
| `firebase.json` per-key: `emulators`, `functions` owned | `0d09453f`, `CLAUDE.md` | Same for `config.toml`, but which keys? `emulators` was mostly house; config.toml's `[auth]` and `[api]` are mostly the project's |
| Ownership is additive, never overwrite | "'Claim only if the file still matches' would have to recognise every devcontainer ever emitted" (`sync-fallout` §6) | Don't sniff. Don't compare to generations |
| Target ownership per key, three-way | `902e3e90` | Use it; it exists |
| `--only` derived at run time from `firebase.json` | "Deriving beats baking": project-editable (`11957994`) | Derive from the project's config at launch |
| **Rejected: `dev` script** | Recursion (`11957994`) | Beware services that launch the dev server |
| **Rejected: `.firebaserc` generation** | "Both lie about the user's actual cloud state" (`aee834b2`) | No generated project ref |
| **Rejected: generated notifier seam with a log-only sink** | Opt-in per integration, "the 'remember to do it' model that failed here"; the secrets seam is opt-out and covers what agents write later (`analysis/U2`) | Guard the secret seam, not app code |
| **Rejected: `.env`-based code-level `FUNCTIONS_EMULATOR` guard** | Same | Same |
| **Rejected: "one source of truth, two sinks" for secrets** | "The two sinks have opposite safety requirements" (U2) | Local and prod env are separate files, intentionally drifting |
| **Rejected: secret borrowing from main** | It trades a loud correct failure for a silent dangerous success (U2) | A fresh worktree fails loudly |
| **Rejected: `requireLocalPort`** | Cannot make a mismatch fail (V) | Don't plan on port fidelity |
| **Rejected: serving the offset to the page** (handoff 2's suggestion) | "Would have kept the browser coupled to ports" (`INBOUND-HANDOFF-2`) | Origin only |
| Direct-dial option, no compat | User cancelled and directed "fix everything"; default stays no compat | Nothing to carry |
| **Rejected: `changeOrigin:false`** for Storage | Breaks behind a Host-rewriting front (W4): rewrite the upload URL | Supabase Storage needs the same test |
| Regex-keyed proxy keys | Don't work on webpack (FD) | Plain prefixes at segment boundaries |
| Override env to choose a project | **User: *"Remove it"***. Refused when set | No `DATABASE_URL_OVERRIDE`-style launch-only switch splitting two sides |
| `serve` non-continuous | "Removes a whole class of bugs… *easy ≠ simple*" | Fragment a process; don't add Nx shapes |
| Lock via kernel `flock`; two containers on one workspace **refused, not modelled** | `943e4686` | A shared server touches this: who holds what |
| `stack = (tree, offset)` | PLAN concept 3 | Per-stack database is natural; per-stack Supabase is not |
| Java via apt, not features | "Structurally network-fragile" (`a3dd1edb`) | Apt or archive, never a feature |
| **Rejected: apt repository for pinning** | `c28408b3`, `descriptor.ts:254` | The handoff's "PGDG apt repository may be needed" needs this answered first |
| Claude not baked into the image | "A cached layer would hand back the build-day version" (`dockerfile-layers`) | Self-updating tools stay out of image; pinned ones go in |
| `~/.config` one volume | User quote above | First look for XDG. Supabase login may not honour it *(unverified)* |
| Docker in the toolkit's verification | User declined DooD: *"No. I'll do the rebuild. Prepare everything so I come back to you after it and you can verify"* | **Not a general refusal of Docker, and specifically "for this repo"**. Ask the user as its own question for consumers |
| CI as an opt-in `ci` layer | DECISION | Migration deploy can plug in; don't build a second CI |
| Emulator `demo-` by default, real only when committed | R2; "the guarantee is stated exactly as enforced, no broader" | Model for wording |
| Firewall: one rule instance, classifier reads imports as lint does | second instance double-reported (introduced `f687232f`, found S2, fixed G4) | Extend the one rule for a server-only tag |
| Mixed real-and-emulated per service | Kept, at a price: #15-17, #59, `align-storage`, RESTART NEEDED (`f5e86e64`). B-6 calls partial-real "incoherent for the real service itself" | See §5 |

## 5. What was over-built or regretted

A new layer should deliberately **not** build these at first:

1. **Mixed local and hosted modes.** `EMULATE`, `?emulate=`, `emulator-overrides.ts`, `proxied`, the dev guards, `align-storage`, project-id agreement. The most expensive feature per user value in the history, and it caused both silent real-id bugs (#59). So: local-only Supabase or plain Postgres, one at a time per stack, chosen at launch. The handoff's "serve against plain local Postgres until…" is this road. Don't take it in the first release.
2. **Hand-built coordination.** Follower, preflight, exit records, `/proc` postscript, claim takeover, heartbeat (#36, #44): built and retired inside one effort. Use `dev claim`, `flock` and the engine as they are. If a shared server seems to need new coordination, prefer one server per stack or fix the seam first.
3. **A reaper.** `reap-emulators.sh` grew over four months and was retired. `80e665bf` warns about orphans nothing reaps now.
4. **A new installer path.** The gcloud apt `repository` mechanism existed for a day. Reuse `osPackages` or `archives`.
5. **Client integration before a client needs it.** Firebase's `firebase-client` port carried 14 CL iterations. The consumer needs no supabase-js on day one; a client port waits for a real consumer.
6. **Cloud setup automation.** `setup-gcp.sh`, identity pools and rollback records are the only large part **still never run against the real service** (`FC.md`). For Postgres, hosting is a connection string. For Supabase, documentation and a human `supabase link` first.
7. **Seeded production-affecting files.** Indexes (#61). Seed rules only on first ensure; don't seed anything a deploy would apply. Think before seeding RLS policies as a deployable migration.
8. **A notifier or provider abstraction in generated code**, per U2.
9. **Published numbers in generated text.** Bundle figures went stale and were disproved (`2026-11-02-firebase-bundle-numbers`); seeded copies stay wrong forever.
10. **A multi-wave plan that lands in one day.** Not over-built as such, but the 0.50.0 reviews' HIGHs came from breadth at speed. Slice it: `postgres` core, then observed, then Supabase.

What was **not** over-built, despite appearances: the tripwires, the version projection, the dogfood script, `historicalShapes` and the three-way merge each caught real failures. Build their equivalents early, because retrofitting cost more. Only 1 of 114 rows was found by a test or tripwire; they arrived after most of the damage.

## 6. Open items a new layer inherits

| Item | Source | Why it matters |
|---|---|---|
| **`CLAUDE.md` is stale on OS packages**: it says an `osPackages` group "may name the third-party apt `repository`… and pin `name=version` (the firebase layer's `google-cloud-cli`)". The code uses `archives`, and `descriptor.ts:254` forbids the road | `c28408b3`, `CLAUDE.md:61` | Anyone designing PGDG from CLAUDE.md gets the rejected design. Fix it in this effort |
| **The handoff's "dev.json env"**: exists (`declaration.ts:21`), but `dev.json` is seeded then project-owned, so add-layer on an existing project needs the path `firebaseFragment` uses, and a per-stack value must substitute (`${PORT:…}` only seen so far) | `dev-fragment.ts`, `declaration.ts:7` | A per-stack database name may need a new substitution token. Check with `code-layer-infra` |
| No Docker in the container: real image builds and any Supabase stack cannot be observed by Claude; the user rebuilds | `dockerfile-layers` "No Docker inside the container" | Blocks the finish gate for Supabase unless solved |
| One devcontainer image, last layer wins (A4); per-layer parameters on `PlanContext` (A8) | `stack-agnostic` deferred | Postgres options like a major need a home; check A8 before adding a flag |
| No server adapter; only `angular` makes apps | handoff §6 | A "core only" postgres has nothing to attach to. Same risk as #21 |
| Firewall limit: a project tagged only by its own non-platform tags cannot be flagged | `impl/G4`, ledger | Backend-only guarantee has this hole |
| `setup-gcp` and CI never run on real GCP | `FC.md` "Not verified" | Any `ci` plug-in for migrations rides an unproven road |
| The local guarantee stops at code naming a real resource, and non-Google services | `impl/FB.md` | Inherited wording; the backend's API keys sit in the hole |
| Emulator JVMs a pre-0.50 stack orphaned are invisible to the claim | `80e665bf` | The engine does not reap. A stray database has no owner either |
| Nx agent `summary` hides a running task; `nx serve` under an agent fails fast on 23.3; Claude uses `tools/dev/dev` | `5dadb09c`, G1 | Layer docs and targets must assume this |
| https dev pages: console error only, Storage and Functions force http | FD | Supabase in https dev unknown |
| Subagent background servers surviving return: unverified | BRIEF "Still unverified" | Cleanup after agent runs of a DB-bearing stack |
| Tripwire "failed beside a concurrent job and passed alone" | `2026-11-02-release-followups` | A real-service tripwire needs a port-isolation answer; test the tool, don't shrug |
| A rung importing live utils (0.33.x imports `firebaseProvidersNote`) | `release-followups` review, `stack-agnostic` | Freeze values in any rung for these layers |
| Next Current Node (27, 2027-04-22): `.nvmrc = node` refused without an image | `angularfire-peer-firebase` | Shared seam only |
| Nx-defect fixture "pins third-party behaviour… cuts both ways" | `sync-fallout` open question 4 | Policy question for tripwires |
