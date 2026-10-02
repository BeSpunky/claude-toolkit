# 07 — Fixes (fixer `fx-layers`, worktree sa-fix-layers)

Items from `handoffs/2026-10-02T00-review-fanout.md` → FX-layers. One entry per item, appended as it lands.

- **A1 (plan half) — fixed.** `layers/plan.ts` now computes the APPLIED set in one topological pass (a layer
  whose requirements are not all *applied* is skipped, so a skipped requirement takes its dependants down too)
  and runs every step through a context whose `active`/`ensured` are that set — so `devcontainer --layers`,
  `claude-settings --layers`, the new `gitignore --layers` and the `house-doc` stamp can only carry applied
  layers. The warning's remedy is per missing layer and per mode: `--ensure=<x>` only where this mode can ensure
  it, else the layer's own `ensureHint` (no more `--ensure=node` on a sync). Tests: test-layers
  "unmet layer (firebase without node, wrapper repo)…" and "a skipped requirement takes its dependants down".
  Consequence worth knowing: a present-but-unmet layer is now absent from the stamp, so the SessionStart hook
  reports it as drift (truthfully: its tooling was not applied); the notice is snoozable as before.
- **A2 — fixed.** New `gitignore` generator (floor concern) = the `nx` layer's workspace step, given the applied
  layers; `claude-settings` no longer writes `.gitignore`. Test: "an Nx node app without the agent layer still
  gets every applied layer's gitignore"; artifact tests now run `gitignore` beside `claude-settings`.
- **A5 — fixed.** `web` is no longer evidenced by "a target called `serve`". Its evidence (and the plan's
  "is this app Nx-served" check) is one `NX_SERVED` rule in `layers/web.ts`: a `dev-server` target, the house
  composer executor, or a dev-server executor a registered stack recognises (`DevServerPort.recognises`, new) on
  any target — so a fresh Angular app with its dev-server still on `serve` is web, an `@nx/js:node` or uvicorn
  `serve` is not. Verified against the real `@nx/js@23.1.0` executor schema (packed in scratch): its `port` is
  "The port to inspect the process on", default 9229. Fixtures: "node API served by @nx/js:node…" → `nx,node,js`;
  "a fresh Angular app whose dev-server still sits on `serve`" → includes `web`. A Vite dev-server on `serve`
  (no adapter) is no longer detected — declare it in dev.json or name the target `dev-server` (the hint says so).
- **A6 — fixed (TS side).** One source each:
  package manager → `_utils/package-manager.ts` (data table; post-create's run-time detection is RENDERED from it
  via `{{PM_DETECT}}`, tested for parity with the TS rule over 5 cases); Nx invocation → `_utils/nx-host.ts`
  `nxInvocation()` (`command` for docs, `bin` for processes; house-doc and the dev fragments share it, the orphaned
  JSDoc is gone); "is this Angular" → `StackAdapter.executors` (new), read by `ownsProject` AND the angular/js
  layer evidence (the layer now counts `@nx/angular:` too); 4200 → `DevServerPort.basePort` (Angular adapter) —
  the angular devcontainer port and the dev seeding read it, and a dev-server no stack owns and that names no
  port is REPORTED rather than declared on 4200; emulator ports → `firebase-emulators/emulator-ports.ts` (the
  canonical firebase.json block, the dev fragment and the devcontainer all read it; the devcontainer now reads
  firebase.json, and forwards a dev-server port only for apps the Firebase client can attach to, at that app's
  own port) — the firebase devcontainer fragment is a function of the tree (`descriptor.devcontainer` may now be
  one); "the workspace stack with port X" → `adapters/workspace.ts` `workspaceStackWith/StacksWith` (app,
  design-system, firebase-emulators firewall, publishable-lib). Not collapsed (outside my paths): scaffold.sh's
  package-manager and Nx-host copies (it runs before the package exists — Needs at merge: point their comments at
  the TS rule). The post-create `nx-wrapper` check asks a different question (is a runnable wrapper on disk) and
  stays. Tests: firebase devcontainer ports, post-create PM parity, dev seeding base port.
- **A7 — fixed.** Firebase's dev fragment moved to the Firebase core (`generators/firebase-emulators/dev-fragment.ts`)
  and reaches the dev generator through a new descriptor field `devFragment` (firebase sets it); the
  `CAPABILITIES` list is gone — `dev/fragments/index.ts` derives capabilities from the present layers. The stale
  "phase 4" comment is gone. The stack's default port lives on `DevServerPort` (A6).
- **A8 (logging) — fixed.** `safeDetect` (layers/registry) and `safely` (adapters/registry) now report the cause
  via `logger.warn` (stderr, once per distinct message) instead of swallowing it; `safely` takes an explicit
  fallback (the `false as unknown` cast is gone); `isApplication` no longer treats an unknown project as an
  error. The plan's own try/catch around web evidence is gone (it hid an unreadable graph).
- **A9 — fixed.** `migrationScope` and `type Layer` removed; the permission-posture `why` moved from
  `editor.formatOnSave` to the claude-code feature it describes; the layers/registry ↔ adapters/registry cycle is
  broken (`defaultLibStack` → `adapters/workspace.ts`), guarded by a test-layers check. A pre-existing
  intra-adapter cycle (adapters/angular/firebase-client ↔ index, call-time only) is left as is.
