---
effort: toolkit-mods
status: concluded
concluded: 2026-10-03
summary: Toolkit state now shows as live Claude Code UI under one ✦ bespunky brand — branch-model status line, /standing pane, house sync band, checkpoint and identity toasts, shared-browser status, voice health; spinner tips stay as they are (no mod surface for them).
tags: [mods, ui, workflow, project-starter, voice, browser-automation, vscode-identity, brand]
---

# Toolkit mods — decision

> "Review our toolkit and suggest mods" → seven suggestions → "Send an agent for each" → "try them out" → "done, ship it"

## What shipped

| Mod | Plugin | Surface |
|---|---|---|
| Branch model (`✦ bespunky · feat/x → development → main`, protected-line warning, violation count) | workflow | status line |
| `/standing` — efforts in flight with a one-line *about*, Resume buttons; concluded collapsed to one line | workflow | pane + branded command row |
| Checkpoint saved → path, on compaction | workflow | toast |
| House sync band — Sync / Update toolkit / Fix, dismissable | project-starter | band above the prompt |
| Window identity upgrade hint, once per project | vscode-identity | toast |
| Shared browser noVNC URL, warning when the host forward is unconfirmed | browser-automation | status line |
| Voice engine health — Piper / whisper broken or missing | voice | existing voice band |

Every detector the mods show is the existing script, given a machine-readable mode (`--json`, `--tsv`, `--last`) whose human/model text stayed byte-identical. No logic was re-implemented in TypeScript.

## Decisions, and the words that made them

- **Additive: the model-relay SessionStart hooks stay.** Every unit independently recommended against retiring its relay: the UI only reaches the person; the relay is what teaches Claude to offer the next step, and the only path in headless runs and builds without mods.
- **One hooks module per plugin** is an engine rule (validate refuses a second `modules` entry) — workflow composes its three mods in `hooks/mods.ts`.
- **Spinner tips: not built.** The mod API has no tip surface (`Spinner` props are word/message/suffix/mode; replacing the tree loses elapsed/tokens; `$.settings.read` is a read-only snapshot). `tips.mjs rotate` stays the only path.
- **`/standing` readability.** User: *"The standing panel looks like it's gonna be unreadable … only the concluded section has items and it's overloaded"* → lead with the answer, collapse Concluded, and scan every worktree (live work lives on its own branch — it showed 0 live while this effort was in flight).
- **A package is born with one line.** User: *"A feature name might not mean anything to me if I come back to it after a month. I need a one-line summary of what a feature/fix is about"* → *"yes, add the rule"*. `DECISION.md` is created with the worktree carrying `effort:` + `summary:` (what it is for), rewritten as the outcome at the gate. Written into feature-package, branch-and-release, the HOUSE.rules.md template (payload 0.38.2, nothing to migrate) and the README.
- **Branding.** User: *"Toolkit mods should clearly show they come from the toolkit and not from Claude or any other plugin. Let's do branding"*. One source, `tools/mod-brand/brand.tsx`, projected into each mod plugin's `hooks/_brand.tsx` with a CI drift check — plugins can't import each other. Violet `#8b5cf6` (a raw colour: theme keys are Claude's palette).
- **Status lines spell the name.** User: *"I'm talking about the orange branching model we added. It's not branded"*. Claude Code colours a plugin's status line from a plain string, so the accent can't reach it; `brandStatus()` writes `✦ bespunky · …` instead. Toasts keep the glyph alone (the engine titles them with the plugin).
- **Spacing and separation.** Bands start one row below the transcript; standing items are divided by a dim rule, a slug and its about line kept together; the pane says `/standing reopens it`.

## Roads not taken

- Moving the branch model into a band (a whole row for a glanceable fact, competing with voice and sync) or the prompt-hint tail (dim, no colour — no better than the status line).
- Tips in `PromptHint` / `AbovePrompt` / `InfoNotice` — a new UI tips were never meant to have.

## Follow-ups

- `plugins/voice/scripts/listen.sh` still has its own whisper existence check; it can now use `voice_stt_verdict` (held back to avoid colliding with the Silero branch, which has since landed).
- The person-closes-the-pane toast path is untested (the test engine cannot raise a person's close).
- Detect-standing: recent activity in any worktree now quiets the dormant notice for all efforts; revisit if that proves too quiet.
