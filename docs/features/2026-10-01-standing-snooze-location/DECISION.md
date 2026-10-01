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
