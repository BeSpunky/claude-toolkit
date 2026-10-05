---
effort: voice-install-agent
status: concluded
concluded: 2026-10-05
summary: Voice engine installs run in the plugin's voice-installer subagent, so a mid-session setup costs the main session one line of context
tags: [voice, install, subagent, context]
---

# Voice installs run in a subagent

Follows `2026-10-05-voice-auto-install`, which made Claude run `install.sh` itself. The user:

> Improve the skill so if installation is needed, Claude will send another agent to install. That way, if the
> skill is run mid-session, the other agent will save context and will also keep the session log clean

## Decision

- **A plugin agent, `bespunky-voice:voice-installer`** (`plugins/voice/agents/voice-installer.md`) — not an ad-hoc
  prompt in the skill. The instructions live in one place, its tools are limited to Bash, and it runs on Haiku
  because the job is "run one script, report the result".
- **Return shape is one line**: `ready: speech <verdict>, listening <verdict>`, `failed: <the script's own error
  lines>`, or `not ready: … restart Claude Code once`. The skill and `/speak` branch on the prefix.
- **The caller waits for the notification** and then retries; it never polls or runs the install a second time.
- **Inline `install.sh` stays as the fallback** only for a caller that cannot dispatch an agent (a subagent itself).

Smoke test: the agent's instructions on Haiku, against this container's healthy engines, returned exactly
`ready: speech natural, listening ok`. `claude plugin validate plugins/voice` passes.
