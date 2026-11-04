---
effort: scaffold-tests-in-ci
status: concluded
concluded: 2026-11-04
summary: The scaffold tests pass in CI again, and a refused TCP readiness probe keeps its reason on dual-stack machines (nx-tools 0.52.2).
tags: [ci, tests, dev-engine]
---

## Causes, as found

CI's `scaffold tests` was red on `development` from bf44dc16 on. It reached `main` with the Landing 1 promotion (470a2cae), which did not look at `development`'s CI first. 54 failures, all CI-only:

- 51 in `docker-fallback.test.sh`, from bf44dc16: runners set `CI=true`, and `house.sh upgrade` refuses under it. `run.sh` now clears `CI`, beside its other machine-state normalisation.
- 2 in `upgrade-next.test.sh`: runner images set `safe.directory=*` system-wide, which answers git's different-owner knob. The case now reads no system or global config.
- 1 in `dev-engine.test.sh`, from Landing 1, and a real engine bug: where `localhost` resolves to both IPv4 and IPv6, a refused connection is an `AggregateError` with an empty message, so the timeout report lost its last answer. `ready.mjs` falls back to the error's code.

Also seen: `runner image e2e (registry)` failed right after the 0.52.1 publish because npm had not yet served the version. A re-run passed. Left alone: the check's failure is correct when a release truly did not arrive.
