---
name: voice-conversation
description: Converse hands-free by voice — Claude asks its questions OUT LOUD and waits for the user's SPOKEN answer, no keyboard. Use when the user asks to "talk by voice", "let's do this hands-free", "I'm away from the keyboard, ask me out loud", "voice chat/mode/conversation", or otherwise wants to answer your questions by speaking rather than typing. Backed by the bespunky-voice plugin's `ask_by_voice` MCP tool (needs installed TTS + STT).
---

# Voice conversation mode

The user wants to answer your questions by **voice**, hands-free. While in this mode:

- For **every** question you would put to the user — a choice, a confirmation, a
  clarification — call the **`ask_by_voice`** MCP tool (from the bespunky-voice
  server) **instead of** `AskUserQuestion` or asking in plain text. Pass a
  `question` phrased for the ear (plain spoken words, no markup) and, when it's a
  choice, the `options` (each a short `label`).
- The tool speaks the question, records the spoken reply, and returns
  `{ transcript, matched, options }`:
  - `matched` non-null → proceed with `matched.label`.
  - `matched` null → interpret `transcript` yourself; if it's unclear or empty,
    call `ask_by_voice` again to re-ask (rephrase or re-read the options).
- Keep spoken questions **short and one at a time** — the user is listening, not
  reading. Prefer 2–4 clear options with distinct labels (the matcher keys off
  the label words, ordinals like "the second one", and yes/no).
- You do **not** need auto-speak (`/voice auto on`) in this mode — the tool speaks
  each question itself, so turning both on would double up.
- Continue using voice for questions until the user says to stop ("back to text",
  "stop voice"), then resume normal questions.

## If it isn't ready

If `ask_by_voice` is unavailable, the MCP server likely isn't loaded yet — tell
the user to restart Claude Code (or `/reload-plugins`). If the tool returns that
speech-to-text isn't installed, have them run
`bash ~/.claude/bespunky-voice/install-whisper.sh` once. Fall back to text
questions until it's ready — never guess an answer.
