---
effort: supabase-project-id
status: concluded
concluded: 2026-11-05
summary: A Supabase project is named by the workspace's identity, not `source` from create-nx-workspace's `@<workspace>/source` (nx-tools 0.54.3).
tags: [supabase, house]
---

Reported by another project's agent: *"the scaffold named the Supabase project source, taken from the workspace's package name @visi/source, and any project created the same way would get that name too."*

The generator had its own naming when `_utils/workspace-identity.ts` already answers "who is this project?", for Firebase and the window identity too. It now uses that, which also fixes a wrapper host named after the upgrade's worktree slug. A rung moves the exact seeded value, since config.toml is seeded once; a stack's data is keyed by root, branch and stack name (state.json), so nothing local is lost. A wrapper host already named after a slug cannot be told from a chosen name, so it stays.
