# FX3

## Fix 1 — outdated deploys notice

Dogfood D4: on a feature branch that had already run the house upgrade (its working-tree `.bespunky/branches.json` has `"deploys": { "note": … }`), the copy in force — the integration line's — still had the bare string, and every notice still said "run the house upgrade". What was left was only to land the branch.

- **One concept, decided once:** `model.mjs` now returns outdated problems as `{ field, problem, rewrite }` and renders them through `outdatedMessage(o, remedy)`; `outdatedRemedy` is `rewrite` (nothing migrated it) or `lands(<integration>)` (this branch already carries it). The resolver (`resolve.mjs`) picks the remedy: when the in-force copy is the integration line's and the working-tree copy has no outdated problem → `lands`; otherwise (same string here, no working-tree copy, bootstrap) → `rewrite`.
- **Every reader gets it:** `status`/`plan` notes, the `describe`/`verify` refusal (its closing line differs per case), and `status --json`, which gains an `outdated` field (`null` or `{ resolution, line, problems }`). `validate`/`write`/`verify --proposed` check the file itself, so they keep the `rewrite` remedy.
- Rendered (a): `stages[0].deploys: a bare string is no longer a deploys value on the integration line's copy — this branch's copy already has the object form ("deploys": { "note": "…" }); it resolves when this branch lands on "development". Nothing else to do: no upgrade, no edit.`
- Rendered (b): `stages[0].deploys: a bare string is no longer a deploys value — replace it with "deploys": { "note": "…" } (same meaning: a note binds nothing). Run the house upgrade (/bespunky-house:upgrade, @bespunky/nx-tools 0.50.0+), whose migration applies it, or propose this exact rewrite to the human.`
- `SKILL.md` tells Claude how to act on each. Tests: a new `tools/test-branches` case covers both on status/plan/describe/verify and landing; 51/51 pass.
- Not touched (out of this fix's paths): `docs/features/2026-10-03-branch-model/CONTRACT.md` still lists the Amendment 2 `status --json` keys without `outdated` (additive; every consumer checks only the keys it needs).
