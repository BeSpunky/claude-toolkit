# Sanity review ledger: nx-tools 0.51.2 (mode: report)

Sanity-reviewer start: 2026-11-03T12:49:52Z, end: 2026-11-03T13:17:32Z. Scope: clone `bench`, `git diff 68c76216...HEAD` (31 files).

## Frame
Release @bespunky/nx-tools 0.51.2 clearing 0.51.x leftovers: (1) `nx test design-system` exits 1 on new Angular projects because the demo spec is pruned: real DsTheme spec seeded at creation only + 0.51.2 rung for existing DSes. (2) Standalone Angular library failed its own lint on an unused peer: prune moved to shared library path (library port create). (3) Measured bundle-size figures in Firebase templates. (4) Zoneless wording in two Angular skill files. `test` joins dogfood gate.
Decisions (not findings): real spec rather than a flag on the executor; rung skips a library with any existing spec.
Verification: test-migrations, test-generators, test-layers; optional dogfood.

## Lenses / agents
| id | lens | model | start | end | status |
| --- | --- | --- | --- | --- | --- |
| R1 | correctness | opus | 12:51:02Z | 13:03:23Z | done (787s) |
| R2 | architecture | opus | 12:51:01Z | 12:54:57Z | done (308s) |
| R3 | tests + clean code + reuse | sonnet | 12:51:02Z | 12:53:08Z | done (164s) |
| R4 | completeness | haiku | 12:51:03Z | 12:54:07Z | done (209s) |
| V1 | adversarial verifier | opus | 13:05:15Z | 13:15:08Z | done (642s) |

## Findings
Raw: R1 10, R2 11, R3 12, R4 16. High/medium verified by V1; lows checked at anchor by the sanity reviewer.

Stands: F1 rung skip premise (M); F2 navigation-core no spec (M-H); F3 ds-component build, out of range (H); F4 green target hides entry specs (M-L); F5 libs.ts:72 cwd-relative directory (L); F6 tag-only rung (L); F7 shape check holes (L-M, partly refuted); F8 narrow: CI paths, spec unexecuted (L, mostly refuted); F9 3 clauses unguarded by tests (L-M, mutated); F12 pre-bump gate; F13 decisions unrecorded (L-M); F14 stale gate wording (trivial); F15 no rung, finding fine, statement owed (L, partly refuted).
Lows standing: README:584 207 kB; rung:55-57 warning; historicalShapes absent; dead null branch and if(logs); header real-run claim not in repo; duplicate tpl; libs.ts triple replace; root '.' and configurations; peers case layout/import gaps; vacuous gate; port and seeding contract; library-peers comment; SKILL no stack; status frontmatter.
Refuted: F10 walkers, F11 0.50.0 coupling, F16 prune ordering, arithmetic comment (rounding), 0.33.0 log (deliberate), zoneless package (trivial), effort: key (29 of 59 have it), angularfire left-for-later (past record), b5022353 answer (not a payload change).
Verification after review: test-migrations 302/0, test-generators 239/0/30 skipped, test-layers 103/0, invariants fail on the pending bumps. Clone clean at 705d4fa9. Full dogfood not run: owed before release.
Trace outside scope: empty ~/projects (mtime 13:09) from V1's house.sh bare name; node_modules/.cache writes through a symlink.
