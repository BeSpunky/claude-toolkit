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

## When NOT to use

Don't split a small, cohesive library into entry points it doesn't need — boundaries cost coordination (`architect-mentality` → *Know when not to do it*). Add an entry point when a part has a genuinely distinct consumer or concern.

## Pitfalls

- A near-empty `ng-package.json` is enough — don't duplicate package names/dest across secondary entry points (only the primary sets `dest`).
- Keep `exports`/path maps and the actual barrels in sync, or imports resolve in dev but fail when published.

---

**Mentality anchors:** *Everything is a black box*, *Place everything on purpose*, *Design for the consumer*, *Work smart* — in the `architect-mentality` skill.
