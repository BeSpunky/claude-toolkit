# DECISION — how the pitch discipline is delivered

*Live. Status frontmatter is stamped at the merge gate.*

## Decided

**An output style, not a skill.** Reading the room is a property of every sentence — including the
first of a session, and the ones where nothing looks like a trigger. A skill fires only when Claude
judges its `description` relevant, so routing this through a relevance check makes it absent exactly
where it is needed most: the throwaway-looking question answered in dense jargon before any skill
would have been considered. This repo has already made that argument once, for
`architect-mentality`; register is the same shape and takes the same answer.

**A new plugin, `bespunky-communication`.** It is a distinct concern — how Claude *speaks*, not how
work flows (`workflow`) or how code is designed (`engineering`) — and it is the only plugin that
would ever hold the exclusive output-style slot. Burying that in an existing plugin would hide the
one thing a consumer needs to make a decision about.

**Presentation only, enforced mechanically.** `keep-coding-instructions: true` keeps Claude Code's
built-in engineering behaviour intact. The style says nothing about how much design work to do, when
to confirm a refactor, or what to write down — so it cannot pull against a project's own always-on
rules. This was a real concern raised mid-design and this frontmatter key is the answer to it.

**Inert on install.** `force-for-plugin` exists (a plugin-only frontmatter option) and is
deliberately *not* set. An output style is exclusive — one active at a time — so installing the
plugin makes the style available and nothing more. Claiming a consumer's only slot without asking is
the toolkit reaching for a global behavioural switch in someone else's project.

## Ruled out

**A role/persona taxonomy** (tech lead, manager, CEO, architect, QA). This was the first framing and
the user cut it off directly:

> "To be clear, it's not about roles and positions. That was an example we can use as a reference."

Roles illustrate register; they are not an input to it. A lookup table of personas would be exactly
the special-casing the house rules refuse — and it fails on the ordinary case where one person
shifts register between two consecutive messages.

**`~/.claude/CLAUDE.md`** — proposed early, when the ask was three tone nudges. Correct for that
size, wrong once the ask became a standing discipline that should hold in the system prompt and ship
to consumers. Superseded, not deleted: it remains the right answer for a purely local preference.

**A skill carrying the depth, alongside the style.** Considered and deferred, not rejected. It would
cover the case where producing a stakeholder-facing artifact is itself the task ("write this up for
the CEO"). That is genuinely relevance-triggerable and would not belong in every turn's system
prompt — but nothing in the user's spec asked for it, and shipping it now would be building for a
brief nobody wrote.

## Corrected along the way

An early claim that a poorly-scoped output style could "loosen the engineering discipline" in a repo
with a strong `HOUSE.rules.md` was an overreach, and the user caught it: *"What? How are the two
related?"* They are not. Output styles replace parts of Claude Code's *own* built-in system prompt;
`HOUSE.rules.md` reaches the model through project memory (`CLAUDE.md` `@`-imports it) and is
unaffected by the active style. The only real residual risk was **instruction conflict** — a style
demanding brevity pulling against rules demanding design-before-code — which is why the style is
scoped strictly to presentation and sets `keep-coding-instructions`.

## Verified

- `claude plugin details bespunky-communication` with `--plugin-dir` — the plugin loads, the
  manifest parses, and it reports `Status: ✔ loaded`.
- `node tools/check-release-invariants/check.mjs` — passes at 10 plugins; the derived registry
  agrees with the new manifest.
- Frontmatter keys used (`name`, `description`, `keep-coding-instructions`) are the ones the loader
  recognises.

**Not verified here:** the style actually taking effect at runtime. `claude plugin details` does not
report output styles in its component inventory, there is no CLI command that lists them, and this
environment is not logged in, so an authenticated or interactive run was not possible. Selecting it
via `/output-style` in a real session is the outstanding check.
