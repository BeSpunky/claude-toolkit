---
summary: Re-measure the initial-bundle figures the Firebase templates quote, now that new projects are Angular 21, AngularFire 21.0.0, firebase 12.19 and zoneless.
---

# Firebase bundle numbers, re-measured

The earlier measurements are in `docs/features/2026-08-10-firebase-bootstrap-split/DECISION.md`, left as written.

## Method

`house.sh new --local --preset=angular --firebase`, then `nx build proj --configuration=production --skip-nx-cache`,
varying only what `app.config.ts` provides. Resolved: `@angular/core` 21.2.25, `@angular/fire` 21.0.0, `firebase`
12.19.0 (declared `^12.18.0`), no `zone.js`. `Initial total` as printed; attribution from `--statsJson`.

| `app.config.ts` provides | raw | transfer | 2026-08-10 raw |
| --- | --- | --- | --- |
| nothing (no Firebase) | 210.01 kB | 56.37 kB | 207.44 kB |
| `provideAppFirebase()`, as generated | 241.29 kB | 65.25 kB | 238.42 kB |
| + auth | 319.28 kB | 85.33 kB | 341.56 kB |
| + firestore | 607.19 kB | 160.68 kB | 412.61 kB |
| + storage | 303.50 kB | 81.78 kB | 336.01 kB |
| + functions | 294.57 kB | 78.88 kB | 327.06 kB |
| + all four | 649.91 kB | 171.65 kB | 478.74 kB |
| all four minus auth | 621.82 kB | 164.52 kB | |
| all four minus firestore | 334.68 kB | 89.55 kB | |
| all four minus storage | 638.41 kB | 168.39 kB | |
| all four minus functions | 646.81 kB | 170.88 kB | |
| as generated, auth in a lazy route | 247.02 kB | 68.19 kB | |
| as generated, firestore in a lazy route | 247.66 kB | 68.51 kB | |
| as generated, storage in a lazy route | 247.61 kB | 68.40 kB | |
| as generated, functions in a lazy route | 247.10 kB | 68.22 kB | |

Derived: increments are all four minus the leave-one-out build (auth 28, firestore 315, storage 12, functions 3). The
one-time base is each service's delta over as-generated minus its increment, and came out at 50–51 kB for all four.
Lazy cost is 6 kB over as-generated, and includes the route that loads the chunk.

## Claims the numbers disproved

- "Each service after the first is far cheaper" is false for Firestore: it adds ~315 kB whenever it arrives.
- "App-check rides in with" Auth: the stats show `@firebase/app-check` (8 kB) in the initial chunk with every service,
  and absent as generated. `@firebase/auth` (38 kB) also rides in with every service.
- Firestore's weight being "@firebase/firestore plus its webchannel transport": `re2js` is the largest part, ~150 kB.

## Budgets

Angular's stock budget, as generated: warn at 500 kB, error at 1 MB. **Firestore at root now trips the warning on its
own** (607 kB; all four 650 kB). The build still succeeds, and no budget was changed. As generated and with any
Firestore-free set it stays under.

## Migration finding: nothing to migrate

No shape changes; only comment and doc text.

- **Owned, reaches existing projects on upgrade:** `firebase.config.ts` and the `firebase-*.config.ts` siblings
  (`writeFirebaseConfigs`), and `HOUSE.md`.
- **Written once, stays stale in existing projects:** the commented menu in `app.config.ts`, written by `wireProvider`
  only when it first wires `provideAppFirebase()`. It is project-owned, and the figures there are comments.

Figures now name the stack they were measured on, because an upgraded project keeps its own stack.

The 0.33.0 rung's log line and comments keep 479/238: they describe the projects that rung meets, not new ones.
