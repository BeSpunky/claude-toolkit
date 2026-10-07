# Inbound handoff (verbatim) — from shir-halili-coaching, 2026-10-07

> Pasted by the user into the toolkit session on 2026-10-07, with: "I'm going to give you a handoff doc that another agent from another project is giving you … don't do anything." Then: "You need to analyze the handoff and see what makes sense, what doesn't, come up with your other ideas that are based on what that project has experienced, and you can plan."

The consumer repo (`BeSpunky/shir-halili-coaching`) is NOT available in this environment; its evidence is quoted, not verified.

## Items (summary of the handoff, ordered by its severity)

- A1 `latest` ranges for firebase + @angular/fire → two @firebase/app copies → app/no-app crash. Fixed there by pinning ^20.0.1 / ^11.10.0. Ask: derive firebase range from @angular/fire's own deps, pin, migration rewriting `latest`, guard against duplicate @firebase/app.
- A2 Functions emulator sends REAL Telegram messages (emulators.sh feeds real .secret.local, worktrees borrow main tree's copy; seeding fires onInquiryCreated). Ask: dev sink under FUNCTIONS_EMULATOR, stop borrowing secrets, seed refuses with real secrets, document.
- A3 Devcontainer port shift (+1 on host) → app dials localhost:8080/9099 on host and misses emulators. Ask: proxy emulator traffic through dev server origin (proxy.conf.mjs), connect*Emulator at location.host; at least warn on forwarded-port mismatch.
- B1 firebase/project.json has no `deploy` target for rules/indexes (+storage rules).
- B2 root firebase files invisible to nx affected — named inputs firebaseConfig / firestore; functions:deploy inputs.
- B3 no backend CI deploy workflow (deploy-backend.yml: nx-set-shas, affected -t deploy, WIF auth, concurrency per ref). Ask: ci-deploy generator + parameterised setup-gcp.sh; rewrite HOUSE.md deploy section.
- B4 IAM grants refused for agents (correctly) → ship as reviewable idempotent script the human runs with `!`; skill says so up front.
- B5 firebase-cli devcontainer feature unpinned, firebase-tools not a devDependency; Node stated 3 times (image 24, functions engines 22, CI 24), no .nvmrc / root engines.
- B6 functions build twice on deploy (dependsOn build + firebase.json predeploy lint+build).
- C1 HOUSE.md deploy story wrong: CLI-from-source vs GitHub auto-rollout; apphosting.yaml lives at backend rootDir (/apps/<app>), root one silently ignored — stop generating it; rollout path filters empty.
- C2 no recipe for moving between Google/GitHub accounts (Developer Connect connections, orphans, org install).
- C3 branches.json `deploys` binding should be proposed from real state (apphosting:backends:get, deploy-backend.yml presence).
- D1 worktree offset emulator stack exported through MAIN tree's hub (4400); eventarc/tasks not in the offset map (9300/9500).
- D2 second dev-server in same worktree holds the nx task lock → nx serve waits silently, exits 1.
- D3 agents leak servers, use pkill --newest / pgrep -f matching own shell → PID-based teardown, ban name kills, final no-listeners check (local-server-isolation, delegate-and-parallelize).
- D4 seed banner "sign in as: " prints empty.
- E1 firebase.json auth.providers.googleSignIn.supportEmail = support@undefined.firebaseapp.com.
- E2 generated vite/vitest configs use __dirname → Vite configLoader 'native' warning.
- E3 @analogjs warns missing libs/<lib>/tsconfig.app.json for generated libs.
- E4 libs/brand has no Nx tags → outside module-boundary firewall.
- E5 site-chrome.scss 4 kB budget trips on adding a skip link; skip link + <main> landmark belong in generated app shell / DS.

Ask back: for each item, the toolkit version that fixes it.
