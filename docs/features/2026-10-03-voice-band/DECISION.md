# voice-band — decision (DRAFT, awaiting the user's confirmation)

Brief: [`BRIEF.md`](BRIEF.md).

## Gate G1 — answered (2026-10-03)

**A marketplace-installed plugin's hooks module DOES load** for whoever installed it,
with no consent prompt of its own. Evidence: an isolated experiment (scratch
`CLAUDE_CONFIG_DIR`, plugin installed from a local marketplace) logged
`hooks module modprobe@probe-mkt loaded (worker, environment 1, tier user)` and its
`session.start` wrote a marker; the `--plugin-dir` control behaved the same; the types
name the `user` tier "everything a person installs". Gates: an organization's managed
`allowManagedModsOnly` policy (read from the binary, not tested) and
`disableAllHooks: true` (tested — nothing loads). Unverified: desktop / VS Code, and
whether the interactive workspace-trust dialog applies.
→ **The band ships inside `bespunky-voice`.**

## Proposed design

**The band is a view, not a second voice.** The runtime keeps owning the audio; the
band only shows its state and sends it two commands.

1. **One state channel.** The processes that speak and listen live outside the
   engine (hook scripts, the MCP server), so files stay the channel: the speaker
   writes what it is saying (and clears it when done), the listener writes what it
   has heard so far. The band polls them on a short clock (`$.clock.every`).
2. **One control verb for "the voice".** Today `speaker.sh stop` silences speech
   only; the listener has no stop. A single stop — speech *and* any open recording —
   becomes the one thing every cancel path calls: the band's Stop, Esc, typing,
   answering the picker, `/voice stop`.
3. **The band** (`ui.render` on `AbovePrompt`): `🔊 <what's being said>` or
   `🎙 "<what's heard>"`, with **Replay [r]** and **Stop [s]**. After speech ends it
   lingers briefly with Replay so a missed sentence can be heard again, then goes.
   Nothing shows when the voice is idle.
4. **Esc reaches the voice for real:** a `tool.call` hook around `ask_by_voice` runs
   the stop when `next.signal` aborts (the engine aborts it when the user
   interrupts) — replacing reliance on the undocumented `notifications/cancelled`.
5. **The command hooks stay** (`silence.sh` on prompt / picker answer). Where mods
   are disabled (`disableAllHooks`, an org's managed-mods-only policy) the plugin
   still works without the band — the band is an enhancement, never a dependency.

## Release
`bespunky-voice` minor bump (a new surface). No `nx-tools` payload change → nothing
to migrate.
