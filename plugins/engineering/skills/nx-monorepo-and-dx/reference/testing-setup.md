# Testing Setup

Make tests cheap to write, fast to run, and resilient to refactors — by concentrating the setup and anchoring assertions to the **contract** (`architect-mentality` → *Concentrate complexity*; *Treat understanding and verification as first-class*).

---

## 1. Layer the configuration

**What.** Don't repeat test config per project. Layer it: framework preset → thin workspace preset → per-project config that Nx discovers.

```
jest.preset.js          // { ...nxPreset } — workspace defaults
libs/x/jest.config.ts   // extends the preset; project-specific bits only
```

**Why.** *Concentrate complexity* + *Work smart* — a 30-project workspace keeps one source of test config; a change lands once. (Older Nx used `getJestProjects()`; modern Nx infers/per-project — either way, layer, don't duplicate.)

---

## 2. Ship reusable test infrastructure as a `/testing` entry point

**What.** Package mocks, `setupX()` builders, and **spec factories** in a `/testing` entry point — consumed by your own specs *and* by library consumers.

```ts
// @scope/lib/testing
export function setupThingTest() { /* builds the harness, returns the deconstructable pieces */ }
export function produceFactoryProviderSpecs(/* … */) { /* emits a full describe() block of assertions */ }
```

**Why.** *Concentrate complexity* + *Design for the consumer* — adding a new variant comes with a battery of tests for one function call, and consumers test against the same scaffolding you do. (See `library-boundaries-and-entry-points.md` for the entry point.)

---

## 3. Mocks reuse the real infrastructure; fakes are honest

**What.** Mock at the **injection boundary** (swap a token/provider), and have mocks reuse the real abstractions so the thing under test is genuinely exercised. Make an unsupported mock method **throw with guidance** rather than silently returning a guess.

**Why.** *Design for the consumer* + *Understanding & verification first-class* — a mock that lies gives green tests and red production.

---

## 4. Test the contract, not the implementation

**What.** Assert observable behavior of the public API; don't reach into internals.

**Why.** *Treat understanding and verification as first-class* — verification anchored to *what a thing is supposed to do* survives internal refactors, so you can reshape freely (and it pairs with `architecture-first`'s design-and-confirm refactors). Implementation-coupled tests punish every refactor and discourage the very improvements you want.

## When NOT to

Don't build elaborate spec factories for a one-off unit (*Know when not to do it*). Reach for them when a *family* of similar units would otherwise copy-paste the same specs.

## Pitfalls

- Snapshot-everything tests assert implementation, not behavior — use sparingly.
- A `/testing` entry point that imports production-only code can drag it into bundles — keep it isolated.

---

**Mentality anchors:** *Concentrate complexity*, *Treat understanding and verification as first-class*, *Design for the consumer*, *Know when not to do it* — in the `architect-mentality` skill.
