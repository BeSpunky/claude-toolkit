---
status: concluded
concluded: 2026-08-06
summary: tmux ships in every BeSpunky devcontainer via one always-on apt step in the generator-owned post-create.sh, so shells opened into a container from outside can be durable; no tmux config is written, deliberately.
tags: [devcontainer, nx-tools, provisioning, tmux, zanshin, apt]
---

# DECISION — tmux in the BeSpunky devcontainer standard

**Slug:** `devcontainer-tmux` · **Opened:** 2026-08-06 · **Concluded:** 2026-08-06

## 1. The seam: `post-create.sh` (apt), not a devcontainer feature

The brief left this open — *"whichever of devcontainer.json (a feature) or the generator-owned
post-create.sh is the house-correct seam"*. The repo had already answered it, in
`devcontainer.json.tpl`'s own comment about the JDK:

> "the JDK required by the Firebase emulators … is installed via apt in `.devcontainer/post-create.sh`
> — **NOT** as a devcontainer feature. The canonical `ghcr.io/devcontainers/features/java` is
> SDKMAN-based and structurally fragile (its install fetches from github.com, which intermittently
> fails: TLS errors / 'Could not connect to server'). apt pulls from Debian's package mirrors which
> are far more reliable, and apt runs in the container's **runtime** network stack rather than the
> buildx build phase."

Every word of that transfers. A `tmux` feature (`ghcr.io/devcontainers-extra/features/tmux-apt-get`)
would be a third-party build-phase dependency for something one apt package provides directly.
`apt-cache policy tmux` in this exact image confirms candidate **`3.5a-3`** on Debian 13 (trixie).

**Rejected: `post-create.local.sh`** — the user's seam, explicitly out of bounds, and it is written once
and never regenerated, so a house capability placed there could never be updated.

## 2. Where in `post-create.sh`: step 6, renamed from "shared-browser prerequisites" to "the OS floor"

Three candidate homes, and the first two were refused by the house rules rather than by taste:

| Option | Verdict |
| --- | --- |
| Drop `tmux` into step 6's existing package list, unchanged | **No** — that is putting a concern where it *fits*, not where it belongs. |
| A new step 6b with its own 3-attempt retry loop | **No** — a third copy of a duplicated pattern; `architecture-first` refuses growing duplication. |
| Rename step 6 to what it already is, and add `tmux` as a named group | **Chosen.** |

The deciding observation: **step 6 was already installing `curl`, `procps` and `iproute2`** — general
utilities, not shared-browser dependencies. Its name was narrower than its own contents. So this is not
squeezing `tmux` into a step it doesn't belong to; it is correcting a misnomer, after which `tmux`
genuinely belongs. One apt transaction, one `OS_FLOOR_PACKAGES` array grouped by capability with a
comment per group.

**Why an array rather than a literal argument list:** bash allows comments between array elements but
not inside a continued command, so the grouping can be self-documenting — and the hand-recovery command
printed on failure is **derived** from the same array (`${OS_FLOOR_PACKAGES[*]}`) instead of retyped.
A re-run instruction that has drifted from what the step installs is worse than none.

**Considered and not done: extracting an `apt_best_effort()` helper.** The 3-attempt-with-backoff loop
appears four times in this file (Playwright, Angular skills, shared browser, voice). Factoring it out is
a real improvement, but it is a *refactor* — `architecture-first` requires designing and confirming one
before implementing, and it would touch steps this effort has no business in. The chosen option adds
**zero** new copies, so it does not make that debt worse. Worth its own effort later.

## 3. No tmux configuration is written — deliberately

The brief: *"No configuration file is needed — Zanshin passes every option explicitly"*, and

> "Zanshin sets its options on its own session (`-t <name>`), never `-g`. The tmux server is shared with
> whatever the human runs in that container, and unbinding their prefix server-wide would be a nasty
> side effect. **Nothing in the generator should set global options either.**"

So the generator writes no `/etc/tmux.conf` and no `~/.tmux.conf`. **Presence on `PATH` is the whole
contract.** This is recorded in the script's own comment so a future reader doesn't "helpfully" add one.

## 4. The `history-limit` question — stays a Zanshin constant

The user's offer:

> "Optional, your call: history-limit defaults to 10,000 lines. A build printing 40,000 lines loses its
> beginning before anyone scrolls back. If you'd rather that be a house parameter than a Zanshin
> constant, say so and Zanshin will read it."

**Declined.** Making it a house parameter means inventing a container-side config surface (a file, an env
var, a stamp) that the generator writes and Zanshin reads — new infrastructure whose only content is one
integer, and a second source of truth for a value Zanshin already passes explicitly on every
`new-session`. It also sits uncomfortably beside decision 3: the house deliberately sets *nothing*
server-wide, and `history-limit` is exactly a server-wide option.

The size of the buffer is a property of **the client's scrollback UX**, which is Zanshin's concern, not
the container's. If 10,000 is too small for a 40,000-line build, the fix is for Zanshin to raise its own
constant — no toolkit release required, which is precisely the argument against binding it here.

## 5. Release shape

- **Payload `@bespunky/nx-tools` `0.29.0` → `0.30.0`.** Minor, not patch: consumers get a capability their
  containers did not have.
- **Plugin `bespunky-project-starter` `0.29.1` → `0.30.0`**, via `nx release version` (never by hand);
  `marketplace.json` derived by its hook.
- **Migrations question — asked; answer is NOTHING TO MIGRATE, deliberately.** `post-create.sh` is a
  class (A) *owned template artifact*, rewritten in full by the devcontainer generator on every sync, so
  there is no shape on disk to carry forward. No target renamed, project relocated, config retired, path
  moved or option dropped. The one thing a project must still do is **rebuild the container** — apt runs
  at container *creation*, so a sync places the new script without executing it. That is the standing
  rule for every devcontainer change (already stated in the README) and is not something a migration can
  do from inside a workspace.
- `.devcontainer/post-create.sh` in this repo is the generated copy of the template and is kept
  byte-identical, so the dogfooded container gets the floor on its next rebuild.

## Verification

| Check | Result |
| --- | --- |
| `bash -n` on the template | passes |
| `bash tools/test-scaffold/run.sh` | all pass; payload version propagates (`0.30.0`) in all four modes |
| `node tools/check-release-invariants/check.mjs` | `ok: release invariants hold (10 plugins, payload 0.30.0)` |
| `publish.sh --dry-run` | `PUBLISH_DRYRUN_OK @bespunky/nx-tools@0.30.0`; tarball carries `src/generators/devcontainer/post-create.sh.tpl` |
| Acceptance: `tmux -V` as `node`, no sudo, in this image | **`tmux 3.5a`** at `/usr/bin/tmux` |

## Adversarial review (2026-08-06) — four defects found and fixed, one criticism accepted

Four independent reviewers were run against this branch after the release commit. Recorded here as an
**addition**, not a rewrite: the sections above stand as what was decided at the time, and this is what
survived contact with review. It is why the branch carries `0.30.1` — see the re-release commit.

**Fixed** (commit *"keep post-create.sh POSIX-parseable…"*):

1. **The bash array made the script non-POSIX**, and it was `dash`-clean before — reproduced both ways.
   The generator supports a human chaining this file from their own `postCreateCommand`
   (`post-create.bespunky.sh`), and `sh` parses **incrementally**: the run got as far as `yarn install`
   and then died at the array with a bare syntax error, skipping steps 6–8 and every WARNING they print.
   Replaced with three accumulating assignments — same per-capability comments, POSIX-parseable, zero cost.
   *The original design note "an ARRAY, not a literal argument list" above is superseded by this.*
2. **A second, hand-typed copy of the package list** in the serve executor's "shared browser dependencies
   are missing" warning (`src/executors/serve/executor.ts`) — already drifted: it named `util-linux`
   (never installed) and omitted `procps`, both font packages and `tmux`. §2's own rationale is that a
   drifted re-run instruction is worse than none; I derived the recovery command inside the script and
   never grepped for other copies of the thing I was deriving. It now names the owning step.
3. **`OS floor ready (tmux missing)` was reachable** — a success banner carrying its own refutation, and
   it verified 1 of 11 packages. Removed: `apt-get install -y` exiting 0 *is* the check.
4. **The failure branch under-claimed** — `procps` and `iproute2` go down in the same transaction, so the
   worktree-domains `:80` proxy and the port probes are unavailable too. It now says so.

**Accepted, not acted on (user's call — "skip the DevContainer feature for now"):** §1's seam decision
never examined the **adoption** case. Where the generator writes the house script as
`post-create.bespunky.sh` and nobody chains it, tmux never installs — whereas a `features` entry would
survive adoption by construction, because `mergeIntoExisting(…, 'adopt')` **adds** a missing `features`
sub-key. The counter is that the shared browser and voice have identical exposure, so tmux is consistent
with every other always-on capability — but that tradeoff should have been named here rather than the
seam being called settled by precedent. Also: *"every word of that transfers"* overstated the JDK
comment, whose force is specifically about SDKMAN and github.com; the tmux feature is apt-based.

**Rejected:** that the layer model was never consulted (a fair question, but "always-on vs a `--flag`"
was answered by the brief's requirement of *every* devcontainer); and that this package was written at
the end (`BRIEF.md` landed in the first commit, before implementation).

## Found in passing — NOT fixed here (unrelated)

`tools/publish-nx-tools/publish.sh` is committed as mode **`100644`** (its sibling `tools/test-scaffold/run.sh`
is `100755`). So the invocation `CLAUDE.md` documents — `tools/publish-nx-tools/publish.sh --dry-run` —
fails with *Permission denied* in any fresh checkout; it only works via `bash …`. Pre-existing and
unrelated to this effort, so it belongs in its own worktree.
