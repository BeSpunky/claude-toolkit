---
effort: scaffold-suite-reliable
summary: The scaffold suite fails now and then for no real reason (emulator-stop, emulator-reset with postgres-launcher, the Supabase MCP line); find each cause and fix it there, so a red run always means a real break.
---

# Make the scaffold suite fail only on real breaks

(in flight — causes and decisions are recorded below as they are found)

## Log, as it happened (2026-11-25, UTC)

- **23:27 — run 1** (baseline, in `/work`) is **contaminated** and counts for nothing: while it ran I edited
  `emulators-stop.test.sh` (bash reads a script as it runs it) and ran single files beside it. Its failures —
  `kill: '': not a pid` and the restart/orphan cases of `emulators-stop` — are noted, not used as evidence.
  From run 2 on, baselines run in a separate clone checked out at `597d1aa7` (`/tmp/base`), so editing `/work` never
  touches a baseline. Single-file experiments did still run beside runs 2–3 (extra load, said per run in EVIDENCE.md).

- **emulators-stop — cause found (test).** The keeper writes its record (`detached/emulators.json`) itself, after it
  has started firebase-tools; the script's own output reaches `out.log` only after it has read that record, so a
  `ready` that *succeeded* implies the record exists. But `ready` gives up silently after 10 s and its result is never
  checked: on a start slower than that, the `keeperkill` case read the pid from a record not yet written, got `''`,
  and `kill -KILL ''` failed with `kill: '': not a pid`. Shown, not assumed: with the keeper's first record write
  delayed 12 s (a `node` shim on PATH, experiment only), the 597d1aa7 test prints exactly
  ``line 227: kill: `': not a pid or valid job spec``; the fixed test passes; delayed 25 s, the fixed test fails with
  `FAIL firebase@0: the keeper's record was never written (<path>)`. Normal start→ready here is 0.85–1.4 s
  (3.8 s for the restart case), so it takes a heavily loaded machine to hit it.
  **Fix (test only, no product change):** `keeper_pid` waits for the record, then for a numeric pid, each within the
  deadline every wait in that file already uses (100 × 0.1 s), and at the deadline fails naming which was missing.
  No timeout raised, no assertion retried.

- **supabase-launcher "names the local MCP" — cause found: BOTH raced.** (a) The launcher (product): the keeper wrote
  the ready marker *before* it logged the ready lines (the MCP line among them), so anyone acting on the marker could
  find the stack ready and its announcement not yet written. The plain Postgres server did the same. (b) The test read
  what the keeper said through a pipe, whose data arrives on the test's event loop on its own schedule — even with
  the product right, the marker could be seen before the pipe's bytes were read.
  **Fix:** product — one `declareReady(stackDir, lines)` in `postgres/files/server.mjs.tpl`, used by both launchers:
  say the lines, then write the marker. Test — the keeper's stdout/stderr go to a file (a child's write is in the
  file when it returns), so what was said before the marker is readable once the marker is seen. The check's
  assertion lines are untouched. New check (item 5): the marker is pre-made as a FIFO nobody reads, so the keeper's
  write of it blocks; the check passes only if the MCP line was said while that write is held. Against 597d1aa7's
  launcher it fails every time (nothing at all is said before the marker); after the fix it passes.

- **postgres-launcher "missing owner/heartbeat" — cause found (test), and it is NOT leaked state from another file.**
  Seen in run 2: `FAIL a stale heartbeat from another host, as after a rebuild: taken over, the server started:
  [postgres] pg_isready is not on PATH`. The heartbeat cases give the launcher a fake `postgres` but no `pg_isready`.
  The launcher probes `pg_isready` right after spawning the server; missing, that is a refusal at once, and the
  refusal's stop races the fake server to its first line — the line that reads `owner` into `owner-at-boot`. Usually
  the fake wins; under load it loses, and the check finds no owner read. The launcher is right (a missing
  `pg_isready` is a real refusal); the test's world was incomplete. Shown: with the fake server 0.3 s slow to start,
  597d1aa7's checks fail both take-over cases with exactly that message, every time; with the fix they pass.
  **Fix (test):** a fake `pg_isready` answering "no response" (exit 2) beside the fake server, so the launcher waits
  for the server to exit by itself, as it would for a real one.

- **00:03 — baselines done.** Runs 2–6, all at `597d1aa7` in the separate clone: 4 passed, 1 failed (run 2: the
  postgres-launcher take-over case above, with single-file experiments running beside it). Durations 333–376 s.
  `emulator-reset` passed in every one, and in run 1.

- **emulator-reset "stack left running" — NOT reproduced in a full run; cause NOT found; nothing claims to fix it.**
  In 6 full runs (1–6) every `emulator-reset` case passed. Run alone at `597d1aa7` under CPU load (8 busy loops on
  4 cores) it failed **once in 43 runs** (3 plain + 40 with a diagnostic copy): `FAIL once it has stopped, reset goes
  through` — the reset refused, still listing `firebase@6000` after `dev stop`, and that run took 170 s against the
  usual 21 s. The export had been written (the case before it passed). The other 42 passed, including all 40 with
  the diagnostic copy that would have captured `dev stop`'s output, `dev ps --json` and the stack records, so what
  held the stack for ~150 s is not known. ~150 s is close to the keeper's default stop deadline (120 s,
  `EMULATORS_STOP_TIMEOUT`, which this test does not set) plus its grace — a lead, not a finding.
  It is also **not leaked state from an earlier file**: it happened with the file run alone.
  **Change (diagnostic only, not a fix):** the test now checks the stop it used to send to `/dev/null` —
  `ok 'dev stop stops the running suite (exit 0)'`, with the stop's own output as the detail, also shown under the
  reset case if that fails. If it comes back, the run says why the stack was still there.

- **The earlier reading of "cross-file leaked state" did not hold.** Both faults it was offered for are timing under
  load inside one file: postgres-launcher's (found and fixed, above) and emulator-reset's (seen once alone).
