# Decoupling & Dependency Inversion

Keep each unit a black box that depends on **contracts**, not concretions, and make dependencies point in a deliberate direction (`architect-mentality` → *Everything is a black box*; *Define the seam; let others plug in*). This is the agnostic root of Angular DI and Nx module boundaries.

---

## 1. Depend on an abstraction, owned by the consumer

**What.** Instead of a unit reaching for a concrete collaborator, it declares the *capability it needs* as an interface/port and receives an implementation from outside.

```ts
interface Clock { now(): Date; }                       // the port — the consumer's need
class Scheduler { constructor(private clock: Clock) {} } // depends on the port, not on SystemClock
// SystemClock / FakeClock implement Clock; one is provided at the composition root
```

**Why.** *Define the seam* — the collaborator becomes substitutable and testable, and `Scheduler` knows nothing of where `now()` comes from.

---

## 2. Ports & adapters (hexagonal)

**What.** The core domain depends only on **ports** (interfaces). The outside world — database, HTTP, UI, third-party SDKs — provides **adapters** that implement those ports. All dependencies point *inward*, toward the core.

**Why.** *Everything is a black box* — infrastructure is swappable plumbing at the edges; the core is pure and stable. You can replace the DB or the transport without touching domain logic.

---

## 3. Dependency direction & layering

**What.** Decide, deliberately, which way dependencies flow, and keep them one-directional: shared/stable things are depended *upon*; they don't depend on volatile/specific things. A common layering: `util ← data ← feature ← app`; presentation is never depended upon by lower layers.

**Why.** *Everything is a black box* (directed connections) — a dependency graph with a consistent direction has no cycles and a clear "stable core, volatile edges" shape. (Nx enforces exactly this with tags — see `nx-monorepo-and-dx` → module-boundary-enforcement; here it's the agnostic principle.)

---

## 4. Invert control: the assembler provides, the component consumes

**What.** Push the choice of concrete collaborators *out* to a composition root; components declare needs and are wired together there.

**Why.** *Define the seam* — components become reusable and testable because nothing concrete is hard-wired inside them.

## When NOT to use

Don't add a port/interface for a single, stable implementation that will never vary and crosses no test or deployment boundary — that's indirection with no payoff (`architect-mentality` → *Know when not to do it*). Introduce the seam **where variation, testing, or a real boundary actually exists**.

## Pitfalls

- An interface with one forever-implementation, named `IThing`, is usually noise.
- "Decoupling" that just moves the coupling into a tangle of indirection is not decoupling — the goal is fewer, clearer, directed connections, not more layers.

---

**Mentality anchors:** *Everything is a black box*, *Define the seam; let others plug in*, *Know when not to do it* — in the `architect-mentality` skill.
