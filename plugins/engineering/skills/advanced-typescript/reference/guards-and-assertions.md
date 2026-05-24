# Guards & Assertions

Narrow types at runtime in a way the compiler trusts — and make every narrowing a **modeled, honest distinction**, not a cast in disguise (`architect-mentality` → *Treat understanding and verification as first-class*; *Model the missing concept*).

---

## 1. Type-guard predicates (`x is T`)

**What.** A function whose return type tells the compiler what the input *is* when it returns `true`.

```ts
type CoordLike = LatLng | [number, number] | { lat: number; lng: number };

function isTuple(c: CoordLike): c is [number, number] { return Array.isArray(c); }

function toLatLng(c: CoordLike): LatLng {
  if (isTuple(c)) return { lat: c[0], lng: c[1] };   // c is narrowed to the tuple here
  // …
}
```

**Why.** *Understanding & verification first-class* — the narrowing is a named, reusable, testable predicate rather than scattered `as` casts.

---

## 2. Assertion functions (`asserts …`)

**What.** A function that throws if a condition fails, and afterward the compiler knows the type holds.

```ts
function assertDefined<T>(v: T, what: string): asserts v is NonNullable<T> {
  if (v == null) throw new Error(`${what} is required`);
}

// the "ensureEnabled" pattern — narrow `this`:
private ensureEnabled(): asserts this is { config: Config } {
  if (!this.config) throw new Error('Not configured — call provideX() at bootstrap.');
}
```

**Why.** *Compensate for weaknesses* + *Design for the consumer* — fail loudly with an actionable message, and let the types follow the check.

---

## 3. Exhaustiveness with `never`

**What.** Force the compiler to flag any unhandled case when a union grows.

```ts
function area(s: Shape): number {
  switch (s.kind) {
    case 'circle': return Math.PI * s.r ** 2;
    case 'square': return s.side ** 2;
    default: return assertNever(s);   // compile error if a new Shape kind is added
  }
}
function assertNever(x: never): never { throw new Error(`Unhandled: ${JSON.stringify(x)}`); }
```

**Why.** *Open/closed* + *Model the missing concept* — adding a case to the model makes the compiler point at every place that must handle it.

---

## When NOT to use

If you can **narrow the model** so a distinction is structural (separate types, a discriminated union), prefer that over a runtime guard — the best guard is the one you didn't need (`architect-mentality` → *Model the missing concept*).

## Pitfalls

- A **lying** guard/assertion (`c is T` whose body doesn't actually verify `T`) is worse than none — it tells the compiler a falsehood. The body must genuinely check what the signature claims.
- Don't use assertions to silence nullability you should have modeled away.

---

**Mentality anchors:** *Treat understanding and verification as first-class*, *Model the missing concept*, *Design for the consumer* — in the `architect-mentality` skill.
