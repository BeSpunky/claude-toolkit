# Sanity review: standing-sees-branches (mode: fix)

Scope: `git diff development...HEAD` on `fix/standing-sees-branches`.

Intent: an in-flight effort is found wherever it lives (unlanded branch, orphaned checkout, root-level handoff); git stays read-only; orphans reported, never repaired.

Lenses: correctness and scalability (by experiment), security and architecture, completeness/tests/skill design; then correctness over the fix diff. Budget 4: lenses merged accordingly. Verification: reviewers reproduced findings in scratch repos, and 14 regression cases were run against the pre-review engine: all 14 failed there. The old-git finding rests on git's source and release notes, simulated with a PATH shim.

## Fixed

- `git log --stdin` with `--not` dies below git 2.42, silently dropping all branch efforts: now `^rev`.
- Shallow boundary commits counted as touching every package: skipped via `shallow`.
- `new RegExp` from the project subdir crashed the engine: string ops.
- `commitTimes` ran in repos with no packages (7-9s, hook timeout 10s): lazy.
- Undeclared unknown default line reported as an effort: `origin/HEAD` is a line; no base reports no branch.
- `held` counted unscanned worktrees (locked and missing, path failing charset): scanned only.
- `hasWorktree` pinned unreachable registrations live: scanned only; `checkedOutElsewhere` plus `--force` prompt.
- False orphans (submodule, another repo's worktree): link shape and owner checked.
- Unborn HEAD's null oid killed the log: filtered.
- Quoted non-ASCII paths missed: `core.quotePath=off`.
- A package deleted on the newest branch vanished: every toucher tried; local first; remotes newest first.
- Remote copy outranked local by author-set date: remote only fills a gap.
- Huge blob erased all branch efforts, huge summary hung: `MAX_TEXT`, batches, text cap before regexes.
- Polynomial glob regex from repo text: one-pass matcher.
- Orphan branch unvalidated; leading `-` and long branch names: `isBranchName`.
- `.gitkeep` as baton hid root handoff and Resume: no leading dot.
- `git show branch:docs/...` failed from a subdir: `:./`.
- Package-level symlinks followed; `docs/features` symlink walked: lstat.
- Malformed tree looped forever: bound. Corrupt tree hid other branches: on failure each branch is walked alone.
- Symlinked project dir missed branch packages; other worktree's dirty files in a subdir project: real paths, project-scoped status.
- `--path-format` garbled `commonDir` below 2.31: resolved by hand.
- Remote Resume prompt, notice wording, resume baton fallback, compare recipe.

## Needs decision

- Always-on no-blanket-prune line in `HOUSE.rules.md.tpl`: the incident's pruners were subagents, which never fire branch-and-release. Takes a payload release.
- Remote efforts in the pane's "N in flight" headline and hotkeys, or a separate group.
- Concluded on an unlanded branch is invisible in the pane; JSON has only `branch`. Add a loose-ends line, optionally an `unlanded` fact.

## Rejected

- No-baton fallback to DECISION.md may not exist: the model sees git's error and looks; harmless.
- `UNDECLARED_LINES` as a third copy: only used when the engine did not answer; the alternative is no fallback.
- Newline in project subdir misaligning `--batch`: not a real path.

## Not covered

Real run on git below 2.42; git below 2.29 (multiple `--no-merged`) gets no branch efforts, silently. A second review of the fixes to the fix diff, by rule. Skipped lenses: visual, types beyond `index.d.ts`.
