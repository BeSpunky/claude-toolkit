---
effort: ask-before-compat
status: concluded
concluded: 2026-10-03
summary: Backwards compatibility is never the default — the always-on Architecture-first directive and the engineering skills make Claude break cleanly and ask, as its own question, before building any alias, shim, stub or deprecation window
tags: [engineering, house-rules, backwards-compatibility, ask-the-user]
---

# Decision — ask before keeping backwards compatibility

> "improve our toolkit skills so they never leave backwards compatibility as default. If Claude is thinking of backwards compatibility the user should be asked if it's needed."

Trigger: the project-starter → bespunky-house rename shipped a hand-over stub plugin and a `scaffold.sh` shim that were
only mentioned inside a larger proposal, never asked as a question. The user: "I didn't ask you to do that. Remove it completely."

## The rule

**Backwards compatibility is never the default.** A change that breaks an old name, path, flag, contract or
install breaks it cleanly; any alias, shim, stub, re-export, dual-shape reader or deprecation window is built
only after the user, asked **as its own explicit question**, says something existing needs it. A compat layer
mentioned inside a larger proposal has not been asked about — that is exactly how the stub shipped. A
migration (moving existing state forward) is not compatibility and stays owed.

## Where it lives

- **Always on:** the Architecture-first directive in `house-doc/HOUSE.rules.md.tpl` (every house project
  imports it every session) and its canonical copy in README → *The always-on half*. Payload 0.39.2;
  nothing to migrate — HOUSE.rules.md is an owned artifact every upgrade regenerates.
- **Depth:** `architecture-first` — a patch smell, a refactor-gate line (what it breaks, and the question),
  two stop signals, a done criterion. `software-design` → contracts: *Changing a contract*.
  `nx-monorepo-and-dx` → release pitfalls: no deprecation cycle by default.
- **Existing compat offers reworded to ask first:** `adopt-extracted --keepShim` in HOUSE.md.tpl and
  `docs/reusable-tool-extraction.md`.
