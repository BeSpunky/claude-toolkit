# fan-out ledger — voice-ux sanity review

User: "Send agents to sanity check" (2026-10-03). Read-only reviewers, branch feat/voice-ux @ HEAD.

| id | scope | status | re-run safe |
| --- | --- | --- | --- |
| R1 | mcp/ask-server.mjs + mcp/answer.mjs (protocol, async, cancel, supersede, intents) | returned | yes |
| R2 | scripts/listen.sh (stream contract, VAD, lifecycle) | dispatched | yes |
| R3 | scripts/speaker.sh, hooks/*, hooks.json, install-runtime, command + skill docs | returned | yes |
| R4 | end-to-end behaviour: phrasing on realistic payloads, docs vs. behaviour, tests' blind spots | returned | yes |

Findings land below as they return.

## R4 (user-side) — returned
1 PARTIAL (statement questions / sentence labels clumsy; Stop-hook path garbles lists) · 2 PARTIAL (Stop hook
prefixes only the LAST bullet before "Which one?") · 3 PARTIAL (only the tool streams; /voice answer doesn't;
unverified live) · 4 FIXED · 5 PARTIAL (answering the AskUserQuestion picker / approving a plan submits no
prompt, so speech keeps going). Worst: "…retry the request. or Log the user out…?", "I'd go with Yes",
multi-select read as either/or. Ranked fixes: PostToolUse stop on AskUserQuestion|ExitPlanMode; Stop hook speaks
list heads + question (shared phrasing); label punctuation, multi-select, yes/no suggestion; tests for
extract-turn-question, multi-select, cancel-while-speaking.

## R3 (speaker/hooks/docs) — returned
MED speaker.sh: without setsid (macOS) stop kills only speak.sh's bash, the player keeps playing. MED speaker.sh:
concurrent `say` not atomic — all speak at once, only one stoppable. LOW-MED install-runtime: unreadable/missing
PLUGIN_ROOT/scripts → prune deletes every published script. Sound: --wait pgid, rc/stderr passthrough, stop during
--wait returns 0, hooks print nothing, hooks.json, docs ↔ scripts, all repo checks.

## R1 (ask-server/answer) — returned
HIGH answer.mjs: norm() turns "don't" → "don t" so dont/cant never match, and affirm wins over negate ("Don't do
it." → affirm) — pre-existing, moved verbatim. MED CANCEL misses "Please stop.", "No, stop.", "Stop, stop." →
fall to negate → option 2. LOW ordinal ignores negation ("Not the first one, the second" → first). MED server:
cancel()'s un-awaited `speaker stop` can kill the NEXT ask's question, which then listens for an unheard question.
LOW serverInfo.version hardcoded. Sound: ids 0/string, no response after cancel, supersede once, progress
monotonic, group kill, stdin end, stdout clean.
