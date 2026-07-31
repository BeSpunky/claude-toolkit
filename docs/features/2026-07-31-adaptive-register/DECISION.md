---
status: concluded
concluded: 2026-07-31
summary: Shipped `Pitch to the listener` as bespunky-communication — an output style (not a skill, because reading the room must hold on every turn) modelling conversation modes as a push/pop stack, plus shape, asking and report-brevity rules; auto-enabled and SEEDED into scaffolded projects via a new owned-vs-seeded distinction in the claude-settings generator.
tags: [output-style, communication, plugin, scaffolder, claude-settings, seeded-keys]
---

# DECISION — how the pitch discipline is delivered

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

**`force-for-plugin` still not set.** The option exists (plugin-only frontmatter) and would force the
style on *anyone* who installs the plugin. Auto-configuration is done instead through the
scaffolder's own settings generator, which is both narrower — it applies to projects the house
already owns the settings of — and reversible, because it seeds rather than forces. Superseded the
original "inert everywhere" stance without adopting the blunt instrument.

**Conversation modes are a STACK, not a depth dial.** The first version modelled mode changes as
zoom — overview versus detail — and the user named the gap:

> "Like a stack push/pop, Claude should intelligently deduced 'ok, this mode has been exhausted. I
> can now return to the previous one'. Ensure it's not a details vs. overview thing. We have many
> conversation modes in life. That's the focus."

So the model is now: many modes (planning, deciding, debugging, teaching, reviewing, negotiating,
catching up, joking), differing in purpose, pace, formality and what would even *count* as a good
answer; they **nest**; entering one is a **push** served on its own terms; and the half that gets
missed is the **pop** — returning to the mode underneath, clearly enough that the other person lands
there too. Depth shifts survive as the ordinary case, not the whole model. Two failure modes are
named because they are the ones that actually happen: **stranding** someone in the sub-conversation,
and **leaking** its register back into a parent it does not fit.

**Asking is governed: one question per MESSAGE.** First written as "ask exactly one question,
decide the rest," then corrected by the user — *"it's OK if there are multiple questions, just
separate them into multiple messages."* The rule is therefore about message shape, not about
suppressing questions. It also goes **last**, with nothing after it, and set off so it reads as a
question. (This effort produced its own evidence: an earlier turn asked two questions at the end of
one message, and neither got answered.)

**Auto-install and auto-configure — the user overrode the inert default.** The style ships enabled
in scaffolded projects, and `outputStyle` is written into `.claude/settings.json` by the
`claude-settings` generator.

**That required modelling a second class of house key**, which is the architecturally interesting
part. The generator's existing rule is one-directional: house keys are re-asserted on every sync so
drift heals. Correct for infrastructure — which marketplaces exist, which plugins are enabled — and
**wrong for `outputStyle`**, because only one style can be active at a time and a consumer choosing
a different one is a real decision. Re-asserting it every `--sync` would silently revert that: not
maintaining a standard, but overruling someone who already answered the question.

So `settings.seed.json.tpl` joins `settings.json.tpl`: **owned** keys are re-asserted, **seeded**
keys are written only where the project has no value of its own, then never touched again. This is
the same distinction the scaffolder already draws between class (A) owned template artifacts and
class (C) seeded-but-never-owned output — `outputStyle` is class C, and the generator simply had no
way to express that before. `deepSeed` judges absence with `in` rather than truthiness, so a project
that deliberately set `false`, `0` or `""` keeps it.

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

- The migrations question, re-interrogated at the merge gate: `claude-settings` runs inside the
  `agent` layer block, and that layer is **detected** (`tree.exists('HOUSE.md') ||
  tree.exists('HOUSE.rules.md')`), not ensured — so a plain `--sync` with no `--ensure` reaches every
  scaffolded project, re-asserts the new plugin key and applies the seed. No migration owed: the
  owned key is a class-A template artifact regenerated every sync, and `outputStyle` is class C
  (seeded, never owned). Nothing renamed, moved or retired, so there is no old state to clean up.
- `tools/test-scaffold/run.sh` — all scaffolder guard tests pass.
- `publish.sh --dry-run` — payload compiles and packs at 0.28.0, with both `settings.json.tpl` and
  `settings.seed.json.tpl` in the tarball.

**Not verified here:** the style actually taking effect at runtime. `claude plugin details` does not
report output styles in its component inventory, there is no CLI command that lists them, and this
environment is not logged in, so an authenticated or interactive run was not possible. Selecting it
via `/output-style` in a real session is the outstanding check.
