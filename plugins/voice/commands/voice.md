---
description: Speak Claude's current question aloud, or toggle automatic speaking. For when you're away from the screen and want to hear what Claude is asking.
argument-hint: "[say | auto on | auto off | test | status]"
allowed-tools: Bash
---

The bespunky-voice runtime scripts live at a stable path, `~/.claude/bespunky-voice/`
(published each session by the plugin's SessionStart hook). Always call them there,
by absolute path.

**First check** — if `~/.claude/bespunky-voice/speak.sh` does NOT exist, the
SessionStart hook hasn't run yet (this happens right after a fresh install, since
installing a plugin mid-session does not fire SessionStart). Tell the user to
restart Claude Code or start a new session once to activate the voice plugin, then
stop — do not try to run the scripts.

The user ran: `/voice $ARGUMENTS`

Do **exactly one** of the following, chosen by the first word of "$ARGUMENTS"
(treat empty as `say`):

- **say** (or empty) — Write a SPOKEN-WORD summary of the question you most
  recently put to the user and are still awaiting an answer on. Rules for the
  summary: plain spoken sentences; **no** markdown, symbols, code, brackets,
  tables, or structure read aloud; state the question, then each option as a
  natural phrase ("Option one: …; option two: …"); include only what they need
  to decide. Then speak it:
  ```
  bash ~/.claude/bespunky-voice/speak.sh "<your ear-ready summary>"
  ```
  If you have NOT actually asked a question recently, tell the user that instead
  of inventing one to read.

- **auto on** / **auto off** — Run `bash ~/.claude/bespunky-voice/voice-auto.sh on`
  (or `off`) and report the new state. When ON, the plugin automatically speaks
  every multiple-choice question and plan-approval the moment it appears.

- **test** — Run
  `bash ~/.claude/bespunky-voice/speak.sh "Voice check. If you can hear this clearly, the voice plugin is working."`
  and confirm to the user whether it should have played.

- **status** — Run `bash ~/.claude/bespunky-voice/voice-auto.sh status` and tell
  the user whether auto-speak is currently on or off.
