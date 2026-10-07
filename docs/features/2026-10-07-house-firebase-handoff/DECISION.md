---
effort: house-firebase-handoff
summary: Triage and plan the gaps a consumer Firebase + Angular SSR house project hit (shir-halili-coaching handoff, 2026-10-07)
---

## Decisions

- **2026-10-07 — release split.** Asked "four separate releases, safety first, or one big release?" The user: *"Just move on."* Taken as: don't block on it, use the recommendation → four waves (safety, dev loop, deploy, hygiene) as in `PLAN.md`.
- **2026-10-07 — scope.** The user: *"Send agents to fix everything and incorporate what's needed into our toolkit's mechanisms. Ensure great DX, facilitate, don't just do the technical work, think what the project/developer/Claude would need and solve *that*"*. Earlier: *"Wait. Don't release anything."* → implement every verified item on this branch; no publish, no plugin release until the user says so.
- **Backwards compatibility:** the explicit question was put by voice and the user cancelled it, then directed "fix everything". House default applies — **no compat layers** (no global `firebase` kept, no direct-dial emulator option, no deprecated aliases). Moving existing projects forward is done by migrations.
- **Open decisions resolved by the orchestrator** (recorded so they can be challenged): CI deploy is an opt-in `ci` layer; the platform firewall is tightened, with a migration that infers `platform:` tags where the evidence is unambiguous and reports the rest; all migrations of this effort live under one payload version, `0.50.0`.
- **2026-10-07 — `deploys` shape.** Asked whether free-text `deploys` should stay valid. The user: *"object-only, no compat. Migration should take care of shifting to the new format"*. → the engine accepts only the object form; a 0.50.0 migration rewrites a string `deploys` to `{ note: <string> }` (a format shift that preserves the declared model — the user's explicit decision is the human decision the "nothing writes the model" rule asks for). Where no migration runs (plugin updated first, or a repo using the workflow plugin without the house), the engine's refusal names the exact rewrite.
