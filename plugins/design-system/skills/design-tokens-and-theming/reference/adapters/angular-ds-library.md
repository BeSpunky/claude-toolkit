# Angular adapter — the DS library on ng-packagr

The framework-neutral structure is in `reference/ds-library-structure-and-entrypoints.md` — read that first.
This file is its **Angular spelling**: the entry-point boundary is an **ng-packagr secondary entry point**, and in
a house project it is generated. It applies when the project wears Angular and the design-system layer (a house
project's `HOUSE.md` stamp lists `angular` and `design-system` in `layers=`) — the house design-system layer is
built on this adapter today.

## The shape, on ng-packagr

```
<libsDir>/design-system/          the workspace's libraries dir (e.g. packages/, libs/)
├── ng-package.json              the PRIMARY entry point (@scope/design-system)
├── styles/ …                    as in the core
├── src/index.ts                 ★ PUBLIC — e.g. provideDesignSystem(), DsTheme
└── button/                      one promoted component = one SECONDARY ENTRY POINT
    ├── ng-package.json          ← THIS FILE IS THE BOUNDARY
    └── src/
        ├── index.ts             ★ PUBLIC — the entry's contract
        ├── button.component.ts
        └── _parts/
```

The primary TS entry point carries the theming service (the house `DsTheme`) and the app-facing provider; each
component is a secondary entry point, importable as `@scope/design-system/<name>`.

## Adding a component is a generator call

```bash
nx g @bespunky/nx-tools:ds-component button
```

**Never hand-create the folder.** The `ng-package.json` **is** the entry point. Without it, the component still
*resolves in your editor* (the tsconfig path alias sees the file), it still compiles, and it still works in dev —
and then it **vanishes from the published package**, because ng-packagr never knew the entry existed. The
failure surfaces at a consumer's `npm install`, weeks later.

The generator also wires the entry's own sass load path (`ng-package.json` → `lib.styleIncludePaths`, because
ng-packagr does *not* read the app's builder options) and seeds a SCSS in which every value is already a token.

## Why one entry per component matters more on Angular

Bundlers tree-shake better than they used to, but **Angular components with providers and side-effectful
decorators are exactly the case where they don't** — a shared `components` barrel drags every component's
providers in with the one you imported. One secondary entry point per component is what makes the deep import
actually cheap.

## Pitfalls

- **A hand-made component folder** without its `ng-package.json` — resolves in dev, missing from the package.
- **Expecting the app's `stylePreprocessorOptions.includePaths` to reach the library build** — ng-packagr has
  its own channel (`styleIncludePaths`); the generator sets it.
- **A DS component that injects an app service** — it was never publishable.

> **Related.** `reference/ds-library-structure-and-entrypoints.md` (the neutral structure this adapts) ·
> `reference/adapters/angular-encapsulation.md` (the styling contract on Angular) ·
> `bespunky-angular:angular-architecture` (providers, DI, component API) ·
> `bespunky-engineering:nx-monorepo-and-dx` (secondary entry points in general).
