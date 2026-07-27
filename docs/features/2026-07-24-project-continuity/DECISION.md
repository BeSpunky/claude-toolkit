# Decision — project continuity architecture

> What was chosen, why, and what was rejected. The conclusion is durable; this doc supersedes nothing yet.
> Status: **built.** As-of 2026-07-24 · branch `feat/project-continuity`. All pieces implemented and smoke-tested; not yet committed or merged.

## The shape we're building

Three cooperating pieces plus a lifecycle model, all composing existing toolkit primitives ([[feature-package]], [[session-handoff]], [[branch-and-release]]). Home: the **`workflow` plugin** (natural neighbor to session-handoff/feature-package).

| Piece | Kind | Fires | Does |
| --- | --- | --- | --- |
| **`project-standing`** | new skill (model-driven) | cold-open / "where's this project at" | **Derives** the portfolio from the repo: efforts, live/stalled/concluded, which baton to read first. Never a stored file. Two scopes: **default** (live tier, full) and **`--history`** (searches the archive tier on demand). |
| **`SessionStart` hook** | detect + relay (no execution) | every repo open | Scans the **live tier only**; if genuinely-stale in-flight work exists, injects a one-line fact and nudges toward `project-standing`. Silent otherwise. Cost stays flat as history grows. |
| **`PreCompact` hook** | cheap-additive nudge | before context compaction | Ensures the model is *asked* to append a distilled checkpoint baton to the live effort's `handoffs/`, at the last moment full context still exists. |
| Lifecycle + archive model | convention | at lifecycle boundaries | Append while live · distill at boundaries · archive (`git mv`) never erase. Governs how docs age. |

## Key decisions and their why

### D1 — A NEW skill, not a mode of `session-handoff`
Cold "where's the project at" is a different job from a hot, intentional, single-effort baton. session-handoff assumes you know the effort; project-standing discovers efforts you've forgotten. Folding cold-survey into session-handoff would blur a clean trigger surface. **Rejected:** extending session-handoff (would overload one skill's intent).

### D2 — Standing is DERIVED at read time, never a stored status doc
A hand-maintained `STATUS.md` / kanban (backlog/in-progress/done) is the *first thing to rot*, and its rot is the exact staleness we're curing. It also duplicates git + issues. And it fights the multi-agent requirement: one shared doc that N agents rewrite is a merge-conflict machine (session-handoff already refuses a committed `latest.md` pointer for this reason). So "current state" is a **query** — computed from `git worktree list`, `docs/features/*`, newest baton per package, `git log` — never a file anyone edits. **Rejected:** a single status doc; a hand-maintained kanban.

### D3 — Per-effort homes, not one shared doc
The concurrency requirement (parallel agents documenting at once) is an argument *against* a single doc. Parallel efforts already live in parallel worktrees ([[branch-and-release]]), each writing to its **own** package. No shared file ⇒ no collision. The cross-effort view is derived on top (D2), not a stored aggregate.

### D4 — Reliable capture is a HOOK, not a skill
A skill fires only when the model judges it relevant — which fails exactly when a bloated session is about to compact. So capture rides `PreCompact`: deterministic trigger, full context still present. The hook does **not** author the baton (a script can't distill); it **guarantees the model is asked to**, every time, at the right moment. **Governing principle** (refining project-starter's "detect, don't execute"): *a hook may drive a cheap, additive, reversible action (append a checkpoint); it must never drive a heavy, irreversible one (Docker repair, deletion, publish).* Appending a timestamped markdown baton is firmly in the safe class, and **headless is the case FOR it** (unattended agents most need the breadcrumb; an additive append needs no consent). **Accepted limit:** still model-executed, so a busy model may under-serve it — worst case a thin baton instead of none, strictly better than today.

### D5 — Front door is detect-and-relay only
The `SessionStart` hook mirrors project-starter's proven pattern: a fast (<100ms) script that *relays a fact and points at the skill* — it never reconstructs the standing itself (that's model judgment). Anti-nag discipline is non-negotiable: it fires **only** when there is genuinely-stale in-flight work (a worktree, an uncommitted tree, or a baton newer than the last merge), and stays **silent** on a clean repo. A notice that fires when nothing changed is one everyone learns to ignore.

### D6 — Docs lifecycle: append · distill-at-boundary · archive, never rewrite-in-place
"Docs need maintenance" is true, but the maintenance is **not** edit-in-place. Sort artifacts by half-life:
- **State/progress/next-steps** — perishable; **append** a new timestamped baton, newest wins on read. Never edit a baton to update it.
- **Decisions** — durable; **supersede**, never delete (the reversal is itself a road-not-taken).
- **Plans/evidence** — disposable working-state; the *learning* is durable, the plan is not.

Distillation happens at **real lifecycle boundaries** (merge / abandon / major pivot) — the **merge gate** ([[branch-and-release]]) is the natural trigger — where you write a **closing conclusion**. Mid-flight distillation is banned (you'd bin a road-not-taken you need next week). **Rejected:** rewriting/erasing past docs to reflect the present — it's lossy history-editing that deletes the perishable *why* future-us asked for.

### D7 — Bloat is a READ-PATH problem; archiving is collapse-by-default + scan-partitioning
A concluded 2024 package costs the model *nothing until read*. So the fix is **indexed, not scanned**: the closing conclusion IS the archive record, and the default view **collapses concluded efforts to a one-line conclusion** (progressive disclosure, the router-skill pattern). The model scans N one-liners, not N packages. Two tiers, only for scale:
- **Live tier** `docs/features/<date>-<slug>/` — in-flight + recently concluded; the front door scans only this ⇒ default cost is O(active), not O(all history).
- **Archive tier** `docs/features/archive/…` — aged-out concluded efforts; **searched on demand, never scanned eagerly.** Promotion is an additive `git mv` (preserves blame), never an erase.

A **closing-conclusion frontmatter** (status · one-line summary · date · tags), written once at the boundary, is the cheap index that makes an archive dive precise without loading packages. **Rejected:** physical relocation as the *primary* bloat fix (it's cosmetic; the model only pays on read) — relocation earns its keep only to bound the default scan at scale.

### D8 — Repo is source of truth; ClickUp deferred
Continuity artifacts are versioned and co-located with the code. A PM platform would raise the two-sources-of-truth question (drift), doesn't hold decisions/roads-not-taken well in task fields, and its upkeep friction is plausibly *why projects go stale*. **Decision:** design local artifacts well now; a one-way **export** projection can come later as its own plugin. **Rejected:** ClickUp as source of truth; integrating it first.

## Roads not taken (summary)
- A single shared status doc / markdown kanban (D2, D3).
- Extending `session-handoff` instead of a new skill (D1).
- Capture as a skill the model must remember to fire (D4).
- A `SessionStart` hook that reconstructs standing itself, or nags on clean repos (D5).
- Rewriting/cleaning past docs in place (D6).
- Physical archiving as the primary anti-bloat move (D7).
- Any PM-platform integration now, or as source of truth (D8).

## Resolved during build (2026-07-24)
- **Stale threshold** → `BESPUNKY_STANDING_STALE_DAYS`, default **14**. The `SessionStart` hook fires only when in-flight work exists AND nothing (doc edit or commit) has happened within the window — so it never nags during active work, only on a genuine cold return. A per-machine, gitignored snooze (`.claude/.standing-snooze`, fingerprinted on last-commit epoch) stops re-nagging across multiple starts in one dormant stretch.
- **Archive cadence** → `BESPUNKY_ARCHIVE_MONTHS`, default **6** months since `concluded:`. Not automated — the ARCHIVE-SWEEP scope offers it and moves only on a yes (heavier, tree-changing ⇒ consented, like `--repair`).
- **Concluded-signal** → `status:` frontmatter on `DECISION.md` (`concluded|abandoned|superseded`). Presence of the field (not the file) marks conclusion, so a mid-flight `DECISION.md` like this one reads as in-flight.
- **Output shape** → built directly into the skill (the report template) rather than a separate sketch, per the "implement to completion" goal.

## What shipped
- `plugins/workflow/skills/project-standing/SKILL.md` — the skill (orient / history / archive-sweep scopes).
- `plugins/workflow/hooks/hooks.json` + `detect-standing.sh` (SessionStart) + `checkpoint-on-compact.sh` (PreCompact).
- Cross-reference section added to `feature-package/SKILL.md` (the two tiers + closing-conclusion frontmatter).
- Catalogs: `plugin.json` + `marketplace.json` descriptions and versions (0.4.0 → **0.5.0**); `README.md` table row, tree, and namespaced-id list.

## Still open / next steps
- **Commit & promote** this effort per [[branch-and-release]] (feature → development → …). Nothing committed yet.
- **Reload** to pick up the new skill/hooks in-session (`/reload-plugins`), then a live cold-open sanity check.
- Consider a follow-up: teach the scaffolder's generated `HOUSE.md` to mention `project-standing` as the cold front door (so scaffolded projects advertise it), and revisit the deferred one-way ClickUp export as its own plugin (D8).
- Smoke tests run: SessionStart silent-when-active + notice-when-dormant; PreCompact checkpoint written to the right package. Not yet exercised through a real compaction or a real months-cold repo.
