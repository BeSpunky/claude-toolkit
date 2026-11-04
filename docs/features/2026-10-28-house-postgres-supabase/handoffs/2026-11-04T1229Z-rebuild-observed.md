# Handoff — rebuild observed
As-of: 2026-11-04T1229Z · branch feat/house-postgres-supabase

## Observed in the container rebuilt from chore/hps-gate (dd92b824)
- gh 2.103.3 (was 2.102.0), /usr/bin/gh and /bin/gh; the feature's tag is pinned and it installed the newest gh, the stated exception. Login survived.
- claude 2.1.318, only ~/.local/bin/claude, ahead of system paths; credentials survived.
- house.packages.sh: "all present — nothing to install", rc 0; alsa-utils and sox installed. house.package-manager.sh: yarn 1.22.22, nothing to install, rc 0.
- Marketplace claude-toolkit is the working folder. core.hooksPath is tools/git-hooks.
- NOT proven: the .deb closure root install; no layer wears one until Landing 2.

## State
Main checkout is back on development; chore/hps-gate is deleted. backup/hps-before-rebase stays until the landing.

## Next actions
F3 at the landing gate, then bumps, DECISION.md stamp, plan land, signal.
