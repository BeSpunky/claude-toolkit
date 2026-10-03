# Choosing a branch model — the investigation

> Used whenever a repo has **no declared model** (`branches.mjs status` exits `3`): by the skill, once per session before the first branch or promotion action, and by `/sync` when its preflight reports the model undeclared. Also used on request — "simplify our branches", "do we still need staging?", "set up gitflow". One procedure for all of them. `<base>` below is this skill's base directory.

**The goal is a model the repo's history and bindings justify — not the one its branch list implies.** Projects scaffolded by earlier versions of the toolkit were *forced* into `development → staging → main`, so every one of them *has* those branches whether it needs them or not. **A branch existing is not evidence it is needed.** Each long-lived line has to justify itself with what fires on it and how it was actually used.

The user's rule is absolute: **no declaration means asking.** This procedure ends in a question, never in a write.

## 1. Gather the evidence

```bash
node "<base>/scripts/branches.mjs" evidence --json
```

It returns the raw facts, each tagged **`observed`** (read directly), **`inferred`** (read heuristically — e.g. a crude YAML read of a CI trigger) or **`unobservable`** (it could not see — e.g. branch protection without an authenticated `gh`, an App Hosting backend that lives only in the console, a squash-deleted branch). Read it all before judging; supplement with the repo's own docs (`HOUSE.md`, `CLAUDE.md`, README deploy notes) where they say what a branch is for.

## 2. Judge each existing long-lived branch

For every long-lived branch, reach one verdict and show the evidence for it:

| Verdict | Means | Typical evidence |
| --- | --- | --- |
| **justified** | it is a real gate or a real binding | a CI/deploy trigger fires on it; it sat **ahead** of its downstream neighbour for real stretches (staging held a candidate while production waited); tags or releases are cut from it; required-PR protection on it |
| **ceremonial** | it exists and moves, but gates nothing | always promoted **back-to-back** with its neighbour (staging and main advanced within minutes, every time); no binding fires on it; never ahead for long |
| **unused** | nothing moves through it | stale tip; no advances since scaffolding; no bindings |

Then look for **shapes** beyond the chain: live `release/*` / `hotfix/*` branches, or their names in merge messages (→ release or hotfix lines); a tag series, and which line carries it (two series on two lines → maintained releases); `(cherry picked from commit …)` trailers (→ upstream-first fix flow); "Merge pull request #" merges or required-PR protection (→ `landing: pr`, and its merge style); direct commits on a protected line (→ the old model was not being followed — say so, don't judge it).

**Confidence travels with every claim.** Present each evidence item with its tag. **Every `unobservable` item becomes a question to the user**, never an assumption — *"I can't see branch protection on `main` (gh isn't authenticated): does it require PRs?"*, *"Is there an App Hosting backend bound to `staging` in the console?"*.

## 3. Report what is owed, whatever is chosen

The evidence includes the **no-regression check over full history** (invariant 3): commits on a production line that integration lacks — hotfixes that were never carried back. That is a **real, current bug**, independent of the model: report each one (sha, subject, line) and offer to carry it. It is not a reason to pick one model over another, and it does not wait for the decision.

## 4. Propose a model

Start from the closest preset and adjust it — `presets` lists them (`trunk`, `two-line`, `three-line`, `gitflow`, `maintained-releases`):

```bash
node "<base>/scripts/branches.mjs" expand --preset <id> [--integration <b>] [--stages a,b] [--release-pattern p] [--maintained] [--fix-flow f] [--landing merge|pr] [--pr-style s] > "<scratch>/branches.proposed.json"
```

Edit the expansion to fit (real line names, `deploys` documenting what each binding fires, `landing` matching the protection rules), then check it against today's repo:

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
