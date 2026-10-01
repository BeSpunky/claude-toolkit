<!-- Seeded by @bespunky/nx-tools@{{NX_TOOLS_VERSION}} (project-starter {{PLUGIN_VERSION}}) for the layers {{LAYERS}} -->
# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

<!-- This file was SEEDED by `@bespunky/nx-tools:house-doc` because the repo had no CLAUDE.md to host the
     generated house pointer — with sections chosen by this project's layers. Everything OUTSIDE the
     `@bespunky/house-tooling` markers is yours: it is never rewritten by a sync. Fill in the prompts below
     (the new-project skill does this on a scaffold), delete the ones that don't apply, and add your own. -->

## Project Overview / Intentions

<!-- What this project is for, who uses it, and the core domain — 2-4 sentences. -->

## Conventions

<!-- This project's own conventions. The house-wide ones are in the imported HOUSE.rules.md; the mechanics in HOUSE.md. -->
{{#angular}}- **Component/Directive prefix**: `<!-- prefix, derived from the project name -->` (update as the project grows).
{{/angular}}{{#design-system}}- **Styling**: SCSS — but **every visual value comes from the design system**, never from the component. Summon it with `@use 'design-system/styles' as ds;` and read tokens (`ds.color('on-surface')`, `ds.space(3)`); a component's own SCSS should be little more than layout. The rule is `HOUSE.rules.md` → **Design-system-first** (already in context); the mechanics are `HOUSE.md` → **The design system**.
{{/design-system}}{{#monorepo}}- **Layout**: apps in `apps/`, libraries in `libs/`, publishable libraries{{#design-system}} (incl. the design system){{/design-system}} in `packages/`; one Nx project each.
{{/monorepo}}
