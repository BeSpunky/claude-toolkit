---
status: concluded
concluded: 2026-08-10
summary: Split the generated Firebase bootstrap one file per SDK service so an app pays only for what it
  provides and only where it provides it (fresh scaffold 479 kB -> 238 kB initial); fixed the app generator's
  missing baseline provider wiring, found by building a throwaway scaffold; shipped migrations 0.33.0 and
  0.33.1 to carry existing projects across without behaviour change.
tags: [firebase, nx-tools, bundle-size, migrations, generators, angular]
---

# Decisions — splitting the generated Firebase bootstrap

*Live document. Appended as the work happens.*

## The shape: one file per service, split by WHEN the service is needed

`firebase.config.ts` keeps the Firebase **app** and nothing else — `provideFirebaseApp()`, the
production fail-loud config guard, and the dev-only emulator resolution helpers the siblings share.
Four new generator-owned siblings sit beside it:

| file | export | what it costs when unused |
| --- | --- | --- |
| `firebase.config.ts` | `provideAppFirebase()` | — (root; measured at +31 kB over an app with no Firebase) |
| `firebase-auth.config.ts` | `provideAppAuth()` | nothing |
| `firebase-firestore.config.ts` | `provideAppFirestore()` | nothing |
| `firebase-storage.config.ts` | `provideAppStorage()` | nothing |
| `firebase-functions.config.ts` | `provideAppFunctions()` | nothing |

**Separate files, not separate exports from one file.** Export-level splitting would tree-shake an
*unused* service, but it cannot **defer** a used one: a route's `providers` array living in an
eagerly-loaded `app.routes.ts` still statically imports whatever it names, and the import is what
pins the chunk. Deferral only happens when the `provideX` call sits in a file that only a lazy chunk
imports. One file per service is what makes that possible.

**No file moves.** The siblings are named `firebase-<service>.config.ts` and land beside the existing
file rather than under a new `firebase/` folder. A folder would read better and would cost a
retargeting migration over every reference to `./firebase.config` — including ones the toolkit never
wrote (a spec, a server config, an app's own re-export). Not worth it for a cosmetic gain.

**`provideAppFirebase()` keeps its name.** It still means "this app's Firebase app". Keeping it makes
the migration additive: every existing call site keeps working, it simply provides less.

## The default for a NEW app: root wires the app only

Asked which default a newly scaffolded app should get, the user chose the smaller floor and then went
further than the option offered:

> *"A - without the auth. Make auth opt-in and lazy also"*

So a new app's seeded `app.config.ts` gets `provideAppFirebase()` wired and **all four services as
commented lines**, each naming the move: put it in the lazy route that needs it, or uncomment here to
keep it at root.

Consequences, accepted deliberately:

- A fresh scaffold's initial chunk drops from ~650–680 kB to **~300 kB** (estimate on the consuming
  project's decomposition; verified against a real throwaway build below). Angular's stock 500 kB
  budget becomes a real signal about the app's own growth instead of a line everyone raises on day one.
  **↳ SUPERSEDED by the measurement below: the real numbers are 479 kB → 238 kB, and a fresh app was
  never over the 500 kB budget — only within 21 kB of it. Left here as written; the correction is the
  finding.**
- The first `inject(Firestore)` (or `Auth`, `Storage`, `Functions`) in a new app throws
  `NullInjectorError` until the developer wires it. That is the whole cost, and the fix is a commented
  line sitting in the file they will open.
- **Auth is the sharp one.** A route guard runs *before* its route activates, so an auth-gated app's
  guard needs Auth already provided — and a guard imported by an eagerly-loaded `app.routes.ts` drags
  Auth back to root regardless. Such an app either lazifies its routes file or accepts a serial fetch,
  which can make first paint *slower* than today. This is the honest cost of an honest default: an app
  whose first decision needs Auth has Auth on its critical path, and today we hide that by charging
  every app for it.

## Existing projects: a behaviour-preserving migration, not a silent change

`firebase.config.ts` is rewritten in full on every sync, so changing what `provideAppFirebase()`
returns would silently break every project on its next sync — the first `inject(Firestore)` becomes a
`NullInjectorError` with no diff to point at.

So migration `0.33.0/split-firebase-service-providers`:

1. Finds where `provideAppFirebase()` is **actually called** — searched across the app's source, not
   assumed to be `app.config.ts`. [[wire-provider]]'s header records why: a project deliberately moved
   Firebase into a browser-only config, and a generator that assumed `app.config.ts` re-added it into
   the shared one and initialised Firebase during SSR.
2. Inserts the four service providers at that same call site, with their imports. Behaviour is
   preserved **exactly** — same providers, same injector, same bundle.
3. Reports what it did, and what the project can now do (move any of the four into the lazy route that
   needs it). Reports and refuses when it cannot find the call site, rather than guessing.

**Ordering.** The house sync runs `probe → install → migrate → detect → generate`, so at migration
time the sibling files do not exist yet — the generator writes them minutes later. A project running
`nx migrate` on its own would be left with imports pointing at absent files. The migration therefore
**writes any missing sibling from the same template the generator uses** (shared routine, one source
of truth; the generator overwrites them identically afterwards). Left unsolved, this would be a broken
intermediate state that only the house sync path happens to heal.

## What is deliberately NOT in scope

- **No house budget.** A budget is a promise a project makes about its own payload, not a house fact.
  Lowering the floor is what makes Angular's stock budget honest; inventing a number to sit above the
  floor is the thing the consuming project's own doc argued against.
- **A transfer-size budget** (the handoff's item 3) — Angular's budgets measure raw bytes; a compressed
  budget appears not to be expressible at all. Not asserted, not built.
- **Their `libs/spine` barrel** — `secondary-entrypoint` already exists for it.

---

## Measured, on a real throwaway scaffold (2026-08-10)

`scaffold.sh --firebase --local fbsplit web`, then `nx build web --configuration=production`, varying only
what `app.config.ts` provides. Raw / estimated transfer, initial bundle:

| `app.config.ts` provides | raw | transfer |
| --- | --- | --- |
| nothing (no Firebase) | 207.44 kB | 55.62 kB |
| `provideAppFirebase()` — **the new default** | 238.42 kB | 64.38 kB |
| + auth | 341.56 kB | 86.92 kB |
| + firestore | 412.61 kB | 108.58 kB |
| + storage | 336.01 kB | 83.94 kB |
| + functions | 327.06 kB | 81.19 kB |
| + all four — **the old behaviour** | 478.74 kB | 120.63 kB |

**Two things the measurement corrected, both of which had reached the docs before it ran:**

1. **The per-service costs are not additive, and the estimates were wrong.** The single-module sizes taken
   from the consuming project's report (auth 85, firestore 235, storage 22, functions 35) describe modules,
   not marginal bundle cost. Measured deltas over the app-only baseline are auth +103, firestore +174,
   storage +98, functions +89 — summing to ~464 kB, while all four together cost only +240 kB. Whichever
   service arrives first pays for Firebase's shared core. Every published figure is now a measured TOTAL
   with that service alone, with the non-additivity stated beside it, because a reader who added the deltas
   would plan against a number that does not exist.

2. **A fresh app was never actually over budget.** 478.74 kB sits 21 kB *under* Angular's stock 500 kB
   warning. The earlier claim (~650–680 kB, "over from birth") was extrapolated from the consuming
   project's numbers, which include its own code and its `libs/spine`. The honest statement is narrower and
   still damning: the old default spent **96% of the budget before the app had a single feature**, so the
   first real screen pushed it over — which is what the consuming project reported at 744 kB (their figure, not
   one measured here).

The delta the split actually buys a fresh app: **240 kB raw / 56 kB compressed** off the critical path.
(An earlier draft of this line said 271/65 — that compares against *no Firebase at all*, which is not the new
default. The new default is `provideAppFirebase()` at root, 238.42 kB, so the honest delta is 478.74 − 238.42.)

## A pre-existing bug the verification exposed

The build came in at 207 kB — *no Firebase at all*. `provideAppFirebase()` had not been wired into
`app.config.ts`, and neither had `provideWorktreeTabLabel()`.

Cause: the `app` generator composes `serve`, `design-system-styles` and `firebase-emulators`, and passed
`wireProviders: true` to **only the design-system one**. The comment above that call states the principle
exactly — *"the app generator only ever runs to CREATE an app, so this IS the baseline write"* — and the
other two calls simply never got the flag.

So **no app the house scaffolder has created since nx-tools 0.26.0 had its Firebase providers wired** — `0143b3b` (2026-07-31) introduced the `ensuring` gate; before it `wireProvider` was called unconditionally, so older apps are correctly wired. It went unnoticed
because the *sync* path passes `--wireProviders` on its own `nx g firebase-emulators` invocation and was
correct all along; only the scaffold path was silent. The failure surfaced far from its cause, at the app's
first `inject(Auth)`.

Fixed here (both calls now pass `wireProviders: true`) — **and a migration IS owed**, which the first draft of
this note got wrong. The house question is not *can the fix reach existing projects* but *does this alter a
shape projects on disk have*, and it does: every app scaffolded on 0.26.0–0.32.x is sitting there with the
files and no calls. `provideAppFirebase()` at least had a repair path (`--sync --firebase` ensures the layer,
which passes `--wireProviders`); `provideWorktreeTabLabel()` had none, since a plain sync never ensures the
`web` layer. So `0.33.1/wire-missing-baseline-providers` wires both — scoped to apps where the generated FILE
exists and NOTHING in the app calls the provider, so a project that wired it by hand, or deliberately moved it
into a browser-only config, is left alone.

---

## What four review agents found (2026-08-10)

Four independent adversarial reviews — correctness, house-rules compliance, an Angular/bundling skeptic
with a real build to experiment on, and a documentation fact-check. They found **eleven** things worth
fixing, several of which would have shipped broken. Recorded because the pattern matters more than the
list: everything they caught was a claim that had been *reasoned* rather than *measured*.

**Three that would have broken consumers:**

1. **The migration wrote into other git worktrees and into `dist/`.** The tree walk skipped only
   `node_modules`/`.git`/`.nx`, and the house's own convention puts a full second checkout at
   `.claude/worktrees/<slug>/` — at exactly the depth the walk reached. It would have silently edited
   source on an unrelated feature branch, which the sync's git backup does not cover. Now a shared
   `_utils/app-roots` walk excludes every dot-directory, the build-output names, and anything carrying
   its own `.git`; it also tests the workspace root (an `nx init` retrofit has its app at `src/app`) and
   recurses into matched roots instead of stopping.
2. **The migration wrote siblings that could not compile.** They import `emulatorFor`/`portOffset`/
   `offsetUrl` from `firebase.config.ts`, which only *exports* them from 0.33.0 — so writing them beside
   a 0.32.x root file yields four files importing symbols that do not exist. Reachable three ways: a bare
   `nx migrate`, a `SYNC_PARTIAL` run, and every app but one in a multi-app workspace. The write routine
   is now all-five-or-none.
3. **Identity, not name.** The idempotence check and the import handling matched on the identifier alone.
   A project with its own `provideAppAuth` from `./auth.providers` read as "already migrated" and was
   logged as a success while Firestore, Storage and Functions were silently dropped; a stray
   `import { provideAppStorage } from '@acme/legacy-storage'` would have let the migration wire a call
   resolving to somebody else's function. Both now resolve the import to a path and compare it; a name
   collision is reported per service instead of guessed at.

**Two claims that were simply wrong, and one that was unusable:**

4. **"A route guard cannot receive Auth from the route it guards" — false.** Measured against Angular 22:
   `canActivate`, `canMatch` and `resolve` all resolve against the route's *own* providers injector. Only
   a **child** route's providers are invisible to a parent's guard. The conclusion (auth usually belongs
   at root) survives, but on the *bundling* argument: a guard named in the eager `app.routes.ts` is
   statically imported by the initial chunk, so its `inject(Auth)` pins `@angular/fire/auth` there
   wherever the provider is declared. The DI sentence is deleted rather than softened — it would have
   sent people to root for a reason that does not exist.
5. **The emulator latch was per-module, not per-instance.** A `let emulatorConnected = false` outlives the
   SDK instance it tracks: delete the Firebase app and re-provide (a TestBed `afterEach`) and the new
   instance is never connected, so a dev/test run silently talks to the **real backend**. Demonstrated,
   not theorised. Now a `WeakSet` keyed on the instance — same tree-shaking, no false positive.
6. **The commented service menu could not actually be used.** Uncommenting a line gave a syntax error
   (the weight and placement prose sat inside the same comment line as the call) and there was no import
   to uncomment either. The whole "deliberate `NullInjectorError`, the fix is in the file you open"
   design rested on a menu you could not select from. Each entry is now three lines — weight, import,
   and the call **alone** on its own line.

**And the numbers, again.** The per-service figures are not merely non-additive: about **74 kB** of
whichever service arrives first is a one-time `@angular/fire` base the rest then share (true increments
once paid: auth ~29, firestore ~100, storage ~24, functions ~15). Deferring also is not free — splitting
hoists `@firebase/app` into a shared chunk, ~9 kB on the initial bundle. App-check rides in with *any*
service, not with auth specifically. The headline delta in this document said 271 kB by comparing against
*no Firebase at all* rather than against the new default; it is 240 kB. Four surviving pre-measurement
estimates were replaced, including one in `HOUSE.md.tpl` — the surface consumers actually read.

**The one that was a process failure, not a code one:** the `app`-generator wiring fix was first recorded
here as "no migration owed", reasoning that the fix cannot reach projects on disk. That answers the wrong
question — the house asks whether the change *alters a shape projects on disk have*, and it does. Hence
`0.33.1/wire-missing-baseline-providers`.

## Follow-up worth its own effort

**There is no regression test for migrations.** The fixture suite written for this branch (an
`@nx/devkit` `Tree` with a worktree, a `dist/`, a nested checkout, a name collision, a subfolder call
site, two providers arrays in one file, and an unwired app) caught five of the eleven findings above and
now lives only in a scratch directory. The house already has `tools/test-scaffold/run.sh` for the
scaffolder's silent-regression guards; migrations deserve the same, and every rung added since 0.24.0
would be a case. Not built here — it is a tool with its own maintenance, and folding it into this branch
would be the ad-hoc mid-edit refactor the house rules forbid.
