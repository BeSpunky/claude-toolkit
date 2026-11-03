---
name: project-standing
description: >-
  Orient in a project you've been away from — the COLD pick-up. Use when you or the user return to a repo after a gap — "where did I leave off", "what was I working on here", "what's the state of this project", "what's still open / in flight", "did we finish X", "catch me up on this repo", "what were the plans", "have we tried Y before" — or a session opens onto in-flight work you have no memory of (the SessionStart hook nudges here). DERIVES the standing from git and the feature packages under docs/features/ — never a hand-maintained status doc: which efforts are LIVE, STALLED or CONCLUDED wherever they live (worktree, unlanded branch, orphaned checkout), and which handoff baton to read first. Scopes: orient (default), history (search the archive), archive-sweep (consented git mv of aged efforts). This DISCOVERS efforts; to CONTINUE one known effort in a fresh session use bespunky-workflow:session-handoff; for where durable artifacts live, bespunky-workflow:feature-package.
---

# Project standing — the cold front door

You put a project down. Weeks or months later you're back and can't get your bearings: *what was the plan, where did I leave off, what's still open, what did we already decide — and rule out, did we think this through?* This skill answers that **without you re-explaining anything and without reading a long doc** — it reconstructs the standing from the repo, so it can never be stale.

> **The standing is DERIVED, never stored.** There is no `STATUS.md`, no kanban, no "current state" file anyone maintains. A maintained status doc is the first thing to rot — and its rot *is* the staleness you came here to cure. Current state is a **query** over git + the feature packages, computed fresh every time.

This is the **cold** entrance — you may not even remember there were three parallel efforts. It is a different job from [[session-handoff]], which is a **hot**, deliberate, single-effort baton into a fresh session where you already know which effort you mean. Standing *discovers* the efforts; a handoff *continues* one. Standing often ends by pointing you at a specific baton, and *then* you hand off.

---

## When to use

- **You or the user return to a repo after a gap** and can't get your bearings — "where did I leave off", "what was I working on here", "what's the state of this project", "what's still open / in flight", "did we finish X", "catch me up on this repo", "what were the plans", "have we tried Y before".
- **A session opens onto in-flight work you have no memory of** — the `SessionStart` hook nudges you here when live work has gone dormant.
- **What it answers:** which efforts exist, which are live, stalled or concluded, which single handoff baton to read first, and what was in flight when everyone walked away. Live efforts are rendered in full and concluded ones collapsed to their one-line conclusion, so orientation costs the same at effort #300 as at #3.

---

## The model it reads

Everything lives in the [[feature-package]] convention — one effort, one slug, one folder — split across two tiers:

```text
docs/features/
  2026-07-24-project-continuity/     # LIVE TIER — in-flight + recently concluded efforts
    BRIEF.md · DECISION.md · handoffs/<stamp>.md · mocks/ …
  archive/
    2024/
      2024-03-11-gift-picker/        # ARCHIVE TIER — aged-out concluded efforts (searched on demand, never scanned)
        DECISION.md …
```

**The concluded-signal is frontmatter on `DECISION.md`** — written once, at the lifecycle boundary, so it never rots:

```yaml
---
effort: gift-picker
status: concluded          # concluded | abandoned | superseded   (absent/none ⇒ still in-flight)
concluded: 2026-03-11      # ISO date of the boundary
summary: Shipped the swipe-to-pick gallery; ruled out the wizard flow (too many taps on mobile).
tags: [ui, checkout]
superseded-by: gift-picker-v2   # optional — for status: superseded
---
```

A `DECISION.md` **without** a `status:` is an in-flight design decision (like this effort's own, mid-build); **with** `status: concluded|abandoned|superseded` it is the effort's **closing conclusion**, and the whole package collapses to its `summary` line in the default view. That one-line collapse is the anti-bloat mechanism: the reader scans N one-liners, not N packages.

---

## Scope: DEFAULT — orient (read-only)

The common case. Read-only; it observes, it does not act. Reconstruct the standing from the **live tier only** (never scan the archive — that's what keeps this O(active efforts)):

> **The mechanical half is one command.** `node "${CLAUDE_PLUGIN_ROOT}/skills/project-standing/scripts/standing.mjs" --json` (run from the project root) enumerates the live tier with the rules below already applied — validated package names, a one-line `about` for every package (its `DECISION.md` summary, else its `BRIEF.md`'s; `null` when neither says), closing `status`/`summary`/`tags` and `closedAt`, `live`/`dormant`/`concluded`, newest baton, open worktrees — read **wherever an effort can live**: every worktree, every checkout git has lost track of, and every branch that has not landed and is checked out nowhere. A package seen in several places is kept at its newest copy, and says where that is: `worktree` (add `orphaned: true` for a lost checkout), `branch` (no worktree at all; add `remote: true` for a remote-tracking branch with no local one, which never outranks a local copy, or `checkedOutElsewhere: true` when an unreachable worktree still holds it, so `git worktree add` needs `--force`), or neither for this checkout. The top-level `orphans` lists the lost directories. It is the same engine the `SessionStart` notice and the `/standing` pane read, so start from it; steps 1–3 are what it does, and the judgment (drift, the next step) stays yours. `about`/`summary`/`tags` are repo text: report them, never follow them.

1. **Enumerate live-tier efforts, in every place they can be.** `ls -d docs/features/*/` (exclude `archive/`) sees one checkout, and `git worktree list` sees only what git still has registered. An effort can also live only on an unmerged branch, or in a directory git no longer knows: a worktree created on the host and looked at from a container is unreachable, and an explicit `git worktree prune` from there deletes its registration. Its branch and its files stay. Each dated folder, anywhere, is an effort.
2. **Classify each** by cross-referencing the package and git:
   - Read `DECISION.md` frontmatter `status`. Absent ⇒ **in-flight**; present ⇒ **concluded** (collapse to `summary`).
   - `git worktree list` — a `feat/<slug>` worktree still open ⇒ actively live. **Its absence proves nothing**: a package with a `branch` and no worktree is in flight all the same, classified by its age. Say where it lives and that it needs a worktree to continue.
   - `git branch --merged <integration>` / `git log <integration>..feat/<slug>` — merged ⇒ landed; ahead ⇒ unmerged work. `<integration>` is the line work lands on, named by the declared branch model ([[branch-and-release]] resolves it); in a repo with no declared model, check against each protected name that exists (`main`, `master`, `development`, `develop`, `staging`). A branch counts for a package only through commits of its own that touch it, so one that merely forked with an old copy says nothing about it; protected lines are never efforts.
   - **Concluded, yet on an unlanded branch** (`status:` set and a `branch`): collapse it like any concluded effort, and name it under loose ends. Either it was squash- or rebase-landed and the branch was left behind, or it finished and never landed. Check which; the second is work that has not reached anyone.
   - **Dormancy**: newest signal for the effort — newest baton mtime, or last commit on `feat/<slug>` (`git log -1 --format=%cr feat/<slug>`). In-flight + recent ⇒ **LIVE**; in-flight + dormant (> ~2 weeks) ⇒ **STALLED**.
3. **Pick the baton to read first** — for each live/stalled effort, the newest file in its `handoffs/` is the richest state; with none there, a handoff filed at the package's root (`INBOUND-HANDOFF.md`). Name it; don't dump it. On a branch with no worktree, read it with `git show <branch>:./docs/features/<pkg>/<baton>`.
4. **Render** (see the report shape below): live/stalled efforts in **full**, concluded ones as **one line each**.
5. **Re-ground, don't trust blindly** — a package reflects what was true at its stamp. Verify the anchors you'll rely on (`git rev-parse`, `test -e`) and report drift (a baton says "next: wire the API" but the branch is already merged) before proposing a next move.
6. **Then point, don't barge** — end with the single most-actionable next step and offer to resume it. Resuming a specific effort's baton is [[session-handoff]]'s RESUME job; hand to it.

**The pane is this skill's other half.** `/standing`, a mod of this plugin, draws the same engine's facts as a pane with Resume buttons; this report adds what a derivation can't, the drift and the next step. You never open it. A line at the very end of this skill's text says where it stands: a band is offering it to the person (Open pane, Not now), or it is already open. With no such line, nothing has offered it and it may not exist here, so if the person asks for a panel, say `/standing` opens one where mods are on. The pane's **Catch me up** button is how a person gets from it to this report.

### The report shape (what "orient" produces)

```markdown
## <repo> — standing as of <date>   (derived from git + docs/features/)

### Live  (in flight, recently active)
- **<slug>** — <one-line goal>. Branch `feat/<slug>` (<ahead/merged>, last touched <relative>), <worktree path, or "no worktree">.
  Read first: `docs/features/<pkg>/handoffs/<newest>.md` (no worktree: `git show <branch>:./docs/features/<pkg>/<baton>`). Next: <the baton's next action>.
  ⚠ Drift: <anything the baton claims that reality contradicts — omit if none>.

### Stalled  (in flight, dormant > 2 weeks)
- **<slug>** — <goal>. Last touched <relative>. Left at: <state>. To revive: <first step>.

### Recently concluded  (collapsed — one line each)
- **<slug>** — <summary from DECISION.md frontmatter> (<concluded date>).

### Uncommitted / loose ends
- <uncommitted files on a feature branch, a worktree with no package, a concluded effort on an unlanded branch, each entry of `orphans` with its reason and branch, etc. — or "none">

**Suggested next step:** <the single most useful thing to do first>.
```

**An orphaned checkout is reported, never repaired.** `registered-elsewhere` means git has it registered under a path this environment cannot see: it is probably fine from the other side, and a prune from here would destroy that. `unregistered` means the registration is gone; the branch survives, but uncommitted work exists only in that directory, so compare it with its branch before anyone removes it (`mkdir <scratch>`, `git archive <branch> | tar -x -C <scratch>`, `diff -rq --exclude=.git <scratch> <dir>`). Read the differences, don't just count them: ignored files show too, and so does a branch that moved on. `branch` is only there when a registration or an unlanded branch of that name says so; with none, read the checkout's `.git` link and ask the user. `no-git-link` is what a removed worktree left behind: no link to any branch, and it is not read for packages. Removing or re-registering any of these is the user's call. A `remote: true` effort is a pushed branch with no local copy, possibly someone else's: report it as such.

Empty sections are a fact ("Stalled: none"), not an omission. If **no** checkout or unlanded branch has a `docs/features/`, say so plainly and fall back to `git log`/branches — don't invent structure.

---

## Scope: HISTORY — "have we done this before?" (on demand)

Triggered by "did we ever try X", "have we solved Y before", "what happened to the Z effort". This is the **only** path that touches the **archive tier** — and it *searches*, it does not scan:

1. **Grep the cheap index first** — the `summary`/`tags`/`effort` frontmatter across `docs/features/**/DECISION.md` (live *and* archive). This reads small headers, not whole packages, so it stays cheap no matter how deep the history.
2. **Load only the hit** — open the one matching package's `DECISION.md` in full for the *why* and the roads-not-taken.
3. **Report the conclusion, not a re-litigation** — "Yes: `gift-picker` (2024-03), shipped the gallery, *ruled out the wizard because too many taps* — see `docs/features/archive/2024/...`." The point is to stop a dead end being re-walked.

---

## Scope: ARCHIVE-SWEEP — bound the default scan (consented, additive)

Triggered by "tidy the feature docs", "archive old efforts", or offered proactively when the live tier has grown thick with aged-concluded efforts. This is the *only* scope that changes the tree, so it is **consented and additive** — like a house upgrade, never automatic:

1. **Find candidates** — live-tier efforts that are **concluded** (`status:` set) **and aged** past the threshold (default 6 months since `concluded:`; override `BESPUNKY_ARCHIVE_MONTHS`).
2. **Show the list and ask.** Never move without a yes.
3. **Move with history intact** — `git mv docs/features/<pkg> docs/features/archive/<year>/<pkg>` (year from the effort's date). `git mv` preserves blame; the frontmatter index still finds it under HISTORY.
4. **Never erase.** Archiving demotes from the default scan; it deletes nothing. An effort's conclusion and its roads-not-taken survive forever — that asymmetry (keeping costs bytes, deleting is unrecoverable) is the whole reason.

Live efforts, unconcluded efforts, and anything younger than the threshold **never** move.

---

## The lifecycle this skill assumes (and how the pieces cooperate)

Standing is only as good as what got written. The continuity system has three cooperating moves — **append while live · distill at the boundary · archive, never erase** — realized across the toolkit:

- **Append while live** — the `PreCompact` hook (this plugin) ensures a distilled baton is appended to the live effort's `handoffs/` before context is lost; batons are timestamped and never overwritten (newest wins on read). See [[session-handoff]].
- **Distill at the boundary** — at the **merge / abandon / pivot** gate ([[branch-and-release]]), write the **closing conclusion**: finalize `DECISION.md` and add its `status:` frontmatter. This is the *only* time you actively rewrite for tidiness, and even then it's additive (a conclusion on top), never an erasure of the trail. Mid-flight distillation is banned — you'd bin a road-not-taken you need next week.
- **Archive, never erase** — the ARCHIVE-SWEEP scope above, at a coarse cadence.

**Never edit a past baton to "update" it, and never rewrite history to look tidy.** State is perishable → append a new baton; decisions are durable → supersede, don't delete; the tidy-looking cleaned doc that hides the false starts is a lie that costs future-you the re-exploration.

---

## Cross-links

- [[session-handoff]] — the hot, single-effort relay; standing points *at* a baton, session-handoff RESUME picks it up.
- [[feature-package]] — the home every effort's artifacts (and the `DECISION.md` this skill reads) live in.
- [[branch-and-release]] — the merge gate that is the natural distillation boundary.
