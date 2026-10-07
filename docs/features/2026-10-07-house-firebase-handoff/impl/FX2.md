# FX2 — dogfood fixes: generators and migrations (D1, D2, root tag, churn, dep order, D7, D8)

Branch `feat/house-firebase-handoff--fx2`, worktree `hfh-fx2`. Written as it happens. Source of the findings:
`DOGFOOD-CONSUMER.md`. FX1 owns the emulator/dev-loop tools, FX3 the HOUSE.md.tpl wording and branch-engine messages.

| # | Finding | Status |
| --- | --- | --- |
| 1 | D1 — migration and firebase-client give conflicting @angular/fire advice; `latest` left unreported | in progress |
| 2 | D2 — house Angular apps have no `lint` target, so the platform firewall never checks them | open |
| 3 | the root project (`.`) tagged `platform:shared` | open |
| 4 | formatting churn (`forwardPorts`, firebase targets' key order) | open |
| 5 | `firebase-tools` appended out of order in devDependencies | open |
| 6 | D7 — stale `.gitignore` / devcontainer comments after 0.50.0 | open |
| 7 | D8 — "Rewrote firebase.config.ts" on every no-op upgrade; sweep the pattern | open |
