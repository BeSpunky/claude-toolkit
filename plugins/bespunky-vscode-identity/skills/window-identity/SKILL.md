---
name: window-identity
description: Give a project's VSCode window a recognizable IDENTITY — an emoji in the window title (dock / Alt-Tab / window switcher) plus a quiet, design-system-coloured band on a bar — so that when several projects are open in several windows they stop looking identical, WITHOUT Peacock's whole-window glow. Use when the user says windows are hard to tell apart, asks to colour/label/badge a project's window, mentions Peacock (or that it's too loud/ugly), wants a project-relevant window accent sourced from the design system, or asks to (re)apply / change / remove a window identity, switch which bar is coloured, upgrade the placeholder colour to the brand colour, or make it personal vs team-shared. This skill is the INTELLIGENCE half: it finds the project's design-system primary colour and a project-fitting emoji, then invokes the `@bespunky/nx-tools:window-identity` generator (the deterministic writer) with them. Colours are DERIVED, never hand-typed — from the design-system primary when one exists, else from a stable hash of the project name, so a window is distinct from birth and later SNAPS to the brand colour when the design system arrives. Requires an Nx workspace with @bespunky/nx-tools (the generator runs there); it is wired into the scaffold/--repair baseline, so most house projects already have a name-hash identity and this skill's main job is enriching the emoji and upgrading the colour to the design system. NOT for general VSCode settings, themes, or colour-theme design — only the per-window identity (window.title + the identity bar colours).
---

# window-identity — make each window recognizable, sourced from the project

Multiple VSCode windows look identical, and that's the whole problem. Peacock "solves" it by flooding the
activity bar + status bar + title bar with loud, fully-saturated colour — a glow that hurts to look at and
means nothing about the project. This does the opposite: **a project glyph and a quiet band, both derived
from the project itself.**

You are the **intelligence**. The [`@bespunky/nx-tools:window-identity`](../../../project-starter/skills/new-project/assets/nx-tools/src/generators/window-identity/generator.ts)
generator is the **deterministic writer** — it owns `.vscode/settings.json`, does all the colour math, merges
instead of clobbering, and enforces the no-clobber ratchet. Your job is the two things a generator can't do
well: **find the design-system primary colour**, and **choose an emoji that fits this project**. Then you call
the generator with them. Never hand-edit `.vscode/settings.json` — that's the generator's file (the house rule:
extending the scaffolder is generator work, never a hand-written file edit).

## The one command

```
nx g @bespunky/nx-tools:window-identity \
  --primary=<hex>        # the design-system primary; OMIT to derive from the project-name hash
  --emoji=<glyph>        # a project-fitting emoji; OMIT to keep the current one / a neutral default
  --surface=status       # status (default) | title | titlebar | both
  --source=design-system # name-hash | design-system | manual  (usually inferred — see the ratchet)
  # --personal           # git-ignore the identity instead of committing it team-wide
```

Everything is optional. Running it with no flags on a house project is a valid no-op-ish refresh.

## Step 1 — find the design-system primary (the colour)

1. **Locate the design system.** It's the library tagged `type:design-system` (fallback: a library literally
   named `design-system`). No design system yet → skip to the name-hash path (step 1c).
2. **Read the primary token.** Open the design system's token stylesheet (its `styles/` — CSS custom
   properties). Find the semantic PRIMARY colour token (e.g. `--ds-color-primary` / brand / accent). Resolve
   it to a hex. That's your `--primary`.
3. **Guard against placeholders.** The `design-system` generator seeds **loudly-marked placeholder** token
   values so the library compiles before the design phase runs. If the primary is still an obvious placeholder
   (a flat `#f0f`, a `/* PLACEHOLDER */` marker, the generator's default), it is **not a real brand colour** —
   do NOT pass `--primary`. Fall through to name-hash and tell the user why (the colour will upgrade itself
   once they've designed real tokens).

When there's no real primary, **omit `--primary`**: the generator hashes the project name into a stable,
distinct hue. Every project is recognizable immediately; the colour is still project-relevant (its own name),
just not yet on-brand.

## Step 2 — choose the emoji (the glyph)

Infer one from what the project IS — its name, domain, product. A payments app → 💳, a maps SDK → 🗺️, a garden
app → 🌱, this toolkit → 🧰. Keep it a single, legible glyph. If nothing obvious fits, or the choice is a
close call, **propose 2–3 and let the user pick** — this is a visible, personal mark and worth a beat of their
input. Omit `--emoji` only when you want to keep whatever emoji is already set.

## Step 3 — surface & scope (usually just defaults)

- **Surface** — default `status`: emoji + a band on the status bar. It always renders (no custom-title-bar
  dependency) and sits in constant peripheral view. Offer `titlebar` (identity up where you switch windows —
  needs `window.titleBarStyle: custom`) or `both` only if the user wants a stronger signal; `title` is
  emoji-only, no colour.
- **Scope** — committed by default, so the whole team shares the project's identity. Pass `--personal` only if
  the user wants their own private styling; warn them it git-ignores the *entire* `.vscode/settings.json`, not
  just the identity keys.

## The provenance ratchet — how colours upgrade without clobbering

The generator records where the colour came from in `.vscode/.window-identity.json`:
`name-hash < design-system < manual`. A run only writes when its source **ranks ≥** the recorded one. So:

- **name-hash → design-system.** The common upgrade. A project scaffolded before it had a design system
  carries a name-hash colour; once real tokens exist, re-run with `--primary=<brand hex>` and the band snaps
  to brand. (`--source` defaults to `design-system` whenever `--primary` is passed.)
- **A human's manual pick is terminal.** If the user hand-picks a colour or emoji, pass **`--source=manual`**.
  After that, no automated run — not a `--repair`, not a design-system re-derive — will ever overwrite it.
- **A `--repair` re-asserting name-hash can't downgrade** a design-system or manual colour: lower rank → no-op.

## When a project grows a design system — the offer

`bespunky-vscode-identity` ships a `SessionStart` hook that detects "a design system now exists but the window
identity is still the `name-hash` placeholder" and **relays that fact so you can offer the upgrade** — it never
runs it. When you see that notice (or the user asks), do Step 1 to get the real primary and re-run with
`--primary`. If the primary is still a placeholder, say so and leave the name-hash colour in place.

## After writing

VSCode applies `window.title` and `workbench.colorCustomizations` **immediately** — no reload needed. If the
user chose a `titlebar`/`both` surface and the title-bar colour doesn't show, their title bar is the OS-native
one; adding `"window.titleBarStyle": "custom"` fixes it (mention it; don't force it).

## Boundaries

- **Nx + @bespunky/nx-tools required** — the generator runs there. In a non-Nx repo, there's no writer; say so
  rather than hand-editing settings.
- **Only the window identity** — `window.title` and the identity bar colours. Not general VSCode settings, not
  colour themes, not design-system token design (that's `bespunky-design-system:design-tokens-and-theming`).
