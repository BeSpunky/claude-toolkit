---
effort: house-firebase-handoff
status: concluded
concluded: 2026-10-08
summary: Fixed every verified gap two consumer Firebase projects reported (nx-tools 0.50.0) — pinned versions, emulators that cannot reach production or lose data, one stack identity per dev server, deploy targets + opt-in CI, true App Hosting docs, a fail-closed platform firewall — through two adversarial review rounds and real-container checks
tags: [house, nx-tools, firebase, emulators, dev-loop, ci, migrations, firewall, dogfood, review]
born-as: Triage and plan the gaps a consumer Firebase + Angular SSR house project hit (shir-halili-coaching handoff, 2026-10-07)
---

## Conclusion (2026-10-08, at the merge gate)

Delivered as `@bespunky/nx-tools` 0.50.0, `bespunky-house` 0.48.0, `bespunky-workflow` 0.12.0 (bumped at landing; publishing waits on the move to `main`). The trail below is untouched; the per-unit records are `impl/`, the two review rounds `review/`, the ledgers `handoffs/`.

- **What changed shape during the effort**, each recorded where it happened: the C1 premise was refuted (App Hosting walks up from the root dir) and the real bug was a non-existent `--environment` flag; `serve` became the engine as a non-continuous task after R3 showed the follower design was patch-on-patch; emulator safety became structural (the `demo-` twin id) after R2; the stack lock became a kernel `flock` after S3; the firewall returned to one rule instance after S2.
- **What the gates caught that fixtures did not:** a blocker in `new --preset=angular --firebase` (R1-0), a data-loss race in the export keeper (S1), seed builds broken under Nx's FORCE_COLOR, `new` committing into an enclosing repo — all found by running, not reading.
- **User decisions:** no compat layers anywhere; `deploys` object-only with a migration; `FIREBASE_EMULATOR_PROJECT` removed (refused when set).
- **Left outside the toolkit, with reasons:** E1 (a firebase-tools init bug — warned about), E2/E3 (upstream Nx/Analog — `nx migrate` guidance); the setup-gcp script is verified against a gcloud simulator and firebase-tools source, not a live GCP project.


## Decisions

- **2026-10-07 — release split.** Asked "four separate releases, safety first, or one big release?" The user: *"Just move on."* Taken as: don't block on it, use the recommendation → four waves (safety, dev loop, deploy, hygiene) as in `PLAN.md`.
- **2026-10-07 — scope.** The user: *"Send agents to fix everything and incorporate what's needed into our toolkit's mechanisms. Ensure great DX, facilitate, don't just do the technical work, think what the project/developer/Claude would need and solve *that*"*. Earlier: *"Wait. Don't release anything."* → implement every verified item on this branch; no publish, no plugin release until the user says so.
- **Backwards compatibility:** the explicit question was put by voice and the user cancelled it, then directed "fix everything". House default applies — **no compat layers** (no global `firebase` kept, no direct-dial emulator option, no deprecated aliases). Moving existing projects forward is done by migrations.
- **Open decisions resolved by the orchestrator** (recorded so they can be challenged): CI deploy is an opt-in `ci` layer; the platform firewall is tightened, with a migration that infers `platform:` tags where the evidence is unambiguous and reports the rest; all migrations of this effort live under one payload version, `0.50.0`.
- **2026-10-07 — `deploys` shape.** Asked whether free-text `deploys` should stay valid. The user: *"object-only, no compat. Migration should take care of shifting to the new format"*. → the engine accepts only the object form; a 0.50.0 migration rewrites a string `deploys` to `{ note: <string> }` (a format shift that preserves the declared model — the user's explicit decision is the human decision the "nothing writes the model" rule asks for). Where no migration runs (plugin updated first, or a repo using the workflow plugin without the house), the engine's refusal names the exact rewrite.
- **2026-10-07 — review round: design disputes decided by the orchestrator** (findings in `review/R1…R9.md`):
  - **Serve: adopt R3's simpler design.** `serve` becomes the engine itself as a NON-continuous task (Nx never shares non-continuous tasks, so every `nx serve` gets its own stack and its own true exit status); continuous `dev-stack` stays only for e2e to depend on. This retires serve-preflight, the follower, exit records and the /proc stderr postscript (a boundary violation). Reason: it removes a whole class of bugs (NB1/NB2, R3-4, R3-6) instead of patching them — *easy ≠ simple*.
  - **Emulator safety: make it structural.** The emulator suite runs under a `demo-` project id by default, so firebase-tools itself refuses every real-service access; the real project id is used only when the developer explicitly asks for a real service or the sandbox. Placeholders and the Secret Manager sink stay as defence in depth, made robust (R2-1/2/4/5). The guarantee is stated exactly as enforced, no broader.
  - **CI: security first.** `ci` bindings only on protected, non-maintained lines, one line per environment; a house-owned WIF pool/provider; rollback undoes only what setup recorded; actions pinned by SHA; `id-token: write` only on the job that authenticates; provider args scoped to provider targets, not every project's `deploy`.
  - **Firewall classifier reads imports the way lint does** (TypeScript's own import scanning), apps take their stack's platform, unknown evidence is reported rather than defaulted to shared.
  - **Proxy becomes composable** (a project seam), with anchored routes; SSR gets the emulate decision from the dev engine's env.
  - **The release gate gains a scripted consumer dogfood** that includes a real `new` with the change (R1-0 slipped through because the consumer was created with the released toolkit).
  - Every fixer reproduces a finding before fixing it, and rejects it with evidence if it doesn't hold.
- **2026-10-07 — second review: decisions.**
  - **Stack lock: a kernel-released primitive** (flock or an abstract unix socket), replacing the hand-built takeover/heartbeat/prune; a workspace shared by two containers is detected and refused, not modelled. Agent runs never take the default ports (the local-server rule, in code).
  - **The suite's project id comes from evaluating `environment.ts`** — the same decision the browser makes — never a regex; unloadable → exit 2.
  - **push-secrets refuses ambiguity instead of reinterpreting:** a value whose parsed form differs from its raw text (an unquoted `#`, quotes, `export`) is refused with the exact quoted form to write. Nothing is pushed with a meaning the developer didn't write; no old behaviour is kept, so no compat question arises.
  - **The firewall goes back to ONE rule instance:** platform constraints spliced into the project's own `@nx/enforce-module-boundaries`, SSR/test scoping by ESLint file overrides — never a second instance that re-runs generic checks.
  - **e2e gets an address contract:** the stack it depends on exports its base URL to the e2e task.
- **2026-10-07 — `FIREBASE_EMULATOR_PROJECT`.** Asked whether to remove the released override (read by the emulator script only, so a set value split suite and browser onto different project ids) or rebuild it so the browser follows. The user: *"Remove it"*. → removed with no compat; the launch path **refuses** to start while it is set (exit 2), naming why and what replaced it (environment.ts drives both sides), so nobody is left with a setting that silently does nothing.
