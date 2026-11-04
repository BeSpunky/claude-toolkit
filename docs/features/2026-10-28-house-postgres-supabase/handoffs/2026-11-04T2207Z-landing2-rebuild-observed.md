# Handoff — Landing 2, rebuild observed
As-of: 2026-11-04T2207Z · feat/house-postgres-supabase, PR #1

## Observed in the container rebuilt from chore/hps2-gate
- postgres and psql 18.6 (pgdg13), dbmate 2.37.0, all at /usr/local/bin, under /opt/bespunky, as the remote user. Installer: "all present", rc 0.
- A real start as an agent took offset 8000, port 13432, never 5432. pgvector 0.8.7 loaded. Data on the real ~/.local volume, 43 MB. dev stop by handle: ports free, launcher exit 0, nothing left. The test data was removed.
- gh 2.103.3 logged in; claude 2.1.318 only at ~/.local/bin, credentials intact.
Main checkout back on development; chore/hps2-gate deleted.

## Not proven
Data surviving a second rebuild (the volume is proven by logins, not by a cluster); real VS Code forwarding; a hosted database; a real GitHub deploy; two real containers.

## Next actions
Land on the user's signal. Then Landing 3, `supabase`, per PLAN.md.
