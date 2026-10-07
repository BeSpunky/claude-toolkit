# POLISH — final polish after the release gate (firebase 13 day)

Written as it happens, 2026-10-07, on `feat/house-firebase-handoff` directly. Context: `firebase@13.0.0` was published
today (2026-10-07T19:36Z); its `@firebase/ai@3.0.0` declares `engines.node >=24.12.0`, so the released toolkit's
`"firebase": "latest"` now refuses to install on a Node-22 house container (FINAL-GATE.md §1).

## Units

| id | unit | owner | paths | status |
| --- | --- | --- | --- | --- |
| P1 | firebase-compat table records Node-engine facts; a firebase the project's Node cannot run is never chosen | main | tools/firebase-compat, _utils/firebase-compat.ts, adapters/angular/angularfire*.ts, migrations/0.50.0/firebase-compat-0.50.0.ts, house-probe.mts | in progress |
| P2 | "pin what is installed" advice describes the real installed firebase | main | adapters/angular/angularfire-judge.ts + a generator fixture | in progress |
| P3 | house.packages.sh archive comment gated with its block | main | devcontainer templates | in progress |
| P4 | dogfood-consumer: "baseline broken upstream: <cause>" reported apart from the change's failures | subagent | tools/dogfood-consumer only | dispatched (safe to re-run) |
