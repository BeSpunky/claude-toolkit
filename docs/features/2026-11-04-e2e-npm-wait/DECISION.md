---
effort: e2e-npm-wait
status: concluded
concluded: 2026-11-04
summary: The post-publish registry check gives npm up to 10 minutes to serve a new version, so a normal publish no longer reads as a failed one.
tags: [ci, release]
---

`runner image e2e (registry)` failed right after the 0.52.1 and 0.52.2 publishes with "the release did not reach it", and passed on re-run: it asked npm while npm still answered 404 (npm's own notice says "may take a few minutes to become available"). The user was asked whether to fix this before starting on `postgres`, and answered: *"yes"*.

Only a run started by a finished publish waits. A schedule or a hand run has no such race, so a 404 there still fails at once. Proven against the fake curl in `tools/check-runner-image/test.sh`; the real proof is the next publish. Nothing shipped to consumers changed, so no plugin or payload bump.
