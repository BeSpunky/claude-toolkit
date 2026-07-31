# BRIEF — pitch every answer to the listener

**Effort slug:** `adaptive-register` · **Branch:** `feat/adaptive-register` · **Opened:** 2026-07-31

## Where this came from

The user opened with an observation about how Claude talks to them:

> "Claude often uses jargon, mixes details with overview, speaks as if I followed the entire thread even though I can leave and come back... Is there a dedicated built-in config/feature Claude provides to set tone and overall conversation?"

That is the ache. Three named symptoms — **jargon**, **detail and overview tangled together**, and **assumed continuity** — which turned out to be three faces of one thing: the response is pitched at nobody in particular.

## What it is NOT

An early draft framed this as a *role taxonomy* — speak differently to a tech lead, a manager, a CEO, an architect, a QA engineer. The user cut that off explicitly:

> "To be clear, it's not about roles and positions. That was an example we can use as a reference."

Roles are an **illustration** of register, not the mechanism. Keying behaviour off a declared role would be exactly the special-casing the house rules refuse — a lookup table of personas instead of a model of the thing itself.

## The actual specification

The user named the mechanism as four questions Claude asks *itself*:

> - What type of conversation are we currently having?
> - What is the user asking about/requesting?
> - At what level of depth am I being spoken to?
> - What does the user really need to know here?

And the reason they work:

> "These will help Claude enter and exit different conversation modes. Exactly like in real life, I adjust my pitch for the listener so my messages reach with clarity and focus. A conversation might shift in depth and zoom in/out as necessary. Just like when you give an overview and someone asks a depth question, or when you speak finer details and someone is asking for the overview."

Two points inside that quote are load-bearing and easy to lose:

1. **Enter AND exit.** A mode is not sticky. The conversation zooms; the pitch follows it, within the turn.
2. **The trigger is the message, not the person.** "At what level of depth am I being *spoken to*" — you read the register off what just arrived, not off a profile you built earlier.

## The two absolute rules

Stated by the user as rules, not preferences:

> "Claude should never use jargon or abbreviations assuming the user understands them, unless the user used them first."

> "Claude should never assume the user has spend the entire hour following the moves and inter-messages it outputs while the agent is working. Just like in real life - you execute a task / being asked a question / something else - you have your internal thought process, then you have to output the flow to your conversation partner. Otherwise they get a digested conclusion, a word, a sentence, a concept, etc. that they can't connect."

The second is the subtler one and the more valuable. It is **not** "be verbose." It is: there is an internal process and there is what you hand the listener, and the handoff between them is a real piece of work. Skip it and the listener receives a conclusion with nothing to attach it to.

## Scope

Ship it in the toolkit, not locally:

> "I'm talking about a solution we ship with our toolkit, not just a local one for this repo"

---

*See `DECISION.md` for what was decided and what was ruled out.*
