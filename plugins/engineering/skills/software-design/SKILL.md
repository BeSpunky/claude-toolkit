---
name: software-design
description: General, language- and framework-agnostic software design techniques - the concrete cross-stack toolbox that realizes the architect mindset in code. Use when making design or refactoring decisions that aren't tied to a specific framework: decoupling and dependency inversion, replacing conditionals with polymorphism/strategy/state machines, removing duplication and extracting (or NOT extracting) abstractions, modeling a domain and making illegal states unrepresentable, handling errors and boundaries, and designing contracts/APIs. This skill is a router - it indexes technique clusters and points to a reference file for each; read only the cluster you need. For the mindset behind these, see architect-mentality; for stack-specific specializations, see advanced-typescript / angular-architecture / nx-monorepo-and-dx.
---

# Software Design (general)

Concrete, **language- and framework-agnostic** techniques that turn the architect mindset into code. The *why* lives in **`architect-mentality`** (principles, no techniques); the operational discipline lives in **`architecture-first`** (root-cause, no patches, design-and-confirm refactors). **This skill is the cross-stack *toolbox*** — the moves you reach for on any project, in any language.

The stack-specific skills are specializations of what's here: Angular DI and Nx module boundaries are concrete instances of *decoupling & dependency inversion*; TypeScript branded types are an instance of *make illegal states unrepresentable*. Learn the agnostic move here; apply it everywhere.

Code snippets are illustrative (TypeScript-flavored) but the patterns are language-neutral.

## How to use this skill

1. Identify which **cluster** (below) your decision belongs to.
2. **Read the matching `reference/<file>.md`** for the full technique: what it is, the mentality it serves, an example, when to use it, when *not* to, and pitfalls.
3. Apply it — and remember the counterweight: every one of these can be over-applied, so each reference says when *not* to (`architect-mentality` → *Know when not to do it*).

Read only the cluster(s) you need; don't load them all.

## Technique clusters

| Cluster | Reference | Covers | Serves (architect-mentality) |
| --- | --- | --- | --- |
| **Decoupling & dependency inversion** | `reference/decoupling-and-dependency-inversion.md` | depend on abstractions/ports not concretions, ports & adapters (hexagonal), dependency direction & layering, inversion of control | Everything is a black box · Define the seam |
| **Replace conditionals with structure** | `reference/replace-conditionals-with-structure.md` | polymorphism/strategy over type-switching, table/map-driven dispatch, flag-argument → two functions, state machines | Model the missing concept · Refuse false tradeoffs |
| **Duplication & abstraction** | `reference/duplication-and-abstraction.md` | single source of truth, extract & parameterize by data, rule of three, incidental vs true duplication, the wrong abstraction | Work smart · Know when not to do it |
| **Domain modeling** | `reference/domain-modeling.md` | value objects over primitives, make illegal states unrepresentable, ubiquitous language, bounded contexts, keep the domain infrastructure-free | Model the missing concept · Place everything on purpose |
| **Errors & boundaries** | `reference/errors-and-boundaries.md` | validate at the edge / trust inside (parse don't validate), model errors deliberately, fail fast & loud, retries/timeouts at the right layer | Compensate for weaknesses · Design for the consumer (+ architecture-first: root cause) |
| **Contracts & API design** | `reference/contracts-and-api-design.md` | minimal surface, hard-to-misuse APIs, command–query separation, guessable naming/symmetry, honest failure & escape hatch | Design for the consumer · Abstractions must never trap |

Read only the one(s) you need.

## Related skills

- **`architect-mentality`** — the agnostic mindset every technique here expresses.
- **`architecture-first`** — the operational discipline governing how changes are made.
- **`advanced-typescript`**, **`angular-architecture`**, **`nx-monorepo-and-dx`** — stack-specific specializations of these patterns.
