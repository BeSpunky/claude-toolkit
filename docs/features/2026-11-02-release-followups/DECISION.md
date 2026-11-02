---
effort: release-followups
summary: Clear the leftovers from the 0.51.x release, one agent per issue, each on its own branch; the session integrates, bumps and lands.
---

User: *"Send an agent for each"*, of the open list after 0.51.1.

Decided before dispatch: `nx test design-system` gets `passWithNoTests` — a library with no specs yet has nothing to fail, and the flag stops mattering the day a spec is added. Agents never bump a version or land; the session does, so two payload branches cannot collide on one version.

## 2026-11-02 — superseded before landing

`passWithNoTests` (above) was tried and does not exist: the `@nx/angular:unit-test` schema refuses it. User, on the outcome: seed a real DsTheme spec at creation only, plus a 0.51.2 rung adding it to existing design systems, skipping and reporting no test target, another executor, own include/exclude, any existing spec, DsTheme missing or reshaped. Creation only, because an upgrade must not bring back a spec a project deleted, or add one its reshaped library cannot pass.
