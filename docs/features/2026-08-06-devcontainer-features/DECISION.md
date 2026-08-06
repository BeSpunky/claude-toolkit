# DECISION — house capabilities as locally-consumed DevContainer features

**Slug:** `devcontainer-features` · **Opened:** 2026-08-06

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
