# fan-out ledger — voice-ux sanity review

User: "Send agents to sanity check" (2026-10-03). Read-only reviewers, branch feat/voice-ux @ HEAD.

| id | scope | status | re-run safe |
| --- | --- | --- | --- |
| R1 | mcp/ask-server.mjs + mcp/answer.mjs (protocol, async, cancel, supersede, intents) | dispatched | yes |
| R2 | scripts/listen.sh (stream contract, VAD, lifecycle) | dispatched | yes |
| R3 | scripts/speaker.sh, hooks/*, hooks.json, install-runtime, command + skill docs | dispatched | yes |
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
