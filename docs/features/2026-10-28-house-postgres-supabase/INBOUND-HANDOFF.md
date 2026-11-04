# Inbound handoff: Postgres and Supabase as house layers

> Written 2026-10-28 by the agent that ran the concept session for a new consumer project (a personal "life app", not yet scaffolded, no name yet). Recipient: the agent in charge of claude-toolkit. Branch `feat/house-postgres-supabase`, worktree `.claude/worktrees/house-postgres-supabase`, opened from `development` at `43e2af1d`.
>
> **Status: nothing is implemented.** This document is input, not a plan. As with the Firebase handoff (`../2026-10-07-house-firebase-handoff/`), analyse it against the code, verify what it claims, disagree where the evidence says so, and write your own `PLAN.md` before building anything.

## 1. The mission

In the user's words: *"I want the toolkit to support Supabase and Postgres correctly and officially."*

"Officially" means first-class, the way `firebase` is today:
- a registered layer in `layers/registry.ts`, ensurable by `new` and `add-layer`, and detected and refreshed by `upgrade`;
- its devcontainer fragment, house-doc sections, `HOUSE.rules.md` directives where they apply, and generator-owned tooling;
- dogfooded through the release gate (`CLAUDE.md` → *Release & versioning*);
- documented in the `new` skill's per-layer requirements, the verify table, and `README.md`.

"Correctly" means it should not repeat the iteration history of the Firebase layer (§ 4). It must carry over the guarantees that history produced: version truth, nothing local reaches production, stack identity per worktree, and declared deploys.

## 2. Why this came up: the consumer project

The user is designing an app they described as *"my personal home where I can find everything in one spot"*. It is a small kernel (typed records, a link graph across modules, contracts, a command registry, an event log, life "periods"), with plug-in modules (finance with forecasting, learning with per-subject skill models, journal, goals, shopping, smart home) and AI at its core. Facts the session settled with the user, in order:

| Topic | Decision | User's words, where they gave them |
|---|---|---|
| Users | Single fixed user now; login and tenants later. `tenant_id` on every row from day one | — |
| Integrations | Every integration is a provider behind a domain contract (finance via Financy's API first; smart home via Home Assistant) | *"we architect the app so Financy is a plugged provider, not infrastructure"* |
| Backend | In the cloud | *"Backend lives in the cloud"* |
| Client | Mobile-first, plus desktop, from one Angular codebase | *"The concept I'm bringing you is a mobile app first"*, *"I'd want it on desktops"* |
| Shell | Tauri 2 for both mobile and desktop; Capacitor only if Tauri fails on mobile. The app never imports the shell directly, only a platform contract | *"let's use Tauri anyways, and if there's any problem, we incorporate capacitor"* |
| First platforms | Android and Linux | *"Android and linux"* |
| Database | Postgres was recommended over Firestore Enterprise (§ 3). The user never formally answered the either/or. **This request is their direction to make Postgres/Supabase a first-class house option.** Treat the consumer's choice as Postgres unless they say otherwise | — |
| Hosting the database | Any Postgres host via a connection string; Supabase or Neon are both candidates (§ 5) | — |

What the consumer's data layer must do, because it shapes what the layers must support:
- record types defined at runtime (JSON columns with indexes);
- cross-module queries and forecasting aggregates;
- AI-generated SQL;
- vector search (pgvector);
- an append-only event log;
- scheduled and event-driven background agents;
- offline use on the phone through a sync engine (later; § 6);
- row-level security keyed on `tenant_id`.

**Architecture point that matters for the layer design:** the phone and desktop apps talk to the consumer's **own Nx backend app**, and only the backend holds a database connection. The client never dials Postgres or Supabase directly. Supabase's client SDK may come in later for Auth or Storage only.

## 3. Research already done (2026-10-28) — verify before relying on it

**Firestore vs Postgres** (why Postgres was recommended). Firebase's 2026 releases changed the picture, so this is recorded in full:
- **Firestore Enterprise "Pipelines"** went GA in April 2026. It adds grouped aggregates, joins through subqueries, and queries with no prepared index (just slower). Full-text and geospatial search are **preview**. Pipeline queries have **no realtime and no offline**, and the emulator **does not run them**, which breaks the house's emulator-first local loop for exactly the analytics and AI query layer. Enterprise is a separate database type: no in-place upgrade from Standard. Limits: 60 s and 128 MiB per query.
- **Data Connect was renamed Firebase SQL Connect.** It is Cloud SQL Postgres with native SQL in *pre-deployed* operations, realtime via `@refresh`, and a query/entity **read** cache; no offline writes were documented. Pricing: $0.90 per million operations from May 1, plus the Cloud SQL instance after the trial. Arbitrary runtime (AI-written) SQL would need a direct server connection.
- **The recommendation rested on:** AI-written SQL is far more proven than generated Pipelines; local development can cover the core query layer; portability; and the Pipelines query language being Firestore-only lock-in. Firebase's remaining edge is offline writes built in, plus the existing house layer.
- Sources: [Pipelines GA](https://firebase.blog/posts/2026/04/firestore-pipelines-ga/), [Cloud Next 2026](https://firebase.blog/posts/2026/04/cloud-next-2026-announcements/), [SQL Connect](https://firebase.blog/posts/2026/04/whats-new-sql-connect), [Pipelines docs](https://firebase.google.com/docs/firestore/pipelines/get-started-with-pipelines), [offline](https://docs.cloud.google.com/firestore/native/docs/manage-data/enable-offline), [InfoQ](https://www.infoq.com/news/2026/02/firestore-enterprise-pipeline/).

**Supabase pricing** ([supabase.com/pricing](https://supabase.com/pricing)):
- **Free:** 500 MB database, 1 GB storage, 5 GB egress, 2 active projects, **paused after 1 week of inactivity, no backups**.
- **Pro:** from $25 a month with a $10 compute credit, 8 GB disk, daily backups kept 7 days, never paused. Point-in-time recovery is a $100-a-month add-on.
- A **spend cap** is on by default; some provisioned items (compute, replicas) sit outside it.

**Neon** (secondary sources; confirm on [neon.com](https://neon.com/docs/introduction/about-billing.md)): usage-based with **no monthly minimum**, scale-to-zero, a permanent free plan. The entry plan is about $0.106 per compute-unit-hour and storage about $0.35 per GB-month. A sync engine's always-open replication connection prevents scale-to-zero: roughly $19 a month at 0.25 CU running around the clock.

**Supabase vs Firebase, piece by piece** (from general knowledge, not re-verified):

| Firebase | Supabase |
|---|---|
| Firestore | Postgres |
| Auth | Supabase Auth (GoTrue) |
| Storage | Supabase Storage |
| Firestore live listeners | Realtime |
| Cloud Functions | Edge Functions (Deno) |
| Scheduled functions | `pg_cron` |

Supabase has **no** offline sync, **no** push notifications (Firebase Cloud Messaging is used regardless), and **no** hosting for a Node backend.

**Not verified, but load-bearing — check first:**
- The local Supabase stack (`supabase start`) needs **Docker**. House devcontainers have none, which is why the house uses no docker-in-docker today. Decide how the `supabase` layer runs its local services: an opt-in Docker-in-Docker or Docker-outside-of-Docker feature, or something else. This is the biggest design question in the Supabase half.
- pgvector packaging for the devcontainer's Debian base. Debian's own `postgresql-NN-pgvector` may be old, so the PGDG apt repository may be needed. Match the Postgres major to the production host (Supabase and Neon versions differ).
- The Supabase CLI ships as the npm package `supabase` (pin it as a devDependency, in line with the version-truth rule).

## 4. How the Firebase layer's history maps onto Postgres

The session read `layers/firebase.ts` and measured the layer on this branch's base: about 5,500 lines across `generators/firebase-emulators`, `generators/firebase-client`, the Angular adapter's Firebase port and the descriptor. **10 of the 24 migration folders** touch Firebase (27 files). It did **not** read every revision. Most iterations trace to causes that a backend-held connection removes:

| Firebase pain (in the code today) | Root cause | With Postgres behind our own backend |
|---|---|---|
| Ports forwarded to the identical number; parallel-container conflicts; origin routing (0.50.0) | The SDK *in the browser* dials emulators at hardcoded ports | Gone. The client never reaches the database |
| Process reaping and stack locks (once `reap-emulators.sh`, now in the dev engine's `stacks.mjs` and the port tooling) | Emulators on the JVM leave orphaned processes | Mostly gone. One well-behaved process, still started and stopped through the dev engine's stack handling |
| Per-service toggles, `emulator-overrides`, the `ngDevMode` dead-code gate, provider splitting | Several client SDK services wired in the browser | Gone. One connection string, held by the backend |
| Data saved only on clean exit, data swaps between worktrees (D1 in the Firebase effort) | The emulator export model | Replaced by migrations, a seed, and **a database per stack** |
| Environment-shape migrations (0.24.x) | Client-side config shape | Gone with the client config |

**What carries over and must hold from day one** (the guarantees the Firebase effort paid for; read its `PLAN.md` *Cross-cutting concepts*):
1. **Version truth.** Postgres major, the pgvector version, the Supabase CLI and any driver are pinned in one place. Generators never write floating ranges.
2. **Nothing local reaches production.** Production connection strings never land in local env files. `seed` and `reset` refuse any non-local host. Worktrees never borrow another tree's secrets. Agent runs never use the default port (the local-server rule).
3. **Stack identity.** Each dev stack (tree plus offset) gets its own database on the shared local server, or its own server on the offset port; decide which. Its connection string reaches its processes through `dev.json` env, never through a shared file.
4. **Declared deploys.** Migration deploy (`supabase db push`, or the neutral runner against `DATABASE_URL`) is an owned target with correct `inputs`, so `nx affected` sees schema changes. It is optionally wired into the existing `ci` layer.
5. **Generator-owned vs seeded.** Templates and tooling are owned (class A). The project's migrations and seed world are seeded and never rewritten (class C), exactly like `tools/seed/world.mjs`.

## 5. Implementation ideas (proposals, not decisions)

**`postgres` layer** — `requires: ['nx']`, probably plus `node` if the tooling runs on Node. Evidence: a marker file such as `postgres/project.json` or a declaration in `.bespunky/`; choose one so `upgrade` can detect it.
- Postgres plus pgvector in the devcontainer, through `os-packages` or a feature, not Docker. Data persisted across rebuilds (a named volume, like the Playwright cache).
- **`wal_level=logical` on from the start**, so a future sync layer (§ 6) works without a config migration.
- A workspace Nx project (like `firebase/project.json`) with `db:start`, `db:migrate`, `db:new-migration`, `db:seed`, `db:reset`, `db:psql`, all through one launch script (like `tools/emulators.sh`).
- **Migrations: one source of truth across both layers.** A stack-neutral, plain-SQL runner, so a Python or Go project gets the same layer; any typed query layer comes through a stack adapter, not the core. Open question: if `supabase` is worn, does its CLI read the same directory (`supabase/migrations`), or does the core runner stay authoritative and Supabase just receive the SQL? Don't create two folders.
- A declarative seed world. A fast reset, for example `CREATE DATABASE … TEMPLATE`, which also gives fast per-test isolation.
- The database as a process in the dev engine (`devFragment`, like `firebaseFragment`), with readiness, so `nx serve <app>` brings it up beside the backend. **No database configuration in client bundles.**
- `HOUSE.md` section: connecting, migrations, seed and reset, safety rules, and how to connect a hosted provider (Supabase, Neon, Cloud SQL). Hosting is just a connection string, so the core needs no provider code.

**`supabase` layer** — `requires: ['postgres']`. Evidence: `supabase/config.toml`.
- The Supabase CLI pinned as a devDependency; a generator-owned `supabase/config.toml` (keep the project's own keys, as `firebase.json` does).
- The local stack for Auth, Storage, Realtime and Edge Functions, behind the Docker decision (§ 3). Consider letting the project serve against plain local Postgres until it actually uses a Supabase-only service.
- Human-run linking (`supabase login`, `supabase link`), the same stance as `firebase use --add`: the toolkit never fabricates cloud state.
- Generated types (`supabase gen types`), secrets (`supabase secrets set`, via stdin like `push-secrets.sh`), migration deploy as an owned target.
- An optional **client port** on stack adapters for supabase-js (Auth and Storage), mirroring `FirebaseClientPort`, attached per app. Backend-only projects get the core and nothing to attach to, which the Firebase layer already treats as a legitimate shape.
- Row-level security guidance (policies keyed on a tenant claim) as house docs. Consider a `HOUSE.rules.md` directive only if it must hold on every change.

**Also expected:** the `new` skill (preset or `--add-layer` docs, verify-table rows, report-back text), `README.md`, `engine/layers.sh` regenerated (`node tools/test-layers/run.mjs --write`), fixture tests in `tools/test-layers` and `tools/test-migrations`, `dogfood-consumer` coverage, and plugin plus payload bumps via `nx release`. A brand-new layer probably owes **no migration**, but state that finding explicitly in the release commit (`CLAUDE.md` rule).

## 6. Related gaps the consumer needs — separate efforts, not this one

Name them in your `PLAN.md` so the design leaves room for them; don't build them here:
- **A server-app stack adapter.** Today only the Angular adapter has an `apps` port; `js` makes libraries only. The consumer's backend (Node, e.g. Fastify or NestJS) can't be created by `nx g @bespunky/nx-tools:app` yet. The `postgres` layer's per-app step, if any, will attach to it. Until then, a postgres-only workspace is "core only", not partial.
- **A `tauri` layer.** Rust, the Android SDK and NDK in the devcontainer, Tauri's Linux and Android targets, and reaching a USB or wireless phone or an emulator from the container. Expected to be the hardest of the consumer's toolkit needs.
- **A sync-engine layer** (e.g. PowerSync or Electric: SQLite on the device synced to Postgres). Its local service may also need Docker. The `postgres` layer must leave logical replication on for it.

## 7. Practical notes for the recipient

- **The host has no Node** (`node: command not found` on 2026-10-28). The branch engine (`branches.mjs`) couldn't run, so this worktree was opened by hand to the model's shape: `{type}/{slug}` off `development`. Do the work inside the devcontainer.
- Local `development` was **4 commits ahead of `origin/development`** when this branch was cut. Rebase before landing, as usual.
- Follow the house's own process: architecture-first, generator-first, delegate-and-parallelize with a ledger in `handoffs/`, and the finish gate (dogfood on this repo **and** on a consumer, and a container rebuild where the devcontainer changes) before any release.
- Ask the user before any backwards-compatibility decision, as its own question. None is expected for new layers.
- The consumer project doesn't exist yet. When these layers ship, it will be scaffolded with them, which makes it a natural first real consumer for dogfooding.
