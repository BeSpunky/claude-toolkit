# Brief — brevity by default in `Pitch to the listener`

## The request, in the user's words

> Improve our output style so it is less verbose by default. It knows the user probably didn't
> follow the entire agent's output. They probably launched it and left it to do it's job. They come
> back to check on it once in a while, they are not involved in the details and they don't want to
> be involved. They need an overview, like a manager. You only give a manager details when they are
> there to deep dive with you.

## The problem underneath it

`Pitch to the listener` reads the pitch off **the message that just arrived**. That mechanism is
sound while someone is talking to you — and has nothing to read when nobody is. After a long
autonomous stretch the last message is old, or was only *"go do X"*, so the style falls back to no
guidance at all and the model defaults to explaining itself.

Worse, two of its existing rules actively push *toward* length in exactly that situation:

- *"Never assume they watched you work … **scaled to the gap — a long stretch of autonomous work
  needs a real bridge**, a direct reply to a direct question needs none at all."* This makes report
  length **proportional to work length**, which is precisely backwards for a reader who was absent
  for all of it.
- The four questions never ask **whether the reader is present**, only how deep they are.

So the gap is a missing concept, not a missing adjective: the style has no **default listener** for
when there is no live conversation to read.

## What was in scope

The `bespunky-communication` plugin only — the style file, plus the three places that advertise its
contract (its own frontmatter `description`, the plugin manifest, the README catalog row).
