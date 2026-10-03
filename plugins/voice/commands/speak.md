---
description: Speak Claude's current question aloud, replay or stop it, answer it by voice, or toggle automatic speaking. For when you're away from the screen.
argument-hint: "[say | replay | stop | answer | auto on | auto off | test | status]"
allowed-tools: Bash
---

The bespunky-voice runtime scripts live at a stable path, `~/.claude/bespunky-voice/`
(published each session by the plugin's SessionStart hook). Always call them there,
by absolute path.

**First check** — if `~/.claude/bespunky-voice/speaker.sh` does NOT exist, the
SessionStart hook hasn't run yet (this happens right after a fresh install, since
installing a plugin mid-session does not fire SessionStart). Tell the user to
restart Claude Code or start a new session once to activate the voice plugin, then
stop — do not try to run the scripts.

The user ran: `/speak $ARGUMENTS`

Do **exactly one** of the following, chosen by the first word of "$ARGUMENTS"
(treat empty as `say`):

- **say** (or empty) — Ask the question you most recently put to the user (and
  are still awaiting an answer on) again, OUT LOUD, the way a person would ask it
  across the room: one or two plain sentences that name the choices in the
  sentence itself — "Should I commit now, or keep going and commit at the end?".
  **No** markdown, symbols, code, or structure; **no** "option one", "your options
  are", or "say your choice"; never list the choices and then summarise them
  again. Include only what they need to decide. Then speak it:
  ```
  bash ~/.claude/bespunky-voice/speaker.sh say --wait "<the spoken question>"
  ```
  If you have NOT actually asked a question recently, tell the user that instead
  of inventing one to read.

- **replay** (or **again**) — Say the last thing the voice said, again:
  `bash ~/.claude/bespunky-voice/speaker.sh replay --wait`. If it reports nothing
  has been said yet, tell the user so.

- **stop** — Silence whatever is being said, and end any recording in progress:
  `bash ~/.claude/bespunky-voice/voice.sh stop`. (Speech also stops on its own
  the moment the user submits a prompt or answers a question picker.)

- **answer** — Capture the user's spoken reply and act on it. Run:
  ```
  bash ~/.claude/bespunky-voice/listen.sh
  ```
  It sets the mic gain for the resolved audio endpoint, records until you stop talking,
  and prints the transcript on stdout. Take that transcript as the user's answer
  to the question you last asked them, echo it back in one line so they can catch a misrecognition ("You said:
  …"), and then continue acting on it. If it exits non-zero (nothing recognized, STT
  not installed, or no reachable audio endpoint), relay the stderr message and offer to retry — do NOT guess an
  answer. If speech-to-text or the speech detector isn't installed yet, tell them to run
  `bash ~/.claude/bespunky-voice/install-whisper.sh` once.

- **auto on** / **auto off** — Run `bash ~/.claude/bespunky-voice/voice-auto.sh on`
  (or `off`) and report the new state. When ON, the plugin automatically speaks
  every multiple-choice question, plan approval and question that ends a turn,
  the moment it appears.

- **test** — Run
  `bash ~/.claude/bespunky-voice/speaker.sh say --wait "Voice check. If you can hear this clearly, the voice plugin is working."`
  and confirm to the user whether it should have played. If it prints
  "falling back to the robotic voice", relay the reason and the repair command
  it names — the natural voice is installed but broken. If it fails with "no
  reachable audio endpoint", relay that diagnosis: voice needs a reachable
  PulseAudio-protocol sink (WSLg, or the host's native PulseAudio/PipeWire),
  bridged by the BeSpunky devcontainer.

- **status** — Run `bash ~/.claude/bespunky-voice/voice-auto.sh status` and tell
  the user whether auto-speak is currently on or off, which audio endpoint was
  resolved (and the mic gain it implies) — or, if none was reachable, relay the
  diagnosis it printed (every endpoint tried, why each failed, and the fix) —
  and which speech engine will actually speak (natural Piper voice or the
  robotic fallback, with the reason and the repair command when it's the
  fallback), and whether the listening engine (whisper.cpp) can hear — with the
  reason and the repair command when it's broken or missing.
