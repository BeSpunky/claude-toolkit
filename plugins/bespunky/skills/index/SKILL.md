---
name: index
description: The BeSpunky toolkit catalog / front door. Use when the user wants to discover or choose among the toolkit's skills — "what skills are available", "list the toolkit", "what can the BeSpunky toolkit do", "which skill for X", "catalog / index of skills", "/bespunky", or is browsing what's installed. Renders every installed toolkit skill (the `bespunky` plugin plus every `bespunky-…` plugin), grouped by plugin, each with its `/plugin:skill` invocation and a one-line "use when", by reading the LIVE available-skills set in the session — so it never goes stale.
---

# BeSpunky toolkit — skill index

Produce a **current** catalog of the toolkit's skills. Do NOT hard-code a list — read the **live set of skills available in this session** and render only what is actually installed, so the catalog can never drift from reality.

## How to render

1. From the skills available to you right now, select every skill whose plugin namespace is **`bespunky`** or begins with **`bespunky-`** (e.g. `bespunky-project-starter`, `bespunky-engineering`, `bespunky-product-ux`, `bespunky-workflow`, `bespunky-browser-automation`). Ignore non-toolkit skills and built-in commands.
2. **Group by plugin.** Order the groups so the entry points come first — this `bespunky` index, then `bespunky-project-starter`, `bespunky-engineering`, `bespunky-product-ux`, `bespunky-workflow`, `bespunky-browser-automation` (adapt to whatever is actually installed). Give each group a short heading naming the plugin's area.
3. Under each group, list its skills. For each skill show:
   - its exact invocation — **`/<namespace>:<skill>`** — as typed text,
   - a **one-line "use when"** distilled from the skill's own description (the trigger, not the whole blurb).
4. Keep it scannable — a compact table or tight list per group, no long paragraphs.

## Then help them choose

- If the user described a task or goal (not just "list everything"), **lead with a recommendation**: name the 1–3 best-fit skills and why, then offer the full catalog below.
- If a skill belongs to an ordered set, say so, so they pick the right entry point — e.g. the product-ux experience-design trio (`envision-the-experience` → `stage-the-vision` → `realize-the-vision`), or engineering's `architect-mentality` → `architecture-first` foundation beneath the technique skills.

## The discovery shortcut (mention once)

All toolkit plugins share the **`bespunky-`** namespace prefix, so typing **`/bespunky`** in the slash menu filters the autocomplete to the entire toolkit at once — this index plus every skill. Point this out so the user can self-serve next time.
