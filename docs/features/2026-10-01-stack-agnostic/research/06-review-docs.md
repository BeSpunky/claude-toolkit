# Review — docs (claims vs behaviour)

Reviewer id: `docs`. Agents spent: 0. Method: read every changed doc / template / description; rendered house-doc
(compiled payload, `@nx/devkit` Tree) for Python wrapper agent-only, Python+web (dev.json), angular+DS+firebase,
node+firebase (no web), node+web(dev.json)+firebase, node+js+design-system (no angular); checked flags against
schemas, `generators.json`, `layers.sh`, `tools/dev/files/dev.mjs.tpl` and the serve executor; resolved every
`bespunky-<plugin>:<skill>` id and every relative reference link.

## Findings

**D1 — major — `house-doc/HOUSE.rules.md.tpl:88`.** The always-on Firebase block tells the agent to run
`{{NX}} serve <app>` from a worktree and `--no-emulators`, gated only on `{{#firebase}}`. Rendered for
node+firebase (no `web`) it says `npx nx serve <app>` — no such target; HOUSE.md in the same render correctly
says the suite runs alone via `nx run firebase:emulators`. For node+web(dev.json)+firebase it says
`npx nx serve` while HOUSE.md says `tools/dev/dev serve … --skip=emulators` (and the engine refuses
`--no-emulators`). Fix: use `{{SERVE}}`, `{{#nx-serve}}`/`--skip=emulators`, and gate the serve advice on `web`.

**D2 — major — `house-doc/HOUSE.md.tpl:17-90`.** The design-system section is gated on `design-system` only
but is Angular: `inject(DsTheme)`, `inject(DsRuntimeTheme)`, and `ds-component`, which
`ds-component/generator.ts:51` refuses without `angular`. `design-system` requires only `nx` and has a neutral
core binding (`design-system/generator.ts:95-101`); rendered for nx,agent,node,js,design-system it shows all of
it. The same overclaim: the layer table (README; new-project SKILL.md:149: design-system "owns" `ds-component`,
`secondary-entrypoint` — both `requireLayer('angular')`), the `design-system-first` description ("in a house
project with the design-system layer, `nx g …:ds-component`") and `plugins/design-system/tips.txt`. Fix: gate the
Angular parts on `angular`, and say "Angular adapter" where ds-component is named.

**D3 — minor — `commands/sync.md` (*The rest*, `[layers] ensure nx`).** It says that after a plain `/sync`
"the floor is all they got", and it offers `--ensure=agent` as the way to get `HOUSE.rules.md` + `HOUSE.md`.
That is wrong: `cli.js plan --active=nx` emits `house-doc` (verified), so a plain sync already writes both
house docs and seeds `CLAUDE.md`. The README layer table and the new-project description make the same claim
when they list HOUSE.md under `agent`.

**D4 — minor.** `bespunky-communication` is enabled by `layers/agent.ts:104`, but the plugin lists in
new-project SKILL.md:25 and in README (the claude-settings bullet and the post-create list) leave it out.

**D5 — minor — stale descriptions.** These descriptions still describe the old behaviour:
- `project-starter/.claude-plugin/plugin.json` still says "integrated Nx monorepo + Angular".
- The marketplace `bespunky-project-starter` entry's layer list leaves out `node`, and it frames the scaffold as an Angular one.
- The marketplace `bespunky-browser-automation` entry says "Loaded by default in scaffolded projects", but the plugin now comes only with `web`.

**D6 — minor — `HOUSE.md.tpl:221`.** In the non-Angular branch, the text still says "only works on the main tree at
`:4200` … add `http://localhost:4200`". I rendered it for node+web+firebase to confirm. This contradicts the
README's promise that only Angular repos are told 4200.

**D7 — minor — new-project SKILL.md:37.** It says "the flags are the engine's … `--no-emulators`,
`--configuration=`". `tools/dev/dev`'s `parseArgs` throws on both as unknown flags. They exist only on `nx serve`.

**D8 — minor — `local-server-isolation/reference/firebase-emulators.md:7`** (and the parenthetical in
HOUSE.rules.md.tpl:88). The page says to "reuse the running suite" via `--no-emulators`. But that flag adds
`?emulate=none`, which means every service is real (`dev/fragments/firebase.ts:73`). So the advice contradicts itself.

**D9 — minor.** HOUSE.md.tpl:285 and the serve `schema.json` both promise an "arrow-key picker". The engine's
picker is actually a numbered readline prompt (`promptForWorktree`). Separately, the `--dry-run` row says it prints
"layers", but the engine prints none.

**D10 — minor.** Several unnamespaced references now cross into another, optional plugin:
- `angular-architecture`, from `engineering/skills/{typed-reactive-navigation,resumable-state}/reference/angular-techniques.md:3`.
- `architect-mentality` and `architecture-first`, from the moved `bespunky-angular` skills.

**D11 — minor.** When web is declaration-only and Firebase is present, HOUSE.md says `tools/dev/dev serve <app>`
"boots the emulator suite". That is not true: the `dev` generator seeds the `emulators` process only for Nx-served
apps (`dev/generator.ts` `servedProjects`).

## Suspicions (unverified)
- `nx serve <app> --worktree` with no value: Nx may hand the executor `true` instead of `''`, so the
  documented picker may never trigger through Nx.
- This repo's own `HOUSE.md` is still stamped `0.29.0` and teaches `--nonAngular`. That predates this branch: the
  dogfood was never re-synced.

## Verified accurate
- Every skill id resolves, and so does every reference link.
- The layer and preset tables match `layers.sh`.
- `scaffold.sh --help` matches the docs, and so do the sync messages that sync.md quotes.
- CLAUDE.md's descriptions of the registry, wrapper host, adapters, `dev.json` and composed devcontainer are accurate.
- "A sync ensures nothing above the Nx floor" holds.
- The shared-browser verbs and Nx targets match.
- `publishable-lib --stack` and the `--nonAngular` alias work as documented.
- The serve executor maps its flags to the engine as documented.
- The Python agent-only render had no yarn, 4200 or Angular in it.
