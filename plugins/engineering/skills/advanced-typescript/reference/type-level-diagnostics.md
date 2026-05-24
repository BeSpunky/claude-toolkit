# Type-Level Diagnostics

Turn a confusing compiler error into a **readable sentence** by resolving invalid cases to a descriptive string-literal type — so the consumer is told exactly what's wrong and how to fix it, at compile time (`architect-mentality` → *Design for the consumer*; *Compensate for your materials' weaknesses*).

---

## 1. Error-message-as-type

**What.** When a generic detects an invalid combination, resolve it to a **string-literal type that reads like an error message** instead of `never`. The mismatch shows up where the value is assigned, with your sentence in the tooltip.

```ts
type RouteArgs<P extends string, Entity> =
  PathParams<P> extends keyof Entity
    ? Pick<Entity, PathParams<P>>
    : `Error: route param '${PathParams<P>}' is not a property of the entity`;
//   ^ a valid path yields the picked args; an invalid one yields a human-readable type
```

**Why.** *Design for the consumer* + *Compensate for weaknesses* — raw TS errors on deep generics are notoriously cryptic; you replace the riddle with a sentence.

---

## 2. Constrain inputs so misuse fails *helpfully*

**What.** Prefer a constraint that explains itself over a bare `never` or a silent widening.

```ts
type NonEmpty<T extends readonly unknown[]> =
  T extends readonly [] ? 'Error: provide at least one item' : T;

function configure<const T extends readonly Step[]>(steps: NonEmpty<T>) { /* … */ }
```

**Why.** *Design for the consumer* — the failure teaches; the fix is obvious from the message.

---

## When NOT to use

Reserve this for **library-grade APIs** whose misuse is otherwise hard to diagnose. For ordinary internal code a normal type error is fine — don't gold-plate (`architect-mentality` → *Know when not to do it*).

## Pitfalls

- It does not *throw*; the error appears where the bad type is **assigned/consumed**. Design the API so that assignment site is the caller's code, not deep inside yours.
- Keep the message short and actionable — it shows up inside an already-noisy type error.
- Don't let the diagnostic machinery dominate the type's readability.

---

**Mentality anchors:** *Design for the consumer*, *Compensate for your materials' weaknesses*, *Know when not to do it* — in the `architect-mentality` skill.
