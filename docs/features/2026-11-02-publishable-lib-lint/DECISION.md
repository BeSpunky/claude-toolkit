---
summary: Every Angular library the house creates peers only what it uses, so it passes its own lint from birth.
---

# Angular libraries peer what they use

**Reproduced first.** `house.sh new --local --preset=angular`, then `publishable-lib --name=widgets`: `nx lint widgets` failed on `The "@angular/common" package is not used by "widgets" project` (`@nx/dependency-checks`); the build passed.

**Root cause.** `@nx/angular`'s library generator writes `@angular/common` + `@angular/core` from a fixed template (`files/base/package.json`), and its standalone demo imports core only. Only the design system trimmed the manifest, through a port of its own.

**Decision.** The judgement moved, unchanged, to `adapters/angular/library-peers.ts`, and the library port's `create` applies it, so `publishable-lib`, `design-system` and `navigation-core` share one behaviour. `DesignSystemPort.pruneUnusedPeers` and its call are gone: the demo never imported the peer, so nothing is left for that later trim to do (observed: a new design system still peers core alone).

**The cost, observed.** A library that later imports `@angular/common` gets `missing from "peerDependencies"` from the same lint; `--fix` writes it, then lint and build pass.

**No migration — a finding, not an omission.** The 0.50.0 rung could prune an existing design system because the house identifies it by tag and knows it pruned its demo. An arbitrary Angular library has no such mark: it cannot be told from a hand-authored one, and its `peerDependencies` is the contract of a published package, which a project may keep deliberately (with `ignoredDependencies`, say). Deleting there is a guess. Nor is a report-only rung owed: an affected library's own `nx lint` already names the peer and offers `--fix`, so a rung would only repeat it, once, in an upgrade log.
