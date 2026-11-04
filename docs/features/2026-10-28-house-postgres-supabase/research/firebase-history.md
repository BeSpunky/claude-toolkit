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

