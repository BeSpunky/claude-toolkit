# Evidence — every full run of `bash tools/test-scaffold/run.sh`

Appended by the run itself as each run ends (never written afterwards). Logs are kept in `runs/` (self-ignoring
evidence, not committed). Box: 4 cores. `+wip` = run on uncommitted changes to tools/ or plugins/.

| # | label | commit | started (UTC) | duration | exit | first failing lines |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | baseline | 597d1aa7+wip | 2026-11-25T23:27:41Z | 379s (6m19s) | 1 |   FAIL restart: the killed run's stack is FINISHING (its keeper still saving)           FAIL restart: the new start's claim waited for the previous suite's save              FAIL orphan: a keeper killed outright leaves the stack ORPHANED (its record the handle), not forgotten  |
| 2 | baseline-597d1aa7 | 597d1aa7 | 2026-11-25T23:34:03Z | 353s (5m53s) | 1 |   FAIL a stale heartbeat from another host, as after a rebuild: taken over, the server started: [postgres] pg_isready is not on PATH. It comes with the postgres layer's image: rebuild the devcontainer (.devcontainer/house.packages.sh on an image of your own). FAILED: 1  |
| 3 | baseline-597d1aa7 | 597d1aa7 | 2026-11-25T23:39:56Z | 376s (6m16s) | 0 | — |
| 4 | baseline-597d1aa7 | 597d1aa7 | 2026-11-25T23:46:12Z | 343s (5m43s) | 0 | — |
| 5 | baseline-597d1aa7 | 597d1aa7 | 2026-11-25T23:51:55Z | 333s (5m33s) | 0 | — |
| 6 | baseline-597d1aa7 | 597d1aa7 | 2026-11-25T23:57:28Z | 341s (5m41s) | 0 | — |
| 7 | final | 0b8b5d93 | 2026-11-26T00:34:42Z | 333s (5m33s) | 0 | — |
| 8 | final | 0b8b5d93 | 2026-11-26T00:40:15Z | 353s (5m53s) | 0 | — |
| 9 | final | 0b8b5d93 | 2026-11-26T00:46:08Z | 339s (5m39s) | 0 | — |
| 10 | final | 0b8b5d93 | 2026-11-26T00:51:47Z | 374s (6m14s) | 0 | — |
| 11 | final | 0b8b5d93 | 2026-11-26T00:58:01Z | 337s (5m37s) | 0 | — |

Runs 7–11 are at 0b8b5d93, the last commit to change code. The commits after it change only CLAUDE.md, tools/test-scaffold/README.md and this package (`git diff --stat 0b8b5d93 -- tools plugins` lists only the README).
