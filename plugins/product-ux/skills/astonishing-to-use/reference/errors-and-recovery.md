# Errors & recovery

The principle: **when something is wrong, the user must instantly know *what* is wrong, *where* it is, and *how to fix it* — and be carried to the fix, never left to guess or hunt.** An error is a moment of friction and a little spike of anxiety; astonishing-to-use design dissolves both. (And the best error is the one you prevented.)

## Prevent first

- The cheapest error is the one that can't happen. Constrain input so bad data is hard to enter (the right or invented control — `facilitating-input.md`), and **validate forgivingly and inline as the user goes**, not only on submit.
- **Don't validate too eagerly.** Don't shout "invalid email" while they're still typing it; validate at the honest moment (on blur, on submit), and **clear the error the instant it's resolved**.
- **Never punish with re-entry** — preserve what they typed; never wipe a field or the form on error.

## Be informative — never "what's wrong?"

When validation fails, the message must **explain and instruct**, in the user's words — never leave them thinking *"what's missing? I don't understand what's wrong."*

- Say *what* is wrong and *why*, and *how to fix it* — "Password needs at least 8 characters," not "Invalid"; show what a valid value looks like.
- **Never** a bare red border, a generic "Error," or a raw code standing alone.
- Put the explanation **at the problem**, not only in a far-away summary — the message lives where the field is.
- Keep it **kind and blame-free** — the user isn't careless; the form asked unclearly.

## Take the user to the problem

A user facing a submit button that "did nothing," or a long form with an invalid field they can't see, is lost. **Bring them to it:**

- **If the problem isn't in the viewport, move the viewport to it** — smoothly scroll the first invalid field into view (`continuity-and-transitions.md`), *or* offer an explicit **"take me there"** / "review the N issues" affordance that jumps to each.
- **Focus the offending control on arrival**, so they can fix it immediately — cursor and keyboard ready, no extra tap.
- **Several problems?** Give a summary (a count, a list that *links* to each) **and** mark each inline, and let them step through one by one.

This is `keep-users-oriented` for the error case — *what's wrong* (the message), *where* (scroll + focus), *what next* (fix this, then carry on).

## Recovery — no dead ends

Every error has a way forward; never strand the user. Preserve their input, offer **undo** for destructive actions, and keep "back" safe.

*Extrapolate beyond the form* — the same move fits any failure: a failed save, a dropped connection, an empty search, a 404. Each should say *what happened, why,* and *the next step,* and carry the user toward it. Form validation is just the most common case of one principle.

## Pitfalls

- **"Invalid" with no explanation** — a red border or generic error that leaves the user guessing.
- **The silent submit** — pressing submit does nothing visible because an unseen field is invalid; no scroll, no focus, no message in view.
- **Disconnected errors** — a top summary with nothing at the fields (or the reverse), so the user can't link message to control.
- **Over-eager validation** — erroring mid-typing, or failing to clear the error once it's fixed.
- **Lost work** — wiping input on error and making the user re-enter.
- **Dead ends** — an error state with no path forward.
