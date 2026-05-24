# Replace Conditionals With Structure

A branch keyed on a *kind* of thing is often a missing abstraction in disguise. Replace repeated conditionals with structure that owns its own behavior (`architect-mentality` → *Model the missing concept*; *Refuse false tradeoffs*).

---

## 1. Polymorphism / Strategy over type-switching

**What.** When the same `switch (kind)` / `if (type === …)` appears in more than one place, give each kind a type/strategy that owns its behavior, and let the system dispatch.

```ts
// instead of switch (shape.kind) scattered across area(), perimeter(), draw():
interface Shape { area(): number; perimeter(): number; }
class Circle implements Shape { /* … */ }
class Square implements Shape { /* … */ }
```

**Why.** *Model the missing concept* + *open/closed* — adding a new kind means adding a class, not editing every `switch`. The thing you were branching on *was* the concept.

---

## 2. Table / map-driven dispatch

**What.** For a one-shot mapping from a value to a handler or result, use a lookup keyed by data — **a map object, not a `switch`** (a house convention).

```ts
const handlers: Record<Kind, (x: In) => Out> = { a: handleA, b: handleB, c: handleC };
return (handlers[kind] ?? handleDefault)(input);
```

**Why.** *Work smart* + *Place everything on purpose* — the cases become data you can see at a glance, extend, and even compose, instead of control-flow you must read line by line.

---

## 3. Flag argument → two functions (or a strategy)

**What.** A boolean parameter that makes one function behave two ways is one function doing two things. Split it.

```ts
// renderList(items, true /* compact? */)   →
renderCompactList(items);
renderDetailedList(items);
```

**Why.** *Refuse false tradeoffs* + single responsibility — call sites read as intent, and each path is independently testable and changeable.

---

## 4. Model state as a state machine

**What.** Replace a cluster of booleans (`isLoading`, `hasError`, `isEmpty`…) — which can express impossible combinations — with one explicit state and defined transitions.

```ts
type LoadState<T> = { tag: 'idle' } | { tag: 'loading' } | { tag: 'ok'; data: T } | { tag: 'error'; error: Error };
```

**Why.** *Model the missing concept* + make illegal states unrepresentable (see `domain-modeling.md`) — whole branches of defensive conditionals simply disappear.

## When NOT to use

A single, local, genuinely binary branch is just an `if` — don't erect a strategy hierarchy for it (`architect-mentality` → *Know when not to do it*). Reach for structure when the *same* distinction recurs, or when the conditional is growing.

## Pitfalls

- Over-abstracting a one-off branch adds indirection without payoff.
- Dispatch maps taken too far hide control flow — keep them for genuine value→behavior mappings, not for sequencing logic.

---

**Mentality anchors:** *Model the missing concept*, *Refuse false tradeoffs*, *Place everything on purpose*, *Know when not to do it* — in the `architect-mentality` skill.
