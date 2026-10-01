# Contract — stack adapters and capability attachment (phase 4)

> Owner: U-adapt. Code: `plugins/project-starter/skills/new-project/assets/nx-tools/src/adapters/`.

## Stacks vs capabilities

- A **stack** (`angular`, `js`; later `react-vite`, …) builds things. It is a `StackAdapter`
  (`adapters/stack-adapter.ts`), registered in `adapters/registry.ts` (`ADAPTERS`, most specific first).
- A **capability** (`firebase`, `design-system`, `navigation`, `web`, …) is what a project wears. It does its
  framework-neutral part itself and reaches an app ONLY through that app's adapter's ports.

| port | meaning | Angular | caller |
|---|---|---|---|
| `ownsProject(tree, p)` | THE one "is this an X project" rule (app or lib) | build executor `@angular/build:` / `@angular-devkit/build-angular:` / `@nx/angular:`, or `ng-package.json` | everything |
| `apps.create` | create an app with house defaults | `@nx/angular:application` | `app` |
| `libs.create / normalizePackaging / allowDependencies` | create a lib; packager post-processing | `@nx/angular:library`; ng-package.json | `publishable-lib`, `navigation-core` |
| `env.files / selectFor` | per-env config files; select one per build configuration | `src/environments/*`, `fileReplacements` | Angular firebase client |
| `providers.bootstrapFile / wire` | wire a provider into the app bootstrap | `app.config.ts` via `wireProvider` | design-system-styles, firebase client |
| `styles.globalStylesheet / addLoadPath / registerStylesheet` | sass channel; standalone stylesheet bundles | `stylePreprocessorOptions`, `build.options.styles` | design-system-styles, ds-theme |
| `designSystem` | the DS binding: runtime templates, provider, ng-packagr channel, prune | `adapters/angular/design-system*` | design-system |
| `firebase` | the Firebase client half: `isWired`, `attach`, `serverBannedImports` | `adapters/angular/firebase-client.ts` (templates stay in `generators/firebase-emulators/` — shipped migrations resolve them there) | firebase-client, firebase-emulators |

`portOf(tree, project, port, capability, what)` returns the port or **reports** (logger.warn) and returns null — a
missing port never crashes. `applicationsWith(tree, port)` lists the apps a capability can attach to.

## Attachment

A capability's per-app steps are its layer descriptor's `generators.app`. A sync runs them for the sync's app; the
`app` generator runs the SAME steps for a new app (`generators/app/attach.ts`, in-process, argv parsed back to
options, every active layer counted as ensured). `scaffold.sh` passes `--layers=$ENSURED` to `app` because at
first-app time nothing ensured exists yet.

## Layer re-cut (this unit)

`firebase[nx]` (app step `firebase-client`, workspace step `firebase-emulators` = neutral core),
`design-system[nx]` (app step `design-system-styles`, workspace step `design-system`), `navigation[angular]`
detected by tag `type:navigation` (migration `0.35.0/tag-navigation-library`).

## Adding a stack

Write `adapters/<id>.ts` with the ports it can honour, register it in `ADAPTERS` and its layer in the layer
registry. No capability generator changes.
