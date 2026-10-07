# Choosing a branch model — the investigation

> Used whenever a repo has **no declared model** (`branches.mjs status` exits `3`): by the skill, once per session before the first branch or promotion action, and by `/bespunky-house:upgrade` (or `add-layer`) when its preflight reports the model undeclared. Also used on request — "simplify our branches", "do we still need staging?", "set up gitflow". One procedure for all of them. `<base>` below is this skill's base directory.

**The goal is a model the repo's history and bindings justify — not the one its branch list implies.** Projects scaffolded by earlier versions of the toolkit were *forced* into `development → staging → main`, so every one of them *has* those branches whether it needs them or not. **A branch existing is not evidence it is needed.** Each long-lived line has to justify itself with what fires on it and how it was actually used.

The user's rule is absolute: **no declaration means asking.** This procedure ends in a question, never in a write.

## 1. Gather the evidence

```bash
node "<base>/scripts/branches.mjs" evidence --json [--app-hosting]
```

**Add `--app-hosting` whenever the repo has Firebase** (a `.firebaserc`): it asks the Firebase CLI which App Hosting backends each project has — region, linked repository (none → it deploys from local source), root directory, environment name — and, with a `gcloud` login, **which branch each one rolls out from**. It is opt-in because every call takes seconds and needs `firebase login`; without a login every one of those facts is `unobservable`, which makes it a question.

It returns the raw facts, each tagged **`observed`** (read directly), **`inferred`** (read heuristically — e.g. a crude YAML read of a CI trigger) or **`unobservable`** (it could not see — e.g. branch protection without an authenticated `gh`, an App Hosting backend that lives only in the console, a squash-deleted branch). Read it all before judging; supplement with the repo's own docs (`CLAUDE.md`, README deploy notes) where they say what a branch is for.

**A `HOUSE.md` generated before the branch model was declarable is not evidence.** It describes the `development → staging → main` flow the toolkit *forced* on every project, not anything the project chose — reading it as intent is exactly the circularity this investigation exists to break. (A `HOUSE.md` rendered from a declared model only restates the declaration.)

`<scratch>` below is a scratch directory **outside the repo** — the session's scratchpad, or a `mktemp -d` — so a proposal never lands in a commit by accident.

## 2. Judge each existing long-lived branch

**"Long-lived" means exactly the lines `evidence` reports under `advancement`**: every branch (local or on the remote) whose name is one of the conventional long-lived names — `development`, `develop`, `staging`, `qa`, `main`, `master`, `production`, `trunk` — plus, when a model is declared, its integration line and every stage. Release and hotfix branches are not judged here; they are reported as **shapes** (below). A long-lived line with an unconventional name (say `prod-eu`) is invisible to the evidence — if the branch list shows one, judge it by hand and say so.

For every long-lived branch, reach one verdict and show the evidence for it:

| Verdict | Means | Typical evidence |
| --- | --- | --- |
| **justified** | it is a real gate or a real binding | a CI trigger that is **exclusive to that line, or deploys/publishes** from it; it sat **ahead** of its downstream neighbour for real stretches (staging held a candidate while production waited — the `lag` facts); tags or releases are cut from it; required-PR protection on it |
| **ceremonial** | it exists and moves, but gates nothing | always promoted **back-to-back** with its neighbour (staging and main advanced within minutes, every time); no binding fires on it; never ahead for long |
| **unused** | nothing moves through it | stale tip; no advances since scaffolding; no bindings |

Reading the evidence for those verdicts:

- **A CI trigger justifies a line only if it is exclusive to that line or deploys/publishes.** A test workflow whose `branches:` lists every long-lived line (or runs on every push) fires on all of them alike and justifies none of them.
- **"Ahead for real stretches" is the `lag` facts** (`<upstream> → <line>`: `promotionEvents` (reflog moves only), median and max seconds between the upstream receiving a commit and this line receiving it; a median under ten minutes reads *back-to-back*). They come from the **local reflog** only, so on a fresh clone, or wherever the reflog has expired, the fact is `unobservable` — then **ask** how promotions actually happened; don't infer a gate or its absence.
- **`directCommits` on a protected line are dated history, not a verdict.** If most of them are old (before a workflow existed, or from the scaffold), report the **date split** the fact already carries (`directCommits: {total, last90Days, older, newest}`) — *"41 direct commits on `main`, 39 before 2025-03, 2 since"* — rather than reading them as a live violation; `git log --first-parent --no-merges <line>` shows them.
- **`deploys` records what a push to a line fires** — it doesn't make a line justified, it says what the line is bound to. Fill it from the bindings evidence and the user's answers, as a **binding** wherever the evidence is structured (see §4), as a **`note`** (free text — `"deploys": { "note": "…" }`; `deploys` is always an object) for anything else (a Vercel preview, a manual release ritual).

Then look for **shapes** beyond the chain: live `release/*` / `hotfix/*` branches, or their names in merge messages (→ release or hotfix lines); a tag series, and which line carries it (two series on two lines → maintained releases); `(cherry picked from commit …)` trailers (→ upstream-first fix flow); "Merge pull request #" merges or required-PR protection (→ `landing: pr`, and its merge style); direct commits on a protected line (→ the old model was not being followed — say so, don't judge it). **Tags that no long-lived line contains** (the `tags` fact's empty `containedIn`) are **reported, not modelled**: they mark something off the chain — a deleted branch, an abandoned candidate, or `sync-backup-*` tags, restore points a toolkit sync left behind, and say nothing about the branch model. Name them; don't invent a line to hold them.

**Confidence travels with every claim.** Present each evidence item with its tag. **Every `unobservable` item becomes a question to the user**, never an assumption — *"I can't see branch protection on `main` (gh isn't authenticated): does it require PRs?"*, *"Is there an App Hosting backend bound to `staging` in the console?"*.

## 3. Report what is owed, whatever is chosen

The evidence includes the **no-regression check over full history** (invariant 3): commits on a production line that integration lacks — hotfixes that were never carried back. That is a **real, current bug**, independent of the model: report each one (sha, subject, line) and offer to carry it. It is not a reason to pick one model over another, and it does not wait for the decision.

## 4. Propose a model

Start from the closest preset and adjust it — `presets` lists them (`trunk`, `two-line`, `three-line`, `gitflow`, `maintained-releases`):

```bash
node "<base>/scripts/branches.mjs" expand --preset <id> [--integration <b>] [--stages a,b] [--release-pattern p] [--maintained] [--fix-flow f] [--landing merge|pr] [--pr-style s] > "<scratch>/branches.proposed.json"
```

Edit the expansion to fit (real line names, `deploys` for what each line fires, `landing` matching the protection rules), then check it against today's repo.

**Propose the deploy bindings from the evidence — never invent one.** The engine reports facts; you draft the binding, and the user confirms it with the rest of the model:

| Evidence | Proposed `deploys` on that line |
| --- | --- |
| `app hosting` `<project>/<backend>` with a repository, and its `live branch` = the line | `"appHosting": [{ "project": "<.firebaserc alias or id>", "backend": "<backend>" }]` |
| a backend with **no** repository (local-source deploys) | nothing for App Hosting — it deploys only when someone runs `firebase deploy --only apphosting`; say so |
| a `live branch` that is `unobservable` | a question: *"Does backend `web` roll out from `main`?"* — never a guess |
| a workflow that deploys on push to the line (`bindings`, `deploys: true`) | a `note` naming it; a `ci` binding only if the project adopts the house `ci` layer (it owns its own workflow) |
| the user wants CI to deploy the line (house projects: the `ci` layer) | `"ci": { "environment": "<name>", "providers": { "firebase": "<.firebaserc alias>" } }` — one environment per Firebase project the line ships to |

A `drift` fact (with `--app-hosting` on a declared model) is a binding that no longer matches the cloud — a backend that moved branch, lost its repository, or exists undeclared. Each one is a model change to propose (`changing-the-model.md`), not a note to ignore.


```bash
node "<base>/scripts/branches.mjs" validate "<scratch>/branches.proposed.json"
node "<base>/scripts/branches.mjs" verify --proposed "<scratch>/branches.proposed.json"
```

**Prefer the simplest model the evidence justifies.** A ceremonial stage costs a promotion per release and buys nothing; collapsing it is the point of the exercise. But never remove a line a binding still fires on without naming that binding — and when simplifying, say which steps it takes (e.g. *"fold `staging` into `main`: `staging` holds nothing un-promoted; the `deploy-staging.yml` trigger on it would go dark — retarget or delete it"*).

## 5. Ask

Present, compactly:

1. **The verdict per branch**, each with its evidence and confidence.
2. **The questions** the unobservable evidence raised.
3. **The proposed model** — `describe`-style: each line, its role, how it advances — and the simplification steps it implies.
4. **Owed carries** from step 3.
5. **The alternatives** worth naming (e.g. keep today's three lines as-is) and what each costs.

Then **ask** the user to choose. Don't write anything on a hunch, and don't treat silence or "sounds fine, later" as a choice — if they defer, the repo stays undeclared (protective rules hold) and you ask again next session.

## 6. On approval — land it

Follow [`changing-the-model.md`](changing-the-model.md) from its first step: the first declaration is a model change like any other (from *undeclared* to the chosen model), verified, risk-assessed and confirmed before anything is written. Its landing on the integration line is the one landing made under the model being replaced — here, the protective undeclared rules.
