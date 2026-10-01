---
status: concluded
concluded: 2026-10-01
summary: The project-standing hook's snooze moved from .claude/.standing-snooze (never actually ignored) into the git dir, so it can never show up as an untracked file; the old copy is removed on the hook's next run.
tags: [workflow, project-standing, hooks]
---

# Standing-snooze location

**Found:** `.claude/.standing-snooze` appeared as an untracked file on `development`. The 2026-07-24 project-continuity decision describes it as "a per-machine, gitignored snooze", but no `.gitignore` ever covered it, here or in consumer projects.

**Chosen:** write it inside the git dir (`git rev-parse --git-path bespunky-standing-snooze`). Git never tracks it, it stays local to each clone (the original intent), and no project needs an ignore line.

**Rejected:** adding a `.gitignore` line. It would have to reach every consumer project through the house generators plus a migration, all for one hook-owned file.

**Cleanup:** the hook deletes the legacy `.claude/.standing-snooze` on its next run. That name was only ever written by this hook.

## Revision — the cleanup ran too late (0.7.3)

The first version deleted the legacy file inside the snooze section, which comes after the "is this project active?" early exits. An active project — exactly the state right after merging — exits before reaching it, so the old file survived until the next dormant stretch. The deletion now runs right after the git-repo check, on every session start.
