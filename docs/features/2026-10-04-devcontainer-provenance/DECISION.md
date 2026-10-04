---
effort: devcontainer-provenance
status: concluded
concluded: 2026-10-04
summary: An adopted devcontainer's marker now records what the house's merge added (adopted.houseAdded), and migrations ask houseWrote() — so the house can clean up after itself in project-owned devcontainers instead of only reporting.
tags: [house, devcontainer, provenance, migrations, adoption]
---

# Devcontainer provenance — decision

## Why

0.40.0's `retire-claude-code-feature` could only half-apply in backitup. The other session put it as:

> "that migration could only ever half-apply, because your devcontainer.json is project-owned and generators only add to files they don't own."

The feature it left was one the house's OWN merge had added — but nothing recorded that, so every migration
had to treat it as possibly the project's. The user: *"yes, build it"*.

## What shipped

- The adopted merge records each addition in the marker, `adopted.houseAdded`: `{ path: string[], value }` or
  `{ path, member }` (segment arrays — feature ids are full of dots), at the merge's own granularity
  (`features.<id>`, `remoteEnv.<name>`, `customizations.vscode.*` leaves, array members). Recorded whole, a
  map would stop "holding" the moment a later run added a sibling, pruning everything in it.
- The record **accumulates** (an addition happens once; only that run knows) and is **pruned** of anything the
  file no longer holds exactly — a changed value has become the project's.
- `generators/_utils/devcontainer-provenance.ts` `houseWrote(tree, entry)`: owned → true; adopted → recorded and
  still held. The one question migrations ask; CLAUDE.md's migration rules point at it.
- An `initializeCommand` lifted into object form records the house's ENTRIES, never the key (it now holds the
  project's command too).
- Owned devcontainers get no record: ownership already answers the question.

## Limits, said plainly

Projects adopted before 0.41.0 have no record for their earlier additions (including the 0.40.0 leftover); those
stay reported, never removed. Nothing to migrate: the marker is an owned artifact regenerated every upgrade.
