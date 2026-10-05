---
name: voice-conversation
description: >-
  Converse hands-free by voice — Claude asks its questions OUT LOUD and waits for the user's SPOKEN answer, no keyboard. Use when the user asks to "talk by voice", "let's do this hands-free", "I'm away from the keyboard, ask me out loud", "voice chat/mode/conversation", or otherwise wants to answer your questions by speaking rather than typing. Backed by the bespunky-voice plugin's `ask_by_voice` MCP tool (sets up its own speech engines on first use).
---

# Voice conversation mode

The user wants to answer your questions by **voice**, hands-free. While in this mode:

- For **every** question you would put to the user — a choice, a confirmation, a
  clarification — call the **`ask_by_voice`** MCP tool (from the bespunky-voice
  server) **instead of** `AskUserQuestion` or asking in plain text.
- **`question` is said word for word** — so write it the way a person asks across
  the room, with the choices named inside the sentence: *"Should I commit now, or
  keep going and commit at the end?"* Plain words, no markup, no "option one", no
  "your options are", no "say your choice". **`options` are never spoken** — they
  only let the tool recognise which choice the reply means (give each a short,
  distinct `label` that echoes the words you used in the question).
- While the user speaks, the transcript appears live under the tool call. The tool
  returns `{ transcript, matched, options }`:
  - `matched` non-null → proceed with `matched.label`.
  - `matched` null → interpret `transcript` yourself; if it's unclear or empty,
    call `ask_by_voice` again with the question rephrased.
  - `cancelled: true` → the user said "stop" / "never mind" (or interrupted).
    Drop the question; don't re-ask unless they bring it up.
- The user can say **"repeat that"** at any point — the tool re-asks by itself.
  `/speak replay` and `/speak stop` work for anything spoken, and the voice band
  above the prompt shows what's said and heard, with Replay and Stop.
- Keep spoken questions **short and one at a time** — the user is listening, not
  reading. Prefer 2–4 clear options with distinct labels (the matcher keys off
  the label words, ordinals like "the second one", and yes/no).
- You do **not** need auto-speak (`/speak auto on`) in this mode — the tool speaks
  each question itself, so turning both on would double up.
- Continue using voice for questions until the user says to stop ("back to text",
  "stop voice"), then resume normal questions.

## If it isn't ready — make it ready, don't ask

The user asked to talk by voice, so a missing engine is yours to fix, not theirs.
**Never tell the user to install something you can install yourself.**

- **A speech or listening engine is missing or broken** (`ask_by_voice` returns an
  `error` about text-to-speech, speech recognition, the speech detector, `parecord`
  or `sox`) → **delegate the install, right away, without asking**: dispatch the
  **`bespunky-voice:voice-installer`** agent (prompt: `Install both halves.`).
  It runs the installer in its own context — the downloads and the build log never
  reach this session, which matters when voice is switched on mid-conversation.
  Tell the user in one line that you're setting voice up, then wait for its
  one-line result (it takes about a minute; don't poll, don't run it yourself too):
  - `ready: …` → call `ask_by_voice` again with the same question.
  - `failed: …` / `not ready: …` → relay it and fall back to typed questions.

  Only where you cannot dispatch an agent (you are a subagent yourself) run
  `bash ~/.claude/bespunky-voice/install.sh` directly, with a 10-minute timeout.
- **`ask_by_voice` is unavailable** → the MCP server isn't loaded yet. Nothing to
  install: tell the user to restart Claude Code (or `/reload-plugins`).
- **`~/.claude/bespunky-voice/install.sh` doesn't exist** → the plugin's SessionStart
  hook hasn't run since it was installed; same fix, a restart.
- **No reachable audio endpoint** → not installable from inside: relay that
  diagnosis — voice needs a reachable PulseAudio-protocol sink (WSLg, or the host's
  native PulseAudio/PipeWire), bridged by the BeSpunky devcontainer; `/speak status`
  shows what was tried.

Fall back to text questions only once the installer has failed or the problem is
one it cannot fix — never guess an answer.
