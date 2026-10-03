# voice-ux — decision (DRAFT, awaiting the user's confirmation)

Brief and root causes: [`BRIEF.md`](BRIEF.md).

## Facts the design rests on (verified 2026-10-03)

- Claude Code (here 2.1.287) **displays the `message` of MCP `notifications/progress`**
  under a running tool call, each one replacing the last (since 2.1.153; anthropics/claude-code#86464).
  → the live transcript has a real channel.
- Whether **Esc** sends `notifications/cancelled` to an MCP server is **undocumented**.
  → cancel must not depend on it alone.
- `UserPromptSubmit` fires on every submitted prompt; **no hook fires on interrupt**.
- whisper.cpp on this machine, 4.2 s clip: `base.en` 0.57 s, `small.en` 1.8 s.
  → live partials with the fast model, the final with the accurate one.

## Proposed design

**1 + 2. One author per utterance.** The robotic template and the doubled options are
the same defect: two parties compose one sentence. Claude becomes the only author.
- `ask_by_voice`: `question` is spoken **verbatim** — Claude phrases it as a person
  would ("Should I commit now, or keep going first?"). `options` become
  **matcher-only**, never read aloud. No "Claude asks:", no "Option one", no
  "Say your choice".
- Auto-speak of `AskUserQuestion` (where Claude wrote no spoken form): one small
  phrasing module renders the question plus a natural spoken list ("…: commit now,
  keep going, or stash it?"), and drops the list when the question already names
  the choices. The Stop-hook prose path drops its "Claude asks:" prefix.

**3. Live transcript.** `listen.sh` gains a streaming mode: it emits `partial:` lines
(fast model, ~1 s cadence) while recording and one `final:` line (best model). It
also ends on **end-of-speech** (adaptive to the measured room noise, which is what
broke the old silence-stop on WSLg) with the fixed window as the cap — so short
answers return sooner. The MCP server relays each partial as a progress message:
`🎙 "I think the second…"`.

**4 + 5. A speaker that can be controlled.** Today speech is a fire-and-forget
process (hooks) or a blocking call (the tool). One seam, `scripts/speaker.sh
say [--wait] | stop | replay`, replaces `speak-detached.sh`: it owns the process
group, the pidfile and the **last utterance**. Everything that speaks goes through it.
- **Replay:** `/voice replay`; and inside `ask_by_voice`, saying "repeat that" /
  "say again" re-speaks and listens again without a round-trip to Claude.
- **Cancel, three ways, because no single one is guaranteed:**
  - Esc → the server, now **async** (no `spawnSync`), handles `notifications/cancelled`
    by killing the request's process groups;
  - saying "stop" / "cancel" / "never mind" while it listens → returns `cancelled`;
  - a new `UserPromptSubmit` hook stops any speech the moment you type — you're back
    at the keyboard. Plus `/voice stop`.

## Release
`bespunky-voice` minor bump (new command verbs, new hook, changed tool contract).
No `nx-tools` payload change → nothing to migrate.
