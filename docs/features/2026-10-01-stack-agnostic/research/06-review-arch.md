# 06 — Review: architecture (reviewer `arch`)

Paths are relative to `plugins/project-starter/skills/new-project/assets/` unless they start at the repo root.
Repros: `scratchpad/review-arch/t.cjs`, `t2.cjs`. Each one compiles the payload the same way test-layers does, then
calls `detectLayers` and `plan` on devkit Trees.

## Verdict

The seam is mostly real. Layers are one descriptor each. `layers.sh` is generated. Capabilities reach apps through
adapter ports, and a missing port is reported instead of crashing. No layer list is duplicated.

Three defects stop it from being genuinely agnostic:
- The plan stamps and composes layers it never applied (A1).
- One layer's contributions only arrive through another layer's generator (A2).
- Several "neutral" rules still name one stack, or are hand-copied rather than derived (A3–A6).

Adding React/Vite is **not** one file plus a registration. You would have to touch:
1. `layers/react.ts` and `REGISTERED`.
2. `adapters/react.ts` and `ADAPTERS`.
3. `layers/web.ts`. Its `ensurable.scaffold: {via:'angular'}` only holds one id, so `Ensurability` has to change (A3).
4. The house-doc templates, for the `react` doc sections.
5. `presets.ts`, if you want a preset.
6. The `app` error text, which names `@nx/angular` (`generators/app/generator.ts:60`).

Python has its own problem (A4).

## Findings

**A1 — major. `layers/plan.ts:45,73` and `layers/agent.ts:94,98`: unmet layers are still stamped and composed.**
- **Evidence:** `t2.cjs` runs a wrapper repo (no package.json) with ensure `nx,agent,firebase`. The plan warns
  "firebase … SKIPPING", yet still emits `devcontainer --layers=nx,agent,firebase` and `house-doc --layers=nx,agent,firebase`.
- **Effect:** the devcontainer gets the JDK, the Firebase CLIs and the emulator ports, which is the exact regression
  `scaffold.sh:471-476` describes. The stamp also claims Firebase was applied.
- **Second defect:** the hint says `--ensure=node … where a sync can ensure it`, but `node` is `sync:false`, so that
  command is refused.
- **Fix:** pass the plan's *eligible* set (not `active`) to `--layers` and the stamp. Also refuse an unmet requirement
  that can't be ensured in the outer shell when the mode is sync.

**A2 — major. `generators/claude-settings/generator.ts:61` is the only caller of `gitignoreBlocks`.**
- **The problem:** the `.gitignore` contributions from `nx`, `node`, `js` and `firebase` are only written when `agent` is
  active.
- **Evidence:** in `t.cjs` case A (Nx node app, no agent) there is no `claude-settings` step, so `dist` and
  `.nx/workspace-data` are never ignored.
- **Fix:** this is a floor concern. Give it its own ungated step.

**A3 — major. `layers/web.ts:343` hardcodes `{via:'angular'}`, and `Ensurability.via` only holds one id.**
- **Effect:** a second app-creating stack cannot ensure `web` at scaffold time. `layers.sh:83` emits `via:angular`.
- **Fix:** let `via` mean "any layer whose adapter has an `apps` port".

**A4 — major (design). `generators/devcontainer/compose.ts:81-85`: the last image wins, and the base image's features
are dropped with it.**
- **Effect:** a Python layer registered after `node` would silently remove Node from a Python+Node repo. The
  `claude-code` feature and `node-install` both need Node.
- **Why it matters:** a second runtime is not a natural case under this model.

**A5 — major. `web` evidence `targets:['serve']` (`layers/web.ts:342`) matches any Nx app, including backends.**
- **Evidence:** `t.cjs` case A (an `@nx/js:node` API) detects `web`.
- **Without agent:** every plain sync is `SYNC_PARTIAL`.
- **With agent:** the API is composed as a browser app. The engine passes `--port=${PORT:app}` with `ready http '/'`
  (`generators/dev/fragments/nx.ts:49-53`). On `@nx/js:node`, `--port` is the inspector port. That last point comes from
  Nx docs; `@nx/js` is not installed here.

**A6 — minor. Duplicated rules.**
- Package manager, 3 copies: `scaffold.sh:245`, `_utils/package-manager.ts:17`, `post-create/node-install.sh.tpl`.
- Nx host, 3 copies: `scaffold.sh:544`, `_utils/nx-host.ts:8`, `nx-wrapper.sh.tpl`.
- Two different functions both named `nxInvocation`: `house-doc/generator.ts:295` and `dev/fragments/nx.ts:26`. The
  house-doc one has an orphaned JSDoc at lines 284-288.
- "Is this Angular": adapter `ANGULAR_BUILDERS` (`adapters/angular/index.ts:34`) vs the layer evidence
  (`layers/angular.ts:477`, which lacks `@nx/angular:`).
- 4200, 3 copies: `layers/angular.ts:500`, `layers/firebase.ts:595`, `dev/fragments/nx.ts:19`.
- Emulator ports, 3 copies: `firebase-emulators/generator.ts:96`, `layers/firebase.ts:606`, `dev/fragments/firebase.ts:20`.
  The devcontainer list is static and is not read from `firebase.json`.
- "The workspace stack with port X" is open-coded 4 times: `app/generator.ts:55`, `design-system/generator.ts:100`,
  `firebase-emulators/generator.ts:225`, `adapters/registry.ts:44`.

**A7 — minor. A third registry outside the descriptors.**
- `generators/dev/fragments/index.ts:16-17` holds `STACKS`/`CAPABILITIES`. Firebase's dev fragment lives there, and its
  own comment at line 13 says it is waiting for "phase 4", which has already landed.
- The stack's default dev port belongs on `DevServerPort`.

**A8 — minor. Patch smells.**
- `app` has the legacy `--firebase` true/false override (`app/generator.ts:37,74-75`).
- `scaffold.sh:371` hard-codes the `functions` exclusion. This one predates the branch.
- `PlanContext` carries `staging`, `voice` and `nodeMajor` (`descriptor.ts:73-79`). That means a layer with its own
  parameter needs edits in descriptor, cli and scaffold.
- `safeDetect` (`registry.ts:107`) and `safely` (`adapters/registry.ts:93`) swallow errors without a log, and `safely`
  uses a cast as its fallback.

**A9 — minor. Dead weight and other leftovers.**
- `migrationScope` has no reader (`descriptor.ts:148`).
- `type Layer` has no users (`registry.ts:37`).
- The `why` on `formatOnSave` describes Claude permissions (`layers/agent.ts:127-133`).
- There is a circular import: `layers/registry` → `web`/`firebase` → `adapters/registry` → `layers/registry`.

## Suspicions (unverified)
- The `@nx/js:node` `--port` semantics in A5 come from memory of the Nx schema.

Agents spent: 0.
