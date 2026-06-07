---
name: architecture-first
description: Architecture-first engineering discipline - solve every feature, bug, or change through design and infrastructure, never a patch. Use BEFORE writing or modifying code for any non-trivial change, and the moment you reach for a special-case `if`, a magic value, a copy-paste, a boolean flag to make one function do two things, a cast to silence a type mismatch, or a "just handle this one case" fix. For bugs, trace to and fix the ROOT CAUSE - never mask the symptom. When the current design doesn't account for a requirement, redesign and refactor the relevant seam (model the concept, extract, decouple, build the missing abstraction, reuse) so the new behavior is a natural case of the design; when a refactor is needed to add a feature or fix a bug, design it and get confirmation before implementing. Triggers - "how should I implement", "fix this bug", "find the root cause", "add this feature", "the design doesn't handle X", refactoring, or any change that would otherwise grow coupling, duplication, or tech debt.
---

# Architecture-First — solve by design, never patch

**The rule: every change is solved through architecture and design — never a patch.** Features, bugs, hotfixes, edge cases, "quick" changes — all of them. There is no exception for size or urgency. A small change done as a patch is still a patch.

When the current design does not account for a requirement, you do **not** bolt the requirement on. You **redesign and refactor the relevant seam** so the requirement becomes a natural case of the design. Coupling, duplication, and special-casing must never grow as a result of your change.

## What a patch is (refuse these)

Each of these is the model trying to *route around* the design instead of *evolving* it:

- A special-case `if` / branch keyed on a specific input, customer, environment, route, or "this one case."
- A **magic value** — a hardcoded literal smuggled in instead of a named, sourced constant or a modeled domain concept.
- **Copy-paste** of existing logic instead of extracting it and reusing the single copy.
- A **boolean flag or extra parameter** added to make one function behave two ways (a unit that now does two things).
- A `try/catch` (or null-default / coercion) that **swallows a symptom** instead of addressing the cause.
- **Reaching into another module's internals** or adding a back-channel instead of going through a proper interface.
- Widening a type to `any`/`unknown`, or **casting**, to silence a design mismatch.
- Bumping a **timeout, retry count, limit, or sleep** to mask a structural problem.
- A `// HACK` / `// TODO` / "temporary workaround" with no design behind it.

If your next edit is one of these, stop — the design is missing something. Run the loop.

## The loop (run before any code change)

1. **State the change** in one sentence: the new capability or correct behavior required.
2. **Find the seam.** Which component / module / boundary *owns* this concern? Read the surrounding design before touching it.
3. **Ask the question:** does the current design *account for* this concern, or does it only *almost* fit?
   - Fits cleanly → implement within it.
   - Only *almost* fits → you are at a design boundary. Do **not** force it. Go to 4.
4. **Redesign the seam** so the requirement is a natural case of the design, not an exception to it (see Redesign moves).
5. **Implement** on the redesigned shape.
6. **Check the ledger:** did coupling, duplication, or special-casing go down, stay flat, or grow? It must not grow.

## Bugs — fix the root cause, never the symptom

A bug fix is held to the same rule: **find the root cause and fix it there.** Never stop at the symptom.

1. **Reproduce** the failure reliably.
2. **Trace the causal chain** from the symptom back to its true origin — keep asking "why" until the answer is the actual defect, not a downstream effect.
3. **Fix it at the origin.**

Masking the symptom is a patch and is forbidden: swallowing the error, defaulting/coercing the bad value, adding a guard at the symptom site, sprinkling a retry, or bumping a limit so the failure "goes away." If you cannot yet explain *why* the bug happens, you are not ready to fix it.

The root cause is very often a **design gap** — a case the design never modeled. When it is, don't fix it locally: run the loop and redesign the seam so the whole *class* of bug becomes impossible, not just this instance.

## Refactors — design and confirm before you implement

If a refactor is needed to **lay the infrastructure for a new feature**, or to **fix a bug at its root**, do not refactor as you go. **Plan and design the refactor first, present it for feedback, and implement only after explicit confirmation.** The choice to reshape the system is not one to make silently mid-edit.

Make the cost legible in the proposal:

- the **seam(s)** affected and the **target shape**;
- the **migration / rollout steps** — and whether it can land incrementally;
- the **blast radius** — what depends on what's changing;
- the **debt it removes or avoids**, versus the debt a shortcut would incur.

Then:

- **Confirmed** → implement on the agreed design.
- **Too large to do now** → still never patch silently. A stopgap is only ever an **explicitly accepted, ticketed, time-boxed** exception — never the default path and never an unannounced one.

## Redesign moves — the only acceptable answers to "the design doesn't handle X"

- **Model the concept.** The thing you wanted to `if` on is usually a missing domain concept. Give it a type / state / strategy and let the system dispatch on it.
- **Extract.** Pull shared logic into one unit with a single responsibility; call it from every site instead of duplicating. When the piece is generic across *projects*, not just this codebase, extract it into a shared reusable library — see *Extract reusable tools*.
- **Decouple.** Replace a direct dependency or internal reach-in with an explicit interface/port; depend on the abstraction.
- **Build the missing infrastructure.** If you keep wanting to patch the same gap, the gap *is* a missing capability — build it once, properly, and route everyone through it.
- **Invert dependencies.** Push policy out to the edges; keep the core depending only on abstractions.
- **Unify.** Collapse parallel near-duplicate paths into one path parameterized **by data, not by a boolean**.
- **Make state explicit.** Replace scattered flags with a single source of truth or a state machine.

## Extract reusable tools — and know where they belong

Architecture-first looks **beyond the current change and the current project.** While building infrastructure or a feature, watch for a piece — a component, directive, service, pipe, utility, type, or chunk of logic — that is **generic enough to serve *other* projects, not just this one.** The moment you catch yourself building something that isn't really *this project's* concern, that's the signal: *"this is generic enough to extract into a reusable library."* Leaving it inlined is cross-project duplication waiting to happen — the next project re-implements it from scratch.

This is the **Extract** redesign move applied across the org, not just within one codebase. Treat it as a design move:

1. **Recognize** the genericity — the piece has no project-specific coupling, or its project-specific parts can be cleanly parameterized/injected out.
2. **Abstract it well** — a clean boundary, a small deliberate contract, dependencies received from outside (`architect-mentality` — *everything is a black box*, *design for the consumer*), so it stands alone, knowing nothing of the project it came from.
3. **Place it on purpose** — and *where* depends on what you can reach. **Check which context you're in first.**

**The placement bends to your access:**

- **You can reach the shared libraries and other projects** (a context where the whole workspace is visible). Then do the full move: extract the piece into the **shared-library destination** as a properly-abstracted, **versioned** package; publish it; and adopt it back into the projects that need it. **Extract → abstract → publish → consume.**
- **You are sandboxed to one project** (e.g. inside its DevContainer — only this workspace is visible). You **cannot** reach the shared libraries or other projects, and must not pretend to. Do the honest half: **abstract it cleanly *in place*** as a self-contained, **extraction-ready** library within this workspace, and **stage it as an explicit extraction candidate** so it gets lifted later from a context that *can* reach across projects. **Never** silently inline generic code; **never** claim to have published what you couldn't reach.

The recognition instinct is **always-on** — every time you write something, ask whether it's really *this* project's or the *org's*. The destination, the tooling, and the cross-context hand-off are **the house's extraction mechanism** — not this skill's to hardcode; this skill owns the *discipline* (recognize, abstract, place on purpose, never inline-and-forget), and the mechanism owns the *where and how*.

## Principles (tech-agnostic)

- **Single responsibility** — a unit does one thing.
- **Single source of truth** — no value or rule duplicated.
- **Open/closed** — extend by adding types/strategies, not by editing an ever-growing switch.
- **Dependency inversion** — depend on abstractions, not concretions.
- **Composition over special-casing.**
- **Make illegal states unrepresentable** — model the cases in the type system.
- **Separation of concerns** — respect module boundaries; no leaking internals.
- **Names carry intent** — no magic literals; every constant is named and sourced.

## Stop signals

These sentences mean the design is missing something — never act on them, run the loop instead:

> "I'll just add an `if` for this case." · "I'll hardcode this for now." · "Let me copy this and tweak it." · "I'll add a flag so it also does Y." · "Let me cast / widen the type to make it compile." · "I'll bump the timeout." · "I'll catch and ignore this error." · "Good enough, the symptom's gone."

## Done criteria

- Root cause addressed — for a bug, the origin is fixed, not the symptom.
- No new special-case branch keyed on a specific value / customer / env.
- No new magic literal — constants are named and sourced.
- No duplicated logic — shared behavior is extracted to one place.
- New behavior is reachable as a natural case of the design, **without** a flag.
- Any refactor was designed and confirmed before implementation.
- Coupling and duplication did not increase.
- Any code generic enough to serve other projects was **extracted to the shared libraries** (when reachable) or made extraction-ready and **staged as a candidate** (when sandboxed) via the house mechanism — never left inlined.

## Keeping the rule always-on in a project

- **New BeSpunky projects** get this baked into `CLAUDE.md` automatically by the `new-project` scaffold, so the rule is always in context.
- **Existing projects** that install the `engineering` plugin: make sure the project's `CLAUDE.md` carries the architecture-first directive (the canonical block is in the plugin's README) so the rule is always in context. This skill then provides the full depth above.
