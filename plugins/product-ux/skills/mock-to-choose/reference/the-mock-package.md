# The Mock Package — where mocks live, how they're shown, how they're thrown

Throwaway artifacts still need a home. Without one they scatter — a `mock.html` at the repo root, a `test-design` folder someone is afraid to delete, three features' worth of variants in one `mocks/` blob that nobody can untangle a month later.

The standard is the opposite of a blob: mocks live inside **the effort's feature package** (`bespunky-workflow:feature-package`) — dated, self-contained, and erasable in one command.

---

## The layout

```text
docs/features/
  2026-07-14-gift-picker/          # THE FEATURE PACKAGE — one effort, one slug (= branch feat/gift-picker)
    BRIEF.md                       #   distill-the-brief
    VISION.md                      #   envision-the-experience
    STAGING.md                     #   stage-the-vision — the concepts these mocks are testing
    DECISION.md                    #   durable — what was chosen, why, what was rejected
    mocks/                         #   the evidence — disposable by default
      .gitignore                   #     contains "*" — the folder ignores itself
      gallery.html · gallery.js    #     THE HARNESS — copied verbatim, never edited
      review.css   · review.js     #     intent pins, comments (POSTed to the server)
      serve.py     · serve.sh      #     server (a /comments endpoint) + launcher → gallery URL
      comments.json                #     written by the server as the user comments — read this
      mocks.json                   #     ← authored: the question, what's faked, the variants
      variants/
        lantern.html               #     ← authored: one file per concept
        tideline.html
        hearth.html
```

**Naming.** `docs/features/<YYYY-MM-DD>-<slug>/`, where the **slug is the effort's identity** — the same one that names the git branch (`feat/gift-picker`) and its worktree, so the mocks, the design, and the code that came out of them are always findable from each other. The date makes the history readable at a glance and keeps a *second* pass at the same feature (a redesign, six months on) cleanly separate from the first — no overwriting, no `-v2`, no ambiguity about which mock is current.

**One package per effort.** Not per surface, not per variant. If `distill-the-brief` produced a Brief Tree with a context and four surfaces, that whole tree's mocks belong in one package (`mocks/variants/context-*.html`, `mocks/variants/surface-timeline-*.html`), because they were designed together and are judged together.

**The package also holds the design's written artifacts** — the Brief, the Vision, the Staging, the Decision. Those are committable conclusions; only `mocks/` is throwaway evidence. That is exactly why the `.gitignore` sits *inside* `mocks/` and not at the package root.

---

## Static, dependency-free — the hard rule

The folder is **the harness plus one HTML file per variant**. Nothing is compiled, installed, or bundled.

- No `npm install`, no build step, no bundler, no framework. `serve.sh` is a static file server on a random free port.
- A variant's **only** imports are the two harness lines (`../review.css`, `../review.js`); everything else — layout, palette, dummy content — is inline in that file. Variants never import each other, and duplication between them is *correct*: each must be readable alone, and the whole thing is deleted soon anyway.
- **Never edit the harness here.** It is copied verbatim from the skill's `assets/mock-harness/`; a bug in it is fixed *upstream*, or every future review inherits the fix's absence.
- Works offline. Works in a year.

**And nothing outside the package may ever depend on a mock.** No route registered, no component importing it, no asset shared with the app, no entry in a config, no `package.json` change. This is the property that makes the package *completely* throwable: `rm -rf docs/features/2026-07-14-gift-picker/mocks` and nothing, anywhere, breaks.

---

## Throwable by default, keepable by choice

`docs/features/<...>/mocks/.gitignore`:

```gitignore
*
```

The folder ignores itself — including the `.gitignore`. Git never sees the mocks. They cannot pollute a diff, a PR, a review, or the app's build output. Nobody has to remember to clean up before committing.

**To throw:** `rm -rf docs/features/2026-07-14-gift-picker/mocks` (or the whole package, once `DECISION.md` has been read and the decision has landed somewhere durable).

**To keep** — when the user says *"actually, keep these, I want to look at them again"*: delete the inner `.gitignore` and commit the folder. It becomes a design record, deliberately.

**Default to throwing, and always ask.** The user owns this call. Offer it plainly when the decision is made: *"Keep the mocks as a record, or bin them?"*

---

## The gallery — declared, not built

The gallery is what makes this skill work. **A person compares far better than they evaluate.** Shown one design, they hedge; shown three, they point.

You do not build it. The harness's `gallery.html` renders whatever **`mocks.json`** declares — the one file you write:

```json
{
  "question": "Which world should the gift picker live in? Judge the feeling and the composition — every control is dead and all content is fake.",
  "honesty": [
    "The light is approximated — the real one is a physically-decomposed layered build.",
    "The scroll cinematic is shown as a single frame.",
    "The hero art is a placeholder; judge its size and weight, not the image."
  ],
  "variants": [
    { "file": "variants/lantern.html",  "name": "Lantern",  "pitch": "A dark room; each gift a light you carry toward someone." },
    { "file": "variants/tideline.html", "name": "Tideline", "pitch": "Gifts arrive like things left by the sea." }
  ],
  "viewports": [
    { "label": "Phone",   "width": 390,  "height": 844 },
    { "label": "Desktop", "width": 1280, "height": 800 }
  ]
}
```

Which gives you, unchanged in every review:

- **The question at the top** — what is being judged, in one line.
- **Every variant, side by side**, each under its concept name and one-line pitch.
- **Every viewport** — each mock laid out at its **true width** (a phone mock rendered at 390px, then scaled to fit the column — never a squashed desktop), because the Staging is mobile-first and a concept that only holds wide is not a concept.
- **The honesty note** — what is faked and what is real. Without it, the user rejects a concept for a placeholder's sins.
- **The comment bar** — comment mode across every variant at once, a live count, copy-to-clipboard, and clear.

---

## Showing it to the user

**Lead with images and a live page, never with a link to read.** The entire premise of this skill is that the user should not have to *read* to judge. A message that says "the mocks are at `docs/features/…/mocks/gallery.html`" has handed the work back to them.

1. **Screenshot every variant** — phone and desktop — with `bespunky-browser-automation:playwright`. Put the images directly in the message.
2. **Name each one** with its concept and one-line pitch, so the picture has a handle they can refer to.
3. **Open it — live if you can, async if you can't.** `bash mocks/serve.sh` (a random free port — `bespunky-workflow:local-server-isolation`). Best case, drive the **shared browser** (`bespunky-browser-automation:shared-browser`) so you and the user look at the *same* page and you narrate live. Otherwise send screenshots and the URL and let them open it themselves — the comments land in `comments.json` either way.
4. **Narrate the walkthrough** — what each concept is, what's faked, what you're asking them to judge — and tell them how to talk back: *press `c` and click anything to pin a comment to it; hover a purple pin to see what a faked thing is meant to be.*
5. **Ask one question:** *which one — and what would you change?* Not "does this look good?"
6. **Read their comments from `comments.json`** (or `window.allComments()` in the live gallery), repeat them back, and copy them **verbatim** into `DECISION.md`.

The harness, the intent notes, and reading comments from disk: `annotations-and-live-review.md` (and the asset itself at `assets/mock-harness/`).

---

## `DECISION.md` — the thing that survives

The mocks are evidence. The decision is the *conclusion*, and it must outlive them, because six months from now nobody wants three HTML files — they want to know what was chosen, and what was already ruled out and why (so it is not proposed again).

Write it as prose, short. It carries:

- **What was chosen** — the concept, by name, and the mock it corresponded to.
- **Why — in the user's own words.** *"The lantern one. The others feel like an app; this one feels like giving something."* The user's phrasing is the most valuable line in the file; it is the design's north star and it will settle a dozen later arguments.
- **What was rejected, and why.** The road not taken, with its reason — so it is not re-proposed, re-mocked, and re-rejected.
- **The corrections asked for.** *"Darker. Lose the second row. The hero is too big on the phone."* These feed the next iteration and the final Staging.
- **What was faked in the mock** and therefore still has to be *properly* designed and built by `realize-the-vision` — so nobody mistakes the shortcut for a decision.

Then the mocks can be deleted with no loss.
