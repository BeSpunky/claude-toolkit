# Annotations & Live Review — the intent layer, and reading the user's comments from a file

A mock is a house with no furniture. Walk someone through it in silence and they will judge the empty rooms — the bare bulb, the chalk outline, the grey rectangle where the art goes — and reject a concept that was never actually shown to them.

So you do what an architect does on site: you **talk over the walkthrough.** *"The sofa goes here, sideways, facing the window."* *"This dot is the light — it'll float and breathe; right now it's just a dot."* That narration is not decoration. It is the thing that makes a low-fidelity mock **honest**: it tells the viewer, at each element, *what this stands for* — so they judge the **intent**, not the shortcut.

And it has to run **both ways**. The user points back — *"too big"*, *"this feels cold"*, *"what is this?"* — and if that arrives as three sentences of prose after the fact, half of it is unlocatable (*which* thing was too big?). So the comment goes **where the user pointed**: pinned to the element, POSTed to the harness server, and written to `comments.json` on disk — where Claude reads it back exactly, live or long after.

Two layers, one kit:

| Layer | Authored by | Purpose |
| --- | --- | --- |
| **Intent notes** | **Claude**, as the mock is built | *"This static glow is the lantern — the real one drifts and dims as you scroll."* Hover/focus a pin → a popover explains what the low-fidelity thing represents. |
| **Comments** | **the user** (live or async) | Click anywhere → pin a comment to that spot. The server writes it to `comments.json`; Claude reads it back from that file: exact words, exact element, exact position. |

---

## The kit — you don't write it, you copy it

The review layer is **harness, not mock**: it ships with this skill at `assets/mock-harness/` and is copied verbatim into the package's `mocks/` folder. You never hand-write it, never edit it per-project, and never paste it into a variant. Writing it by hand each time is the exact "doing the same thing twice" this repo refuses.

```text
assets/mock-harness/          →  copied to  docs/features/<date>-<slug>/mocks/
  gallery.html                # the shell: renders whatever mocks.json declares
  gallery.js                  #   … side by side, at every viewport, with the comment bar
  review.css                  # the pins, popovers, comment-mode chrome (namespaced .mk-*)
  review.js                   # intent pins + the user's comments (POSTed to the server)
  serve.py                    # the server: static files + a /comments endpoint → comments.json
  serve.sh                    # launcher: random free port, prints the gallery URL
  mocks.json                  # ← YOU WRITE THIS: the question, what's faked, the variants
  variants/_template.html     # ← COPY PER CONCEPT: two harness lines + your mock
  (comments.json, .gitignore  #    written by the server — read comments.json; git ignores the folder)
```

**What Claude authors is only ever two things:** `mocks.json` (the question, the honesty list, the variants and their pitches) and one file per concept under `variants/`. Everything else is fixed, so **every mock review looks and behaves the same** — same pins, same comment gesture, same gallery, same read-back contract — and the only thing that changes between reviews is the design being judged.

A variant carries exactly two harness lines in its `<head>`; the rest of the file is pure mock:

```html
<link rel="stylesheet" href="../review.css">
<script src="../review.js" defer></script>
```

Then Claude narrates the fakes by putting **`data-note="…"`** on any element. That is the whole authoring surface.

## Writing good intent notes

The note is the sentence you'd say standing in the empty room. It has one job: **name what the cheap thing stands for**, so the viewer judges the design and not the shortcut.

- ✅ *"The lantern. In the real thing it drifts and dims as you scroll deeper; here it's a static glow so you can see where it sits and how much of the frame it owns."*
- ✅ *"Sofa goes here, sideways — facing the window, not the room. The list runs along the light."*
- ✅ *"Placeholder art. The real hero is a commissioned illustration; what's being judged is its **size and weight** in the composition, not this image."*
- ❌ *"Hero section."* — a label, not an intent. It tells the viewer nothing they can't see, and explains away none of the fakery.
- ❌ *"TODO: animate."* — a note to yourself, not to the person judging.

Rules of thumb:

- **Note the fakes, not the obvious.** Every place you took a shortcut from the fidelity dial gets a note. A plain, honestly-rendered button does not.
- **Say what it *will* be, and what to judge *now*.** Those are two different things, and the second is what you're actually asking for.
- **One sentence, two at most.** A popover the user has to *read* is the failure this whole skill exists to avoid.
- **Cover the concept's screenshot-worthy thing first.** If exactly one element gets a note, it's that one.
- **Keep a global honesty note** in the gallery header too (*"light is approximated; the cinematic is one frame; the art is a placeholder"*) — the pins say it per-element, the header says it up front.

---

## The live review — reading comments from a file

The mocks are for a **decision**, and a decision is a conversation. Because the harness writes comments to disk, that conversation does **not** have to happen live: co-driving is the best case, not a requirement.

1. **Serve the mocks on a random free port** — the harness ships the script:

   ```bash
   bash docs/features/<YYYY-MM-DD>-<slug>/mocks/serve.sh          # prints http://127.0.0.1:<random>/gallery.html
   bash docs/features/<YYYY-MM-DD>-<slug>/mocks/serve.sh --stop
   ```

   Never the project's default/forwarded port — that one belongs to whatever the user launched (`bespunky-workflow:local-server-isolation`). And never `file://`: the gallery `fetch`es `mocks.json` and the comment layer POSTs to `/comments`, both of which need the http server (`serve.py`). The server also writes the `*` `.gitignore` on first run, so the folder is throwaway from the first serve.

2. **Get it in front of the user — live if you can, async if you can't.**
   - **Co-driven (best):** open the gallery in the **shared browser** (`bespunky-browser-automation:shared-browser`) — the user clicks in a host tab over noVNC while you narrate and watch. Tell them, in one line: *"Press `c` and click anything — on any variant — to pin a comment to it. Hover a purple pin to see what a faked thing is meant to be."*
   - **Async (also fine):** send screenshots (`bespunky-browser-automation:playwright`) and the URL; the user opens it in their own browser whenever. The comments still land in `comments.json`.

3. **Walk them through it** — the same narration the pins carry: what each variant's concept is, what's faked, what you're asking them to judge. They are looking at an empty house; be the architect standing in it.

4. **Read the comments back — from the file, not from a live browser:**

   ```bash
   cat docs/features/<YYYY-MM-DD>-<slug>/mocks/comments.json      # the durable source of truth
   ```

   or, if you're already driving the live gallery over CDP, `JSON.stringify(window.allComments())`. Both return the same array — the gallery reads it from the same `/comments` endpoint. Reading the **file** is preferred: it survives a server restart, a closed tab, and a review that happened while you were away, and it needs no live session at all. Each comment carries the **exact words**, the **element** (a stable selector), its position within that element, the **variant**, and the viewport width — so *"too big"* is never ambiguous again: you know which thing, on which concept, at which width. (If a comment was pinned to an element that also has an intent note, its `note` field carries that note — so you can see whether the user was reacting to your stated intent.)

5. **Read them back to the user before acting.** *"So: the lantern hero is too big on the phone, the tideline palette reads cold, and you want the second row gone."* This catches a misread while it's free.

6. **Take the verdict — including "none of these" and "a hybrid".** A rejection of all concepts, or a graft of two, is a *first-class* outcome, not a failure: this is the outside-eye taste gate. Any verdict routes **upstream** — a comment is feedback on the **design**, not a bug in the mock's CSS — to `stage-the-vision` (re-conceive, or re-synthesize a hybrid into one concept) or `envision-the-experience` (the feeling was wrong). **Re-mock cheaply; never polish the mock into compliance.**

7. **Copy the verbatim comments into `DECISION.md`** — the user's own words are the most valuable line in the package (`bespunky-workflow:feature-package`), and `comments.json` is thrown away with the `mocks/` folder.

> **A comment pinned to a pixel beats a paragraph written from memory.** That is the whole reason this layer writes to a file instead of trusting a chat reply to remember which pixel.
