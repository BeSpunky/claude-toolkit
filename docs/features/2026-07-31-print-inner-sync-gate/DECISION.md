---
status: concluded
concluded: 2026-07-31
summary: --print-inner is exempted from the sync consent gate, so the render test can render sync modes under CI=true.
tags: [scaffolder, ci, print-inner, consent-gate, render-test]
---

# `--print-inner` must render sync modes under CI

## Symptom

The `scaffold tests` CI workflow was **red on every branch** (development, staging, main).
`tools/test-scaffold/render.test.sh` failed all four `sync` arms:

```
FAIL sync — render exited 1 (a failed command substitution in a block string aborts under set -e)
       | ERROR: refusing to sync in CI — a sync rewrites generated files and no human is here to agree.
```

The test's own diagnostic misattributes the exit to a backtick-in-a-comment (the class it was
originally built for). The real cause is unrelated.

## Root cause

The render test drives `scaffold.sh --sync --yes --print-inner <fixture>`. In CI, `CI=true`, so the
**sync consent gate** (`scaffold.sh` ~line 548) fired its unconditional CI refusal and exited 1
**before** the render block (~line 1772) was ever reached. `--yes` cannot override the CI arm — by
design (header: *"CI=true: there is no human to consent, and --yes cannot conjure one → REFUSE
unconditionally"*).

So the test passes locally (where `CI` is unset) and fails only in CI — which is exactly why it
shipped green and broke the moment it ran on a runner. The test meant to catch render breakage was
itself defeated by a gate that predates it.

## Decision

**The consent gate governs the *act* of syncing; `--print-inner` runs nothing, so it is exempt.**
`--print-inner` renders the command sequence and exits 0 without executing a single command of it
(its own docstring: *"print it, and exit without [running]"*). Consent is a property of *doing* the
sync, not of *describing* it — excluding a dry render from a consent-to-act gate states the gate's
real scope rather than special-casing the test.

Change: guard the gate with `[ "$PRINT_INNER" != "1" ]`, and note the exemption in the gate's header.

### Rejected alternatives

- **Make the render test not pass `--sync`** — it would stop exercising the sync arms (`--local`,
  `--ensure`, `--firebase` each swap different block strings), the exact places the render can break.
- **Have the test unset `CI`** — hides the real defect (a dry render blocked in CI) and would let a
  future change that genuinely can't render under CI slip through.
- **Let `--yes` override the CI arm** — wrong: `--yes` asserts a *human* agreed, which CI can't
  provide. The CI refusal for a *real* sync must stay unconditional. Only the no-op render is exempt.

## Verification

`CI=true bash tools/test-scaffold/run.sh` → all 6 files pass. A *real* `--sync --yes` under `CI=true`
still exits 1 with the refusal — only the dry render is exempt.
