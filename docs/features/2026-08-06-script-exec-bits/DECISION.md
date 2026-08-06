# DECISION — the exec bit on scripts that declare a shebang

**Slug:** `script-exec-bits` · **Branch:** `fix/script-exec-bits` · **Opened:** 2026-08-06 · *(status stamped at the merge gate)*

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
Both are written by the `devcontainer` generator through the Nx `Tree`, which has **no mode control**, and
both are invoked as `bash <path>` by `devcontainer.json`. Making this repo's copies executable would make the
dogfooded container the one project where they differ from what the generator produces everywhere else — an
invisible and untrue difference. Reported here rather than silently skipped.

## Considered and rejected: a machine check for this invariant

Tempting, since the rule is trivially checkable and the repo has the habit
(`check-release-invariants`, `test-scaffold`). Rejected on the repo's **own** stated criterion: those exist
for failures that are **silent**. A missed plugin bump advertises the old version forever with nothing to
see; `Permission denied` is loud and names the file. Automating after **one** occurrence would also be
automating a process that has not yet repeated. If it recurs, it has earned a guard.

## The plugin-boundary trap, caught by the machine

Two of the six files ship inside plugins, so `check-release-invariants` refused the push until
`bespunky-project-starter` (0.29.1 → **0.29.2**) and `bespunky-voice` (0.2.1 → **0.2.2**) were bumped —
**a mode-only change still counts as shipped content that moved.** This is exactly the hazard CLAUDE.md
names from two past incidents: *a sweep that crosses plugin boundaries while the commit is named after
something else.* Worth recording that the checker earned its keep on a change nobody would have thought of
as a plugin change at all.

## Verification

| Check | Result |
| --- | --- |
| `tools/publish-nx-tools/publish.sh --dry-run` — the exact documented command, run bare | `PUBLISH_DRYRUN_OK @bespunky/nx-tools@0.29.0`, exit 0 |
| `bash tools/test-scaffold/run.sh` | all pass |
| `node tools/check-release-invariants/check.mjs` | `ok: release invariants hold (10 plugins, payload 0.29.0)` |
| shebang-but-`644` sweep, repo-wide | only the two generator-written devcontainer files remain, as intended |

*(Payload reads `0.29.0` here because this branch is off `development`; the `0.30.0` bump lives on the
unmerged `feat/devcontainer-tmux`.)*

## Merge-order note

`feat/devcontainer-tmux` bumps `bespunky-project-starter` to **0.30.0**; this branch bumps it to **0.29.2**.
Both touch `plugin.json` and the derived `marketplace.json`. Whichever lands second rebases onto
`development` and resolves to the **higher** version — `0.30.0` — which stays correct in either order. Merging
this branch first is the simpler sequence, since the tmux branch's rebase then just keeps its own value.
