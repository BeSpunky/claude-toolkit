---
effort: review-model-tiers
status: concluded
concluded: 2026-11-03
summary: Three small speed-ups to the sanity review shipped; mixing models was tested and dropped, because it gave no wall-clock gain and the serious findings all came from the strongest model.
tags: [workflow, sanity-review, models, dogfood]
---

User: *"Sanity reviews seem to take very long. Check if there's anything we can do to optimize without compromising sanity quality"*, then *"Can the dispaching agent choose multiple models and task multiple agents with an appropriate model each?"*, then *"Yes"* to testing it.

## Measured before the change

The two finished reviews of 2026-11-02 and 2026-11-03 took 27 and 31 minutes. About two-thirds of reviewer time is the model thinking (100 minutes of agent time, 32 in tools). Phases of the 31-minute one: lenses about 9, disproving about 9, fixes about 6, suites about 5.

## Three safe changes, shipping either way

Targeted suites after fixing and the full set once at the end; the session hands over its frame; each verifier starts when its lens returns.

## 2026-11-03 — no model names in the implementation

User: *"Once this is tested and proven, the implementation should not include fixed models. It should tell the sanity agent to chose from what's available at the time of testing"*.

So the reviewer's instructions describe what each kind of check needs (judgement, or fast search), and the agent picks from the models available when the review runs. The benchmark's named models are the test's, not the design's. Read "at the time of testing" as when the review runs.

## 2026-11-03 — benchmark result: not proven for speed

One blind run, ledger in `reviews/20261103-benchmark-tiered-review.md`. Opus on correctness, architecture and the single verifier; Sonnet on tests + clean code + reuse; Haiku on completeness. Report mode, full dogfood not run (optional in the brief).

- **Time:** 27.7 min with no fix phase, against 26.7 min with one, for the baseline. Verified findings at about 25 min against about 17. Sonnet and Haiku finished in 3 and 4 min, but correctness (Opus, running real upgrades) took 13 and the verifier 11, over 49 raw findings. The brief forced one verifier, which may have added to that. The slowest reviewer sets the pace, and that is the one that must not be downgraded.
- **Quality:** caught 3 of the baseline's 5 open findings (entry specs, navigation-core, ds-component) and most rung fixes. Missed the brand-lib seed and a dogfood seed bug (no dogfood run), and rejected the peer-order finding the baseline fixed. Missed two doc fixes. All the serious ones came from the Opus reviewers. Sonnet added a mutation gap the baseline lacked. Haiku raised most (16, 4 rejected) and declared "no stale bundle figures" where another reviewer found one.
- **Still open in released code, found here:** README says 207 kB against 210 elsewhere; no dogfood step exercises navigation-core; the gate's `run-many` passes when no project matches.

## 2026-11-03 — outcome

User, on dropping the split and shipping the rest: *"go"*. Shipped the three speed-ups and the three fixes the benchmark surfaced.

The dogfood gate's own cleanup ran a blanket `git worktree prune` against the toolkit repo, the likely source of the lost host-made worktree, over the subagents `standing-sees-branches` named. Removed; it already removes its tree by path. The new `navigation-core` step first failed because of this work's stub of the package managers, not the product: `nx g` and `nx test` exit 0 against the published 0.51.2. It now installs from a pack of the build in place.

No sanity review: a few lines of agent text and one gate step, with the gate itself as the check.
