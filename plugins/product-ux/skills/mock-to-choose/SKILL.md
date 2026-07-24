---
name: mock-to-choose
description: Put the concepts in front of the user's EYES so they can approve, reject, or course-correct in seconds — never by reading a long design document. Use the moment a design decision is waiting on a human: several concepts are on the table (from `stage-the-vision` or `envision-the-experience`) and someone must pick; a Staging needs sign-off before `realize-the-vision` spends real build effort; the user says "show me", "which one looks better", "I can't tell from the description", "mock it up", "let me see it first"; or a written vision is drawing shrugs instead of decisions. The one move — **build the CHEAPEST throwaway thing that makes the concept judgeable by eye, mock EVERY option on the table, and put them side by side.** A mock here is SHELL AND PRESENTATION ONLY: the layout, the composition, the palette, the type, the atmosphere — dressed with dummy records and stand-in graphics so it reads like a real screen — with **zero functionality** (dead controls, no state, no routing, no data, no build step, no dependencies, no app integration). Heavy visual concepts (a scroll-driven cinematic, a 3D scene, a generative background, a physical-light hero) are NOT fully rendered: they are **suggested with cheap stand-ins** — one representative frame, a still, a flat approximation — kept just vivid enough that the atmosphere is unmistakable, because the point is a fast verdict, not a faithful build. All variants share the SAME dummy content so the only difference the eye sees is the DESIGN. Every review runs on a shared HARNESS — a mini-app shipped with this skill (`assets/mock-harness/`: a Compare wall + a true-size Focus view + a random-port `serve.sh` that HOT-RELOADS on edit) that is copied verbatim into the mocks folder, so Claude authors ONLY `mocks.json` (the question, what's faked, the variants) and one file per concept, and EVERY mock experience is identical (same shell, same pins, same comment gesture, same read-back contract) while only the mocks change — never hand-roll a gallery, never edit the harness per project. Because a bare low-fidelity mock reads as low QUALITY, every mock carries an INTENT LAYER — floating notes and hover popovers (Claude marks elements with `data-note`; the harness renders numbered pins) that narrate the empty house the way an architect walks a site: *"the sofa goes here, sideways, facing the window"*, *"this dot is the light — it will float and breathe; here it's a static glow, so judge where it sits and how much of the frame it owns"* — so the user judges the INTENT, never the shortcut. And because feedback on a look is all *this* and *that*, the mocks support IN-PLACE COMMENTS: the user presses `c` and clicks the EXACT SPOT to pin a comment right where they point (not at some corner), captured with full DOM CONTEXT (tag, text, rect, styles, ancestor path) and written to `comments.json` ON DISK. Comments run a lifecycle draft → submitted → handled: the user SENDS them to Claude — a "Submit review" BATCH, or an AUTO-SEND toggle that fires each on save (a web page can't interrupt an idle Claude, so the "live" feel comes from Claude WATCHING the inbox — a watch **armed the moment the mock is served** (a persistent `Monitor` on the inbox that re-invokes Claude per submitted comment), NOT something the user must ask for and NOT the page pushing). Claude reads the inbox from a FILE (submitted-and-not-handled, exact words + element + point + variant + viewport + dom) — so an ASYNCHRONOUS review works as well as a co-driven one in the SHARED BROWSER (opened over the forwarded noVNC :6080 — no random port to hunt, Claude driving the live page over CDP) — CHECKS EACH OFF as it re-mocks (`window.mockHandle` / `PATCH /comments`, the handled pin VANISHES from the mock and shows resolved in the side-list, so the user WATCHES their notes get checked off via hot reload), routes them upstream, and copies them VERBATIM into `DECISION.md`. The mock ITERATES IN ROUNDS (v1 → v2 …): comments are version-bound, each committed round is snapshotted (past versions viewable read-only, and the whole arc readable as an EVOLUTION timeline — each round's snapshot beside the feedback that drove the next), and the live mock only ever shows the CURRENT round's OPEN pins. The verdict is a DEDICATED SELECT — a real GATE, not a comment and not a poll: the user CHOOSES a concept with a "Choose this concept" button (in Focus, and on every Compare card), confirmed, or rejects all with "None of these" — written to `verdict.json` ON DISK and WATCHED (like the comment inbox), so Claude is NOTIFIED when the decision lands and proceeds (build the chosen concept, or reconceive on none) rather than guessing a decision out of a passing comment. "None of these" and "a hybrid of A and B" are first-class outcomes (route upstream to re-conceive), and a mock YES is PROVISIONAL — it picks a direction, it does not certify the finished art (`realize-the-vision` still owes the outside-eye pass on the real, rendered result). Mocks live inside the effort's **feature package** (`bespunky-workflow:feature-package` — `docs/features/<YYYY-MM-DD>-<slug>/mocks/`, the slug shared with the git branch), **self-ignoring and completely throwable** — nothing outside may depend on them, one command erases every trace, and the user may instead choose to keep any of it as a design record; the DECISION is recorded durably in the package (`DECISION.md`) even when the evidence is thrown away. Feedback from a mock goes UPSTREAM (re-conceive in `stage-the-vision`) and the mock is re-made cheaply — it is never polished into a prototype, and its code NEVER becomes the build (`realize-the-vision` builds fresh from the confirmed Staging). The decision instrument of the experience-design quartet — `distill-the-brief` → `envision-the-experience` → `stage-the-vision` → **`mock-to-choose`** → `realize-the-vision` (problem → feeling → art → *verdict* → build). An expression of `bespunky-engineering:architect-mentality` (*work smart, not hard*; *know when not to build*; *design for the consumer* — the user judges by eye) and `bespunky-engineering:architecture-first` (confirm the design before you build it).
---

# Mock to Choose

A written vision is a promise. Nobody can approve a promise.

Hand someone three paragraphs describing three concepts and you get a shrug, a hedge, or a polite "sounds good" that means nothing — because *reading* is the wrong instrument for judging a *look*. Show them the same three concepts as three screens they can flick between, and the verdict arrives in seconds, with a real reason attached: *that one. The middle one feels cold. Can the first one be darker?*

That is this skill. It is not a design stage — it invents nothing. **It is the decision instrument**: the cheapest possible artifact that turns a design question into a human answer, fast, so the expensive stage (`realize-the-vision`) is only ever spent on a concept a human actually chose.

The mock is **evidence, not product**. It exists to be looked at, argued with, and thrown away.

---

## The one move: build the cheapest thing that can be judged by eye — and mock *every* option

Everything reduces to one act. **Take the concepts on the table, render each as a throwaway shell you can look at, put them side by side, and ask the human to point.**

Three disciplines make it work, and each is a way of *not* doing work:

1. **Cheapest thing that can be judged.** The mock's only job is to carry the verdict. Every minute spent past that is stolen from the build. If a concept is judgeable from a static screen, it does not get an animation. If a still frame conveys the atmosphere, it does not get a scroll timeline.
2. **Every option, not the favourite.** A single mock asks "is this OK?" — a weak question that invites a weak yes. Several mocks ask "**which one?**" — and a person choosing *between* things is a person telling you what they actually want. If `stage-the-vision` generated three bold concepts, **mock all three**, or the exploration was theatre.
3. **Same content everywhere.** All variants show the same dummy records, the same names, the same numbers, the same photos. Change the content between variants and the user is judging the copy, not the design. **Vary one thing: the design.**

The bar is not "beautiful". The bar is: **could a person look at this for five seconds and know whether they want it?** If yes, stop building.

---

## What a mock IS — and what it is emphatically not

A mock is **the shell and the presentation**:

- The **layout and composition** — where things sit, what dominates, the depth, the rhythm, the negative space.
- The **surface** — palette, type, material, light, ornament: the visual system made visible.
- The **atmosphere** — enough of the concept's *feeling* that you can tell it apart from another concept at a glance.
- **Dummy content that reads like real life** — records, names, avatars, prices, dates, an inbox with plausible messages, a chart with plausible bars. Fake data with *real texture*, so the screen reads as a screen and not a wireframe. (Lorem ipsum and grey boxes destroy the mock's whole purpose: you cannot judge a design nobody can read.)

A mock has **no functionality — at all**:

| Not in a mock | Why |
| --- | --- |
| Working buttons, forms, validation, submits | Dead controls. Clicking does nothing, and that is fine — the user is judging the look, not the flow. |
| State, stores, signals, reactivity | There is nothing to react to. |
| Routing, navigation, multi-screen flows | If a second screen matters to the verdict, it is a *second mock file*, not a router. |
| Real data, APIs, fetches, auth | Dummy records, hard-coded, in the file. |
| A build step, a framework, dependencies, `npm install` | A mock that needs a toolchain is not cheap. Static HTML + CSS on the harness, served by a one-line script. |
| Integration into the app (a route, a component, an import) | The mock never touches the product. It lives in its own package and leaves no trace. |
| Tests, accessibility passes, responsiveness beyond the two views, performance work | All of it belongs to `realize`. Doing it here is doing the build twice. |

> **The seduction to refuse:** a mock that looks good invites "just make the button work / just wire this one thing / just clean this up." That is a prototype growing out of a decision instrument, and it will cost you the build twice over. **The mock stops the moment it can be judged.**

**The one exception — and it is not part of the product.** Every mock carries the **annotation kit**: a small inline `<style>` + `<script>` that renders the intent pins and collects the user's comments (below). It is the *only* script in a mock, it belongs to the *reviewing* of the mock rather than to the design being shown, and it is thrown away with it. Everything else stays dead.

---

## The fidelity dial — suggest the heavy thing, never render it

The Staging's most valuable moments are usually the *expensive* ones: a cinematic scroll where the room warms from dusk to dawn, a 3D scene you look into, a generative living background, a hero lit by physically-decomposed warm light. Rendering those for real is `realize`'s job and takes hours. Skipping them entirely is worse — strip a concept of its atmosphere and the user is judging a stripped concept, and will reject the wrong thing.

So neither. **Suggest it.** Turn every heavy concept into the cheapest stand-in that still makes the atmosphere *unmistakable*:

- A **scroll-driven cinematic** → its **single most striking frame**, rendered still. (If the *change* is the point, two frames side by side, or a stack of "here, then here".)
- A **3D / spatial scene** → a flat composition with layered planes, perspective faked by scale and blur — or a single generated/sourced still of the scene.
- A **generative, living background** → one static snapshot of it, or a CSS approximation of its texture and colour field.
- A **complex physical light model** → a good-enough layered approximation, or a sourced photograph with the right light. (The *build* refuses the lone gradient; the *mock* is allowed the shortcut, because the mock is not the build — it just has to *read* as that light.)
- **Choreographed motion** → mostly cut. If a motion *is* the concept (the thing being judged), give it one crude CSS animation and nothing else. Otherwise: still.
- **Real illustration / photography / a character** → a stand-in with the right mood, size, and place in the composition (a sourced placeholder image, a silhouette, a block of the right colour and shape). It marks *where the art goes and what weight it carries*.

The dial has two failure ends, and both are cheap to spot:

- **Over-rendered** — you are building the animation, tuning the shader, sourcing the real asset. You have started the build without a decision. **Stop and ship the mock.**
- **Under-rendered** — every concept has collapsed into the same grey wireframe, the atmosphere is gone, and the user cannot tell the three apart. **The one thing you would screenshot must be visible in the mock**, or you are asking for a verdict on nothing. Cut everything else before you cut the concept.

Depth and worked examples: `reference/cheap-stand-ins.md`.

---

## Narrate the empty house — the intent layer

A mock is a house with no furniture. Walk someone through it in silence and they judge the empty rooms — the bare bulb, the grey rectangle where the art goes, the static dot standing in for a light that should breathe — and they reject a concept that was never actually shown to them.

So do what an architect does on site: **talk over the walkthrough.** *"The sofa goes here, sideways, facing the window."* *"This dot is the light — it'll float and breathe; right now it's just a dot."* Every shortcut you took on the fidelity dial gets a sentence saying **what it stands for**, so the viewer judges the **intent** rather than the shortcut.

In a mock, that narration is **built in** — floating notes and hover popovers, pinned to the elements they explain:

- Claude marks any element with **`data-note="…"`**; a small kit (one inline `<style>` + `<script>`, no deps) renders a numbered pin on it, and hovering or focusing the pin shows the intent.
- A good note **names what the cheap thing will become, and what to judge now** — *"The lantern: in the real thing it drifts and dims as you scroll; here it's a static glow, so judge where it sits and how much of the frame it owns."* A note that just says *"Hero section"* is a label, and labels explain away nothing.
- The concept's **one screenshot-worthy thing always gets a note.** If a viewer can only understand one fake, it's that one.
- The gallery header carries the **global honesty note** (*"light is approximated; the cinematic is one frame; the art is a placeholder"*) — the pins say it per-element, the header says it up front.

Without this layer, low fidelity reads as **low quality**, and the user rejects the shortcut instead of judging the design. The notes are what make a cheap mock *honest* rather than merely cheap.

---

## Let them point — comments in place, read from a file

Feedback on a look is **deictic**: it is all *this*, *that*, *here*. Received as prose after the fact — *"the big one felt off and the second thing is too much"* — half of it is unlocatable, and you re-mock the wrong element.

So the user comments **where they are pointing**, and the server writes each comment to `comments.json` on disk — which Claude reads back **as a file**, not out of a live browser. That one property is what makes the layer robust:

1. **Serve the mocks** — `bash mocks/serve.sh` (a random free port, never the project's default — `bespunky-workflow:local-server-isolation`). The server hosts the gallery, a `/comments` endpoint, and a hot-reload stream.
2. **Get it in front of the user.** Best case, **co-drive** it in the **shared browser** (`bespunky-browser-automation:shared-browser`): open the gallery URL *inside* the container's browser, and the user watches and clicks in a host tab over the already-forwarded **noVNC `:6080`** — so there is **no random port for them to hunt or forward**, and you narrate out loud while driving the live page over CDP (`window.mockGoto`, `mockViewport`). You are the architect standing in the empty room, not a link in a chat. Co-driving is an *upgrade, not a requirement*: if there is no shared browser, hand them the URL as a **clickable link** and screenshots. Either way the comments land in the same file.
3. **They open a concept (Focus) and click the exact spot.** Press `c`, click where they mean — the pin lands **on that pixel**, not at some corner. The server records the exact words, the element (a stable selector), the fractional position within it, the variant, and the viewport width — to `comments.json`.
4. **Claude reads `comments.json`** (or `window.allComments()` in the live gallery) — so *"too big"* is never ambiguous again: you know **which** thing, on **which** concept, at **which** width, at **which** point. Because it's a file, it survives a server restart, a closed tab, and a review that happened while you were away.
5. **Read them back to the user**, then route them **upstream** (`stage-the-vision` to re-conceive, `envision-the-experience` if the feeling itself was wrong) and re-mock cheaply. A comment is feedback on the *design*, never a bug in the mock's CSS.
6. **Check each one off as you address it** — `PATCH /comments {n, handled, reply}` (or `window.mockHandle`). The pin **vanishes from the mock** (handled notes never clutter it — see *Rounds*, below), and the comment shows **resolved** — a green ✓ with your one-line reply — in the Focus side-list and in the round's history. Because the edit hot-reloads, the user *watches* their notes get checked off, live. This is the iterative loop the old harness lacked: comment → re-mock → checked, visibly, without a single manual refresh.
7. **Copy the verbatim comments into `DECISION.md`.** `comments.json` lives in the throwaway `mocks/` folder and dies with it — the user's own words are the most valuable thing the whole session produced, so they must be promoted to the durable record.

> **A comment pinned to a pixel beats a paragraph written from memory.** That is why this layer writes to a file instead of hoping a chat reply remembers which pixel.

The intent-note craft, the live-review flow, and reading the comments: `reference/annotations-and-live-review.md`.

---

## Send it to Claude — the review channel

Reading `comments.json` when the user *asks* is fine for an async review. But the user often wants the GitHub feel: **pin, submit, and have Claude respond** — either a batch when they're ready, or each note the moment they save it. The harness supports both, with one honest constraint stated plainly.

**A comment has a lifecycle: `draft → submitted → handled`.**

- **draft** — pinned, hollow, not yet sent (the user is still collecting).
- **submitted** — sent to Claude: a solid orange pin. **Auto-send is ON by default** — each comment submits the instant it's pinned (live). Unchecking auto-send switches to batch: comments stay drafts until the user hits **"Submit review (N)"**. The toggle persists in `localStorage` (per-browser, survives a reload), not per-session.
- **handled** — Claude addressed it: its pin **disappears from the live mock** (declutter — see *Rounds*), and it shows resolved (green ✓ + reply) in the Focus side-list and in the round's history.

Each comment carries a **`dom` blob** — the clicked element's tag, id, classes, a text snippet, its `getBoundingClientRect`, key computed styles, and its ancestor path — so Claude receives **full context**, not just the words: *what* was clicked, what it said, where and how big it was, how it was styled.

**How Claude receives it — the honest part, and how you resolve it.** A web page **cannot interrupt an idle Claude**; nothing (not a socket, a hook, or an MCP server) injects a turn into a session that's sitting waiting. So the page never *pushes* — the "live" feel comes from Claude **watching the inbox**. The mistake to refuse is treating that watch as something the user must ask for: **a mock you served is a mock you are reviewing, so you arm the watch the instant you serve it, by default.**

- **Arm the watch on launch (default — do this every time).** Right after `serve.sh`, start a **persistent `Monitor`** on the mocks folder: it polls `comments.json` and `verdict.json` and emits an event for each newly *submitted*-and-not-handled comment **and when the verdict lands** — re-invoking you with it. Now the review is live *by construction* — the user pins, submits (or flips auto-send), and finally **chooses a concept**, and each of those arrives in your turn on its own, with **no "go" and no ping**. That is the GitHub feel, and it costs ~nothing while idle (the harness watches; you are only woken on a real event).

  ```bash
  # Monitor command — persistent: true. One event per newly submitted comment, plus the VERDICT when it lands.
  D=docs/features/<YYYY-MM-DD>-<slug>/mocks; seen=""; lastv=""
  while true; do
    # n and variant FIRST, text last with newlines/tabs stripped — so a multi-line comment stays one record.
    while IFS=$'\t' read -r n variant text; do
      [ -z "$n" ] && continue
      case " $seen " in *" $n "*) ;; *) seen="$seen $n"; echo "comment #$n on $variant: $text";; esac
    done < <(jq -r '.[]|select(.status=="submitted" and (.handled|not))|"\(.n)\t\(.variant)\t\(.text|gsub("[\n\r\t]";" "))"' "$D/comments.json" 2>/dev/null)
    # the DECISION — signature includes version + ts, so re-choosing the SAME concept on a new round still fires.
    v=$(jq -rc '. // empty | "\(.kind) \(.choice // "-") v\(.version // "-") @\(.ts)"' "$D/verdict.json" 2>/dev/null)
    if [ "$v" != "$lastv" ]; then lastv="$v"; [ -n "$v" ] && echo "VERDICT: $v"; fi
    sleep 1
  done
  ```

  A **comment** event is your cue to read the full payload (`GET /state` → `pending`, with the `dom` context), re-mock upstream, and **check it off** (`window.mockHandle(n, {reply})` or `PATCH /comments`) — the handled pin clears from the mock and its ✓ + reply lands in the side-list, live. A **VERDICT** event is the gate opening: read it (`GET /verdict`, `GET /state` → `verdict`, or `window.mockVerdict()`), record `DECISION.md`, and **proceed** — a `chosen` verdict licenses `realize-the-vision` to build that concept (fresh from the Staging; a mock yes is provisional), a `none` verdict routes upstream to reconceive. (No `Monitor` in your harness? A self-paced `/loop` on the folder does the same job, at the cost of some idle tokens.)

- **Read on demand (the fallback, not the default).** If no watch is running — a genuinely *asynchronous* review the user does while you're away, or after you deliberately stopped the Monitor — the payload just waits on disk. When they say *"go"* (or you pick the review back up), read the inbox in one shot and act:

  ```bash
  curl -s http://127.0.0.1:<port>/state | jq '{pending, verdict}'   # the inbox AND the decision, in one read
  # or straight off disk:  jq '[.[] | select(.status=="submitted" and (.handled|not))]' mocks/comments.json
  #                        cat mocks/verdict.json          # the decision (null until the user chooses)
  # or over CDP in the live gallery:  window.mockInbox()   ·  window.mockVerdict()
  ```

Either way, the harness stays a plain static-file + HTTP-server tool — no framework, no MCP, no experimental flags. The channels are two files and a status field (`comments.json` for feedback, `verdict.json` for the decision); the watch is a `Monitor` you arm on launch, not a daemon baked into the mock.

---

## The verdict — selecting a concept is the GATE, not a comment

A comment is feedback on a *detail*. The **verdict** is the whole point of the review: *this is the direction — build it.* Making the user express that by typing a comment ("I guess the first one?") throws away the one act the entire skill exists to capture, and leaves you guessing whether a passing remark was actually the decision. So selecting a concept is a **dedicated, first-class feature of the harness** — its own button, its own file, its own watch — deliberately separate from commenting.

**How the user casts it.** On every concept there is a **"Choose this concept"** action — the primary button in the bottom bar while a concept is in Focus, and a **Choose ✓** on each card in the Compare wall (so a verdict can be cast from the wall or from a close look). Choosing opens a small **confirm** ("Proceed with Lantern? Claude will build this direction — a mock yes is provisional…"), because the gate should never trip on an accidental click. Because the gate can only say yes if it can also say no, the bar also carries **"None of these"** (reject all → reconceive upstream), and the chosen concept is un-choosable and switchable. The decision is legible everywhere — a green **✓ Chosen** ribbon on the Compare card, a marker on the rail, and a status line in the bar (**✓ Chosen: Lantern · v2**).

**How you receive it.** The server writes the decision to **`verdict.json`** — `{kind: 'chosen'|'none', choice, note, version, ts}` — and your launch-time watch emits a **VERDICT** event when it lands (above). Read it back from `verdict.json`, `GET /verdict`, `GET /state → verdict`, or `window.mockVerdict()`. Then **act on the gate**:

- **`chosen`** → record `DECISION.md` (what was chosen, the round, what was faked and still owed), then hand the concept to `realize-the-vision` to build **fresh from the Staging**. The verdict names the version the user approved, so `DECISION.md` is exact. Remember a mock yes is *provisional* (it licenses the build, not the finished art).
- **`none`** → route **upstream** to reconceive (`stage-the-vision`, or `envision-the-experience` if the *feeling* was wrong) and produce fresh cheap mocks. Reject-all is a first-class outcome, not a failure.

The verdict is version-stamped and re-castable: if the user chooses, then keeps commenting and you re-mock, they can re-choose the newer round. It is **not** a comment, never lands in `comments.json`, and never clutters the mock with a pin.

---

## Rounds — the mock iterates, and comments are version-bound

A real review is not one pass; it is *rounds*. The user comments, you re-mock, they comment on the new version, and so on. If every handled pin stayed on the mock, it would silt up into a field of dots; and if there were no record of what each version looked like and why it changed, the most valuable thing the review produced — the *trail* — would be lost. So the harness models the round as a first-class thing.

**A concept iterates in internal rounds: `v1 → v2 → v3…`** — a *mocking-process* version, not an app version. A **version chip** in Focus shows the current round.

- **Comments are version-bound.** The server stamps every comment with the round it was made against (`version`). The live mock shows **only the current round's OPEN pins** — so a handled comment's pin **vanishes** (declutter), and a past round's comments never appear on the current mock. (Their resolution still shows in the side-list and in that round's history.)
- **Committing a round snapshots the mock.** Right *before* you re-mock, commit the round — `window.mockCommit(variant, note)` or `POST /version {variant, note}`. The server freezes the current mock's HTML to `.versions/<variant>__v<n>.html` and bumps the round. Commit *before* editing, so the snapshot captures exactly what the user reviewed. A round is one deliberate re-mock — **not** every keystroke, or the history turns to noise.
- **History — the compact index.** The Focus side-list carries a **History** section: every committed round as a `vN · N comments · note` link. Click one to reopen that round's **actual snapshot** (read-only), with that round's comments and your replies shown against it. It's the quick way back to *"what did v2 look like, and what did they say about it?"* — deep-linked as `#focus/<variant>/<vp>/v2`, honoured by the back button and a shared link.
- **Evolution — the whole arc, as a filmstrip.** History's **"See the evolution →"** opens the **Evolution** view (`#evolution/<variant>/<vp>`, or `window.mockEvolution(name)`): one concept's entire life laid out left-to-right — `v1 → v2 → … → current` — each round a snapshot thumbnail with, beneath it, the **note** for what changed and the **feedback that round drew** (its comments, each with its status pill). Between the frames sit arrows that read *"the feedback on the left drove the version on the right,"* so the strip is a legible **narrative of why the design moved**, not just a stack of versions. Every frame is clickable → opens that round full-size in Focus (the current one live, a past one as its snapshot). It needs at least two rounds to be worth showing; before that it says so and fills in as you re-mock. This is the review's built-in answer to *"how did we get here?"* — the visual complement to `DECISION.md`'s written conclusion, and the thing that makes the iteration *readable* by anyone who wasn't in the room.
- **The rounds ARE a built-in record.** Each round has a note, its comments, your replies, and an HTML snapshot — a chronological account of what changed and why. That complements `DECISION.md` (write the *conclusion* there in the user's words); the rounds hold the *evidence of the iteration*. Like everything in `mocks/`, they self-ignore and are thrown unless the user deliberately keeps them.

> **Handled ≠ green-on-the-mock.** The single most common stale mental model: a handled pin does *not* turn green in place on the live mock — it **disappears** from it. The green ✓ and your reply live in the **side-list** and the round's **history snapshot**. The mock stays a mock.

---

## The harness — every review is the same; only the mocks change

None of the above is hand-built each time. A review that is re-invented per feature is re-invented *badly*: the pins look different, the comment gesture moves, the gallery is laid out fresh, and the user has to re-learn how to look at their own design. So the review is a **harness** — a small mini-app that ships with this skill at `assets/mock-harness/` and is **copied verbatim** into the package's `mocks/` folder.

```text
assets/mock-harness/        →  copied into  docs/features/<date>-<slug>/mocks/
  gallery.html · gallery.js   # the shell — Compare wall + Focus view, viewport toggle, rounds, deep-linked
  review.css   · review.js    # intent pins, clamped popovers, the comment composer (pins land where you click)
  serve.py  · serve.sh        # random-port server: /comments + /version + /verdict + hot-reload SSE; prints the URL
  mocks.json                  # ← Claude writes: the question, what's faked, the variants
  variants/_template.html     # ← Claude copies per concept: 2 harness lines + the mock
  (comments.json)             #    written by the server as the user comments — read this (the inbox)
  (verdict.json)              #    written when the user selects a concept — the DECISION (watched)
  (versions.json · .versions/)#    round state + per-round HTML snapshots — written on commit
  (.gitignore = "*")          #    the server writes it on first run — mocks never reach git
```

**Claude authors exactly two things: `mocks.json` and one file per concept.** Everything else is fixed — so every mock review has the **same shell, the same pins, the same comment gesture, the same read-back contract**, and the only thing that changes between reviews is the design being judged. The user learns the review *once*.

The harness gives you, for free, the things a hand-rolled mock always forgets:

- **Two instruments, not one squashed grid.** A **Compare** wall (every concept side by side at a readable, honest scale — because a person compares far better than they evaluate) and a **Focus** view (one concept at its **true** size, where the pins are full-resolution and a comment lands on the exact pixel it was clicked). Commenting happens in Focus, never on a thumbnail — which is why *"this, here"* finally lands where the user pointed. A **viewport toggle** (phone / desktop) drives both, instead of rendering every combination squished at once.
- **The question and the honesty note up front**, and **intent pins** whose popovers **flip and clamp** so they never slide off the frame.
- **Comments persisted to disk** (`comments.json`) with the **exact click coordinate** — so you read them by reading a file (`window.allComments()` in the live gallery, or `comments.json` straight off disk), and an **asynchronous** review works exactly as well as a co-driven one.
- **Hot reload.** The server watches the folder; when you edit a variant or `mocks.json`, every open gallery updates itself — the user never hits refresh, and you can re-mock while they watch (like a dev server, with no build, no framework, no `node_modules`).
- **A delightful composer, not a native prompt.** Press `c`, click the exact spot, and an in-place dialog opens — a pulsing dot marks the point, `Enter` pins, `Esc` cancels.
- **Handled state + declutter.** Check a comment off — `PATCH /comments {n, text?, status?, handled?, reply?}` (or `window.mockHandle(n, {reply})`). Its pin **vanishes from the mock** (handled notes never clutter it) and the comment shows resolved (green ✓ + your one-line reply) in the side-list, live — so the user *watches their notes get checked off* instead of wondering if you heard them.
- **In-place comment management.** In the Focus side-list: **edit** a comment inline, **send** a single draft on its own, **remove** with a 6-second **Undo**, and **row↔pin linking** — hover a row to light its pin, click to scroll to and flash it (recognition, not recall).
- **Rounds, history & evolution** (see *Rounds*, above) — the mock iterates `v1 → v2…`, comments are version-bound, each committed round is snapshotted; past rounds are viewable read-only from the **History** list, and the whole arc reads as an **Evolution** timeline (`#evolution/…`, `window.mockEvolution()`) — each round's snapshot beside the feedback that drove the next.
- **The verdict — a first-class SELECT** (see *The verdict*, above). A **"Choose this concept"** button (in Focus, and a **Choose ✓** on every Compare card) with a confirm, plus **"None of these"**; the decision persists to `verdict.json`, is watched, and shows as a **✓ Chosen** ribbon/status. Not a comment — the review's gate.
- **A drive + read API** so Claude steers the live page over CDP: `window.mockGoto(name)`, `mockViewport('Phone')`, `mockCompare()`, `mockEvolution(name)`, `mockState()`, `mockCommit(variant, note)`, `mockVersions()`, `mockInbox()`, `mockVerdict()`, and deep-link URLs (`#focus/Lantern/Phone`, `#focus/Lantern/Phone/v2`, `#evolution/Lantern/Phone`) the back button and a shared link both honour.

**Never edit the harness per project** (it is harness, not mock — a fix belongs upstream in this skill's asset), and never hand-write the kit into a variant. A variant's whole contract with the harness is two lines in its `<head>`:

```html
<link rel="stylesheet" href="../review.css">
<script src="../review.js" defer></script>
```

(`architect-mentality` — *automate every repeated process; never do the same thing by hand twice*.)

---

## Where the mocks live — inside the feature's package

Mocks are throwaway, but throwaway things still need a **home**, or they end up scattered across the repo and mixed between features. They go where everything else about this effort goes: **the feature package** (`bespunky-workflow:feature-package`) — one effort, one slug, one folder, dated. Never a shared `mocks/` blob that eventually mixes three features and nobody dares delete.

```text
docs/features/2026-07-14-gift-picker/   # the feature package — slug matches branch feat/gift-picker
  STAGING.md                            # the concepts these mocks are testing
  DECISION.md                           # durable: what was chosen, why, what was rejected  ← survives the throw
  mocks/                                # the harness (copied verbatim) + what Claude authors
    gallery.html · gallery.js           #   the shell — never edited
    review.css   · review.js            #   the review layer — never edited
    serve.py     · serve.sh             #   the server — never edited
    mocks.json                          #   ← authored: the question, what's faked, the variants
    variants/lantern.html · tideline.html   # ← authored: one file per concept
    comments.json                       #   written by the server as the user comments (the inbox)
    versions.json · .versions/          #   round state + per-round HTML snapshots (written on commit)
    .gitignore                          #   "*" — written on first serve; git never sees this folder
```

The rules that make it work:

- **Static, dependency-free.** The harness plus one HTML file per variant, served by `serve.sh` — no packages, no build, no toolchain. A variant's only imports are the two harness lines.
- **A gallery, not a pile.** `gallery.html` shows every variant *together* in the **Compare** wall — that is the whole point (a person compares far better than they evaluate). A **phone / desktop toggle** switches the whole wall between widths (and **Focus** shows one concept at its true size), because the Staging is mobile-first and a concept that only works wide is not a concept that works.
- **Throwable, by default invisible.** `mocks/.gitignore` contains `*` (the server writes it on first run) — the folder ignores itself, so mocks never pollute a diff, a PR, or the app's build. `rm -rf docs/features/2026-07-14-gift-picker/mocks` erases every trace, and nothing anywhere breaks. **Nothing outside the mocks folder may ever depend on it** — no route, no import, no shared asset, no config entry. That is what makes it *completely* throwable. (The package's rule: *the conclusion is durable, the evidence is disposable*.)
- **Keepable, by choice.** If the user wants a mock kept as a design record, they say so and it is promoted deliberately: `git add -f` the files you keep (the folder self-ignores, so keeping is always an explicit act). The default is throwaway; the exception is deliberate.
- **The decision outlives the evidence.** When the user picks, write `DECISION.md`: which concept won, in the user's words *why*, what was rejected and why, what corrections they asked for. **Record the conclusion, throw the evidence.** Six months later nobody wants a folder of throwaway mocks — they want to know what was chosen and what was already ruled out.

Full layout, the gallery pattern, and how to show the mocks to the user: `reference/the-mock-package.md`. The package convention itself (the slug shared with the branch, what else lives in it, born-with-the-worktree, conclusion-vs-evidence): `bespunky-workflow:feature-package`.

---

## How to run it

1. **Get the options on the table.** Take the concepts as they exist — the Staging's bold concepts, the Visions, the two layouts someone is torn between. If there is genuinely only one concept, mocking it is still worth it (approval before build), but ask first whether a single option is really a choice: *one mock invites a shrug; three invite a verdict.*
2. **Name what is actually being judged.** *Which world feels right? Is the hero too much? Does the dark palette work?* This sets the fidelity dial — everything that does not serve *this question* gets stripped or stubbed. Write it at the top of the gallery so the user knows what they are being asked.
3. **Copy the harness** into the package's `mocks/` folder (`assets/mock-harness/` → `docs/features/<date>-<slug>/mocks/`). You never build the gallery, the pins, or the comment layer — they are the same in every review.
4. **Fix the dummy content once — shared across all variants.** One cast of records, names, numbers, images. Plausible, real-textured, and *identical everywhere*, so the eye compares designs and nothing else.
5. **Mock every option, fast.** Copy `variants/_template.html` per concept: two harness lines, then pure mock. Shell and presentation. Dead controls. Heavy concepts suggested with stand-ins. Time-box it — if a variant is taking long, you are over-rendering; cut fidelity, not the concept.
6. **Annotate the intent.** Put a `data-note` on every shortcut you took — what the cheap thing stands for, and what to judge *now*. Silence makes low fidelity read as low quality.
7. **Write `mocks.json`** — the question being asked, the honesty list (what's faked), and each variant with its concept name and one-line pitch. The gallery renders itself from this.
8. **Show it — live and narrated, never as a link to read.** `bash mocks/serve.sh` (a random free port — `bespunky-workflow:local-server-isolation`) prints the gallery URL on its first line. **The instant it's serving, arm the inbox watch** — a persistent `Monitor` on `comments.json` (see *Send it to Claude* for the command) — so every comment the user submits reaches you live, with no "go" and no ping. Serving without arming the watch leaves the user submitting into silence; arming it is part of launching, not an extra the user requests. **Prefer the shared browser** (`bespunky-browser-automation:shared-browser`): open that URL *inside* the container's browser and the user watches over the forwarded **`:6080`** — no port for them to hunt or forward — while you drive the live page over CDP (`window.mockGoto`, `mockViewport`) and narrate out loud. If there is no shared browser, hand them the URL as a **clickable markdown link** and screenshots (`bespunky-browser-automation:playwright`). Either way: lead with images, walk them from the **Compare** wall into **Focus** on a concept, tell them to press `c` and **click the exact spot**, and ask: **which one — and what would you change?** — *with "none of these" always on the table* (next step).
9. **Take the verdict — a dedicated SELECT, including "none of these".** The user casts the decision with the **"Choose this concept"** button (or **Choose ✓** on a Compare card), confirms it, and it lands in `verdict.json` — your watch fires a **VERDICT** event, or read it any time (`window.mockVerdict()`, `GET /verdict`, `GET /state → verdict`). They may pick one, ask for a hybrid ("A's hero, B's palette"), or hit **"None of these"** and reject them all. **Reject-all and hybrid are first-class outcomes, not failures** — this is the outside-eye taste gate, and a gate that can only say yes is not a gate. A rejection or a correction routes **upstream** — it is a message for the *design*, not the mock's CSS — to `stage-the-vision` (re-conceive, or re-synthesize a hybrid into one concept) or `envision-the-experience` (the feeling was wrong), and you produce fresh cheap mocks. As you address each comment, **check it off** (`window.mockHandle(n, {reply})` or `PATCH /comments`) — its pin **clears from the mock** (handled pins never clutter it) and it shows resolved in the side-list; because the folder hot-reloads, the user watches their notes get checked off without a refresh. **Iterate by re-mocking, never by polishing.**
10. **Record the decision, then throw the mocks.** Write `DECISION.md` — what was chosen (or that all were rejected), in the user's own words *why*, and what was ruled out. Offer the user the choice to keep or discard the mock folder — default discard. Hand the *chosen* concept to `realize-the-vision`, which builds it **fresh from the Staging** — never from the mock's code — carrying forward the note that **a mock yes is provisional** (next section).

---

## The mock is not the build

The single most expensive mistake this skill can cause: someone looks at a good-looking mock and says *"it's basically done — just use that as the starting point."*

It is not done, and it must not be the starting point. The mock is a **fake**: hard-coded content, dead controls, a hand-waved approximation where the real light model goes, no architecture, no accessibility, no responsiveness, no state, no tests. Every property that makes it *cheap* is a property that makes it *wrong to ship*. Adopting mock code as the build's skeleton imports all of that debt into the product and quietly skips `realize-the-vision`'s entire job (researching the truest means, engineering each moment, rendering the physical decomposition faithfully).

**The mock's output is a decision. Its code is trash by design.** `realize` reads the confirmed Staging and builds clean. (`architect-mentality` — *know when not to build*; `architecture-first` — the design is confirmed, *then* built properly, never patched forward from a prop.)

---

## A mock "yes" is provisional — it licenses the build, not the moment

Everything expensive is invisible in a mock *by design*: the cinematic is one frame, the light is faked, the motion is cut, the hero art is a placeholder. So a mock can honestly return a **no** — if a concept looks wrong cheap, it will look wrong expensive — but it **cannot honestly return a final yes**, because the user approved a concept whose defining moments they never actually saw.

So a mock verdict **chooses a direction; it does not certify the art.** It licenses `realize-the-vision` to *build that concept* — it does not discharge `realize`'s own outside-eye pass on the real, rendered thing (the drifting light, the running cinematic, the sourced art). The mock says *"this world, not that one."* Whether the built world actually lands is judged again, on the real thing, by an outside eye — never self-certified, and never assumed from the mock's approval. `DECISION.md` names what was faked precisely so `realize` knows what it still owes.

This is the honest reading of `stage-the-vision`'s "judged by an outside eye, confirmed *before* the high-fidelity build": the mock is that low-fidelity confirmation, and it is a *gate on direction*, not a substitute for judging the finished art.

---

## Reference library

| Cluster | Reference | Covers |
| --- | --- | --- |
| **Cheap stand-ins** | `reference/cheap-stand-ins.md` | the fidelity dial in practice — faking a cinematic, a 3D scene, a generative background, physical light, motion, and real art; dummy content that reads like life; what to cut first and what may never be cut |
| **The harness (asset)** | `assets/mock-harness/` | the mini-app itself — gallery + review layer + `serve.sh`, copied verbatim into every mock package; Claude writes only `mocks.json` and the variant files |
| **Annotations & live review** | `reference/annotations-and-live-review.md` | how to write an intent note that names what the cheap thing stands for; running the review (co-driven in the shared browser *or* asynchronously), and reading the user's comments back from `comments.json` on disk |
| **The mock package** | `reference/the-mock-package.md` | the dated feature package, the self-ignoring mocks folder, the gallery pattern (side-by-side, phone + desktop), showing the mocks to the user, `DECISION.md`, keep-vs-throw |

---

## Ask yourself

- Did I **copy the harness** and author only `mocks.json` + the variants — or hand-roll a gallery and a comment layer that behave differently from every other review?
- Did I mock **every option on the table**, or quietly mock my favourite and ask for a yes?
- Is the user being asked to **point**, not to **read**? Did I lead with images, or with paragraphs?
- Do all variants share the **same dummy content**, so the only difference the eye sees is the design?
- Is the dummy content **plausible and real-textured** — or did I ship grey boxes and lorem ipsum that nobody can judge?
- Is the concept's **one screenshot-worthy thing visible** in each mock, at whatever cheap fidelity it took?
- Did I **narrate the empty house** — a `data-note` on every shortcut, saying what it stands for and what to judge now — or did I show bare low fidelity in silence and invite a rejection of the *shortcut*?
- Did I put the user **in the live page** (shared browser, random port) where they can **click and comment on the thing itself** — or make them describe from memory what "the big one" was?
- When I served the mock, did I **arm the inbox watch** (a persistent `Monitor` on `comments.json`) so submitted comments reach me live — or leave the user submitting into silence until they think to ping me?
- Did I **read the comments from `comments.json`** and repeat them back before acting, and **copy them verbatim into `DECISION.md`** (the mocks folder is thrown away)?
- Did I let the user **cast the verdict with the Choose button** (a dedicated SELECT), read it from `verdict.json` / `window.mockVerdict()`, and **watch for it** — or make them express the decision as a comment I then have to guess at?
- Did I keep **"none of these" and "a hybrid" on the table** as first-class verdicts — the taste gate must be able to reject — or did I ask a question that can only return a yes?
- Did I carry forward that a **mock yes is provisional** (it picks a direction; `realize` still owes the outside-eye pass on the real thing)?
- Did I **suggest** the heavy moments (a frame, a still, an approximation) — or did I start *rendering* them and drift into the build?
- Is every mock **self-contained** — one file, no deps, no build, no app integration — so `rm -rf` leaves no trace and breaks nothing?
- Does it live in a **dated, feature-scoped package**, not a shared mocks blob that will mix features?
- When the verdict came in, did I **record the decision durably** and route the feedback **upstream** to re-conceive — or start polishing the mock's CSS?
- Am I handing `realize` a **confirmed concept** (to build fresh from the Staging), or handing it **mock code** to grow into the product?

## Red flags

- **One mock, presented for approval.** A weak question that gets a weak yes. Options are what produce a real verdict.
- **A wall of text with a link at the bottom.** The whole point was to spare the user the reading. Screenshots first, and the live page second.
- **Bare low fidelity, shown in silence** — a grey rectangle where the hero goes, a static dot where the floating light goes, and no note saying so. The user rejects the *shortcut* instead of judging the *design*, and you re-mock the wrong thing.
- **A note that's just a label** — `data-note="Hero section"`. It explains away no fakery and tells the viewer nothing they can't see.
- **Feedback collected as prose** — "the big one felt off, and the second thing is too much" — unlocatable a day later. The user was standing in the live page; they should have been able to *click the thing*.
- **Serving the mock without arming the inbox watch.** The user pins and submits into the void, and nothing answers until they think to ping — the live, GitHub-style review the harness was built for, thrown away. The watch is a persistent `Monitor` you arm the moment you serve, not an opt-in the user must request.
- **Comments left in `comments.json`** and never copied into `DECISION.md`. The most valuable words of the whole session, thrown away with the `mocks/` folder.
- **A verdict that can only say yes** — asking "which one?" with no way to answer "none of these" or "A's hero on B's palette". A taste gate that cannot reject is a rubber stamp; reject-all and hybrid are first-class outcomes.
- **Making the user "choose" by typing a comment** — then guessing whether a passing remark was the decision. The verdict is the review's whole point; it has a dedicated **Choose this concept** button and its own watched `verdict.json`, never a comment you have to interpret.
- **Treating a mock "yes" as final** — shipping the built result on the mock's approval, when the mock faked every expensive moment. The mock picks a direction; `realize` still owes the outside-eye pass on the real thing.
- **Variants with different content** — different copy, different photos, different records — so the user is comparing the *content* and cannot see the design.
- **Wireframe mush** — grey boxes, lorem ipsum, no atmosphere; all three concepts look identical and the verdict is meaningless.
- **Over-rendering** — tuning the scroll timeline, sourcing the final hero art, fixing the responsive breakpoints. That is the build, started without a decision.
- **A mock that grew functionality** — "just make this button work", a store, a route, a component import. It is a prototype now, and it will be paid for twice.
- **Mocks wired into the app** — a route, an import, a dependency, an asset path. It is no longer throwable, and it will rot in the repo forever.
- **A hand-rolled review** — a bespoke gallery, hand-pasted pins, a comment mechanism invented for this feature. The harness exists so the user learns the review *once*; re-inventing it per feature means re-inventing it badly.
- **Editing the harness in the package** to fix a review bug. It's harness, not mock — the fix belongs upstream in the skill's asset, or every future review inherits the bug.
- **A shared `mocks/` blob** with three features' worth of files in it and nobody willing to delete any of them.
- **Polishing the mock in response to feedback** instead of taking the feedback upstream and re-mocking cheaply. The mock's CSS is not where design decisions live.
- **The mock becoming the build** — "it looks done, just start from that file." Every cheap shortcut in it is now product debt, and `realize`'s job has been skipped.
- **The decision lost with the evidence** — the mocks were thrown away and no one wrote down what was chosen, why, or what was already rejected.

---

> **Origin.** The quartet designs (`distill-the-brief` → `envision-the-experience` → `stage-the-vision` → `realize-the-vision`), but between the *art* and the *build* sits a human gate every one of them depends on and none of them serve: **someone must approve the concept, and they cannot do it by reading.** `stage-the-vision` explicitly requires exploration "at low fidelity, judged by an outside eye" and confirmation "before the high-fidelity build" — this skill is the instrument that makes that real. It is deliberately *not* a design stage: it invents nothing, decides nothing, and its artifacts are engineered to be deleted. It exists so that the expensive stage is never spent on an unapproved concept, and so the user course-corrects **by eye, in seconds** — which is the only way a person can honestly steer a look. (`architect-mentality` — *work smart, not hard*; *know when not to build*; *design for the consumer*.)

> **Related.** The decision instrument of the experience-design quartet: `bespunky-product-ux:distill-the-brief` (the problem) → `bespunky-product-ux:envision-the-experience` (the feeling) → `bespunky-product-ux:stage-the-vision` (the art) → **`bespunky-product-ux:mock-to-choose`** (the *verdict*) → `bespunky-product-ux:realize-the-vision` (the build). It consumes a Staging (or several competing concepts) and produces a **decision**; `realize-the-vision` then builds the chosen concept **fresh from the Staging**, never from the mock. Rejections travel back up: a wrong *look* returns to `stage-the-vision`; a wrong *feeling* returns to `envision-the-experience`; a wrong *problem* returns to `distill-the-brief`. A mock that is judged only for beauty is judged for half — pressure the chosen concept against `bespunky-product-ux:astonishing-to-use` before it goes to build. Show the mocks with `bespunky-browser-automation:playwright` (screenshots) or `bespunky-browser-automation:shared-browser` (a live look, together). Governed by `bespunky-engineering:architecture-first` — confirm the design, *then* build it properly.
