---
effort: finish-the-job
summary: Three follow-up fixes in 20 minutes for one bug; make the whole job (every reference, verified where it runs) happen in one go — the lock-file cleanup, and the skills and always-on rules that would have caught all three before shipping.
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
