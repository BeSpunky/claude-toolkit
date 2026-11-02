---
effort: release-followups
summary: Clear the leftovers from the 0.51.x release, one agent per issue, each on its own branch; the session integrates, bumps and lands.
---

User: *"Send an agent for each"*, of the open list after 0.51.1.

Decided before dispatch: `nx test design-system` gets `passWithNoTests` — a library with no specs yet has nothing to fail, and the flag stops mattering the day a spec is added. Agents never bump a version or land; the session does, so two payload branches cannot collide on one version.
