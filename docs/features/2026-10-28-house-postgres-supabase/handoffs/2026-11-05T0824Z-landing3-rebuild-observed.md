# Handoff — Landing 3, rebuild observed
As-of: 2026-11-05T0824Z · feat/house-postgres-supabase, PR #2. Push with the gh login: `git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push`.

## Observed in the container rebuilt from chore/hps3-gate
- supabase 3.0.0 at /usr/local/bin; no postgres server and no dbmate on PATH; psql is Debian's 17.11 client. Installer "all present". SUPABASE_HOME on the real ~/.local volume, 1.9 GB.
- A real start as an agent: offset 39000, ports 44432 and up, never a base port; auth.users reachable; no ledger, as this repo has no migrations; dev stop by handle: ports free, launcher exit 0, nothing left.
- gh logged in; claude only at ~/.local/bin; credentials intact.
Main checkout back on development; chore/hps3-gate deleted. This container keeps the CLI until its next rebuild, which the hosted check uses. ~/.local/share/supabase stays until then.

## Next actions
1. The hosted check, with the user: login, link, a real push, a function deploy, a secret reaching a function, migration repair, session pooler from an IPv4 runner. deploy and secrets-set refuse under an agent by design, so the user runs them.
2. Land on the user's signal; stamp DECISION.md concluded.
3. Then a rebuild from development and removing ~/.local/share/supabase, offered to the user.
