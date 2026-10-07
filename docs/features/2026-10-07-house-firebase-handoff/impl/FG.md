# FG — review round: the platform firewall, house lint, the a11y shell (R8, R9-8, the FH firewall shape)

Branch `feat/house-firebase-handoff--fg`, worktree `hfh-fg`. Written as it happens. Binding decision (DECISION.md,
review round): the classifier reads imports the way lint does (TypeScript, never a regex), apps take their stack's
platform, unknown evidence is reported, never defaulted to shared.

Reproduction: R8's probe (`scratchpad/r8/probe.mjs`, re-pointed at this worktree as `scratchpad/fg/probe.mjs`) on
the unfixed payload printed exactly R8's table — `b` (a comment) server, `c` (a spec) server, `d` (template literal)
shared, `e` (`node:fs`) shared, `f` (a string) web, the SSR app `null`. Every finding below was reproduced (by that
probe, by reading Nx 23.1's sources from a scratch install, or by a failing fixture) before it was fixed.

## Facts read from Nx (scratch install of @nx/eslint-plugin, @nx/eslint 23.1.0)

- `enforce-module-boundaries` visits ImportDeclaration, ImportExpression, ExportAll/ExportNamed and
  `require(…)`/`require.resolve(…)` CallExpressions — string `Literal` only (no template literal, no
  `import x = require`). No `importKind` exemption for the bans.
- **It cannot ban a Node built-in**: an import that resolves to no graph node returns early ("including node
  internals"). Bans only apply to npm external nodes. `bannedExternalImports` patterns are `^…$` regexes with `*` → `.*`
  — `firebase` matches only `firebase` (the old `matchesExternal` also matched `firebase/app`).
- A project matching NO constraint of an instance that has constraints gets "A project without tags matching at least
  one constraint cannot depend on any libraries" — only for workspace-project imports.
- @nx/eslint/plugin's createNodes glob includes `**/project.json` and `**/package.json`, and Nx filters a plugin
  entry's files by `include`/`exclude` (minimatch, `dot: true`, ordered negation) — so an entry CAN be scoped by project root.

## The platform firewall — the design

**Its own rule instance.** @nx/eslint-plugin is registered a second time under the `platform` namespace and the
firewall is `platform/enforce-module-boundaries` over a top-level `const platformConstraints`. Why: ESLint replaces a
rule's options wholesale per config block, so any per-file scope (SSR server code, tests) on the project's own
`@nx/enforce-module-boundaries` would have had to copy every constraint the project ever wrote. A separate instance
scopes only the firewall, and — because its only constraints are platform ones — an untagged project is checked too
(the message above), which closes R8-2 for imports of workspace projects. Verified with real ESLint 9 +
@nx/eslint-plugin 23.1 in `scratchpad/fg/lintws` (the config rendered by the payload's own writer): web lib importing
an untagged lib and a server lib → 2 errors, `express` in web → error, `node:fs` → no error (as read), SSR
`src/server.ts` / `src/server/api.ts` importing express + a server lib → clean, `*.spec.ts` and `vite.config.mts`
importing express → clean, an untagged tooling project importing a lib → the "without tags" error.

## Findings

| # | Verdict | What was done |
| --- | --- | --- |
| R8-1 | fixed | `platform/imports.ts`: an AST walk over exactly Nx's five visitor forms (string literals only). `ts.preProcessFile` was tried and rejected: it also returns template-literal imports and `declare module` names, and misses `require.resolve` — three disagreements with lint. Comment/string/template now no evidence (fixture). |
| R8-2 | fixed | Apps take their stack's platform when the stack is bound (`basis: 'stack'`); contrary imports are reported as what lint will flag (`conflicts`), except in the SSR server scope. Untagged projects are checked by the firewall's own instance. |
| R8-3 | fixed | Table: `+ @google-cloud/*, firebase-functions-test(/*), express(/*)` server; `+ @firebase/*, rxfire(/*)` web. Node built-ins are server EVIDENCE only (`isNodeBuiltin`: `node:*`, and bare names without a same-named browser package — `events`, `buffer`, `util`, … are excluded), never written as bans, because Nx cannot ban them (above). No evidence → `undefined`, REPORTED ("Left `x` without a platform … State it: …"), never tagged. `matchesExternal` now mirrors Nx's regex exactly. |
| R8-4 | fixed | `readDeclaredBans` reads `platformConstraints` (or the 0.49 constraints); `platformExternals(tree)` = table ∪ declared (web's bans → server-bound, server's → web-bound, a shared-only ban → `unsided`, which leaves a project unplaced). Fixture: a `pg` ban added to web makes a `pg` library server. |
| R8-5 | fixed — decided | One table, `platform/scopes.ts`, read by both halves: tests (`*.spec|test.*`, `test-setup.*`, `e2e/ __tests__/ __mocks__/`) and tool configs (`*.config.*` outside `src/`) **never ship**: no evidence, and the firewall block turns the rule off for them. A spec seeding the emulator through firebase-admin is legitimate. |
| SSR (D1) | fixed — decided | `src/server.ts` and `src/server/**` are the SSR server scope: in a `platform:web` project the web constraint is relaxed there (it may reach server projects and server packages); server/shared constraints are unchanged on those paths. No `platform:server` sub-tag: a tag is per project, the scope is per file. |
| R9-8 / D3 | fixed | Only CODE projects are classified: tagged `tooling` (the house already tags shared-browser, worktree-domains; the emulator suite now too), or nothing imports it and it has no shipping file / no role, stack, code target, or platform-bound import. Tooling is left untagged and unmentioned. The suite keeps its 0.49 `platform:server` (its files run in Node; dropping it would fail lint for any suite file importing a project). |
| FH (orchestrator) | fixed | The ≤0.35 comment wording ("browser/SSR Angular code", "SDK and Angular", 1ac9b19 / 0d09453) is now a shipped shape (`LEGACY_COMMENTS`); two historical shapes in the rung's case (prettier-formatted, and unindented as inserted) — both converge with the canonical case. |
| D4 | agreed | One import reader (`imports.ts`) for classifier, `platform` generator, migration and sync generator. |
| D5 | fixed | `platform-sync`, an Nx sync generator registered on `targetDefaults.<lint>.syncGenerators` (by the firewall's first insertion and by the rung): before lint, an untagged project whose evidence settles is tagged; `nx sync:check` fails CI while one is not. Reads only untagged projects' sources. The guidance comment now also explains the "without tags" message. No `generators` defaults: a default tag would be a guess. |
| D2 | partly agreed | For APPLICATIONS the stack decides. For libraries the Angular stack still counts as web evidence: an ng-packagr library is built for the browser toolchain (Angular package format) and imports `@angular/*` in practice; a model library meant for functions belongs to the js stack. |

The 0.50.0 rung `close-the-platform-firewall` was reshaped, not stacked: it moves the 0.49 constraints out of the
project's rule (with their comment, every wording), writes the firewall, carries the project's own ban edits (added
stay banned, removed stay allowed — both reported; other keys reported), registers the sync generator, classifies.
