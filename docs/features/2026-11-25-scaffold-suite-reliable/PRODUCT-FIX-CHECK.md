# The one product fix, and the check that proves it (item 5)

**Fix:** `plugins/house/engine/nx-tools/src/generators/postgres/files/server.mjs.tpl` — `declareReady(stackDir, lines)`:
a launcher says what is ready, then writes the ready marker. Used by the Postgres server and the Supabase keeper
(`supabase/files/supabase-keeper.mjs.tpl`), which both wrote the marker first and logged after.

**Check:** `tools/test-scaffold/supabase-launcher.checks.mjs` — *"what it says about the ready stack is said before it
marks the stack ready"*. The marker is pre-made as a FIFO nobody reads, so the keeper's write of it blocks; the check
passes only if the MCP line is said while that write is held. No timing decides it.

## Before — the check against the launcher at 597d1aa7

A clone at `597d1aa7` with only the new `supabase-launcher.checks.mjs` copied in (2026-11-25, ~23:45 UTC):

```text
$ bash tools/test-scaffold/supabase-launcher.test.sh      # in /tmp/pre, 597d1aa7 + the new checks file
exit 1
  FAIL what it says about the ready stack is said before it marks the stack ready:
FAILED: 1
```

The detail after the colon is empty: at 597d1aa7 the keeper has said nothing at all when it writes the marker.
That was the only failing line.

## After — the same check against the fix

```text
$ bash tools/test-scaffold/supabase-launcher.test.sh      # in /work, the fix
exit 0
  ok   what it says about the ready stack is said before it marks the stack ready
ok
```

The other fixes in this package are in the tests, not in `plugins/house/engine/**`, so they owe no check of this kind.
How each was reproduced is in DECISION.md.
