# Handoff — Landing 1 landed
As-of: 2026-11-04T1237Z · the user pressed "Land & promote"; development and main carry it.

## State
- Landing 1 is merged: nx-tools 0.52.1, bespunky-house 0.50.0, bespunky-workflow 0.15.2. The branch and its worktree are torn down.
- This package stays live; no status stamp until Landing 3.

## Next actions
Landing 2, `postgres`, per PLAN.md, on a new worktree off development: `feat/house-postgres-supabase` again, this same package. It needs a user rebuild, which also owes the closure root install, plus the items PLAN.md lists from the Landing 1 review. Then Landing 3, `supabase`, which needs a rebuild and a real hosted project.

## Verification state
- Not proven: the closure root install; the blocked line on real GitHub Actions.
- To confirm after the push to main: the publish workflow put 0.52.1 on npm.
