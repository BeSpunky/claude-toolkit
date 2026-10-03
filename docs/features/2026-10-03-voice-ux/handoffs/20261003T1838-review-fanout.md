# fan-out ledger — voice-ux sanity review

User: "Send agents to sanity check" (2026-10-03). Read-only reviewers, branch feat/voice-ux @ HEAD.

| id | scope | status | re-run safe |
| --- | --- | --- | --- |
| R1 | mcp/ask-server.mjs + mcp/answer.mjs (protocol, async, cancel, supersede, intents) | dispatched | yes |
| R2 | scripts/listen.sh (stream contract, VAD, lifecycle) | dispatched | yes |
| R3 | scripts/speaker.sh, hooks/*, hooks.json, install-runtime, command + skill docs | dispatched | yes |
| R4 | end-to-end behaviour: phrasing on realistic payloads, docs vs. behaviour, tests' blind spots | dispatched | yes |

Findings land below as they return.
