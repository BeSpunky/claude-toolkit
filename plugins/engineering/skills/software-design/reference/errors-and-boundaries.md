# Errors & Boundaries

Decide deliberately where untrusted data is checked, how failure is represented, and where resilience lives — and never paper over a failure (`architect-mentality` → *Compensate for your materials' weaknesses*; *Design for the consumer*; and `architecture-first` → fix the root cause, don't mask the symptom).

---

## 1. Validate at the edge, trust inside ("parse, don't validate")

**What.** Untrusted input is validated **once, at the boundary**, and converted into a typed domain value. Everything inside the boundary receives that value and trusts it — no re-checking everywhere.

```ts
function handleRequest(raw: unknown) {
  const cmd = parseCreateOrder(raw);   // throws/returns error at the edge; yields a typed CreateOrder
  return placeOrder(cmd);              // core trusts the type; no defensive re-validation
}
```

**Why.** *Concentrate complexity* + *Compensate for weaknesses* — validation lives in one place; the core is clean and can't be reached with bad data.

---

## 2. Model errors deliberately

**What.** Choose, on purpose, how each failure is represented — an exception, or a result/`Either` type — and make failure modes explicit in the contract. Don't smuggle errors through `null` or magic sentinels.

**Why.** *Design for the consumer* — a caller can see what can go wrong and is forced to handle it; failures aren't a surprise discovered in production.

---

## 3. Fail fast and loud

**What.** Surface a problem at its source, immediately, with an actionable message. **Never swallow** (empty `catch`, defaulting bad data to keep going, coercing away a type mismatch).

**Why.** `architecture-first` (root cause, no symptom-masking) — a swallowed error doesn't go away; it reappears later, far from its cause, as a harder bug. Loud failure at the source is a gift to whoever debugs it.

---

## 4. Put retries / timeouts / idempotency at the right layer

**What.** Resilience concerns belong at the boundary/adapter that talks to the unreliable thing — not sprinkled through the core. Make operations idempotent where retries are possible.

**Why.** *Place everything on purpose* — and **bumping a timeout or retry to mask a structural problem is forbidden** (`architecture-first`): tune resilience deliberately, at its layer, for the real reason.

## When NOT to over-engineer

A throwaway script doesn't need an error taxonomy and a result monad; match rigor to blast radius (`architect-mentality` → *Know when not to do it*). A library boundary or a money path deserves the full treatment; a one-off does not.

## Pitfalls

- Catch-and-ignore and "default the bad value so it doesn't crash" — the classic symptom-masks.
- Validation scattered through every function instead of parsed once at the edge — you can never be sure data is clean.

---

**Mentality anchors:** *Compensate for your materials' weaknesses*, *Design for the consumer*, *Concentrate complexity*, *Place everything on purpose*, *Know when not to do it* — in `architect-mentality`; root-cause / no-symptom-masking in `architecture-first`.
