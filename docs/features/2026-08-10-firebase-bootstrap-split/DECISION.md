# Decisions — splitting the generated Firebase bootstrap

*Live document. Appended as the work happens.*

## The shape: one file per service, split by WHEN the service is needed

`firebase.config.ts` keeps the Firebase **app** and nothing else — `provideFirebaseApp()`, the
production fail-loud config guard, and the dev-only emulator resolution helpers the siblings share.
Four new generator-owned siblings sit beside it:

| file | export | what it costs when unused |
| --- | --- | --- |
| `firebase.config.ts` | `provideAppFirebase()` | — (root; `@firebase/app` + `util`, ~23 kB) |
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
   first real screen pushed it over — which is exactly what happened to `our-journey` at 744 kB.

The delta the split actually buys a fresh app: **271 kB raw / 65 kB compressed** off the critical path.

## A pre-existing bug the verification exposed

The build came in at 207 kB — *no Firebase at all*. `provideAppFirebase()` had not been wired into
`app.config.ts`, and neither had `provideWorktreeTabLabel()`.

Cause: the `app` generator composes `serve`, `design-system-styles` and `firebase-emulators`, and passed
`wireProviders: true` to **only the design-system one**. The comment above that call states the principle
exactly — *"the app generator only ever runs to CREATE an app, so this IS the baseline write"* — and the
other two calls simply never got the flag.

So **no app the house scaffolder has ever created had its Firebase providers wired.** It went unnoticed
because the *sync* path passes `--wireProviders` on its own `nx g firebase-emulators` invocation and was
correct all along; only the scaffold path was silent. The failure surfaced far from its cause, at the app's
first `inject(Auth)`.

Fixed here (both calls now pass `wireProviders: true`). **No migration owed**: the `app` generator only ever
runs to create an app, so the fix cannot reach a project already on disk. An existing project that was
never wired is reported by the 0.33.0 migration as *"no `provideAppFirebase()` call found in a providers
array"* — which is the honest finding, and adding the call would be guessing at a decision the project may
have made deliberately.
