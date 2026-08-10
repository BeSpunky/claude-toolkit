---
status: concluded
concluded: 2026-08-10
summary: "`Pitch to the listener` gained a default listener — a manager who stepped out — wired in as the FLOOR of the mode stack, so brevity is the resting state while any engagement pushes to full depth in that same turn; shipped as bespunky-communication 0.4.1."
tags: [communication, output-style, brevity, conversation-modes, plugin-release]
---

# Decision — model the absent reader, don't add a "be brief" adjective

## The design

Add the concept the style was missing: a **default listener**, used whenever the four questions have
no live signal to read. That listener is *a manager who stepped out* — the person the user described.
Everything else follows from it rather than being asserted separately.

New section, placed immediately after *The four questions* (it sets the default that the rest of the
document adjusts away from):

- **Assume disengagement until they show up.** Engagement is a property of *their* messages, never
  of the task's importance or of how much work was done.
- **Engagement decays.** A deep dive two turns ago licenses nothing after a stretch of silent work;
  they can re-raise it in one message.
- **Detail is PULLED, never pushed** — including no *"let me know if you want more"* tail, which is
  itself the verbosity being avoided. Nothing cut is lost; it can be answered in full when asked.
- **What a check-in owes:** where it stands · what needs their decision · what they'd be unhappy to
  discover later. Read in seconds, not a document.

## The rule that had to be reversed, not merely supplemented

*"Never assume they watched you work"* ended with **"a long stretch of autonomous work needs a real
bridge"** — length proportional to effort. Left in place it would have out-argued the new section in
exactly the situation the new section exists for. It is now:

> **A bridge is a clause or a sentence — and it does NOT scale with how long you worked.** … a long
> autonomous run … all it produces is a slightly longer list of *outcomes*.

The rule's true insight is kept (a bare verdict is unattachable, so give it *one* thing to attach
to); only its scaling clause is inverted.

## What was deliberately NOT weakened

**"Brevity trims explanation, never omissions."** A manager who is told less must still be told
everything that failed, is unfinished, was assumed, or needs their decision. Strengthened rather
than trimmed: *an honest report is long only because of what it must not omit, never because of what
it chose to explain.* Brevity is a licence to cut the **account**, never the **caveats** — a short
report that drops bad news is misleading, not concise.

## Rejected

- **A global word/line cap.** It would cut caveats first, since those are the parts that read as
  optional. The bar is stated as a *reader experience* ("read in a few seconds") so that what gets
  cut is the account, not the content.
- **Framing it as an instruction to be terse.** The style is built on reading a listener; a bare
  "be brief" would sit outside its own model and lose to any turn where explaining felt warranted.
  Naming the listener makes brevity a *consequence* of the existing mechanism.

## Follow-up: the default had to be wired INTO the stack, not laid beside it

> "Ensure it's still dynamic and shifts and stacks throughout the conversation"

The first pass left two sections sitting side by side — *the default listener* and *conversation
modes are a stack* — with only a single clause connecting them. Read cold, *"assume disengagement
until they show up"* plus *"engagement decays"* can be taken as a **one-way ratchet** that mutes the
depth-shifting the style is built on. That would have been a real regression: the whole document's
thesis is that pitch is re-read continuously.

The fix is structural rather than another caveat: **the manager check-in is the BOTTOM OF THE MODE
STACK.** That makes it a participant in the existing push/pop mechanism instead of a rule competing
with it — dynamic by construction, since everything the stack section already says then applies on
top of it unchanged. Stated from both sides, so neither section can be read alone:

- In the default section — a `### This default is the FLOOR of the stack, never a ceiling`
  sub-section: they engage → **push immediately, in that turn**, at full depth, without dragging the
  check-in register in and without making them ask twice; mode exhausted → **pop back to the floor**;
  and **re-decided every single turn**, because *decay is not a ratchet* — it moves both ways,
  repeatedly, within one session. Nothing about the default is sticky.
- In the stack section — *"the stack has a bottom, and it is the check-in above"*: an **empty stack**
  means brief, and every mode pushed onto it is served at whatever depth *it* asks for. The two
  sections are named as **one mechanism**.

And the failure mode the first pass introduced is now called out explicitly: **staying terse at
someone visibly present** — brevity aimed at an engaged reader is the same failure as a wall of text
aimed at an absent one. Both ignore the listener, which is the one thing the document forbids.

## Also added

Two guards: **length is not diligence** (never reach for detail to demonstrate effort), and **don't
narrate to an empty room** (no progress commentary between steps) — plus a ban on *announcing*
brevity, alongside the existing ban on announcing the mode.

## Propagation

The style's contract is advertised in four places, all updated together: the frontmatter
`description`, `plugins/communication/.claude-plugin/plugin.json`, the derived
`.claude-plugin/marketplace.json` entry (its `description` is hand-written and preserved by
`nx release`; only `version` is derived), and the README catalog row — which carried a verbatim copy
of the reversed bridge claim.
