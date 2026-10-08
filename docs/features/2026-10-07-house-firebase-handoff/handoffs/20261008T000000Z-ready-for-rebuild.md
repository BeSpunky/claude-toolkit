# Baton — ready for the container rebuild (2026-10-08)

**State:** every finding from both inbound handoffs, two review rounds and four dogfood runs is fixed and merged on `feat/house-firebase-handoff`. All suites green. Final gate PASS (impl/FINAL-GATE.md); polish done (impl/POLISH.md). Nothing released, nothing pushed.

**Outstanding, in order:**
1. **Container rebuild from this branch** (human — no Docker here). Then observe: `node -v` = 22 and `.nvmrc` = 22; `which gcloud firebase` empty in this repo (no firebase layer); tmux/espeak-ng/sox work; post-create log "all present"; gh + claude still logged in.
2. **Land** on `development` (human signal) — finalize DECISION.md status, bin or keep nothing (no mocks).
3. **Release** (human signal): bespunky-house minor (0.48.0), bespunky-workflow minor (0.12.0); nx-tools 0.50.0 as the LAST commit (the branch set 0.50.0 early — reset to 0.49.2 then a dedicated `chore(release)` bump, so release-invariants sees nothing after it); regenerate this repo's own upgrade output from the published payload (the review-only branch `chore/hfh-final-gate-selfupgrade-REVIEW-ONLY` shows what it will be).
4. Reply to the two reporting projects with the fixing version per item.

**Urgent context:** firebase 13.0.0 (published 2026-10-07, needs Node ≥24.12) breaks every NEW Firebase project made with released 0.49.2 (`"latest"`). This branch fixes it.

**Worktrees to remove at landing:** hfh-w1..w9, hfh-fx1..fx5, hfh-fa..fh, hfh-g1..g4, hfh-s1, hfh-df1, hfh-df1b, hfh-final (+ their branches).

## Rebuild procedure (2026-10-08)
The feature branch does NOT change this repo's container; the regenerated `.devcontainer/house.packages.sh` lives on `chore/hfh-rebuild-check` (cut from development + that one file; package pins left on the published payload so post-create's install is not confounded). The review-only self-upgrade branch must NOT be used for the rebuild — it pins unpublished 0.50.0.

User: in the main folder `git checkout chore/hfh-rebuild-check` → VS Code *Rebuild Container*. Next session (Claude) verifies: `node -v` (22) vs `.nvmrc`; `which -a gcloud firebase` empty; `tmux -V`, `espeak-ng --version`, `sox --version`; post-create log "all present"; `gh auth status`; Claude logged in; `.devcontainer` package layer reinstalled once. Then `git checkout development` (no rebuild needed back — the script only reinstalls what is present).
Not covered by this rebuild: the firebase layer's container changes (gcloud from Google's archive, firebase-cli feature removal) — needs a Firebase project's container (option offered to the user).
