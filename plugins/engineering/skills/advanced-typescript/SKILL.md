---
name: advanced-typescript
description: Advanced TypeScript type-system techniques - the type-level expression of the architect mindset. Use when designing non-trivial types, generics, or APIs - deriving one type from another, typing dynamically-implemented or metaprogrammed code, building ergonomic string/typed APIs, validating inputs at compile time, narrowing with type guards/assertions, or making illegal states unrepresentable. TypeScript on any stack (not Angular-specific). This skill is a router - it indexes technique clusters and points to a reference file for each; read only the cluster you need.
---

# Advanced TypeScript

Type-system techniques that put the architect mindset into practice at the **type level**. The *why* lives in the **`architect-mentality`** skill (agnostic principles); the *how-in-Angular* lives in **`angular-architecture`**. **This skill is the *how*, in the type system** — and it's stack-agnostic: plain TypeScript, usable anywhere.

The goal of advanced types is never cleverness for its own sake. It is to make the compiler do real work for you: a **single source of truth** that derived types follow automatically, surfaces that are **impossible to misuse**, and illegal states that simply **don't typecheck**. If a type trick doesn't buy one of those, don't reach for it (`architect-mentality` → *Know when not to do it*).

## How to use this skill

1. Identify which **cluster** (below) your type problem belongs to.
2. **Read the matching `reference/<file>.md`** for the full technique: what it is, the mentality it serves, code, when to use it, when *not* to, and pitfalls.
3. Apply it — and keep the type and the runtime in lockstep (a type that promises what the runtime doesn't deliver is a lie the compiler will happily believe).

Read only the cluster(s) you need; don't load them all.

## Technique clusters

| Cluster | Reference | Covers | Serves (architect-mentality) |
| --- | --- | --- | --- |
| **Derive types from types** | `reference/deriving-types-from-types.md` | mapped & conditional types, filter-by-kind via key-remapping, `infer` extraction, the `Pick`/`Omit`/`Parameters`/`ReturnType`/`Awaited` toolkit, derived types as a single source of truth | Work smart · Refuse false tradeoffs · Place everything on purpose |
| **Declaration merging & dynamic surfaces** | `reference/declaration-merging.md` | same-name interface + class to type runtime-supplied members, interface merging, module/global augmentation, keeping types and runtime in lockstep | Refuse false tradeoffs · Abstractions must never trap |
| **Template-literal & branded types** | `reference/template-literal-and-branded-types.md` | ergonomic string types, parsing strings at the type level (`Split`/`Extract`), key transforms (`Capitalize`), nominal/branded types, make-illegal-states-unrepresentable | Design for the consumer · Model the missing concept |
| **Type-level diagnostics** | `reference/type-level-diagnostics.md` | error-message-as-type for readable compile errors; constraining inputs so misuse fails with a sentence, not a riddle | Design for the consumer · Compensate for your materials' weaknesses |
| **Guards & assertions** | `reference/guards-and-assertions.md` | `x is T` predicates, `asserts x is T` / `asserts this is {…}`, exhaustiveness with `never`, narrowing as a modeled distinction | Treat understanding & verification as first-class · Model the missing concept |

Read only the one(s) you need.

## Related skills

- **`angular-native-wrappers`** — *applies* these techniques (derive + merge a wrapper's typed surface). It links here for the type-level depth.
- **`angular-architecture`** — the Angular-domain techniques; some lean on these types.
- **`architect-mentality`** — the agnostic mindset every technique here expresses.
