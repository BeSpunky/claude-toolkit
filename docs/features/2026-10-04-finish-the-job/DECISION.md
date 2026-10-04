---
effort: finish-the-job
status: concluded
concluded: 2026-10-04
summary: Retiring a devcontainer feature now removes its lock pin too (0.44.0 prunes the orphans), every rung refuses unparseable JSONC for real, and a "finish gate" — sweep every occurrence, judge leftovers by dependency, observe it where it runs, release once — is now an always-on house rule, an architecture-first section and this repo's release procedure.
tags: [process, thoroughness, architecture-first, house-rules, migrations, devcontainer, dogfooding]
---

# Finish the job — decision

## Why

One bug (house containers froze Claude Code, hiding the toolkit's mods) took four releases in an afternoon:
0.40.0 (one install, PATH first) → 0.42.0 (`${containerEnv:HOME}` resolved empty) → 0.43.0 (the feature left in
adopted devcontainers) → and then the devcontainer lock file still pinned the removed feature. The user:

> "yes, build it and ship it. Improve our skills so stuff like this happen by themselves at one go. We've release 3 fixes in a less than 20 minutes. Claude should be more thorough"

## What each miss had in common

| Miss | What would have caught it before shipping |
| --- | --- |
| `${containerEnv:HOME}` → `/.local/bin` | Observing the result where it runs: `--local` upgrade + rebuild, then `which -a claude`. An assumption about an environment was shipped unobserved. |
| Feature left in adopted devcontainers | Asking "can anything still depend on it?" instead of "might it be theirs?" |
| Lock file still pinned it | Sweeping EVERY occurrence of the removed identifier (`git grep <feature id>`), lock and generated files included. |

All three were found only because the user rebuilt and looked. The verification loop ran AFTER each release
instead of before it.

## What shipped (bespunky-house 0.42.3, bespunky-engineering 0.8.0, @bespunky/nx-tools 0.44.0)

- **One removal, two files.** `_utils/devcontainer-feature.ts` `removeFeature()` takes a feature out of
  `devcontainer.json` AND its pin out of `devcontainer-lock.json`; 0.40.0 and 0.43.0 go through it. The 0.44.0 rung
  `prune-orphaned-feature-locks` removes every pin nothing declares (nothing can read one), cleaning up the projects
  that already ran the old rungs.
- **The sweep found a fourth defect class.** `jsonc-parser`'s `parseTree` returns a partial tree for broken input,
  so the "leave an unparseable file alone" guard in 0.34.0, 0.35.0, 0.40.0, 0.42.0 and 0.43.0 never fired (0.39.0
  already knew). `_utils/jsonc-strict.ts` decides on parse errors; each rung has an unparseable-file fixture.
- **The finish gate**, in three places so it cannot be skipped: an always-on `HOUSE.rules.md` directive (every
  house project, every change), an `architecture-first` section + done criterion (the depth; its trigger now fires
  on "done" / "ship it"), and this repo's CLAUDE.md release procedure (sweep · `--local` upgrade on this repo + read
  the whole diff · a rebuild before release when it reaches the container).

## The gate paid for itself on its first run

Dogfooding this very release (`house.sh upgrade --local .`) showed `HOUSE.rules.md` UNCHANGED: the new directive
had been inserted inside the template's `{{#ui}}` block, so every repo without a UI layer would silently have lost
it — fixtures passed. Moved above the gate; test-layers now asserts the stack-agnostic directives render in a
no-UI repo. That is the fifth release this afternoon would otherwise have needed.
