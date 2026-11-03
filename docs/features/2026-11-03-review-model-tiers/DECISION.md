---
effort: review-model-tiers
summary: Make sanity reviews faster without losing quality, by giving each review check a model suited to it, if a benchmark on an already reviewed change shows nothing is lost.
---

User: *"Sanity reviews seem to take very long. Check if there's anything we can do to optimize without compromising sanity quality"*, then *"Can the dispaching agent choose multiple models and task multiple agents with an appropriate model each?"*, then *"Yes"* to testing it.

## Measured before the change

The two finished reviews of 2026-11-02 and 2026-11-03 took 27 and 31 minutes. About two-thirds of reviewer time is the model thinking (100 minutes of agent time, 32 in tools). Phases of the 31-minute one: lenses about 9, disproving about 9, fixes about 6, suites about 5.

## Three safe changes, shipping either way

Targeted suites after fixing and the full set once at the end; the session hands over its frame; each verifier starts when its lens returns.

## 2026-11-03 — no model names in the implementation

User: *"Once this is tested and proven, the implementation should not include fixed models. It should tell the sanity agent to chose from what's available at the time of testing"*.

So the reviewer's instructions describe what each kind of check needs (judgement, or fast search), and the agent picks from the models available when the review runs. The benchmark's named models are the test's, not the design's. Read "at the time of testing" as when the review runs.
