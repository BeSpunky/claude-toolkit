---
effort: house-docker-open-items
summary: close the five items house-docker-pm left open — a chown failure losing the report, yarn 2+ without yarnPath, the rolling :24 image, a stale versions.ts comment, and a devcontainer dying on a package manager its image lacks
---

# Decisions made before dispatch

The user: "Send agents to fix those open items". Read `docs/features/2026-11-02-house-docker-pm/` first.

- **D1 chown after a good run.** Keep the run's report; exit with the chown's code; say how to repair ownership. A completed run is never reported as if it had not happened.
- **D2 declared yarn the image cannot honour.** Refuse up front on the fallback, before the lock, with the native route. Yarn 1 only dispatches to a project's yarn through `yarnPath`.
- **D3 rolling `:24`.** A weekly real-image check beside the other upstream checks, not a digest pin: a pin stops security updates and still leaves the devcontainer on the rolling tag.
- **D4 stale comment.** Corrected in the payload release D5 owes anyway.
- **D5 devcontainer without the project's package manager.** Fixed in the payload, for any package manager and any image, not for yarn on 26 alone.
