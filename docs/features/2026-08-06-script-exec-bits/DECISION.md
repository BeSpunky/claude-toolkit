---
status: concluded
concluded: 2026-08-06
summary: publish.sh was committed non-executable so its only documented invocation failed; fixed as a class across six files and machine-checked so the sweep never has to be re-run by hand.
tags: [tooling, file-modes, ci, release-invariants, guardrails]
---

# DECISION — the exec bit on scripts that declare a shebang

**Slug:** `script-exec-bits` · **Branch:** `fix/script-exec-bits` · **Opened:** 2026-08-06 · **Concluded:** 2026-08-06

Found in passing during `2026-08-06-devcontainer-tmux`; the user's follow-up was **"Fix that publish error"**,
so it was taken as its own effort rather than piled onto that branch.

## The bug

`tools/publish-nx-tools/publish.sh` was committed as mode `100644`. The invocation documented in
**`CLAUDE.md`** (three places), **`tools/publish-nx-tools/README.md`** (twice) and
**`docs/reusable-tool-extraction.md`** is bare:

```
tools/publish-nx-tools/publish.sh --dry-run
```

In any fresh checkout that dies with `Permission denied`.

## Why it survived — and what that revealed

**Every caller inside the repo routes through an interpreter explicitly:**

| Caller | How it invokes |
| --- | --- |
| `.github/workflows/publish-nx-tools.yml` | `bash tools/publish-nx-tools/publish.sh` |
| `tools/test-scaffold/run.sh` | `bash "$t"` |
| `tools/git-hooks/pre-push` | `node "$workdir/tools/check-release-invariants/check.mjs"` |

So CI stayed green — running *the very script that was broken* — while the only path a human was told to
take did not work. The publish workflow's own header says it runs "the SAME script a human runs locally";
in fact CI and the documented human path had diverged.

## The two candidate fixes

**A. Fix the file** — set the exec bit; the docs were already right.
**B. Fix the docs** — rewrite them to `bash tools/…/publish.sh`, matching what every caller already does.

**A was chosen**, because the evidence says the mode was an accident rather than a convention:

- **The reverse invariant already holds perfectly.** Every `100755` file tracked in this repo has a shebang —
  checked, zero exceptions. The repo's habit is already *shebang ⟺ executable*; these files were the slip.
- **Sibling asymmetry.** Five of the six `tools/test-scaffold/*.test.sh` are `755`; `render.test.sh` alone was
  `644`. `plugins/voice/hooks/extract-spoken.mjs` is `755`; its sibling `extract-turn-question.mjs` was `644`.
  Nobody decides that on purpose.
- B would also have made the documentation uglier to fix a problem that only exists in the file.

The `bash …` call sites were left alone: they are correct either way and immune to the mode entirely.

## Scope — fixed as a class, not as one file

The failure class is *"a file declaring a shebang that cannot be executed"*, so all six exceptions moved to
`100755`, not just the reported one:

- `tools/publish-nx-tools/publish.sh` — the reported break
- `tools/test-scaffold/render.test.sh`
- `tools/validate-shared-browser/two-container-check.sh`
- `plugins/project-starter/skills/new-project/assets/scaffold.sh`
- `plugins/voice/hooks/extract-turn-question.mjs`
- `plugins/voice/mcp/ask-server.mjs`

**Deliberately left at `644`: `.devcontainer/post-create.sh` and `.devcontainer/post-create.local.sh`.**
Both are invoked as `bash <path>` by `devcontainer.json`, so their mode is inert; and making this repo's
copies executable would make the dogfooded container the one project where they differ from what the
generator produces everywhere else — an invisible and untrue difference. Reported here rather than silently
skipped.

> **CORRECTED after review.** This paragraph originally justified the exclusion with *"written by the
> `devcontainer` generator through the Nx `Tree`, which has **no mode control**"*. **That is false.** The
> `Tree` has two: `TreeWriteOptions.mode` (`nx/dist/src/generators/tree.d.ts:11`, applied on flush at
> `tree.js:285-291`) and `changePermissions` (`:66`) — and **this repo already uses it**, at
> `shared-browser/generator.ts:51,62` and `worktree-domains/generator.ts:43`, with comments saying exactly
> why. The exclusion still stands on the two reasons above, but the reason originally given was wrong, and
> wrong in the way that does most damage: it told the next reader the fix was impossible. The correction is
> recorded rather than quietly swapped, because the false claim is the interesting part.
>
> Two payload findings follow from it, **left for their own effort** (this one is about repo scripts, not
> generator behaviour): the devcontainer generator *could* pass `{ mode: 0o755 }` at
> `devcontainer/generator.ts:210`; and `formatFiles()` re-writes changed files with a bare `tree.write`,
> which **discards** the `{ mode: 0o755 }` that `shared-browser/generator.ts:62` sets for `port-claim.mjs`
> — so that generator states a guarantee it does not deliver. Harmless today (every generated script is
> invoked through an interpreter), but it is a stated intent silently dropped.

## A machine check — first rejected, then built

**The original reasoning, and why it was wrong.** This section first rejected a checker, on the repo's own
criterion that machine checks exist for failures that are **silent**: *"`Permission denied` is loud and
names the file. Automating after **one** occurrence would also be automating a process that has not yet
repeated."*

Both halves fail, and the section above this one refutes them:

- **It was not loud, it was never fired.** The "Why it survived" section establishes that every in-repo
  caller uses an interpreter and that CI ran *the very script that was broken*, green, via `bash`. A failure
  that only fires for a human following the documentation is silent in every sense that matters.
- **It was not one occurrence, it was six** — the section immediately above is titled *"fixed as a class"*
  and lists six files. HOUSE.rules: *"automate every repeated process (never do the same thing by hand
  twice)."*

**And the decisive argument arrived from the review itself: the hand-run sweep was wrong.** The verification
row below claimed two remaining exceptions; there are thirteen, because the sweep silently excluded `.tpl`
files. The subtle part was never the failure — it was the **sweep**. A sweep re-run by hand is a sweep that
will be wrong again, and it will be wrong in the direction of reporting clean.

**So `tools/check-script-modes/check.mjs` now exists.** It asserts the forward direction only —
*shebang ⇒ executable* — since the reverse would have to be argued with the first time someone commits a
binary, and a guard that gets argued with is a guard that gets disabled. Its exemptions are **predicates
carrying their reasons**, printed on **every** run, passing or failing: the eleven `.tpl` templates and the
two generator-written devcontainer scripts are now visible on every invocation instead of hiding behind a
sweep that claimed two. It refuses to report success when it cannot see (empty enumeration, unreadable
file), the same stance its sibling takes on a shallow clone.

Wired into the two hosts that already existed: the `release invariants` workflow (whose header is really
about the failure *mode* — silent — not about releases, and which already hosts a non-release check) and
`tools/git-hooks/pre-push`, in the same temporary worktree the release checker already uses.

## The plugin-boundary trap, caught by the machine

Two of the six files ship inside plugins, so `check-release-invariants` refused the push until
`bespunky-project-starter` (0.29.1 → **0.29.2**) and `bespunky-voice` (0.2.1 → **0.2.2**) were bumped —
**a mode-only change still counts as shipped content that moved.** This is exactly the hazard CLAUDE.md
names from two past incidents: *a sweep that crosses plugin boundaries while the commit is named after
something else.* Worth recording that the checker earned its keep on a change nobody would have thought of
as a plugin change at all.

**Name the trade honestly (added after review): five of the six changes are inert, and two of the inert five
cost a consumer-visible release each.** Only `publish.sh` had a load-bearing exec bit; every other file is
invoked as `bash …` or `node …` at every call site (`run.sh:25`, `speak-turn.sh:21`, `.mcp.json:5`,
`SKILL.md` ×5, `docs/shared-browser-DESIGN.md:35`). So `bespunky-project-starter` 0.29.2 and
`bespunky-voice` 0.2.2 ship **no behavioural change** to anyone. The bumps are still mandatory under the
house rule and `patch` is the right specifier — but the class fix was for **consistency**, not for six
broken things, and the two releases are its price. That price is what makes the checker above the right
call rather than a nice-to-have: it is the thing that stops the sweep, and the releases it costs, from ever
being needed again.

## Verification

| Check | Result |
| --- | --- |
| `tools/publish-nx-tools/publish.sh --dry-run` — the exact documented command, run bare | `PUBLISH_DRYRUN_OK @bespunky/nx-tools@0.29.0`, exit 0 |
| `bash tools/test-scaffold/run.sh` | all pass |
| `node tools/check-release-invariants/check.mjs` | `ok: release invariants hold (10 plugins, payload 0.29.0)` |
| `node tools/check-script-modes/check.mjs` | `ok` — 367 tracked files, 47 with a shebang, **13 exempt** (11 `.tpl` + 2 generator-written), 0 violating; negative-tested against a throwaway repo, exits 1 |

> **CORRECTED after review.** This row originally read *"shebang-but-`644` sweep, repo-wide | only the two
> generator-written devcontainer files remain, as intended"*. **It was false.** Thirteen remain, not two —
> the hand-run sweep piped through `grep -v '\.tpl'` and so never looked at eleven generator templates.
> They are correctly non-executable, so nothing was broken by it; what was broken is that the row asserted a
> completed sweep to a reader who would use it to skip checking. This is the row that argued the checker
> above into existence.

*(Payload reads `0.29.0` here because this branch is off `development`; the `0.30.0` bump lives on the
unmerged `feat/devcontainer-tmux`.)*

## Merge-order note

`feat/devcontainer-tmux` bumps `bespunky-project-starter` to **0.30.1**; this branch bumps it to **0.29.2**.
Both touch `plugin.json` and the derived `marketplace.json`.

**MERGE THIS BRANCH FIRST. It is not a preference — the other order leaves `development` failing its own
invariants.** Two reviewers reproduced both orders independently in scratch clones:

- **This branch first** → merges clean; the tmux branch then rebases, its `plugin.json` /
  `marketplace.json` conflict resolves to its own `0.30.1`, and the checker is green before and after. All
  of that branch's content precedes its release commit, so nothing is left unreleased.
- **The tmux branch first** → this branch rebases on top, and its **`scaffold.sh` mode change now lands
  *after* the `0.30.1` release commit** with no bump behind it. `check-release-invariants` fails
  (`changed: …/assets/scaffold.sh`), and the repair is a further `0.30.2` — not "keep the higher number".

Resolve the `marketplace.json` conflict **line by line, never file-wise**: this branch also carries
`bespunky-voice` `0.2.2`, and a wholesale `--ours`/`--theirs` (or `git merge -X`, which resolves without
prompting) silently reverts the registry to `0.2.1` while the manifest says `0.2.2`. The checker catches
that one, but `git rebase --skip` — which git itself offers as a hint — drops the voice bump too.

> **CORRECTED after review.** This section originally claimed the higher version *"stays correct in either
> order"* and called merging this branch first merely *"the simpler sequence"*. That was wrong on both
> counts, and wrong in the direction that would have put `development` in a state the pre-push hook refuses.
