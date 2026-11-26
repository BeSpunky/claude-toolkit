# Sanity review (fix mode) of 13362013, 2026-11-26

Scope: `git diff 597d1aa7..HEAD`. Single-file runs, one at a time, all exit 0: emulators-stop, emulator-reset,
postgres-launcher, supabase-launcher (supabase-launcher rerun after the fix below: exit 0).

## Lenses and findings

**1. Races and bugs in the new test code**
- The FIFO check passes without proving anything if `mkfifo` fails. Its result was not checked, so the marker would be
  a plain file and the keeper's write would never be held. **Real, fixed:** a check now asserts the marker is a FIFO
  before the ordering check relies on it.
- Could the FIFO case hang or leave a keeper blocked? **Rejected.** `until` never throws, and the reader is opened
  (`O_NONBLOCK`, which returns at once) before SIGTERM on every path, so the held `open` is released before the keeper
  is stopped. The reader is kept open until the keeper exits, so its write cannot raise EPIPE. The one remaining risk is
  an outside kill of the test between spawn and open. The `finally` SIGTERM cannot end a keeper blocked in `open`, but
  that window holds only an `until` and two checks. Noted, not fixed.
- `keeper_pid` (emulators-stop): it runs in the main shell, not a subshell, so `KEEPER` and `FAILED` set inside it are
  seen by the rest of the script. With `set -u`, `KEEPER` is always set first. The script has no `set -e`, so a status
  of 1 does not abort it. A record that is only half written fails `JSON.parse` and is waited on again, which is a wait
  and not a retry of an assertion. **No defect.** The spared case's `[ -n "$KEEPER" ]` guard turns the old silent
  `gone ''` (which passed at once) into a named FAIL. That is better than before.

**2. Product change (server.mjs.tpl, supabase-keeper.mjs.tpl)**
- Postgres: the same two lines, same prefix, now said before the marker. **Preserved.**
- Supabase: the same lines under the same conditions (`mcpUrl`, `/tmp/`), still only `if (!stopAsked)`. No `await` sits
  between the lines and the marker, so the two `stopAsked` tests of 597d1aa7 collapse into one with no change in
  behaviour. The lines now run inside the `try`, so a throw while saying them (for example `realpathSync`) now stops
  the stack through the error path. Before, such a throw escaped with the stack up and its marker written. **Acceptable,
  and arguably better.** The keeper already imported from `server.mjs`.

**3. DECISION.md against the code**
- Checked: the 100 × 0.1 s deadline, the named FAIL messages, the fake `pg_isready` exiting 2 with "no response", and
  `EMULATORS_STOP_TIMEOUT` defaulting to 120 s (emulators.sh.tpl). The "names the local MCP" assertion line is
  byte-identical to 597d1aa7. emulator-reset is described as diagnostic only, and the test comment claims no fix.
  **Consistent.**

**4. Clean code and house style**
- Comments explain why. The deadline reuses the file's existing 100 × 0.1 s. **No finding.** The FIFO path is now
  named once (`held`) and not built twice.
