# Audit 4 — skills, hooks, docs (2026-10-01)

## Already agnostic
workflow: feature-package, project-standing, session-handoff, delegate-and-parallelize + their hooks. engineering: architect-mentality, software-design (examples aside). product-ux: most skills. house-doc mostly layer-gated.

## house-doc templates
- `HOUSE.rules.md.tpl:78-80` Generator-first says `nx g` always → generic core + `{{#nx}}` block (flag doesn't exist yet).
- `HOUSE.rules.md.tpl:84` names 4200 for every repo — **README:326 claims non-web repos aren't told; README is currently wrong.**
- `HOUSE.rules.md.tpl:28-31` DS directive names SCSS, `::ng-deep`, `nx g ds-component` → gate within block.
- `HOUSE.md.tpl:9` "Monorepo: Nx", `:14` typescript-node devcontainer, `:302-330` Common Commands all `nx …` (and `{{^angular}}` branch pushes `nx add @nx/angular`) — ungated.
- "Regenerated to match the installed @bespunky/nx-tools" in HOUSE.md / pointer / CLAUDE.seed → name "house tooling".

## Hooks
- `project-starter/hooks/check-house-version.sh`: marker HOUSE.md (agnostic), version from plugin's own payload (agnostic); stamp key `nx-tools=`; layer-drift probes (207-214) Nx-shaped/greps → share detectors with registry.
- `vscode-identity/hooks/check-window-identity.sh:47-55` detects DS only via Nx tag; skill says requires Nx — concept is stack-free, writer is an Nx generator.
- `bespunky/hooks/tips.mjs` + voice hooks assume `node` on PATH (native installer doesn't guarantee it) → skip silently when absent.

## workflow
- branch-and-release:40-46 Nx daemon override (already scoped) → reference; 60-72 `nx serve --worktree` → reference under web layer. **Flag drift:** skill `--portOffset=auto`/`--dryRun` vs HOUSE.md `--port-offset`/`--dry-run`.
- local-server-isolation: description lists `nx serve`, Firebase; body Firebase section → generic fixed-port-backend pattern + Firebase reference.
- `workflow/tips.txt:9` 4200.

## browser-automation
- playwright/SKILL.md: "Angular-rendered", `localhost:4200`, `yarn playwright codegen`, "wait for Angular", `@nx/playwright`, `nx serve`, **dead ref to nonexistent `serve-and-share` skill**, "pre-installed in BeSpunky devcontainer".
- shared-browser/SKILL.md built around `nx serve`; the CLI is the stack-free core.

## design-system (biggest repackaging candidate)
- design-system-first: trigger + body Angular/SCSS (`::ng-deep`, `@Input() variant`, `nx g ds-component`) — discipline is universal → generic smells + adapter.
- design-tokens-and-theming: core agnostic; references encapsulation (Angular), SASS, ng-packagr entry points → per-framework adapters; SASS as the house author-time choice, not the definition.

## engineering
- angular-architecture, angular-native-wrappers: honestly Angular → optional `bespunky-angular` plugin.
- nx-monorepo-and-dx: honestly Nx → optional `bespunky-nx` (or stay).
- typed-reactive-navigation: core SKILL.md is Angular Router-specific despite `reference/angular-techniques.md` existing → neutral core.
- architecture-first:26 `::ng-deep` in a universal smell list; advanced-typescript:9 frames TS as Angular's companion.

## product-ux
realize-the-vision + 7 references have "On the house stack (Angular / Nx)" sections → "On your stack", read layers from the HOUSE.md stamp.

## project-starter docs
README:12 project-starter row, :456-476 "How the scaffolder works" leads with Nx/Angular, :354 hard-codes `packages/design-system`; `project-starter/tips.txt` "Nx + Angular".
