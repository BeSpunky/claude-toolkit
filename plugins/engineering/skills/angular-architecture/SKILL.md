---
name: angular-architecture
description: Concrete Angular architecture techniques - the modern-Angular expression of timeless design patterns. Use when designing or structuring Angular code beyond a trivial tweak - building or shaping libraries, components, directives, and services; deciding dependency injection and providers; managing lifecycle and reactivity; making code SSR-safe and change-detection-efficient; building extensible/pluggable capabilities; projecting content or bridging to a non-Angular sink; or designing a component's input/output API. Assumes modern Angular (standalone, signals, inject(), provideX). This skill is a router - it indexes technique clusters and points to a reference file for each; read only the cluster you need. For wrapping an imperative/third-party JS API (maps, editors, charts, players) in Angular, use the angular-native-wrappers skill instead.
---

# Angular Architecture

Concrete, modern-Angular techniques that put the architect mindset into practice. The *why* lives in the **`architect-mentality`** skill (agnostic principles); the *discipline* lives in **`architecture-first`** (root-cause, no patches, design-and-confirm refactors). **This skill is the *how*, in Angular.**

Everything here is the timeless design idea expressed in **today's** Angular — standalone components, `inject()`, `provideX()` functions, signals, `takeUntilDestroyed`, `afterNextRender`. Where a pattern originated in an older idiom (NgModules, Zone, `EventEmitter`), it is restated in the current one. The idea is what matters, not the dated API.

## How to use this skill

1. Identify which **cluster** (below) your decision belongs to.
2. **Read the matching `reference/<file>.md`** for the full pattern: what it is, the mentality it serves, modern code, when to use it, when *not* to, and pitfalls.
3. Apply it — and keep every connection between units deliberate and one-directional (`architect-mentality` → *Everything is a black box*).

Read only the cluster(s) you need; don't load them all.

## Technique clusters

| Cluster | Reference | Covers | Serves (architect-mentality) |
| --- | --- | --- | --- |
| **DI & providers** | `reference/di-and-providers.md` ✅ | provider factories / `provideX()`, hierarchical (element-level) DI for parent–child, class-as-token config, platform/SSR tokens, optional config with graceful degradation, provide-once guards, strategy-by-config | Define the seam · Work smart · Concentrate complexity |
| **Lifecycle & reactivity** | `reference/lifecycle-and-reactivity.md` ✅ | teardown without boilerplate (`takeUntilDestroyed`/`DestroyRef`), template-method abstract directives, signal/observable input handling, binding an external object's lifecycle to the component's | Concentrate complexity · Work smart |
| **SSR, zone & change detection** | `reference/ssr-zone-and-change-detection.md` ✅ | platform-safe globals, browser-only rendering, controlling when Angular reacts (zoneless/OnPush, high-frequency native callbacks), readiness gates (`afterNextRender`, deferred render) | Compensate for your materials' weaknesses |
| **Extensibility & runtime plugins** | `reference/extensibility-and-plugins.md` ✅ | tree-shakable capabilities a host never imports, attached lazily per-instance through DI + a stream of capability types | Define the seam · Know when not to do it |
| **Content projection & DOM bridging** | `reference/content-projection-and-dom-bridging.md` ✅ | projecting Angular content into a non-Angular sink, two-way-binding extraction, avoiding `ExpressionChanged…` errors | Abstractions must never trap · Design for the consumer |
| **Component API ergonomics** | `reference/component-api-ergonomics.md` ✅ | entity-shaped inputs (pass the model, not scalars), the `custom`/context payload slot, permissive `*-Like` inputs normalized internally, intent-named feature components | Design for the consumer · Work smart |

All six clusters have full reference files — read only the one(s) you need.

## Related skills

- **`angular-native-wrappers`** — the dedicated pattern for wrapping an imperative/third-party JS API (maps, editors, charts, players) in idiomatic Angular: convention-based delegation, a fully-typed phantom surface, and an auto-wired component base. Reach for it when *that* is the task.
- **`architect-mentality`** — the agnostic mindset every technique here expresses.
- **`architecture-first`** — the operational discipline that governs how changes are made.
