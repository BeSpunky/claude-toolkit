# Handoff — Landing 2 rebuild in progress
As-of: 2026-11-04T2204Z · feat/house-postgres-supabase, pushed, PR #1

## State
With the user's approval the MAIN CHECKOUT is on chore/hps2-gate (3d17aecf) for a rebuild, and must go back to development. CI green on 0e723b76; dogfood 156 passed. Baseline: gh 2.103.3 or newer, claude from ~/.local/bin.

## Next actions
1. Observe as the remote user: postgres, psql and dbmate at the pins; tools/postgres boots a real server on a free port (never 5432) with DEV_OWNER set, data under ~/.local/share, stop by handle; gh and claude logins survive; claude first on PATH; house.packages.sh a no-op.
2. git -C /workspaces/claude-toolkit switch development; delete chore/hps2-gate.
3. Offer the landing: PR #1 was opened for CI; landing is plan land on the user's signal. No status stamp until Landing 3. Say what stays unproven: real VS Code forwarding, a hosted database, a real GitHub deploy.
Also raised to the user: the Chromium fix, the Node 18 floor, the scaffold flake. Throwaway ~/projects/pgw is theirs to remove.
