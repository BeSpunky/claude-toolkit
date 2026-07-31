---
status: concluded
concluded: 2026-07-31
summary: scaffold.sh died at render time on four unescaped backticks in a comment, so no sync installed anything; fixed, and the render is now a test in every mode.
tags: [project-starter, scaffolder, sync, shell-quoting, ci-guard, regression]
---

# DECISION — fix the render, then make the render a test

## The decision

Two changes, and the second is the one that matters.

1. **Escape the four backticks** (`plugins/project-starter/skills/new-project/assets/scaffold.sh`).
   The defect. One-line-per-occurrence, no behaviour change.

2. **Make the render a test** — `tools/test-scaffold/render.test.sh`, seven arms, in CI via the existing
   glob in `run.sh`.

## Why the second change, and why it is not gold-plating

The backticks were not an unknown hazard. `scaffold.sh` spends a paragraph on this exact failure mode
immediately above the block that broke:

> `cmd` and `$(cmd)` are COMMAND SUBSTITUTION — evaluated NOW, at render time, even inside a `#` comment.
> Prose about a flag has bitten this file repeatedly for exactly this reason […]
> Verify with `scaffold.sh --print-inner …` […] ANY stderr during rendering means something in a string was
> evaluated that should not have been.

Every neighbouring comment in the same string escapes its backticks. The rule was written down, the
verification was named, the command existed — and it had to be **remembered and typed by a human**. So the
root cause is not four characters; it is that the file's most dangerous class of bug was guarded by
discipline alone. Fixing only the backticks leaves that exactly as it was, which is the patch this house
does not ship: *"For bugs, find and fix the root cause — never mask the symptom."*

The house rule the guard actually discharges is the plainer one: **automate every repeated process — never
do the same thing by hand twice.** A documented manual check run before every edit to a 1800-line generated-
shell file is precisely a repeated process.

## What the guard asserts, and what it deliberately does not

Per arm — sync, `--local`, `--ensure`, `--firebase`, scaffold, scaffold `--firebase`, scaffold `--local`:

| assertion | the failure it names |
| --- | --- |
| render exits 0 | the shipped bug — a failed substitution aborts under `set -e` |
| program non-empty | a "successful" render that produced nothing |
| `bash -n` parses it | quoting damage that does not abort but yields an unparseable program |
| no `scaffold.sh: line N:` on stderr | the same class when it is *not* fatal |
| payload version reaches the program | the reported symptom asserted directly — a sequence that installs nothing |

Seven arms because **each selects a different set of blocks**: `--local` swaps `INSTALL_NX_TOOLS` and the
migration collector for much larger strings, `--ensure`/`--firebase` gate whole blocks in and out, and
scaffold mode renders a different program. A single default-path render would have covered one of four
places this can break.

**Stated limit, in the file itself:** a backtick around a command that *exists and succeeds* (`date`, `pwd`)
is still silently substituted and this will not catch it. Every accident of this shape so far has been prose
words, which are not commands. Chasing the remainder would mean parsing which lines are inside which
quoted block — fragile, and guarding a case that has never occurred.

**Rejected: a static lint for unescaped backticks.** It would need to know which lines are inside the block
strings, which means hand-parsing nested double-quoted shell — the exact fragility that produced the bug.
Rendering asks bash itself, which is the only reader whose opinion counts.

**Rejected: adding this to the pre-push hook.** `tools/test-scaffold/README.md` records that the hook's
remit is release bookkeeping and that widening it is a separate decision. CI runs the suite at the same
integration points. Left alone on purpose.

## Roads not taken

- **A hotfix branch straight onto `main`.** `main` (0.27.0) carries the defect and consumers are on it, so
  it was tempting. The house pipeline is one-way: fix off `development`, promote forward. Nothing here
  justified inventing a second path — the fix reaches `main` through the ordinary two gates.
- **Bumping the payload.** `@bespunky/nx-tools` stays at 0.28.0. `scaffold.sh` is plugin content and is
  never installed into a project, so no project's on-disk shape changes: **nothing to migrate**, reached
  deliberately and recorded in the release commit.

## What this was NOT

Worth writing down, because the report pointed hard at it and three plausible causes were checked and
cleared before the real one turned up:

- **npm is fine.** Published `@bespunky/nx-tools` is `0.27.0`, which agrees with `main`. No release missing.
- **The pin is fine.** `yarn add -D -E @bespunky/nx-tools@<payload version>`, exact, no caret.
- **The probe/migrate ordering is fine.** probe → install → migrate with an explicit `--from`, as designed.

The install never got the chance to be wrong. That is the lesson worth keeping: *"after the sync, nx-tools
doesn't install the latest version"* was a completely accurate report that pointed at the install, and the
cause was a comment four hundred lines away that stopped the script before it began.

## Follow-up now possible (not done here)

`render.test.sh` makes the rendered program a first-class artifact of the suite. The open caveat in
`tools/test-scaffold/README.md` — that preflight running *before* the first write is guaranteed only by
reading the source — could now be asserted against that artifact instead. Out of scope for this fix.
