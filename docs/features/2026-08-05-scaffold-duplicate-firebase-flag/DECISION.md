---
effort: scaffold-duplicate-firebase-flag
status: concluded
concluded: 2026-08-05
summary: Removed the redundant scaffold-time DEVCONTAINER_FLAGS author so the devcontainer generator's layer flags have exactly one source, and guarded the class in render.test.sh; `scaffold --firebase` no longer aborts every workspace generator.
tags: [scaffolder, devcontainer, firebase, voice, release]
---

# One authority for the devcontainer's layer flags

## The failure

`scaffold.sh --firebase <project>` created the workspace, the Angular app and the whole Firebase
layer, then died here:

```console
$ nx g @bespunky/nx-tools:devcontainer --name=zanshin --nodeMajor=24 --web=true --angular=true --firebase=true --firebase=true

 NX   Property 'firebase' does not match the schema.
     { "type": "boolean", ... }
```

`--firebase=true` twice. Nx coerces a repeated flag to an array, the array fails a `boolean` schema,
the generator exits 1, and under `set -e` the script's generator sequence stops — taking **everything
after the devcontainer** down with it: `claude-settings`, `window-identity`, `playwright`,
`shared-browser`, `worktree-domains`, `angular-ai`, `design-system`, `house-doc`, and the scaffold's
own closing `git add -A && git commit` and `$FINALIZE_LOCAL`. The result is a project with no
devcontainer, no `.claude/settings.json`, no design system and no `HOUSE.md`, left as a large
**uncommitted** tree, reported as `SYNC_FAILED`. Found while scaffolding `zanshin`.

## The root cause

The generator's layer flags had **two authors**:

| Author | Resolved | Scope |
| --- | --- | --- |
| `DC_LAYER_FLAGS` | at run time, inside the rendered sequence, from layer detection | both modes |
| `DEVCONTAINER_FLAGS` | host-side, before rendering, straight from `--firebase` / `--voice` | scaffold only |

`DEVCONTAINER_FLAGS` was correct when it was written: a scaffold started from an empty directory, so
there was nothing to detect and the CLI flags *were* the whole truth. It stayed correct for as long
as it was the **only** author. Today `--firebase` adds `firebase` to `ENSURE_LAYERS`, and
`DC_LAYER_FLAGS` gates on `ACTIVE` = detected ∪ **ensured** — so on a scaffold the layer block
already emits `--firebase=true` on its own, and the second author is pure duplication. Duplication of
a *fact* is what broke it.

**Which commit made it a duplicate, precisely** — the first answer here was "ensure-sets", review
found it wrong, and the difference is the whole lesson:

| commit | date | effect on the two authors |
| --- | --- | --- |
| `2e62f9c` | 2026-05-29 | introduces `DEVCONTAINER_FLAGS`, pre-layers. Sole author ✅ |
| `51e66ea` | 2026-07-21 | adds its `--voice` branch |
| `2ace14b` | 2026-07-27 | introduces layers, `ENSURE_LAYERS` **and `DC_LAYER_FLAGS` — but only `--web` / `--angular`.** `--firebase` still has exactly one author |
| `5607eb3` | 2026-07-29 | **adds the `layer_active firebase` branch to `DC_LAYER_FLAGS` without retiring the flag-driven one.** From here, both fire |

So it was not slow drift and it was not ensure-sets: `2ace14b` left `DEVCONTAINER_FLAGS`
load-bearing, and `5607eb3` created the second author two days later, in one commit. The
generalizable rule is therefore sharper than "avoid duplication" — **adding a detection-driven
author for a fact must retire the flag-driven one in the same commit.**

The same reasoning covers `--voice`: the rendered sequence's `_dc_voice` interpolates `VOICE`
directly (and carries a previous answer forward from the ownership marker), so the host-side copy
added nothing there either.

Worth noting that a **sync** was never affected — `DEVCONTAINER_FLAGS` is gated on
`MODE = scaffold`. Only a scaffold with `--firebase` or `--voice` could fail, which is why the bug
survived the self-sync work: nothing in that flow passes either flag.

## The decision

**Delete `DEVCONTAINER_FLAGS` rather than de-duplicate the flags at the call site.**

De-duplicating (filter the string, or let one author win) would keep two authorities for one fact
and leave the next flag free to reintroduce the same class of bug. The layer block is the right
authority — it is the one that describes *the project*, in both modes, which is the property the
scaffolder is built around. So the fix restores a single author and removes the other entirely.

Rejected alternatives:

- **Dedupe the rendered command string** — treats the symptom; two authorities remain.
- **Gate `DC_LAYER_FLAGS`'s firebase branch on `MODE != scaffold`** — inverts the fix, keeping the
  author that is only correct in one mode and disabling the one that is correct in both.
- **Make the generator's schema accept an array and take the last value** — hides caller bugs
  workspace-wide.

## …and the guard, because deleting the author only removed the instance

The decision above says de-duplicating "would leave the next flag free to reintroduce it" — and then
left exactly that freedom in place. The rendered program has **six** flag-concatenation sites, each
mixing render-time literals with run-time variables, and until now `nx g` was the only thing that
ever checked, in someone else's project. Worse, the existing render test **already rendered the
failing arm** (`render 'scaffold --firebase'`) and stayed green throughout, because it asserts only
that the program renders, parses and carries the payload version.

So the fix is not complete without `assert_one_author_per_flag` in `tools/test-scaffold/render.test.sh`.
It resolves the variables rather than reading the line: every `VAR=…--flag…` assignment in the
rendered program declares what that variable can emit, and a generator line that names the variable
**and** spells the same flag out has two authors. No flag names are listed in the test, so a flag
added tomorrow is covered the day it is added. Verified red against `development`'s `scaffold.sh` on
both `--firebase` and `--voice`, green here.

This is the same response the file earned once before: `66a4449` put backticks in a prose comment
inside a block string, and the answer was `render.test.sh` itself. A program assembled as a string
gets a machine check, not more care.

## Blast radius

`--voice` was broken identically and is fixed by the same change.

Any project scaffolded with `--firebase` (or `--voice`) between `5607eb3` and this fix is missing its
devcontainer, Claude settings, window identity, design system and `HOUSE.md`. **Recovery is not a
plain `--sync`** — the obvious assumption, and wrong three times over:

1. **The sync refuses first.** The failed scaffold never reached its own `git commit`, so the tree is
   dirty and the preflight raises `dirty-tree` (`scaffold.sh:856`) — a refusal, exit 1, `--yes` does
   not override it. Commit or stash first.
2. **A plain sync cannot restore the `agent` layer.** It detects on `HOUSE.md || HOUSE.rules.md`
   (`layers/registry.ts`), neither of which exists in the broken state, and a sync ensures nothing by
   default — so `layer_active agent` is false and the devcontainer, Claude settings and window
   identity are skipped again. `house-doc` is ungated and writes the two files, so a **second**
   consecutive sync would then work. One run needs **`--sync --ensure=agent`**, which is what was
   actually verified below.
3. **`design-system` is never healed by a sync** — `SYNC_ENSURABLE="nx,agent,firebase"` and the layer
   is undetected. It needs `nx g @bespunky/nx-tools:design-system` directly.

For a `--voice` casualty add `--voice` to the sync: voice has no detector and the ownership marker
was never written, so a sync without it restores the devcontainer *without* the WSLg bridge.

**Residual hazard, unrelated to this fix but now the only one left in this area.** `DC_LAYER_FLAGS`
passes an explicit `--firebase=false` whenever the layer is absent, which *actively strips* the
Firebase half of a devcontainer. That is deliberate — a sync must describe the project it is looking
at (`scaffold.sh:1391-1392`) — but it means the detector is load-bearing, and the detector is
`tree.exists('firebase.json')` at the workspace root only. This replaces the warning that lived in
the comment deleted here, which described an earlier incident of the same shape; the protection
against that incident was never the comment, it was detection-driven explicit flags, and that is
what the fix leaves standing.

## Verified

Against the real half-scaffolded `zanshin` project, not a fixture:

- `bash -n scaffold.sh` — clean.
- `scaffold.sh --sync --ensure=agent /home/shyagam/projects/zanshin` → **`SYNC_OK`**. Before the fix
  the same generator aborted with `Property 'firebase' does not match the schema`.
- The devcontainer the generator had been denied is now written, **with its Firebase half intact** —
  which is the specific thing the duplicate flag destroyed:
  - `ghcr.io/devcontainers-extra/features/firebase-cli` and `ghcr.io/jajera/features/gcloud-cli`
  - the `toba.vsfire` extension
  - `forwardPorts: [80, 4200, 4000, 9099, 8080, 9150, 9199, 5001]` with labelled `portsAttributes`
- `--firebase=true` appears **once** in the rendered generator invocation.
- The generators that used to be taken down with it all ran: `claude-settings`, `window-identity`,
  `house-doc`. `design-system` needs `nx g …:design-system` directly (a sync can only refresh an
  existing layer, never ensure that one) — unrelated to this bug, and noted so the next person
  scaffolding a fresh project does not go looking for it here.
- `nx build zanshin` succeeds on the healed project.

Not verified: the `--voice` path **end to end**. No WSL voice scaffold was run. It is now verified at
the render level — a `scaffold --voice` arm was added to `render.test.sh`, which is red on
`development` and green here — so what remains unconfirmed is only whether the WSLg bridge itself
comes up, not whether the flag reaches the generator exactly once.

Also run: `bash tools/test-scaffold/run.sh` — all 6 files pass.

## Release

`nx release version --projects=bespunky-project-starter --specifier=patch`, as its own
`chore(release)` commit. `scaffold.sh` is shipped plugin content, and a consumer's `--sync` runs the
copy under `CLAUDE_PLUGIN_ROOT`, not this repo — so without the bump the marketplace keeps
advertising the version whose scaffolder crashes on `--firebase`, and `/plugin marketplace update` is
a no-op. `tools/check-release-invariants/check.mjs` fails on this branch until it lands.

**Nothing to migrate**, deliberately, not by default: `assets/nx-tools/` is untouched (the payload
stays at `0.29.0`), so no `nx migrate` ladder is involved. And the damage this bug did to projects on
disk is *absent* class-A artifacts — a devcontainer, `.claude/settings.json`, `HOUSE.md` — which the
next sync regenerates. No shape changed, so there is nothing for a migration to carry.

## What review changed

The fix was reviewed by four independent agents before merge, two of which rendered the command
string from both revisions rather than reading the diff. **The mechanism held up in full** — every
claim about `ENSURE_LAYERS`, `ACTIVE`, `_dc_voice` and the absence of any silently-dropped flag was
confirmed mechanically, and the adversarial pass found no combination of flags or modes where the
deletion loses anything.

What did not hold up was the story told around it. Recorded here because the errors are more
instructive than the fix, and because a reader who only sees the final state cannot tell which parts
were hard:

- the **history** was misattributed to ensure-sets; `5607eb3` is the commit (see the table above).
  This was the sharpest catch: it turns "avoid duplication" into a rule about how to add an author.
- the **blast radius** understated what `set -e` took down, and missed that the scaffold never
  reaches its own `git commit` — which is what makes the tree dirty, which is what makes the sync
  refuse. One omission, three consequences.
- **"`--sync` heals it"** was wrong, and contradicted this document's own *Verified* section, which
  had recorded the `--ensure=agent` run all along. The verified command and the claimed command were
  not the same command, in the same document.
- the decision **refused to leave the bug class open and then left it open**. Hence the guard
  section above — the part of the fix this effort nearly shipped without.

Worth keeping as method: the two reviewers that mattered were the ones that *ran* something (rendered
both revisions, ran the checker on a throwaway clone). The reviewers that read the diff agreed with
it.
