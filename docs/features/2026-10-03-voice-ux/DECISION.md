---
status: concluded
concluded: 2026-10-03
summary: Voice asks like a person (Claude is the only author of what is said), shows the transcript live, ends on end-of-speech settled by the recogniser, and can be replayed or silenced from every path.
tags: [voice, tts, stt, mcp, ux, cancel, replay]
---

# voice-ux — decision

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

## The design

Confirmed by the user as proposed: "yes" (2026-10-03).

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

## As built — what differed from the proposal

- **Yes/no questions are asked as one** ("Should I commit now?", not "…: yes or no?"),
  and a `(Recommended)` label becomes a spoken suggestion ("I'd go with …").
- **End-of-speech applies to `/voice answer` too**, not only the streaming mode; the
  hard cap rose from 10 s to 20 s, since it now only bounds a long answer.
- **Noise annotations are stripped at the STT boundary**: whisper names sounds it
  hears instead of words — `(static)`, `*coughs*` — which would otherwise have
  surfaced as partials or even as an answer.
- **A new ask supersedes one still running** (one microphone, one speaker).
- `speak-detached.sh` is retired; the SessionStart publish now prunes runtime
  scripts the plugin no longer ships.

## Sanity review (2026-10-03) — what it changed

The user asked: "Send agents to sanity check". Four reviewers (tool, listener,
speaker/hooks/docs, the user's-eye view of the five annoyances) found real gaps;
all fixed, tests 18 → 28, released as 0.4.1. The ones that changed the design:

- **Silence on answer, not only on prompt.** Answering the picker or approving a
  plan submits no prompt, so speech kept going after the user had moved on —
  `silence.sh` also runs on `PostToolUse` for `AskUserQuestion|ExitPlanMode`.
- **Prose questions are read by structure.** The end-of-turn path flattened the
  text and said the last bullet + "Which one?"; a list directly above the question
  is now its set of choices, phrased by the same `phrasing.mjs` as the picker.
- **The recogniser decides what loudness can't.** A cough and "yes" are identical
  by energy, and a loud room hides speech below any threshold. Short bursts and
  the no-speech give-up are both settled by a fast transcription: words end the
  take ("yes" ≈ 3.5 s; a 12 s answer at SNR 4 kept whole), no words mean noise.
- **Replies understand negation** ("don't", "not the first one") and padded
  commands ("please stop", "no, stop").
- Speaker: one locked stop→launch step; its own process group via perl where
  `setsid` is missing (macOS). Server: a cancel's stop lands before the next
  question is spoken.

Not changed, by decision: `/voice answer` stays non-streaming — a slash command's
Bash output isn't shown live; the live transcript belongs to the hands-free tool.

## Not verified live

The conversation logic is covered by `tools/test-voice/run.mjs` (real server, fake
audio). End-of-speech was tuned on synthetic speech + noise; the container's mic,
probed with nobody speaking, produced near-full-scale noise and once ended a take
early on a burst. **The first real hands-free session is the remaining check** —
especially that partials appear under the tool call and that Esc reaches the tool.

## Next

The user, on whether to use Claude Code mods: "yes, merge and do the band next" — a
voice control band (live transcript, Replay/Stop buttons, Esc via `next.signal`) is a
follow-up effort, gated first on whether a marketplace-installed plugin's mod module
loads for consumers at all.
