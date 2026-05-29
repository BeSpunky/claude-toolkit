# Contracts & API Design

A unit's public surface is a promise you must keep. Design it small, predictable, hard to misuse, and honest (`architect-mentality` → *Design for the consumer*; *Abstractions must never trap*; *Everything is a black box*).

---

## 1. Minimal surface

**What.** Expose the least that is genuinely useful. Everything public is a commitment you'll have to support and can't change freely.

**Why.** *Everything is a black box* (small contract) — a narrow surface is easier to learn, to keep stable, and to reason about; internals stay free to change.

---

## 2. Hard to misuse — make the wrong call impossible

**What.** Use the type system to forbid invalid usage: required vs optional on purpose, illegal argument combinations made unrepresentable (see `domain-modeling.md`), the correct order/shape the *only* one that compiles.

```ts
// not connect(host?, port?, tls?)  — where some combos are invalid;
// model the valid shapes so an invalid call won't type-check
type Endpoint = { kind: 'tls'; host: string; cert: Cert } | { kind: 'plain'; host: string };
```

**Why.** *Design for the consumer* — the easiest way to use it is the correct way; mistakes are caught at compile time, not in production.

---

## 3. Command–Query Separation

**What.** A method either **does** something (a command, changes state) or **answers** something (a query, returns data) — not both in a surprising way. A getter doesn't mutate; a mutator doesn't return a value you'd mistake for a query.

**Why.** *Design for the consumer* + predictability — callers reason about effects without fear of hidden ones.

---

## 4. Guessable naming & symmetry

**What.** One naming convention applied everywhere; symmetric operations named symmetrically (`open`/`close`, `add`/`remove`, `subscribe`/`unsubscribe`). Names state intent — never the architectural role.

**Why.** *Lead with one mental model* — learn the convention once, predict the rest of the API without the reference.

For the deeper naming rules — **name by purpose not architectural role** (no `Service`/`Manager`/`Facade`/`Util`/`Handler`…), intention-revealing names, ubiquitous language — see `naming.md`.

---

## 5. Honest failure & a documented escape hatch

**What.** Errors explain cause *and* remedy (see `errors-and-boundaries.md`). And an abstraction that hides complexity still exposes a documented way down to the underlying power, noting what it costs.

**Why.** *Abstractions must never trap* — remove burden without removing control; never strand a consumer the design didn't anticipate.

## When NOT to over-design

An internal helper used in one place needs far less ceremony than a published, long-lived API — match rigor to **reach and lifetime** (`architect-mentality` → *Know when not to do it*).

## Pitfalls

- Leaking internals through the contract (returning a mutable internal structure, exposing a field that should be private) — you can never change them again.
- "Convenience" overloads and optional flags that make behavior unpredictable.
- An over-broad initial surface — every public thing is a future breaking change waiting to happen.

---

**Mentality anchors:** *Design for the consumer*, *Abstractions must never trap*, *Everything is a black box*, *Lead with one mental model*, *Know when not to do it* — in the `architect-mentality` skill.
