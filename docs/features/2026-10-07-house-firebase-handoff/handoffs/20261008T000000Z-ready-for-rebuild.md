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

## Rebuild result (2026-10-08, container started 04:54Z from chore/hfh-rebuild-check) — PASS
- Node v22.23.2 (matches the 22 the self-upgrade writes to `.nvmrc`).
- `which -a gcloud firebase` empty — the gcloud W1 had hand-installed is gone, as expected for a layer without firebase.
- tmux 3.5a, espeak-ng 1.52.0, sox 14.4.2 installed in the image; re-running `house.packages.sh` → "all present — nothing to install" (exit 0).
- Claude Code 2.1.293 logged in; session state survived (`.claude` host bind).
- `gh`: **"Failed to log in to github.com account BeSpunky"** — NOT caused by the rebuild: the same 401 "Bad credentials" was already seen before it (verifier V4's `gh api` call). The token in the persisted `~/.config/gh/hosts.yml` is expired/revoked → user re-runs `gh auth login`.
- Main folder switched back to `development`.

## Firebase container check (2026-10-08) — PASS, 15/15
A real Firebase+Angular project created with this branch (`.claude/worktrees/fb-container-check`, vendored 0.50.0 tarball), opened by the user in its own dev container. Result copied to `impl/FIREBASE-CONTAINER-CHECK.md`: Node 24 = .nvmrc; `firebase` only from node_modules/.bin at the pinned 15.32.1; gcloud 588.0.0 from Google's archive, no apt source, config in persisted ~/.config; Java 21; packages all present; no firebase-cli/gcloud feature; logins on persisted volumes; full dev loop — isolated offset, app answers, `dev ps`, emulators under `demo-`, Firestore write, `dev stop` exports the doc, no process left.
A first run reported 3 FAILs only because it ran before post-create finished installing — not a defect; the fixture's script now says so instead.
Also fixed during this step: `new` inside another git repo committed into the OUTER repo (59fc9f25 + branch-name follow-up).

**Remaining:** user re-runs `gh auth login` (token expired, pre-existing); then land + release on the user's signal.
