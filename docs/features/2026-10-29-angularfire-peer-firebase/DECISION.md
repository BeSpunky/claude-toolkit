---
effort: angularfire-peer-firebase
status: concluded
concluded: 2026-11-02
summary: Shipped nx-tools 0.51.1 to unblock the stalled 0.51.0 publish — AngularFire 22's firebase is read as a peer, both upstream tables refreshed, so new Angular + Firebase projects start on Angular 21 and Node 26 becomes the newest LTS.
tags: [nx-tools-0.51.1, firebase-compat, node-facts, angular-21, publish]
---

# Unblocking the publish

Promoting 0.51.0 to `main` failed at `publish.sh`'s upstream-table check: `@angular/fire` 22 moved `firebase` from `dependencies` to `peerDependencies`, and the projection treated that as fatal. `house.sh` pins a project's nx-tools to its engine's version, so until a release publishes, a consumer who updates the plugin cannot upgrade or create a project.

## Decided

- **Refresh, never bypass the check.** Offered a hand-publish past the guard or the full refresh, the user answered *"yes"* to: *"go ahead with 0.51.1, which also moves new Angular + Firebase projects to Angular 21 and makes Node 26 the newest LTS"*. 0.51.0 never reaches npm.
- **A peer is not a dependency.** The range means the same to the root, but a peer cannot nest a second SDK, so a root inside its range is accepted and an unmet one has its own message.
- **Nothing to migrate.** Tables are read at decision time; existing projects keep the pins they declare; the 0.50.0 rungs read frozen tables. One deliberate movement: a project whose `.nvmrc` is the alias `lts/*` (or `lts/-1`) moves an image major on upgrade, through regenerated owned artifacts, and is told — that is what the alias says. Observed on a real project (24 → 26). Functions stay on engines 24, since 26 is not a GA runtime, and the project is told so.

## What the review caught

The refreshed tables themselves carried two release blockers, both invisible to the suites: `v27.0.0-alpha` counted as a release (refusing every `.nvmrc = node` project), and Angular 21's TypeScript pin `~6.0.3`, which `@angular/build`, `ng-packagr` and `@angular/fire` all refuse. Both are fixed in the projectors, not the tables. Ledger: `reviews/20261102-sanity-review.md`.

## Left for later, deliberately

- **`nx test design-system` fails on Angular 21+** — the library ships no spec. Pre-existing: a plain `new --preset=angular` on Angular 22 fails the same way; this release only widens it to Firebase scaffolds. Options and their migration cost: the ledger.
- The next real odd Current Node (27, due 2027-04-22): `.nvmrc = node` projects are refused if no `:27` image exists. Documented behaviour.
- A standalone publishable lib's lint failure (unused `@angular/common` peer), bundle-size numbers measured on an older stack, and `bespunky-angular`'s reference still calling zoneless "the direction of travel".
