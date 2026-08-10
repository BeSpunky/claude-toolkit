# Brief — the generated Firebase bootstrap puts the whole SDK on the critical path

*Opened 2026-08-10. Slug `firebase-bootstrap-split`.*

## Where it came from

A consuming project (`our-journey`) measured its production build and sent two documents upstream:
`BUNDLE-REFACTOR.md` (its own local decision) and `TOOLKIT-HANDOFF-firebase-bootstrap.md` (a report
addressed to this repo). The user's instruction there:

> *"Fix budget now, write a handoff doc I can give to the agent in charge of the generator-owned
> files so it refactors the generated code to avoid this problem."*

The handoff was reviewed here rather than executed. Its **defect report is correct**; several of its
**ownership claims are not**, and acting on them would have built things we already ship or changed
files we do not own.

## The defect (verified in this repo)

`src/generators/firebase-emulators/firebase.config.ts.tpl` statically imports all four
`@angular/fire` entry points, and `provideAppFirebase()` returns providers for all four services.
`generator.ts` wires that one call into the app's `app.config.ts` **root** providers.

Root providers are reached from `main`, so **Auth, Firestore, Storage and Functions are pinned into
the initial chunk of every house-scaffolded Firebase app**, whether or not the app uses them — and
AngularFire instantiates each eagerly at bootstrap, so it is execution time as well as bytes. The
file is rewritten in full on every `--sync`, so no consuming project can fix it locally.

Measured by the consuming project (raw kB, initial chunk):

| | raw kB | on the critical path? |
| --- | --- | --- |
| `@firebase/firestore` | 183.6 | no |
| `@angular/core` | 126.2 | yes |
| `@angular/router` | 78.6 | yes |
| `@firebase/auth` | 76.6 | only for an auth-gated app |
| `@firebase/webchannel-wrapper` | 51.1 | no (firestore's transport) |
| `@firebase/storage` | 21.7 | no |
| `@firebase/util` | 13.7 | yes (shared) |
| `@firebase/app` | 9.3 | yes |
| `@firebase/app-check` | 8.3 | no — rides in behind auth, never configured |

## What the handoff got wrong

Recorded because each one would have sent the work somewhere useless:

- **"The generated default budget is 500 kB."** We never write budgets — `rg budgets` over the whole
  payload returns a single hit, and it is a prose comment; no generator writes a `budgets` key. The 500 kB is Angular's stock default, emitted by `@nx/angular:application`,
  which our `app` generator delegates to. So the consuming project's build **warns**, it does not
  fail (the stock error threshold is 1 MB), and "reconsider the generator's default budget" asks us
  to change a number we do not own.
- **"The generated auth guard runs before a screen is chosen."** We generate no guard. `stand.guard.ts`
  is the consuming project's own code.
- **"The generator scaffolds the library layout … it should emit secondary entry points on the data
  library."** We do not lay out their `libs/spine`, and `nx g @bespunky/nx-tools:secondary-entrypoint`
  already exists. Severing that barrel is available to them today, with no toolkit change.
- **"`@firebase/functions` tree-shakes to 0 kB — yet `provideFunctions` still pins the import."**
  Self-contradictory, and `@firebase/functions` appears nowhere in their own table. Treated here as a
  gap in the measurement, not a finding.

## The ask

Make the generated Firebase seam pay for services **where and when they are used**, without breaking
any project already on disk.
