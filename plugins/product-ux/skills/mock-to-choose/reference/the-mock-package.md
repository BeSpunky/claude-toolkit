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
      serve.py     · serve.sh      #     server (/comments + /version + /verdict endpoints) + launcher → gallery URL
      comments.json                #     written by the server as the user comments — read this
      verdict.json                 #     written when the user selects a concept — the DECISION (watched)
      versions.json · .versions/   #     round state + per-round HTML snapshots (both self-ignored by *)
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
- **A Compare wall** — every variant side by side, each under its concept name and one-line pitch, at a readable, honest scale, so the eye can pick. Click one to **Focus** it.
- **A Focus view** — one concept at its **true width** for the chosen viewport (a phone mock at a real 390px, a desktop mock at 1280px), where the pins are full-resolution and a comment lands on the exact pixel it was clicked. This is where commenting happens — never on a shrunk-down thumbnail, which is why *"this, here"* finally lands where the user meant.
- **A viewport toggle** (phone / desktop) that drives both views — the Staging is mobile-first, and a concept that only holds wide is not a concept.
- **The honesty note** — what is faked and what is real. Without it, the user rejects a concept for a placeholder's sins.
- **The comment gesture** — press `c`, click the exact spot, and a delightful in-place **composer** opens (a pulsing dot marks the point, `Enter` pins, `Esc` cancels — no native browser prompt).
- **The comment bar** — a draft / sent / handled tally, a **"Submit review (N)"** button (and an **auto-send** toggle, persisted in `localStorage`, to fire each comment on save), copy-to-clipboard, and clear. In the Focus **side-list**, each comment is managed in place — **edit** the text inline, **send** a single draft on its own (distinct from the batch Submit), **remove** with a 6-second **Undo** toast — and rows **link** to pins both ways (hover a row to light its pin, click to scroll to and flash it).
- **A review channel** — comments run `draft → submitted → handled`, carry full DOM context, and are read back as an inbox (`/state → pending`, `window.mockInbox()`, or `comments.json`); see SKILL.md → *Send it to Claude*. A handled pin **clears from the live mock** (which only shows the current round's open pins) and shows resolved — green ✓ + reply — in the side-list and the round's snapshot.
- **The verdict — a dedicated SELECT** (SKILL.md → *The verdict*). A **"Choose this concept"** button (in Focus, and a **Choose ✓** on every Compare card) with a confirm, plus **"None of these"** to reject all — the decision, not a comment. It persists to `verdict.json` (`{kind, choice, note, version, ts}`), is **watched** so Claude is notified when it lands (`window.mockVerdict()`, `GET /verdict`, `GET /state → verdict`), and shows as a green **✓ Chosen** ribbon/status across the wall, rail, and bar.
- **Rounds, history & evolution** — a mock iterates in internal rounds (v1 → v2 → …); Claude commits a round (`window.mockCommit(variant, note)`, `POST /version`) right before re-mocking, which snapshots the mock's HTML and stamps a note; `window.mockVersions()` (or `GET /versions`) reads the round state back. A version chip shows the current round; past rounds are viewable read-only (their snapshot + that round's comments) from the **History** list, and the concept's whole arc — each round's snapshot beside the feedback that drove the next — reads as an **Evolution** timeline (`#evolution/<variant>/<vp>`, `window.mockEvolution()`), the review's built-in record of *why the design moved*.
- **Hot reload** — edit a variant or `mocks.json` and every open gallery updates itself; no manual refresh, so you can re-mock while the user watches.
- **Deep links** — `gallery.html#focus/Lantern/Phone` reopens the exact state, a round suffix addresses history (`#focus/Lantern/Phone/v2`), and `#evolution/Lantern/Phone` opens the round-by-round timeline; the back button and a shared link both honour it, which is also how Claude drives the live page over CDP.

---

## Showing it to the user

**Lead with images and a live page, never with a link to read.** The entire premise of this skill is that the user should not have to *read* to judge. A message that says "the mocks are at `docs/features/…/mocks/gallery.html`" has handed the work back to them.

1. **Screenshot every variant** — phone and desktop — with `bespunky-browser-automation:playwright`. Put the images directly in the message.
2. **Name each one** with its concept and one-line pitch, so the picture has a handle they can refer to.
3. **Open it — live if you can, async if you can't.** `bash mocks/serve.sh` (a random free port — `bespunky-workflow:local-server-isolation`) prints the gallery URL. Best case, open that URL in the **shared browser** (`bespunky-browser-automation:shared-browser`) so you and the user look at the *same* page over the forwarded `:6080` (no random port for them to forward), and you drive it over CDP and narrate live. Otherwise send screenshots and the URL as a **clickable link** and let them open it themselves — the comments land in `comments.json` either way.
4. **Narrate the walkthrough** — what each concept is, what's faked, what you're asking them to judge — and tell them how to talk back: *open a concept, press `c`, click the exact spot to pin a comment; hover a purple pin to see what a faked thing is meant to be.*
5. **Ask one question:** *which one — and what would you change?* Not "does this look good?" And tell them how to answer it: **press "Choose this concept"** on the one they want (or **"None of these"** to send them all back) — a dedicated Select, not a comment; you're watching for it.
6. **Read their comments from `comments.json`** (or `window.allComments()` in the live gallery), repeat them back, and copy them **verbatim** into `DECISION.md`. As you re-mock, **check each one off** (`window.mockHandle(n, {reply})`) — the handled pin clears from the live mock and shows resolved with your reply in the side-list, so the user watches their notes get checked off.

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

The harness's **per-round history complements this**: each committed round carries a note, its own comments, and an HTML snapshot, so `versions.json` + `.versions/` are a built-in record of *what changed and why* across the iteration. But — like the rest of `mocks/` — the rounds and snapshots are **self-ignored by the `*` `.gitignore` and thrown away** with the folder unless deliberately kept. `DECISION.md` is the durable conclusion; the round history is disposable evidence.

Then the mocks can be deleted with no loss.
