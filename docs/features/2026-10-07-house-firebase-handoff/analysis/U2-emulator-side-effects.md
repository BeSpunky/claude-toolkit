# U2 — Emulator side effects (A2), seed banner (D4), supportEmail (E1)

Read-only triage against this worktree. The consumer repo (`shir-halili-coaching`) is not available; its evidence is quoted from `INBOUND-HANDOFF.md`, not verified. Paths below are relative to `plugins/house/engine/nx-tools/src/generators/firebase-emulators/` unless stated.

---

## A2 — the Functions emulator sent REAL Telegram messages

### 1. Origin — the toolkit's half is real; the Telegram half is the project's

| Piece | Toolkit? | Where |
| --- | --- | --- |
| `tools/emulators.sh` | yes, **class A** (generator-owned, rewritten every upgrade) | `emulators.sh.tpl`, written at `generator.ts:233` |
| Borrowing the MAIN worktree's `.secret.local` | yes | `emulators.sh.tpl:164-172` (resolves `MAIN_WORKTREE`), `:208-232` (the cascade + the exact log line `.secret.local absent in this worktree; using the main worktree's copy`, `:226`) |
| The emulator seeing real secrets at all | yes | `emulators.sh.tpl:230-231` copies `<functionsRoot>/.secret.local` into the dist bundle unconditionally |
| `.secret.local` as the ONE file for both emulator and prod | yes | `functions-secret.local.example.tpl:1-13`, `push-secrets.sh.tpl:2-6,50`; HOUSE.md `house-doc/HOUSE.md.tpl:219` ("One source of truth, two sinks") |
| `.env` (public params, e.g. `TELEGRAM_CHAT_ID`) copied into the bundle | yes, mechanism only | `generator.ts:420-424` (`assets: [{ glob: '.env', … }]`) |
| `tools/seed/build.mjs` + the applier | yes | `seed-build.mjs.tpl` (class A, `generator.ts:241`), `seed-world.mjs.tpl` (class C — user-owned once written, `generator.ts:242`) |
| Telegram, `onInquiryCreated`, any notifier | **no** — the toolkit has none. The only generated function is the `ping` callable (`functions-main.ts.tpl`). `grep -ri telegram\|notif\|FUNCTIONS_EMULATOR` over `nx-tools/src` finds nothing relevant. |

### 2. Root cause in the toolkit

Not "the emulator forgot to check `FUNCTIONS_EMULATOR`". The toolkit made a **design decision that real production credentials are the emulator's default input**, and then worked to make that default reach further:

1. **One file, two audiences.** `.secret.local` is simultaneously the *push source for production* (`push-secrets.sh`) and *the emulator's secrets* (`emulators.sh`). "One source of truth, two sinks" sounds tidy, but the two sinks have opposite safety requirements: prod needs the real values, a local emulator must not hold anything that can reach the outside world. Coupling them means the only way to have prod secrets on disk is to arm every local emulator run with them.
2. **The worktree cascade amplifies it** (`emulators.sh.tpl:215-229`). Its stated motive is an OAuth code→token exchange failing with "client_secret is missing" in a fresh worktree. The fix chosen — silently arm every worktree, including throwaway agent worktrees, with the main tree's production secrets — trades a loud, correct failure for a silent, dangerous success. Agents run worktrees unattended; this is exactly where a side effect goes unnoticed.
3. **There is no emulator-only override channel for public params.** Firebase's own emulator-only mechanism is `.env.local` (highest precedence, read only by the emulator). But the house emulator loads the **dist bundle**, and the build copies only `.env` (`generator.ts:424`), so a project that writes `<functionsRoot>/.env.local` (e.g. `TELEGRAM_CHAT_ID=<test chat>`) has it silently ignored. The documented escape hatch is broken by the dist-bundle architecture.
4. **Seeding is not the root cause, but it has a hole.** The toolkit's seed path, `tools/seed/build-seeds.sh` (`seed-build-seeds.sh.tpl:142-146`), boots only `--only auth,firestore` — no Functions, so no triggers fire. The incident must therefore have come from running `node tools/seed/build.mjs default` **directly** against a running full suite. That works because `seed-world.mjs.tpl:39-41` falls back to `localhost:8080` / `localhost:9099` when the `*_EMULATOR_HOST` vars are absent — i.e. the applier silently writes into *whatever suite is on the base ports* (possibly the main tree's, not this worktree's), where Firestore triggers then fire. The fallback is the defect; the seed tool was never meant to run outside `emulators:exec`.

### 3. Correct architectural fix — "no outbound side effect leaves an emulator by default"

The class is not Telegram; it is *any credentialed egress*: email (SendGrid/Resend keys), payments (Stripe), SMS, webhooks, third-party APIs. Practically every outbound integration needs a credential, and in a house project every Functions credential flows through ONE seam the toolkit owns: `emulators.sh` placing secrets beside the bundle. So the guarantee belongs **at that seam, not in app code**:

**(a) Emulator secrets are INERT by default — derived, not copied.**
- `emulators.sh` writes `dist/<functions>/.secret.local` itself, containing **every key** the project declares (keys from `.secret.local.example` ∪ keys of `.secret.local`) with inert values (`EMULATOR_INERT_<KEY>`). Values never come from the real file by default.
- Every key must be written explicitly: removing the file is not enough. *(To verify before building)* the Functions emulator may fall through to Secret Manager via ADC for a secret absent from `.secret.local` — and the house devcontainer persists gcloud credentials, so an absent key could resolve to the REAL production secret. Writing placeholders for every declared key closes that.
- Real values are an **explicit, loud, per-run opt-in**: e.g. `EMULATOR_SECRETS=real` (or a `--real-secrets` flag on the target), printed as a banner naming each key that is live. Optionally a separate `<functionsRoot>/.secret.emulator.local` for *sandbox* credentials (Telegram test bot, Stripe test key) that the emulator may use by default — this is the honest version of "the emulator needs a secret to work": give it a *test* credential, not the prod one.
- `.secret.local` remains the push source for `push-secrets.sh` — unchanged for production.

**(b) No cross-tree borrowing of secrets — ever.** Delete the cascade (`emulators.sh.tpl:215-229`). Seeds may keep borrowing (they are data, copied, harmless); secrets may not. With (a) in place, a fresh worktree gets inert placeholders automatically — nothing to set up, and the OAuth exchange fails loudly instead of acting as production.

**(c) Make Firebase's emulator-only override channel work.** `emulators.sh` copies `<functionsRoot>/.env.local` (gitignored, emulator-only by Firebase's own semantics) beside the bundle at launch, same as the secrets. That covers the *uncredentialed* remainder of the class (a plain webhook URL, a chat id in `.env`): the project points them at a sink locally. Seed a commented `.env.local.example` (class C) explaining this.

**(d) Seed tooling refuses to run outside its harness.** `build.mjs`/the applier require `FIRESTORE_EMULATOR_HOST` and `FIREBASE_AUTH_EMULATOR_HOST` to be set (i.e. it is under `emulators:exec`) and exit with a message otherwise — no `localhost:8080` fallback. The "seed refuses when real secrets are loaded" proposal is then moot: the toolkit's seed suite has no Functions, and running against a live suite is refused outright.

**(e) Document the hazard** as a HOUSE.md section under *Functions secrets* (rewrite `HOUSE.md.tpl:219`): the emulator is inert by default; how to opt in; sandbox credentials; `.env.local`. Plus a one-line always-on rule in HOUSE.rules only if we want agents to never pass the opt-in on their own (I would: "never enable real emulator secrets without the user's explicit say-so" — it is a consent question, like IAM grants in B4).

**Pushback on "generated notifier seam with a log-only dev sink under `FUNCTIONS_EMULATOR`".** The toolkit generates no notifier and should not: it would be generating application architecture for one project's integration, and a code-level `if (FUNCTIONS_EMULATOR)` guard is opt-in per integration — exactly the "remember to do it" model that failed here. The secrets seam is opt-*out* and covers every integration the project will ever add, including ones written by an agent who has never heard of this incident. The project's own Telegram notifier *may* still add a dev log sink as defence in depth (good practice, their code), but the toolkit's guarantee must not depend on it.

### 4. Migration?

- `emulators.sh`, `build.mjs`, `build-seeds.sh` are class A — regenerated on upgrade, **no migration** for (a), (b), (d-build.mjs).
- `.gitignore` gains `<functionsRoot>/.env.local` and (if adopted) `.secret.emulator.local` — the generator's gitignore block assertion handles it; no migration.
- The applier's host fallback lives in **`tools/seed/world.mjs`, which is class C** (user-owned once written). A template fix never reaches existing projects. See D4 below — the right fix is moving the applier out of `world.mjs`, which **does need a migration**.
- One release note matters: existing projects whose local flows *relied* on real emulator secrets will start failing loudly. That is the intended behaviour, but it must be stated, with the opt-in named.

### 5. Extra ideas

- **Print the egress posture at emulator start**: `[emulators] secrets: INERT (3 keys) — EMULATOR_SECRETS=real to arm`. Visible, cheap, and it turns the hazard into a fact the developer sees every run.
- **Worktree serves should never be armable by an agent** without the human: the opt-in env var could be refused when `PORT_OFFSET != 0` unless also confirmed, since worktrees are where agents run unattended. Judgement call — flag for the user.
- Consider a network-level belt: Node 24's `NODE_USE_ENV_PROXY` + an `HTTPS_PROXY` pointing at a black-hole/logging proxy for the Functions emulator process would catch even uncredentialed egress. Probably over-engineering for now (breaks legit Google-API calls the emulator itself makes); note only.
- Audit the same "borrow from the main tree" pattern elsewhere — seeds are fine (data, copied), but anything credential-shaped (e.g. `.firebaserc`, service account files) must never cascade.

---

## D4 — seed banner prints "sign in as: " with nothing after

### Origin
Toolkit: `seed-world.mjs.tpl:138-141` (`applyWorld`'s banner), called from `seed-build.mjs.tpl`. The applier is written into **`tools/seed/world.mjs`, class C** (`generator.ts:242` — written only when absent).

### Root cause
`who` is `Object.values(world.accounts).map(a => \`${a.email} (${a.name})\`).join(' · ')`. An empty string means **the world has zero accounts** (an account without `email` would print `undefined (…)`, not nothing). The applier never considers that a world may seed no accounts — the template's only world has one, so the empty case was never seen. (Unverified: the consumer's actual `world.mjs`; an accounts shape other than an object of `{email,name}` would also explain it.)

The deeper issue: **generic machinery lives in a user-owned file.** `world.mjs` is "the declarative source of truth" for data, yet it also carries the applier (encoder, REST calls, banner), which the file's own header calls "generic; never needs touching". Because it is class C, every applier fix — this banner, the `localhost:8080` fallback from A2(d) — is frozen out of every existing project.

### Fix
- Split: `tools/seed/apply.mjs` (class A, generator-owned: encoder, REST, harness-required env check, banner) + `tools/seed/world.mjs` (class C: `WORLDS` only, plus `ref`/`at` re-exported from `apply.mjs` or imported by it). `build.mjs` imports `WORLDS` from `world.mjs` and `applyWorld` from `apply.mjs`.
- Banner: with accounts → list them; with none → `'<name>' world ready — no accounts seeded (sign up through the Auth emulator)`. Better still, print the sign-in hint where it is useful — at **serve** time, not only at `seed:build` (the README table already wants it: `emulator-seeds-README.md.tpl:12`).

### Migration — yes
A migration rewriting existing `tools/seed/world.mjs`: if the file still contains the template applier (detect by the `── The applier (generic; never needs touching to add data)` marker and the `applyWorld` export), remove everything from that marker down, keep `WORLDS`/`ref`/`at` (or replace the latter with an import), and let `build.mjs` (regenerated) import from `apply.mjs`. If the applier section was customized (no marker / modified functions), **leave it and report** it by name — per the cleanup rule. Needs a `tools/test-migrations` case (template-shaped world, customized world, already-split world).

---

## E1 — `firebase.json` `auth.providers.googleSignIn.supportEmail = "support@undefined.firebaseapp.com"`

### Origin — not the toolkit
Nothing in `nx-tools/src` writes an `auth` key or `providers`/`googleSignIn`/`supportEmail` into `firebase.json` (`grep -rn "supportEmail\|googleSignIn" nx-tools/src` → none). The generator owns only `emulators` and `functions` and preserves other top-level keys (`generator.ts:194-197`; `skills/new/SKILL.md:57`). An `auth.providers` block in `firebase.json` is written by **firebase-tools** itself (`firebase init auth` / its auth-provider config support), templating `support@<projectId>.firebaseapp.com`.

### Root cause — an interaction the toolkit contributes to
`undefined` is the projectId firebase-tools had when it ran: **no active project**. The house deliberately writes no `.firebaserc` (`SKILL.md:57`, `HOUSE.md.tpl` "no `.firebaserc` needed") and its emulator tooling passes `--project` explicitly, so a house repo is, by design, a Firebase directory with no active project — and any `firebase init <feature>` run there (by a human or an agent) without `firebase use --add` first produces `undefined`-templated config.

### Fix
- Not a generator change. Document in HOUSE.md's "Connect to a real Firebase project" recipe: **`firebase use --add` before any `firebase init <feature>`**, and why (the house intentionally ships no active project).
- Cheap detection: `firebase-welcome.sh` / `emulators.sh` can warn when `firebase.json` contains the literal `@undefined.` or `"undefined"` — a fact relayed, not a repair.
- **No migration**: `firebase.json` is class B, but the correct value (the real project's support email) is not knowable by a migration — rewriting it would be a guess. At most, the warning above.

---

## Summary

| Item | Verdict | Fix | Migration |
| --- | --- | --- | --- |
| A2 | **Real gap** (toolkit arms the emulator with prod secrets and spreads them to worktrees; Telegram code itself is project-specific) | Inert-by-default emulator secrets derived from declared keys; explicit opt-in; no cross-tree secret borrowing; make `.env.local` reach the bundle; seed tooling refuses outside `emulators:exec`; HOUSE.md section | No for the scripts (class A); yes only via D4's applier split for the seed fallback |
| D4 | **Real gap** (empty-accounts case; applier stranded in a class C file) | Move applier to generator-owned `apply.mjs`; handle zero accounts | **Yes** — split existing `world.mjs`, report customized ones |
| E1 | **Not toolkit** (firebase-tools templated with no active project) — contributed to by the house's no-`.firebaserc` design | Document `firebase use --add` before `firebase init`; optional `undefined` warning | No |
