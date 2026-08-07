---
effort: devcontainer-features
status: concluded
concluded: 2026-08-06
summary: Ships ONE local devcontainer feature that chains the parked house script, so adopted projects finally run house setup; the larger build-time-features design was built, adversarially reviewed, and reverted — its premise was wrong and its migration destroyed user comments.
tags: [devcontainer, nx-tools, adoption, provisioning, adversarial-review, reverted-design]
---

# DECISION — house capabilities as locally-consumed DevContainer features

**Slug:** `devcontainer-features` · **Opened:** 2026-08-06 · **Concluded:** 2026-08-06

> ⚠️ **SECTIONS 1–8 DESCRIBE A DESIGN THAT WAS BUILT, REVIEWED, AND REVERSED.** They are kept
> verbatim as the trail — the reasoning below is what a five-agent adversarial review demolished, and
> reading it is the point. **The design that shipped is in §9.** Do not take §1–§8 as current guidance;
> in particular §3.1's adoption argument is *wrong*, and §2's "what stays" table is answering a
> question that turned out not to be the deciding one.

## 0. This re-opens a thread the previous effort deliberately left open

`docs/features/2026-08-06-devcontainer-tmux/DECISION.md` closed the feature-vs-apt seam on the JDK
precedent, and then recorded, under *Accepted, not acted on*:

> §1's seam decision never examined the **adoption** case. Where the generator writes the house script
> as `post-create.bespunky.sh` and nobody chains it, tmux never installs — whereas a `features` entry
> would survive adoption by construction … that tradeoff should have been named here rather than the
> seam being called settled by precedent.

That is the thread this effort pulls. The earlier decision is **not overturned** — its reasoning was
about *third-party* features (SDKMAN, fetches from github.com). It even said so itself: *"every word of
that transfers" overstated the JDK comment*. Our own apt-based feature inherits none of that objection.

## 1. The user's constraints, in their words

> "implement our features for local consumption. **I don't want another deploy procedure.**"

So: features are referenced by **relative path** (`"./features/os-floor": {}`), the folders are written
into each project by the devcontainer generator, and they are versioned by the payload that carries
them. No ghcr, no OCI artifact, no publishing workflow, no second version surface. The entire delivery
mechanism is the one that already exists.

## 2. What moved, and the rule that decided it

The deciding question was **not** "is it an apt install" — it was *does a mount replace this path when
the container starts?* Features install during the **build**; several mounts attach at **start** and
cover what the build put there.

| Capability | Verdict | Why |
| --- | --- | --- |
| The always-on apt floor (X stack, tmux, fonts, `iproute2`, `procps`, `curl`) | **Feature** | Installs to ordinary system paths nothing replaces. |
| Voice (`espeak-ng`, `pulseaudio-utils` + the mount + `PULSE_SERVER`) | **Feature** | Same, plus it makes one capability one unit instead of two halves. |
| Claude plugin pre-install | **Stays** | Writes into `/home/node/.claude`, a bind mount from the host. A build-time install is discarded at start. |
| Playwright Chromium (~150 MB) | **Stays** | Writes into the `ms-playwright` volume. Same discard. |
| Port-registry chown, `.cache` chown | **Stays** | Their targets are volume mount points that don't exist until start. |
| Shared browser *as a capability* | **Stays** | `runArgs` (`--sysctl`, `--add-host`) has no feature equivalent, and its noVNC band is single-sourced from `novnc-band.ts` for `portsAttributes` — a feature would become a second place that knows the band. Its apt packages travel with the OS floor; the capability does not. |
| Firebase JDK | **Stays** | One apt line, `--firebase`-gated, no adoption exposure worth the churn. |

**Told to the user before implementing, and unchallenged:** *"move voice and the general system
packages, leave the Claude plugins and the browser download alone, and treat the shared browser as a
separate decision."*

## 3. What is actually gained (beyond order)

1. **A silent failure is fixed.** In an adopted devcontainer the house script is written as
   `post-create.bespunky.sh` and never chained, so tmux, the X stack and voice simply never install and
   nothing says so. `mergeIntoExisting(…, 'adopt')` **adds** a missing `features` sub-key, so a feature
   installs there by construction.
2. **Rebuilds stop re-running the apt transaction** — build layers are cached.
3. **An inference becomes a declaration.** `post-create.sh` could not see the `--voice` flag, so it
   detected voice by testing whether the mount the *other* file declared existed (`[ -d /mnt/wslg ]`).
   The feature now sets `BESPUNKY_VOICE=1` in `containerEnv` and the remaining voice step gates on that.

## 4. `install.sh` warns and exits 0 — it never fails the build

A feature's `install.sh` runs during the build and a non-zero exit **fails the whole container build**.
Every apt step in `post-create.sh` takes the opposite stance deliberately — retry three times, then warn
loudly and continue — because *"a half-provisioned container is worse than a missing optional step"*.

Moving the code must not silently invert that. So each `install.sh` keeps the 3-attempt backoff and then
**exits 0** with a loud warning naming the hand-recovery command, derived from the same package variable
it installs from (the file's own rule: a drifted re-run instruction is worse than none).

**The honest cost:** a build-phase apt failure is now *quieter* than before — it scrolls past in build
output rather than appearing in the post-create log the user is watching. Accepted, because the
alternative is a failed build for a transient DNS blip, which is strictly worse.

## 5. `PULSE_SERVER` moves from `remoteEnv` to `containerEnv`

Not a transcription — feature-declared environment is `containerEnv`, which is a **widening**: every
process in the container sees it, not only editor-spawned ones. That is correct for an audio sink (a
voice process launched from a plain `docker exec` shell now finds it too), and it matches how
`BESPUNKY_DEVCONTAINER_ID` is already handled.

## 6. The release gate: one migration is owed

Asked deliberately, per CLAUDE.md — *does this alter a shape projects already have on disk?*

`post-create.sh` and an **owned** `devcontainer.json` are class-(A) owned template artifacts, rewritten
every sync, so they need nothing. The **adopted** path is the exception and it is not symmetric:
`mergeIntoExisting(…, 'adopt')` only ever *adds* keys and *appends* array members — it never removes. So
a project that adopted its devcontainer while voice was enabled keeps the house-appended `/mnt/wslg`
mount and `PULSE_SERVER` remoteEnv entry forever, while the new feature declares both again. Two sources
of truth for one capability, and a duplicated bind target is a plausible hard failure at container
creation.

Hence a migration at `0.31.0` that removes those two entries — and, where the value is *not* the house
value, leaves it and reports it rather than guessing.

### Correction — the population is every existing project, not only adopted ones

The paragraph above is **wrong about who is affected**, and the error is worth keeping visible because it
is the kind that produces a migration that silently helps a minority. It assumed *owning* a devcontainer
still means rewriting it, so an owned file would drop the retired entries by itself.

It has not meant that since `1ffe9bd` (payload `0.26.0`, *"ownership re-asserts house keys, it no longer
rewrites the file"*). `tree.write(rendered)` now happens on exactly one path — **the file does not exist
yet**. Every other run, owned or adopted, goes through the same additive merge, which iterates the keys
the *house* renders and only ever appends to arrays. A key the template has **stopped** rendering is
therefore never visited, in either mode.

So ownership is not the axis; *"the file already exists"* is. The migration is deliberately blind to the
`owned` flag, and it is owed for essentially every project that ever enabled voice.

### The gate the migration added, which the brief did not ask for

It deletes only where the ownership marker records `flags.voice: true` — because that is the same fact
`scaffold.sh` reads when deciding to pass `--voice=true`, so it is exactly the condition under which the
replacement feature gets written later in the same sync. Where voice is off, no feature is written, no
collision can arise, and the entries in `devcontainer.json` may be the only thing giving that container
audio. Removing them there would be a guess that silently kills someone's microphone, so they are left
and reported with the command that resolves them.

Payload bumps `0.30.2` → **`0.31.0`** (a new capability, not a patch), which is also the ceiling the
migration's version must sit under.

## 7. A pre-existing bug this exposed

`mergeIntoExisting`'s `write()` skipped **any** empty container as noise — and a devcontainer feature's
value *is* `{}`. So in any project that already declared a `features` map of its own, **every** house
feature was silently dropped: not just the new ones, but `claude-code` and `github-cli` too, and without
even reaching the adoption report. The guard now applies at the top level only, where its original
rationale (`"forwardPorts": []` says less than an absent key) actually holds. Affected projects heal on
their next sync; no migration is owed, because the generator re-asserts it.

## 8. How this was verified

Not by inspection. The real templates were run through the real generator and the real migration against
Nx `FsTree`s in throwaway workspaces, asserting on what landed on disk:

- **Greenfield, voice on** — both feature folders written, `install.sh` at `0755`, both entries present,
  and *no* live `PULSE_SERVER` or `/mnt/wslg` left in `devcontainer.json`, with the feature carrying all
  three declarations instead.
- **Greenfield, voice off** — `os-floor` written, voice folder and entry absent.
- **Adoption** — a foreign `devcontainer.json` with its own `features` map and its own
  `postCreateCommand`: their feature and command survive, `./features/os-floor` *and* `claude-code` are
  merged in (the bug above), the feature folder is written anyway, and the house script parks at
  `post-create.bespunky.sh`.
- **Migration** — clears the house mount and `PULSE_SERVER` and sweeps the orphaned WSLg comment; leaves
  an unrelated mount; leaves everything untouched when the marker says voice is off; leaves a non-house
  `PULSE_SERVER` and reports it; and is idempotent on a second run.

Plus the repo's own gates: `check-script-modes`, `check-release-invariants`, `test-scaffold`.

**Not built, and worth its own effort:** this ran from a scratch harness, so it is *evidence*, not a
regression test. The repo has no generator-level test harness (`tools/test-scaffold` only covers
`scaffold.sh`'s refusals), and adding one is more than this effort's scope.

---

## §9. THE DESIGN THAT SHIPPED — one feature, and it does not install anything

Everything above was built, verified at the file level, and then put through a five-agent adversarial
review at the user's request: *"Send agents to review, highly critic and sanity check your work"* and
*"Have them challenge your assumptions, designs, implementation."* The review found fourteen confirmed
defects and, more importantly, refuted the premise. The user's call was one word: **"rework the branch."**

## 9.1 The premise was wrong — a feature CAN chain the house script

§3.1 argued that features are worth it because *"a `features` entry survives adoption by construction,
whereas the house post-create script is written beside the project's own and never chained."* The second
half is false. The spec:

> "Commands provided by Features are always executed *before* any user-provided lifecycle commands
> (i.e: in the `devcontainer.json`)."

A feature may declare `postCreateCommand`, and it is **additive** — it does not replace the project's.
So one feature that simply chains `.devcontainer/post-create.bespunky.sh` closes the adoption hole for
**every** house capability: workspace deps, the Claude plugin pre-install, the apt floor, Playwright, the
Firebase JDK.

What §1–§8 built closed it for **two of roughly eight**, and never said so. The "Stays" table in §2 lists
four capabilities and does not note that each remains exactly as silently broken under adoption as before
the effort. That is the failure: not a bug, a *justification that would have misled the next reader into
thinking the problem was solved.*

## 9.2 The second reason, which the user found by asking the right question

> "Without devcontainer features, does our `/sync` command allow upgrades without rebuilds?"

Partly, and the part that works is the part features would have destroyed. A sync rewrites
`post-create.sh` but never runs it (nothing in `scaffold.sh` does), so workspace files land immediately
while container provisioning waits. But **`post-create.sh` is re-runnable by hand** — that is already the
documented recovery (`serve`'s missing-dependency hint says `bash .devcontainer/post-create.sh`). So
`/sync` plus one command upgrades provisioning with no rebuild.

A feature's `install.sh` runs **only during the build, in a content-addressed cached layer**. It cannot be
re-run in place, and a rebuild is a cache hit that re-runs nothing. Moving the apt floor into a feature
therefore traded away upgrade-without-rebuild — a cost §3.2 recorded only as a benefit ("rebuilds stop
re-running the apt transaction").

## 9.3 What shipped

**One feature, `bespunky-house-setup`, which installs nothing.** Its entire content is a
`postCreateCommand` that runs `.devcontainer/post-create.bespunky.sh` when that file exists. Written
unconditionally, on the owned and adopted paths alike: in an owned project the beside-path does not exist
and the command no-ops; in an adopted one it is the thing that makes house setup run at all.

Everything else went back where it was. The OS floor and the voice engine are apt steps in
`post-create.sh` again; the voice mount and `PULSE_SERVER` are back in `devcontainer.json`.

**Plus one genuine bug fix that survived review** — see §7. It is kept because the chain feature depends
on it (a feature's value is `{}`), but it is implemented differently: the reverted attempt relaxed the
guard by *depth* (`path.length === 1`), which review showed also affects `conflict()` and silently
flattens a deliberate feature version pin to `{}` on an owned devcontainer. The policy is now **named**
rather than encoded as a depth.

**Deliberately not reintroduced: `retireFeature`.** It deleted a hand-written
`.devcontainer/features/<id>/` from repos this generator had never touched, and deleted the folder while
leaving a live reference whenever `devcontainer.json` failed to parse — logging *"(nothing referenced
it)"*. The new feature is unconditional, so there is nothing to retire and the folder and the reference
cannot disagree.

## 9.4 The migrations question, asked again for the new shape

**Nothing to migrate**, and this time the answer is small because the change is. The feature is a new
folder with no prior shape to retire; the merge-guard fix re-asserts itself on the next sync; nothing
moved, was renamed, or was dropped. The 0.31.0 migration written for the old design is deleted with it.

**Shipped version: `0.32.0`.** The effort bumped to `0.31.0` and then `0.31.1` mid-branch, before the
rework. While it ran, `development` moved on and released the `delegate-and-parallelize` effort at
*those same two numbers* — so at the merge gate this branch was rebased onto current `development` (the
single-divergence-point rule) and re-bumped to `0.32.0`. Nothing was published from this branch at any
of the intermediate versions; CI publishes only from `main`.

## 9.5 What the review cost, and what it was worth

Fourteen confirmed defects, of which three destroyed user data (the migration's editor silently ate the
*neighbouring* entry's comment; the comment sweep deleted any block containing "pulseaudio" anywhere in
the file, including one marked `DO NOT REMOVE`; `retireFeature` as above). Two more broke this very
branch: this repo's own marker says `voice: false`, so the next `/sync` would have deleted the voice
feature three commits after it was added.

**The verification in §8 did not catch any of them, and it is worth being precise about why.** It ran the
real generator and the real migration and asserted on real files — but every scenario it exercised was one
the author had already thought of. It never ran the retirement path, never fed the migration a comment it
did not expect, and could not have discovered that the spec permits `postCreateCommand` on a feature. A
harness confirms the cases you imagine; it cannot supply the ones you didn't.

## 9.6 Found in passing — NOT fixed here (unrelated)

`src/generators/shared-browser/shared-browser.tpl`'s `preflight_deps` failure message carries its own
hand-typed copy of the apt list, already drifted: it names `util-linux` (never installed) and omits
`procps`, `tmux` and both font packages. This is the same drift class that was fixed in the `serve`
executor at `dae4194`, in the sibling file one directory over. Pre-existing and unrelated to this effort,
so it belongs in its own worktree.
