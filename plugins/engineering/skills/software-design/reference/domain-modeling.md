# Domain Modeling

Encode the problem domain so the *types and structures themselves* enforce what's valid — and so the code speaks the domain's language (`architect-mentality` → *Model the missing concept*; *Place everything on purpose*; *Lead with one mental model*).

---

## 1. Value objects over primitives

**What.** A meaningful domain value is its own type, not a bare `string`/`number`. The type carries the rules (construction validates; invalid values can't exist).

```ts
class Email { private constructor(readonly value: string) {} static of(s: string): Email { /* validate */ } }
// function invite(to: Email)   — you cannot pass an arbitrary string
```

**Why.** *Model the missing concept* — "an email is not just any string" becomes a fact the whole system relies on. Cures *primitive obsession*. (In TypeScript, branded types are a lightweight form — see `advanced-typescript`.)

---

## 2. Make illegal states unrepresentable

**What.** Structure types so invalid combinations can't be constructed in the first place — prefer a discriminated union over optional fields that imply one another.

```ts
// not { loading: boolean; data?: T; error?: Error }  (allows loading && error && data)
type Remote<T> = { tag: 'loading' } | { tag: 'ok'; data: T } | { tag: 'error'; error: Error };
```

**Why.** *Place everything on purpose* — the defensive checks for "can't happen" states vanish because they genuinely can't happen.

---

## 3. Ubiquitous language

**What.** Names in code match the domain experts' words — one term, one meaning, everywhere.

**Why.** *Lead with one mental model* — when code and conversation share vocabulary, there's no translation layer to get wrong, and onboarding is reading the domain you already discussed.

---

## 4. Bounded contexts

**What.** The same word can mean different things in different parts of the business (a "customer" in billing vs. support). Don't force one global model — give each context its own model and define the **translation** at the boundary between them.

**Why.** *Everything is a black box* at the domain scale — each context is a box with its own language and a deliberate, well-defined connection (a translation/anti-corruption layer) to the next.

---

## 5. Keep the domain free of infrastructure

**What.** Domain types and rules don't import the database, the HTTP client, or the UI framework. Infrastructure depends on the domain, never the reverse (see `decoupling-and-dependency-inversion.md`).

**Why.** *Everything is a black box* — the domain is the stable core; swapping infrastructure leaves it untouched.

## When NOT to use

A trivial CRUD field that carries no rules doesn't need a value-object ceremony; not every record is a rich aggregate (`architect-mentality` → *Know when not to do it*). Model richly where the domain has real rules; stay light where it doesn't.

## Pitfalls

- **Anemic models** — data bags with all behavior elsewhere — give you the cost of objects with none of the benefit; put the rules with the data they govern.
- Forcing one global model across contexts breeds god-objects and endless special cases.

---

**Mentality anchors:** *Model the missing concept*, *Place everything on purpose*, *Lead with one mental model*, *Everything is a black box*, *Know when not to do it* — in the `architect-mentality` skill.
