# voice-band — brief

## In the user's words (2026-10-03)

> Can we use the new mod feature in Claude for these stuff?

…about the voice annoyances fixed in `2026-10-03-voice-ux`. After seeing the fit
(strong for the live transcript, replay and cancel; none for the audio itself), the
user: "yes, merge and do the band next".

## The goal

A **voice control band** above the prompt, shown whenever the voice is active, on
every path that speaks or listens (auto-speak hooks, `/voice say`, `/voice answer`,
`ask_by_voice`):
- 🔊 what is being said · 🎙 what is being heard, live;
- **Replay** and **Stop** buttons with hotkeys;
- **Esc** while `ask_by_voice` runs stops the voice, via a `tool.call` hook's
  `next.signal` (the engine aborts it when the user interrupts) — replacing the
  undocumented `notifications/cancelled` gamble.

It sits ON the existing runtime: the speaker/listener own state files; the band
reads them and its buttons call `speaker.sh replay|stop`. The audio stays ours —
the engine's `$.audio.speak` is the platform synth and plays nothing in a Linux
terminal.

## Gate (first unit)

Mod modules are documented as loading from folders the person owns (the session's
dev-mods folder, `--plugin-dir`, `CLAUDE_CODE_PLUGIN_DIRS`, a skills folder). Whether
a **marketplace-installed** plugin's `hooks.json` `modules` load for a consumer is
unverified — it decides whether the band ships inside `bespunky-voice` or is a
per-user mod.
