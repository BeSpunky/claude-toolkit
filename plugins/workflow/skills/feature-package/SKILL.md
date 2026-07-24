---
name: feature-package
description: A feature is a PACKAGE, not a scatter of files — one effort, one slug, one folder that holds everything about it. Use whenever an effort produces something durable that isn't code: a brief, a vision, a staging, a mock, a decision, a research note, a plan, a handoff baton — and the moment you catch yourself asking "where should I put this doc?", inventing a new folder for a write-up, dropping a `NOTES.md` at the repo root, or about to hand the user an important decision that will only ever exist in a chat transcript. The core move — **the effort's slug is its identity, and its package is `docs/features/<YYYY-MM-DD>-<slug>/`.** The SAME slug names the git branch (`feat/<slug>`) and worktree (`.claude/worktrees/<slug>`) from `branch-and-release`, so the code and the thinking behind it carry one name and can always be found from each other; the DATE prefix makes the trail chronological and lets a second pass at the same feature (a redesign, a year on) sit beside the first instead of overwriting it. The package is born WITH the worktree, at the start of the effort — not written up at the end — and every skill that produces a durable artifact writes INTO it rather than into a private home of its own: the design quartet's `BRIEF.md` / `VISION.md` / `STAGING.md` / `DECISION.md` (`distill-the-brief` → `envision-the-experience` → `stage-the-vision` → `mock-to-choose`), the throwaway self-ignoring `mocks/`, the effort's `handoffs/` batons (`session-handoff`), and whatever else the effort genuinely produces. Two rules keep a package honest — **the CONCLUSION is durable, the EVIDENCE is disposable** (a decision, in the user's own words, and the roads not taken, survive; the mocks, the scratch, the explorations are thrown at will and NOTHING may depend on them), and **a package is written as it happens, never reconstructed afterwards** (a doc written at the end is a memory, and memories are where the reasons go missing). It is NOT a documentation ritual, NOT a required set of files (an effort writes only the artifacts it actually has), and NOT a second memory system — it is the answer to "six months from now, why was it done this way, and what did we already rule out?" An expression of `bespunky-engineering:architect-mentality` — *place everything on purpose* (never because it merely fits), *model the missing concept* (the effort is a thing, so give it a home), *automate every repeated process*, and *preserve understanding and proof*.
---

# A Feature Is a Package

An effort produces far more than code. It produces the *reason* for the code: the problem someone actually had, the concept that was chosen and the three that were rejected, the constraint that killed the obvious approach, the decision the user made in one sentence that settled everything.

Almost none of that survives. It lives in a chat transcript that gets cleared, a doc dropped wherever the writer happened to be standing, a mock in a folder nobody dares delete, a handoff baton in one place and the design it refers to in another. Six months later the code is still there and every reason behind it is gone — so the same idea gets re-proposed, the same dead end gets re-explored, and the same question gets re-asked.

The fix is not "write more docs." It is to notice that **the effort is a thing** — it has an identity, a lifespan, and a set of artifacts — and to give that thing a **home**.

> **One effort. One slug. One folder.**

---

## The shape

```text
docs/features/2026-07-14-gift-picker/     # the package — slug matches branch feat/gift-picker
  BRIEF.md          # distill-the-brief        — the design problem(s), solution stripped out
  VISION.md         # envision-the-experience  — the feeling, the world
  STAGING.md        # stage-the-vision         — the art: concept, moments, visual system
  DECISION.md       # what was chosen, why (the user's words), what was rejected
  mocks/            # throwaway evidence — self-ignoring (.gitignore = "*"), nothing may depend on it
    gallery.html · serve.sh · variants/ · comments.json …   # the mock-to-choose harness
  handoffs/         # session-handoff — the relay batons for THIS effort
    2026-07-14T0930Z.md
```

**The slug is the identity.** It is the *same* slug that names the branch and the worktree in [[branch-and-release]] (`feat/gift-picker`, `.claude/worktrees/gift-picker`). One name, three places. From the branch you know the slug but **not** the date, so find the package by the slug — newest match wins:

```bash
slug=$(git branch --show-current | sed 's|^[^/]*/||')     # feat/gift-picker → gift-picker
ls -d docs/features/*-"$slug" | tail -1                    # → docs/features/2026-07-14-gift-picker
```

Never invent a second name for the same effort.

**The date is the trail.** `2026-07-14-gift-picker` sorts chronologically and — crucially — lets the *next* pass at the same feature (a redesign, a rethink, a year later) sit **beside** the first rather than overwrite it. The old package is the record of what was tried and why it was replaced. The lookup above takes the **newest** match, so a revisit's package is the current one; the earlier dated package remains as history. That is exactly the thing you want when someone asks "didn't we already try this?"

**Nothing here is mandatory — but a package that produced only throwaway evidence must still write its conclusion.** A package holds the artifacts the effort *actually produced* — a bug fix may have only a `handoffs/` baton; a design effort may have the full quartet. An empty file written for completeness is worse than no file. But note the trap: git does not track an empty directory, and `mocks/` **self-ignores** — so a design spike that got explored and *rejected*, leaving nothing but mocks, would vanish entirely on merge, taking the record of "we tried this and ruled it out" with it. That record is exactly a **conclusion**: write `DECISION.md` ("explored X, rejected because Y") even when every concept was binned. Record the conclusion, throw the evidence — and the conclusion is what keeps the package from evaporating. The package is a home, not a checklist.

---

## Born with the worktree, not written at the end

The package is created **when the effort starts** — at the same moment [[branch-and-release]] opens the worktree, and by the same act. It is filled *as the work happens*: the brief when the brief is distilled, the decision the moment the user makes it, the baton when the context runs out.

This ordering is the whole value. **A document written at the end is a memory** — reconstructed, tidied, and confidently wrong about the parts that matter. The reason a design was rejected, the constraint that turned out to be fatal, the exact sentence the user said when they chose — those are perfectly clear in the moment and irretrievably vague a week later. Write them when they happen or lose them.

(`architect-mentality` — *preserve understanding and proof*. The code proves *what*; the package preserves *why*.)

---

## The two rules

### 1. The conclusion is durable; the evidence is disposable.

A package holds two very different kinds of thing, and confusing them is how repos rot.

- **Conclusions** — decisions, the reasons behind them, the roads not taken, the constraints discovered, the brief that was actually agreed. These are **committed, small, and permanent.** They are what someone needs six months from now, and they are cheap to keep.
- **Evidence** — mocks, scratch renders, explorations, spikes, generated candidates, screenshots. These are **big, throwaway, and self-ignoring.** They existed to *produce* a conclusion, and once it's recorded they've done their job.

The discipline that makes evidence safely disposable: **nothing outside the evidence folder may ever depend on it.** No route, no import, no shared asset, no config entry, no build step. `rm -rf` a mocks folder and *nothing anywhere breaks* — that is what earns it the right to exist in the repo at all. Evidence folders carry a `.gitignore` containing `*` so git never even sees them, and a user who wants to keep one says so and it is promoted deliberately. (See `mock-to-choose` for the pattern in full.)

**Record the conclusion, throw the evidence.** Nobody wants three HTML files a year on. They want to know what was chosen and what was already ruled out.

### 2. The user's own words are the most valuable line in the package.

When a person says *"the lantern one — the others feel like an app; this one feels like giving something,"* that sentence is worth more than any paragraph you could write about it. It is the design's north star, and it settles a dozen later arguments in one line. **Quote it, don't paraphrase it.** The same goes for a rejection ("too clinical"), a constraint ("we can't ask for their phone number"), or a correction. Your summary of what the user meant is a lossy compression of the thing you already had.

---

## Where each skill writes

Every skill that produces something durable writes **into the package**, not into a private home of its own. That is the point of the convention — one place to look, and artifacts that can see each other.

| Skill | Writes | Kind |
| --- | --- | --- |
| `bespunky-product-ux:distill-the-brief` | `BRIEF.md` — the Brief Tree (the design problem, solution stripped out) | conclusion |
| `bespunky-product-ux:envision-the-experience` | `VISION.md` — the feeling, the world, the five beats | conclusion |
| `bespunky-product-ux:stage-the-vision` | `STAGING.md` — the concept, the moments, the visual system | conclusion |
| `bespunky-product-ux:mock-to-choose` | `mocks/` (throwaway harness + variants) and `DECISION.md` (durable) | evidence + conclusion |
| **any decision the effort makes** | `DECISION.md` — what was chosen and why, in the user's words, and what was ruled out. **Owned by the package, not by one skill:** an architecture call or a build-vs-buy with no mocks still records its decision here. | conclusion |
| `bespunky-workflow:session-handoff` | `handoffs/<UTC-stamp>.md` — the relay batons for this effort | conclusion |
| `bespunky-workflow:branch-and-release` | *creates the package* alongside the worktree; the slug it chooses is the package's name | — |
| anything else durable | a plainly-named file in the package — research notes, a plan, a spike write-up, an ADR | conclusion |

A skill that finds itself inventing a folder for its output is a skill that has forgotten this convention.

---

## How to run it

1. **At the start of an effort** — as [[branch-and-release]] classifies the request and opens the worktree — **take the slug it chose and create the package**: `docs/features/<YYYY-MM-DD>-<slug>/`. Date from the shell (`date -u +%F`), never guessed. If the effort is genuinely trivial (a typo, a one-line fix), skip it — a package for nothing is noise.
2. **Write artifacts into it as they are produced**, under their conventional names. Not at the end.
3. **Keep evidence self-ignoring** — a `.gitignore` containing `*` inside any throwaway folder, and *nothing* outside it depending on it.
4. **Capture decisions in the user's own words**, the moment they make them, along with what was rejected and why.
5. **At the end of the effort**, offer the user the throw: *"Keep the mocks/scratch as a record, or bin them?"* Default is bin. The conclusions stay and are committed on the feature branch, so they promote to `development` with the code they explain.
6. **When a feature is revisited later**, open a **new dated package** with the same slug. Read the old one first — it tells you what was already tried and rejected — and never overwrite it.

---

## Ask yourself

- Does this effort have **one slug**, shared by its branch, its worktree, and its package — or did I invent a second name for the same thing?
- Was the package **born with the worktree**, and are artifacts landing in it **as they happen** — or am I planning to write it all up at the end (a memory, not a record)?
- Is every durable artifact **inside the package** — or did a skill quietly write to a private folder of its own?
- Did I record the **decision and the roads not taken**, in the **user's own words** — or only the outcome, where the reasons will be gone in a month?
- Is all the throwaway evidence **self-ignoring**, with **nothing outside depending on it**, so it can be deleted without breaking anything?
- When I revisit a feature, did I open a **new dated package** and read the old one — or overwrite the record of what was already tried?

## The package's lifecycle — and the archive tier

A package is born in-flight and, at the end, **concludes**. Mark that boundary on `DECISION.md` with frontmatter — written **once**, at the merge / abandon / pivot gate, so it never rots:

```yaml
---
effort: gift-picker
status: concluded        # concluded | abandoned | superseded   (absent ⇒ still in-flight)
concluded: 2026-03-11
summary: Shipped the swipe-to-pick gallery; ruled out the wizard (too many taps on mobile).
tags: [ui, checkout]
---
```

The **presence of `status:`** (not of the file) is the concluded-signal — a mid-flight `DECISION.md` has none. That one line is what lets a returning reader collapse a finished effort to a single row instead of re-reading the package.

As history grows, concluded-and-aged packages move to an **archive tier** — `docs/features/archive/<year>/<pkg>/` — by an additive `git mv` (blame preserved), **never an erase**. The live directory stays scannable; the archive is searched on demand via that frontmatter. This whole lifecycle — reconstructing standing, collapsing concluded efforts, and the archive sweep — is owned by [[project-standing]] (the cold pick-up). This skill just defines the *home*; that skill *reads* it.

## Red flags

- **`NOTES.md` at the repo root.** Or `design/`, or `tmp-plan.md`, or a folder invented on the spot. The effort had a home; the file didn't go in it.
- **A decision that only exists in the chat.** The user chose, everyone moved on, and in a month nobody can say why — or what was rejected, so it gets proposed again.
- **Written up at the end.** A tidy retrospective document in which every inconvenient reason has been quietly smoothed away.
- **Paraphrasing the user.** Their one sentence was the north star; your summary of it is a lossy copy.
- **Evidence something depends on.** A mock wired into a route, a scratch asset imported by the app. It is not throwaway any more, and it will rot in the repo forever.
- **A shared blob** — one `mocks/` or `docs/design/` folder accumulating three features' worth of files that nobody is willing to delete.
- **A slug that drifts** — the branch says `gift-picker`, the folder says `gifts-v2`, the handoff says `present-flow`. Three names, one effort, nothing findable.
- **Ceremony** — empty template files written for completeness, a package for a typo fix, a `BRIEF.md` that says "n/a". A package holds what an effort *actually* produced.

---

> **Origin.** The toolkit's skills each produced durable things and each invented a private place to put them — design mocks in one folder, handoff batons in another, and the design quartet's Brief, Vision, and Staging in *no* file at all (they evaporated with the conversation that made them). The missing concept was the **effort itself**: it has an identity (the slug `branch-and-release` already chooses), a lifespan (the worktree's), and a set of artifacts. Naming that concept and giving it one home is what turns scattered outputs into a record you can actually use — and what lets the *why* survive as long as the *what*. (`architect-mentality` — *model the missing concept*; *place everything on purpose*; *preserve understanding and proof*.)

> **Related.** Keyed to `bespunky-workflow:branch-and-release` — the same slug names the branch, the worktree, and the package; the package is born with the tree and promotes with the code. Holds the batons of `bespunky-workflow:session-handoff` (per-effort, in `handoffs/`, located on resume by computing the newest package for the branch's slug — no committed pointer file, which would conflict on every promotion), and the artifacts of the experience-design quartet: `bespunky-product-ux:distill-the-brief` (`BRIEF.md`) → `bespunky-product-ux:envision-the-experience` (`VISION.md`) → `bespunky-product-ux:stage-the-vision` (`STAGING.md`) → `bespunky-product-ux:mock-to-choose` (`mocks/` + `DECISION.md`). Governed by `bespunky-engineering:architecture-first` in spirit: the reasoning that produced a design is part of the design, and it is kept, not re-derived.
