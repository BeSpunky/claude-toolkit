# Library Boundaries & Entry Points

A library is a **black box**: a boundary, a deliberate public contract, hidden internals (`architect-mentality` → *Everything is a black box*; *Place everything on purpose*; *Design for the consumer*). Entry points are how you make that contract physical and tree-shakable.

---

## 1. One folder = one entry point

**What.** Split a library into independently-importable entry points by physical folder, so consumers import only what they use and each surface is its own boundary.

- **Angular libraries (ng-packagr):** every folder with an `ng-package.json` becomes a secondary entry point (`@scope/lib`, `@scope/lib/core`, `@scope/lib/testing`). The config is minimal:
  ```json
  // libs/zen/core/ng-package.json
  { "lib": { "entryFile": "src/index.ts" } }
  ```
- **General TS libraries:** declare subpaths in the package `exports` map.
  ```json
  { "exports": { ".": "./dist/index.js", "./core": "./dist/core/index.js" } }
  ```

**Why.** *Everything is a black box* + *Work smart* — physical separation gives tree-shaking and API boundaries for free; the presence of the entry-point config is the *only* thing that declares the boundary.

---

## 2. Ship test utilities as a dedicated `/testing` entry point

**What.** Put mocks, harnesses, and spec helpers in their own entry point (`@scope/lib/testing`).

**Why.** *Place everything on purpose* — test-only code never leaks into a production bundle, and consumers get the same scaffolding you use. (See `testing-setup.md`.)

---

## 3. The public-API barrel is the contract — keep it minimal

**What.** Each entry point's `index.ts` re-exports only what's truly public; internals are simply not exported.

**Why.** *Everything is a black box* (small public surface) + *Design for the consumer* — what you export, you must support. A root barrel may deliberately omit generic utils/test entry points so they're imported explicitly, signalling they're a separate concern.

---

## 4. Dogfood your own subpaths via tsconfig path mapping

**What.** Map every published subpath to its source in `tsconfig.base.json`, and have the library's *own* code import through those subpaths — not relative `../../core`.

```jsonc
// tsconfig.base.json
"paths": {
  "@scope/lib":         ["libs/lib/src/index.ts"],
  "@scope/lib/core":    ["libs/lib/core/src/index.ts"],
  "@scope/lib/testing": ["libs/lib/testing/src/index.ts"]
}
```

**Why.** *Design for the consumer* — your in-repo experience equals a consumer's, and you're forced to respect your own boundaries. **If an internal import needs something a subpath's barrel doesn't export, that's a design smell** (a missing public concept), not a reason to reach in relatively.

---

## 5. Styles are an entry point too

**What.** A design-system library publishes **three kinds** of surface, and each needs its own declared entry point:

- **The SASS API** — a *zero-output* barrel of functions/mixins/placeholders (`@use`-ing it must emit no CSS), plus the one mixin that emits the token block. Published via the package's `exports` map (`"./styles": { "sass": … }`) with the raw `.scss` shipped to `dist` as an asset; resolved **in-repo via a sass load path**, because SASS cannot read `tsconfig` paths and a paths-linked workspace has no `node_modules` symlink for it to find.
- **The primary TS entry point** — in a design system, deliberately tiny (the theming service, and little else).
- **One secondary entry point per component** — `@scope/design-system/button` — so each tree-shakes independently and is its own boundary.

And within each, **public vs private is enforced twice**: at the export level (`@forward … show` for SASS, `index.ts` for TS) *and* structurally — the implementation lives in **`_`-prefixed folders named for what they are** (`_core`, `_utils`, `_parts`), never a bucket called `internal`: the `_` already says *private*, so spend the name on saying *what it is*. Adding a member does not publish it — publishing is a deliberate act, performed in the barrel.

**Why.** The same *one folder = one entry point* rule, applied to styling: **the presence of the entry-point config is the only thing that declares the boundary.** A style surface with no declared entry point is not a private API — it is a **global**. And a component folder without an `ng-package.json` resolves in the editor (the path alias sees it) and then **vanishes on publish**, because ng-packagr never knew it existed — a failure that surfaces at a consumer's install, not in your build.

> ⚠️ **The cache trap.** An app consuming a library's SASS through a **load path** creates **no edge in the Nx project graph** on its own (a load path is not a TS import). If nothing else couples them, editing a token does **not** invalidate the app's build cache and Nx replays a stale bundle. Declare the dependency **explicitly** with `implicitDependencies` on the app — a real graph edge, so `nx affected` stays correct — **not** a hand-rolled `inputs` array (which overrides the target's inferred inputs and hard-fails on a workspace missing the named input you referenced).

See `bespunky-design-system:design-tokens-and-theming` → *The DS library — structure & entry points*.

---

## When NOT to use

Don't split a small, cohesive library into entry points it doesn't need — boundaries cost coordination (`architect-mentality` → *Know when not to do it*). Add an entry point when a part has a genuinely distinct consumer or concern.

## Pitfalls

- A near-empty `ng-package.json` is enough — don't duplicate package names/dest across secondary entry points (only the primary sets `dest`).
- Keep `exports`/path maps and the actual barrels in sync, or imports resolve in dev but fail when published.

---

**Mentality anchors:** *Everything is a black box*, *Place everything on purpose*, *Design for the consumer*, *Work smart* — in the `architect-mentality` skill.
