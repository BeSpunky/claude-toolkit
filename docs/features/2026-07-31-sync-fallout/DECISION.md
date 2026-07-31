# Decisions — sync fallout, upstream fixes

Seven items, designed one at a time with the user on 2026-07-31 before any code was written.
Each records the decision, the reasoning that produced it, and the roads not taken.

---

## 1 — The sync must refuse a dirty tree and a protected branch

**Decision.** The **probe** gains two preconditions, checked before anything is written:
dirty working tree (`SYNC_DIRTY`) and HEAD on a protected branch (`SYNC_PROTECTED_BRANCH`).
All preconditions are checked in **one pass** and reported together. **No override flag.**

**The probe classifies; it never resolves.** Three outcomes, not two: clean · refuse-with-a-
required-fix · **ambiguous-ask-the-human**. The refusal's output is an **API for an agent** — a
status token in the existing `SYNC_OK`/`SYNC_PARTIAL` vocabulary, dirty paths split by kind
(staged / modified / **untracked** — untracked is what `libs/keeper` was), the ladder it would
have run, the branch, and an explicit "nothing has been written".

**Why not stash-and-restore** (the first choice, then reversed by the user):

> "Actually, let's not stash and pop. Let's have it fail so Claude (which is running it) will
> know and prompt the user on what to do. The user can chose to stash, create backup branch and
> commit there, sync on a new branch, or any other option Claude sees"

That reframed the deliverable. The sync is almost never run by a human at a shell — it is run
by Claude, in a session, with a user present. The script does not need to *solve* the dirty-tree
problem; it needs to fail in a way that hands the decision to the party with the context.
Stash-and-restore was a shell script guessing at things only the session knows (is this work
related, is there an open feature package, what did the user just say). It would have guessed
wrong sometimes, silently, at the worst moment.

**Protected branches.** `--create-commits` commits onto whatever branch HEAD is; nine migration
commits landed directly on the consumer's current branch. A clean tree does not help — the
commits *are* the problem, and it is the same failure shape: an irreversible git act on an
unchecked precondition. House tooling must not break the house rule it ships.

**When no branch structure exists** — fresh scaffold, or a repo whose only branch is `main` —
the user's answer was **"Ask the user"**, i.e. the ambiguous third outcome. Refinement made
without asking: **a repo with no commits is new, not ambiguous** (being asked "what is your
branch model?" while creating an empty project would be absurd). The ask fires when there is
real history on a lone `main`.

**This spans two artifacts.** The script detects and refuses; **`plugins/project-starter/commands/sync.md`**
(a slash command — *not* a skill, corrected during collision review) carries the decision
procedure. Script-only would leave Claude improvising differently every session — the same
non-determinism in a new costume.

**Constraint discovered during collision review:** `scaffold.sh` carries a deliberate duplicate
of the version comparator, in `MIGRATE_PROBE` and in the `--local` collector, because it runs in
consumer projects where `tools/check-release-invariants/rules.cjs` does not exist. It is stamped
*"IF YOU CHANGE THE ORDERING HERE, CHANGE IT THERE TOO."* Our preconditions are additive and must
not touch that ordering.

---

## 2 — `app.config.ts` is seed-only, and the fix belongs on `wire-provider`

**Decision.** `app.config.ts` is **class (C): seeded at baseline, never owned.** Generators write
it once and never again; any later provider change ships as a migration.
**Mechanism: wire on *ensure*, never on *detect*** — reusing the house's existing strict split.
Scaffold ensures everything, so new projects still get wired; a sync where the layer is merely
detected must not touch the file.

**Two bugs were stacked here**, and fixing only the visible one leaves the other live:
- **Class error** — `app.config.ts` is the file an Angular app is most certain to evolve.
  Writing into it at sync time is a category error regardless of *what* is written.
- **Correctness error** — the placement is wrong for an SSR app. Firebase in the shared config
  initialises during prerender, the exact concern `bespunky-engineering:angular-architecture`
  exists to prevent. The generator contradicted the toolkit's own advice.

**Scope is three generators, not one.** `_utils/wire-provider.ts` is the single implementation,
used by `serve` (`provideWorktreeTabLabel`), `firebase-emulators` (`provideAppFirebase`) and
`design-system-styles` (`provideDesignSystem`). All three write into `app.config.ts` on every
sync. Firebase is merely the one whose double-provide breaks SSR.

**Nobody was careless.** The idempotency guard at `wire-provider.ts:78-81` deliberately scopes
"already wired?" to a call *inside the providers array* rather than a whole-file identifier scan,
with a good reason written down (a leftover import after a manual revert would otherwise read as
"wired"). That reasoning is sound. It simply cannot see a providers array in a file it was never
told about — `app.config.browser.ts`, which is the **consumer's own invention**; nothing in the
payload mentions it. The write should not have been happening on a sync at all.

**Rejected: making the guard smarter.** Checking the whole config graph before adding would have
prevented this exact diff — and would require recognising every shape an app config has ever had
or might be restructured into, forever. That is unbounded legacy healing wearing a small hat, and
it is precisely what the migration ladder was built to retire.

**Migration owed: detect and report, delete nothing.** Scan each app for the same `provideX()`
called in more than one config; report file and line. Honours *"where a deletion would be a
guess, don't delete — but report it"*, and works for config shapes the toolkit has never seen.
Accepted cost: the SSR bug is named, not fixed; a human still acts.

---

## 3 — Emulators: derive `--only`, isolate the stack, reap only orphans

Two independent defects, both patched locally in the consumer, both belonging upstream.

### 3a — App Hosting takes the suite down

**The user's account, which named the mechanism:**

> "The apphosting config looked for `yarn run dev` and there was no such command"

Confirmed against the consumer's `firebase.json`: **there is no `apphosting` block** — `auth`,
`firestore`, `storage`, `functions`, `ui`, `singleProjectMode` only. firebase-tools auto-includes
App Hosting because the root `apphosting.yaml` exists, which **the house generator writes**. The
toolkit creates the condition and then does not handle it. `TIMEOUT: Port 5002` is what that looks
like from outside.

**Rejected: "no `dev` script? add one."** `dev` would have to be `nx serve <app>`; the house
`serve` target chains `tools/emulators.sh`, which starts the suite — so the App Hosting emulator
would launch a serve that launches the emulators that launch the App Hosting emulator. Defining
`dev` does not fix this, it makes it recursive.

**Considered and set aside: remove the entry.** The house already has a rule for this failure
class, stated twice in the generator (`generator.ts:144-148`, `:409-415`): *a configured emulator
with no backend behind it fatally aborts `emulators:start`*. For `functions` the answer was
`ensureFunctionsProject()` — scaffold the backend so the entry is valid. App Hosting has no
backend to scaffold and no entry to delete, so `--only` is the only lever there is.

**Decision.** `emulators.sh` **derives `--only` from `firebase.json` at run time** — the
consumer's 30 lines, upstreamed into `emulators.sh.tpl`. `firebase.json` is class (B) project
state that a project legitimately edits, so deriving beats baking a list at generate time: it
cannot drift. **The consumer's fix was right; the bug is that the toolkit made them write it.**

### 3b — A second `nx serve` killed the running suite

**The user's recollection, which was correct:**

> "Emulators kept dying mid-run - if I remember correctly, because Claude kept running serve
> again (or maybe another reason?)"

`reap-emulators.sh` pass 0 `pkill -TERM`s every process matching `firebase/emulators/*.jar` in the
container, then `SIGKILL`s survivors 1.5s later. Its own safety argument (lines 18-22) claims
anything on these ports is *"unambiguously this project's own leftover"* — true — and then
quietly equates **belongs to this project** with **is stale**. A healthy suite started thirty
seconds ago also belongs to this project.

Three things sharpen it: it is `bespunky-workflow:local-server-isolation` ("never kill a server
you didn't start") broken by house tooling, automatically, on every serve; the concept already
exists in the file (ISOLATED mode skips the sweep *for exactly this reason*, but only when the
caller opts in via `--portOffset`); and it is **data loss, not interruption** — a `SIGKILL` skips
firebase-tools' export-on-exit, which is what the "session + data survive every serve" promise
depends on.

**Decision.** **Serve defaults to an isolated stack**, which makes the destructive sweep
unreachable rather than merely conditional. Plus:
- **Ownership-aware sweep** — kill only JVMs whose owner is dead (reparented to PID 1). Safe to
  run always, including for isolated stacks, because a live suite always has a living ancestor.
  This is necessary: skipping the sweep everywhere would reinstate the orphan-accumulation problem
  the file was written for, since each crashed offset stack strands JVMs no later run enumerates.
- **Persistence: first stack persists, extras are import-only.** A serve takes the base ports when
  free and owns import+export; if base is occupied it allocates an offset and runs import-only.
  The ordinary one-developer flow behaves exactly as today, concurrent serves see the same seeded
  data, nothing clobbers. Reuses the precedent already in `emulators.sh` (focused `--only` runs are
  import-only). Needs port-availability detection — **never a kill**.

---

## 4 — Target documentation moves to `metadata.description`

**Decision.** Adopt Nx's modelled `metadata.description` field instead of the `//` comment-key
convention, and ship a migration converting existing `//x` keys — which also repairs projects
already corrupted.

**The culprit is not house code.** Every spread and every target iteration in the payload was
checked: `serve` only ever reaches `dev-server`/`serve` by name, `serve-options` touches four named
keys, `_utils` has no merge helper, and no generator iterates `targets` generically. **Nothing in
the toolkit spreads that value.**

**Leading hypothesis, not a finding: the `@nx/devkit` round-trip.** `readProjectConfiguration` →
mutate → `updateProjectConfiguration` normalises on write, and a normaliser doing `{ ...target }`
per entry will spread a string into 555 char keys. It explains why the corruption appeared as *the
generator's only net change* (the generator did not write it; the round-trip did) and why it looked
like serve/serve-options (they are simply the generators that touch `project.json`).
**Settle it with a fixture test before designing further.** If it is wrong, item 4's culprit is
still unidentified.

**Latent defect found on the way, worth fixing regardless:** `serve/generator.ts:214` guards with
`if (target && target.executor !== SERVE_EXECUTOR)`. A string passes `target &&`, and a string's
`.executor` is `undefined`, satisfying `!== SERVE_EXECUTOR` — so a non-object under a
`serve`/`dev-server` key is returned as a `TargetConfiguration` and written back at line 129. The
guard checks *truthiness* where it means *is an object*.

**Second open fact:** `metadata.description` must be confirmed present in the pinned Nx version;
the whole fix rests on it.

**Rejected: make generators comment-safe by not round-tripping.** Broader protection (it would
guard every unknown key, not just comments), but it costs a rewrite of how each generator edits
`project.json`. Revisit if the fixture test implicates the round-trip and other keys prove exposed.

---

## 5 — `.bespunky-sync.lock/` — SHIPPED INDEPENDENTLY, out of scope

Designed here as a **self-ignoring directory** (`.gitignore` containing `*`, written at lock
creation, same pattern as feature-package `mocks/`) rather than a consumer `.gitignore` edit,
because a lock is a **machine fact**, not a repo fact — the house's own stamp/install distinction.

`dd87697` (project-starter **0.26.4**) landed exactly this while the design was in progress, with
independent reasoning that reached the same place. **Nothing is owed to projects already bitten,
deliberately** — a `.gitignore` does not untrack a tracked file, and a permanent detector would be
a museum piece. The consumer clears its two phantom deletions with any commit, or once by hand:
`git rm -r --cached .bespunky-sync.lock`.

---

## 6 — `owned: true` means additive assert, never overwrite

**Decision.** Reuse the existing comment-preserving `jsonc-parser` additive merger in **both**
cases. Ownership decides whether **house keys are re-asserted**; it never decides whether the
**project's keys survive** — they always do, comments included.

**Why this shape.** The obvious guard does not survive contact with house rules: "claim only if
the file still matches generator output" would have to recognise every devcontainer the toolkit
has ever emitted — unbounded legacy healing again. Making ownership non-destructive removes the
need for any such recognition.

**Items 6 and 7 were a live trap together.** The migration wrote `owned: true`, but the consumer's
active layers are `angular, firebase, js, nx, web` — no `agent`, so the devcontainer generator
never ran and the claim is dormant. The sync's own closing suggestion was to run `--ensure=agent`
to get `HOUSE.md`. Doing that **activates the agent layer**, finds the fresh ownership marker, and
rewrites the devcontainer. The remedy the report recommends is the trigger for the overwrite the
migration set up, and nothing in the report connects them. **That project must not run
`--ensure=agent` until this ships.**

---

## 7 — `house-doc` becomes baseline, not agent-layer capability

**Decision.** `house-doc` runs whenever any house layer is active, not only under `agent`. The
agent layer keeps what it is actually about — devcontainer, window identity, Claude settings.

**Why it is a layering bug, not working-as-intended.** `retire-inline-house-sections` refused
correctly, but its precondition (`HOUSE.md` exists) is met only by a layer the project never opted
into — so it will refuse on every future sync, forever, and be right every time. Eight inline house
sections can never retire. `HOUSE.rules.md` is the mechanism by which house rules reach a session
at all; bundling it with the tooling makes the **rules** contingent on wanting the **tools**.

**This does not reverse `374c907`** — checked, because it looked like it might. That commit's
layer-gating is **section-level *within* the rendered docs** (`house-doc` receives
`--layers="$ACTIVE"` and omits what a project cannot support). The gate this item targets is
`scaffold.sh:1254`, `if layer_active agent; then` — whether `house-doc` **runs at all**. The
generator itself has no `requireLayer`. They are complementary, and the dependence runs in our
favour: section-gating is exactly what makes baseline invocation *safe*.

---

## What the release owes

Interrogating each change for one-way deltas, per the house gate:

| Item | Migration owed |
| --- | --- |
| 2 | **Yes** — detect and report duplicate providers |
| 4 | **Yes** — convert `//x` keys to `metadata.description`, repairing corrupted ones |
| 3, 6 | **No** — owned template artifacts and behaviour changes that regenerate anyway. *Considered, not defaulted.* |
| 7 | **No** — changes when a generator runs, not a shape on disk |
| 1 | **No** — `scaffold.sh` behaviour, no payload shape |

Both migrations register at the bumped `assets/nx-tools/package.json` version, **in the same
commit**. Current floor: payload **0.25.1**, migrations max **0.25.0**, 9 registered.

**The release process changed under this effort.** `d324b3b` moved plugin releases to `nx release`
(per-plugin `project.json` + `nx.json`), so "bump `plugin.json` and `marketplace.json` together by
hand" is obsolete. The migration-ceiling invariant is now **machine-enforced** —
`tools/check-release-invariants/rules.cjs` via a `pre-push` hook and CI, reading both `generators`
and `schematics`, prerelease-aware, treating unorderable versions as errors. Registering a
migration above the ceiling now **fails the push** instead of failing silently.

## Open before implementation

1. **The devkit round-trip hypothesis** (item 4) — one fixture test settles it.
2. **`metadata.description` in the pinned Nx version** (item 4) — the fix rests on it.
3. **The `sync.md` decision procedure** (item 1) — specified as a contract, never drafted.
