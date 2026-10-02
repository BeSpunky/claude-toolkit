# Nx in a worktree — the workspace-root override

> Applies to every Nx workspace, which means every house project (Nx is the floor). The generic rule lives in the SKILL: tooling that caches one workspace root across trees must be pointed at the worktree explicitly.

**EVERY `nx` command run from a worktree MUST be prefixed**, or the Nx daemon — which caches **one** workspace root across trees — silently builds/tests/serves the **MAIN** tree's source instead of this worktree's (builds "pass", tests "pass", against unchanged code):

```bash
NX_DAEMON=false NX_WORKSPACE_ROOT_PATH="$(pwd)" <pm> nx <target> <project>
```

**The symptom that catches it:** a deliberately-failing canary test in the worktree never fails; the spec count doesn't change after you edit specs.

**The one exception:** the house `nx serve <app> --worktree=…` applies these overrides for you (see [`serving-a-worktree.md`](serving-a-worktree.md)) — but only for the tree it serves; any *other* `nx` command you run from the worktree still needs the prefix.

**Cleanup:** a worktree's first install can drop a stray package-manager store at the repo root — remove it; `.claude/worktrees/` itself is gitignored.
