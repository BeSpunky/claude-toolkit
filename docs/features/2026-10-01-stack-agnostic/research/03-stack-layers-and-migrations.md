# Audit 3 — stack-specific generators, migrations, registry (2026-10-01)

Paths relative to `plugins/project-starter/skills/new-project/assets/nx-tools/src/`.

## Cross-layer coupling
- **F1 Firebase is welded to Angular.** `registry.ts:135` `firebase.requires: ['angular']`; `firebase-emulators/generator.ts:197` requires angular for the whole generator. Only the env-files pattern (`:261-335`), `fileReplacements` (`:449-493`), `provideAppFirebase()` wiring (`:522-549`), `@angular/fire` (`:574`) and the `@angular/*` boundary ban (`:517,872`) are Angular. `firebase.json`, `apphosting.yaml`, emulator/seed/secrets scripts, `apps/functions`, the workspace `firebase` project are framework-neutral. Also turns off the Nx TUI (`:252`) — unrelated. → `firebase` layer requires `nx` only; `firebase-client:<framework>` adapter does the client wiring.
- **F2 Design system is mostly neutral but built as an Angular lib.** `registry.ts:119` requires angular; built via `publishable-lib` → `@nx/angular:library`/ng-packagr; sass channel via `ng-package.json` + Angular `stylePreprocessorOptions`. Core (`_tokens.scss`, `_theme.scss`, `_functions.scss`, CSS vars) is neutral; only `src/lib/*.ts.tpl` (`ds-theme.service.ts`, `provideDesignSystem`) is Angular. → `design-tokens` core + per-framework adapter (style load path, runtime theme binding, component generator). `ds-component` = Angular adapter's component generator.
- **F3 Navigation** correctly Angular-only, but detected by hard-coded name `navigation-core` (`registry.ts:129`), hand-written files with no lib generator/tag (`navigation-core/generator.ts:32-47`), hard-coded `libs/` (`domain-navigation/generator.ts:47`).
- **F4 `app` bundles four concerns**: `@nx/angular:application` + `serve` + `serve-options` + `design-system-styles` + `firebase-emulators` (`app/generator.ts:95-160`). `serve` (claimed neutral) writes `@angular/build:dev-server` (`serve/generator.ts:58`) and an Angular tab-label into `app.config.ts` (`:162-195`). → `adapter.createApp` then each present capability `attach`es.
- **F5 "is Angular app" duplicated 3×**: `registry.ts:216`, `_utils/design-system.ts:57`, `serve/generator.ts:230`.

## Migrations
- No rung consults the layer registry; all guard on file evidence (firebase.json, app.config.ts, DS tag, devcontainer marker). Graph reads have raw-scan fallbacks — nothing crashes.
- **Real mis-edit risk — `0.24.0/unify-serve-targets.ts`**: renames/deletes any target named `serve-app|serve-standalone|serve-no-emulators|serve-with-emulators` by name only (`:155-174`); step 3b (`:229-233`) strips `options.host` from **any** `nx:run-commands` `serve` — a Python `uvicorn --host` serve would lose its host, contradicting its own comment (`:240-247`). Fix: gate 3b on `referencesCollapsedTarget(serve)`.
- 0.33.0/0.33.1 recognise apps by Angular-ish file names without saying so.
- Agent-only project: firebase/DS/app rungs no-op; devcontainer/CLAUDE.md/output-style/window-identity rungs apply — correct.
- **Non-Nx project: the ladder can't run at all** (`nx migrate` requires `nx`; `agent` requires `nx`, `registry.ts:71`).
- Suggest each migration declare its `layer` in `migrations.json`; runner skips absent layers.

## Generic concerns trapped in Angular generators
- Env files / per-env build config → an `env` capability with adapters.
- `publishable-lib`: Nx-generic but Angular-default with a `--nonAngular` boolean (`:83-94`) — a flagged anti-pattern; hard-codes `packages/` and `@bespunky` scope.
- `mark-extractable` detects Angular by regex (`:88`); `adopt-extracted:82` assumes `@bespunky`.
- Worktree tab label could be plain DOM, injected per adapter.

## Adapter shape (proposed)
`StackAdapter { id; requires; detect; ownsProject; createApp?; createLib?; devServer?; env?; providers?; styles?; designSystem? }` and `CapabilityLayer { requires; detect; ensure(tree); attach(tree, app, adapter) }`. Registry becomes open (registered, not a closed `LayerId` union, `registry.ts:29-55`). Missing port → reported, not crashed.
