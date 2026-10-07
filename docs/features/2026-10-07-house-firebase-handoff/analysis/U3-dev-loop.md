# U3 — dev loop: A3 (host port remap), D1 (worktree suite uses main's hub), D2 (nx task lock)

Triage, read-only. Paths are relative to `plugins/house/engine/nx-tools/src/` unless stated. firebase-tools
claims were checked against the published `firebase-tools@15.32.1` source (`lib/emulator/*`); Nx claims against
this repo's `node_modules/nx@23.1.0`. Nothing here was observed in a consumer container — the consumer repo is
not available, so every fix below still owes the finish gate (observe it in a real devcontainer).

## The shared root cause (read this first)

D1 and D2 are **the same bug class**, and A3 is its browser-side cousin:

> A tool keeps **process-global discovery state** keyed by something every stack of the tree shares, and the
> dev loop's **stack identity** (tree + offset) is not part of the key.

| Item | Discovery state | Keyed by | Shared across |
| --- | --- | --- | --- |
| D1 | firebase-tools hub locator `os.tmpdir()/hub-<projectId>.json` | projectId | every suite in the container (same `demo-…` id) |
| D2 | Nx `RunningTasksService` (workspace-data DB) | task id `<project>:<target>:<config>` | every nx invocation in the same tree |
| A3 | the Firebase web SDK dials `localhost:<port>` | a container port number | assumed equal on the host; VS Code remaps it |

So the architectural move is not three patches but one concept: **a stack owns its own discovery state**, and
the **browser addresses a stack only through the one origin it already loaded**. Details per item below.

---

## A3 — host port remap (4200→4201, 8080→8081, 9099→9100)

### Where it originates

- `generators/firebase-emulators/environment.ts.tpl:44-61` — the seeded `emulators` block: `auth` and
  `functions` carry `proxied: true` (new scaffolds), **`firestore` (8080) and `storage` (9199) have no relay at
  all** — hard `host: 'localhost', port: N`.
- `generators/firebase-emulators/firebase-firestore.config.ts.tpl:44-47` — `connectFirestoreEmulator(db, e.host, e.port + portOffset)`: always direct.
- `generators/firebase-emulators/firebase-storage.config.ts.tpl:~34` — `connectStorageEmulator(storage, e.host, e.port + portOffset)`: always direct.
- `firebase-auth.config.ts.tpl:46-58`, `firebase-functions.config.ts.tpl:40-53` — relay to `window.location` when `proxied`, else direct.
- `generators/firebase-emulators/proxy.conf.mjs.tpl:1-70` — relays Functions (`/<projectId>`) and Auth
  (`/identitytoolkit.googleapis.com`, `/securetoken.googleapis.com`, `/www.googleapis.com`, `/emulator`);
  header line 153 states "Firestore is NOT relayed here — its gRPC-Web/streaming transport needs its own design".
- `migrations/0.24.3/upgrade-emulator-environment-shape.ts:36-40` — **deliberately does not add `proxied: true`**
  to existing projects ("would change RUNTIME ROUTING mid-upgrade"). So a project scaffolded before the relay
  dials 9099/5001 directly too — consistent with the report (it dialled 9099).
- `layers/firebase.ts:131-139` (`emulatorForwards`) and `layers/angular.ts:52` — the app port and every emulator
  port are forwarded **without `requireLocalPort`**, so VS Code silently remaps on a busy host port. Contrast
  `layers/web.ts:132-139`, which sets `requireLocalPort: true` on the noVNC band precisely for this reason.
- `generators/dev/files/dev.mjs.tpl:236-246` — the only remap awareness: `foreignOwner()` (port-claim registry)
  checks the **primary** port only, only at offset 0, and only knows *house* containers, not arbitrary squatters.

### Root cause

The browser is told **container port numbers** and assumes the host has the same ones. The host side of a
forward is decided by the editor, invisibly to everything in the container. Auth/functions already escape this
via the same-origin relay (when `proxied`); Firestore and Storage never do, and older projects never opted in.

### Feasibility of relaying everything through the dev-server origin

| Service | SDK call | Paths to relay | Verdict |
| --- | --- | --- | --- |
| Auth | `connectAuthEmulator(auth, location.origin)` | already relayed (4 prefixes) | done |
| Functions | `connectFunctionsEmulator(fns, location.hostname, port)` | `/<projectId>/…` | done |
| Firestore | `connectFirestoreEmulator(db, location.hostname, Number(location.port) \|\| 80)` | `/google.firestore.v1.Firestore/` (WebChannel Listen/Write channels — plain HTTP/1.1 streaming GET/POST, **not** raw gRPC); `/v1/projects/` only if `firebase/firestore/lite` is used | **Feasible.** Angular's dev server is Vite; its proxy is `http-proxy`, which streams chunked responses unbuffered. If anything in the path buffers, the SDK's default `experimentalAutoDetectLongPolling` (on since JS SDK v10) falls back to long-poll. The "naive entry won't work" note in proxy.conf.mjs is not borne out by the transport; it needs an **observed** test, not a redesign. `ssl` stays false for http localhost; a page served over https would need `ssl`-aware wiring. |
| Storage | `connectStorageEmulator(st, location.hostname, port)` | `/v0/b/` (all JS SDK ops incl. resumable uploads) | Feasible; `/v0/b/` cannot collide with a realistic route. |
| Emulator UI | n/a (own page) | — | Stays port-bound (it is a separate app). Low stakes. |

One wrinkle: proxy.conf relays the whole `/emulator` prefix to **Auth**. Firestore/Storage also expose
`/emulator/v1/projects/…` admin endpoints — the browser SDKs never call them, but the prefix should be narrowed
to Auth's (`/emulator/auth`, `/emulator/action`, `/emulator/v1/projects/<id>/config|accounts|oobCodes`) so the
table stays honest once more services share the origin.

### SSR (latent bug, same seam)

The server path is the `typeof window === 'undefined'` branch (direct `e.host:e.port + portOffset`). But
`portOffset` is `resolvePortOffset()` (`emulator-overrides.ts.tpl:92-112`), which returns **0 without a window**
— so a shifted (worktree) stack's SSR dials the **base** stack's emulators. The adapter does not generate SSR
today (no `app.config.server` anywhere in `adapters/angular`), so it's latent, but the templates already claim
"SSR-safe". The server must dial the container directly at base+offset, and the offset is in the dev-server
process's env (`PORT_OFFSET`, `generators/dev/files/lib/declaration.mjs.tpl:185`).

### Correct architectural fix

1. **One rule for the browser: every emulator is reached through the page's own origin.** Add Firestore and
   Storage relays to `proxy.conf.mjs` (owned), make all four `firebase-*.config.ts` (owned) connect to
   `location` in the browser. Then the browser needs **no ports and no offset**: `?portOffset=`,
   `resolvePortOffset`, its localStorage fallback, the port literals in `environment.ts`, and the host forwards
   of every emulator port except the UI all **retire**. Complexity moves into one place — the in-container relay,
   which already reads `PORT_OFFSET` and `firebase.json`.
2. **Retire the per-service `proxied` knob** rather than flipping it. Relay-vs-direct is not a property of a
   service; it is a property of *where the caller runs* (host browser → relay; container/server → direct).
   Modelled as an **emulator-endpoint resolver with two implementations**: browser (same origin) and server
   (container-direct, base+`PORT_OFFSET` — or the standard `FIRESTORE_EMULATOR_HOST` /
   `FIREBASE_AUTH_EMULATOR_HOST` / `FIREBASE_STORAGE_EMULATOR_HOST` env the dev engine could export, already
   shifted). Server one provided from the server config, never by sniffing `window` inline.
3. **The relay table is capability data, the proxy file its projection.** Firebase (the capability) owns the
   path→emulator table; the Angular adapter's existing `devServer.useProxy` port is how it reaches the app.
   A future non-Angular stack needs only its own `useProxy` — no capability change.
4. **The minimum guard, natively:** `requireLocalPort: true` on the app dev-server port (`layers/angular.ts:52`)
   and the UI forward. VS Code then *prompts* on a busy host port instead of silently remapping — exactly the
   noVNC precedent. With (1) in place, the emulator forwards can be dropped entirely, so they can't be remapped.
   A page-side mismatch warning is weaker (the page can't know the intended port without being told) — not
   recommended once relaying is total.

### Migration

**Yes.** `proxy.conf.mjs` and `firebase-*.config.ts` are owned (no migration). But `environment.ts` is seeded
(class C): retiring `proxied` and the port literals is a one-way shape change → a migration that removes them,
reports what it left. Per house rules, **ask the user** whether existing projects need the old `proxied: false`
escape hatch kept (no compat by default). Adopted devcontainers: removing the emulator forwards / adding
`requireLocalPort` needs a migration gated on `houseWrote()`; owned ones regenerate. Note this reverses the
0.24.3 decision not to change runtime routing — that decision is exactly what left this consumer on 9099.

---

## D1 — worktree suite exported through MAIN's hub; eventarc/tasks unshifted

### Where it originates

- `generators/firebase-emulators/emulators.sh.tpl:54-70` — the offset copy of firebase.json: shifts every
  `emulators.<k>.port`, pins hub/logging (literals 4400/4500) shifted. **It does not shift
  `firestore.websocketPort`**, and **eventarc/tasks are never written** (not in firebase.json).
- `emulators.sh.tpl:241-247` — `--export-on-exit "$DATA_DIR"` with the same `--project` as main.
- `generators/firebase-emulators/emulator-ports.ts:35-36` — `ALWAYS_ON = ['hub','logging']`: eventarc/tasks
  missing from the one table too (so missing from the dev.json `emulators` ports and the devcontainer).
- `reap-emulators.sh.tpl:51-56` — its own 4400/4500 literals; never reaps eventarc/tasks.
- firebase-tools (verified, 15.32.1):
  - `hub.js:25-30` — locator path is `os.tmpdir()/hub-<projectId>.json`.
  - `hub.js:157-163` — a second suite whose project's locator names a **live pid** does **not** write its own;
    it logs "running multiple instances of the emulator suite" and returns.
  - `controller.js:750-764` — `exportEmulatorData` (used by export-on-exit) builds `EmulatorHubClient(projectId)`,
    reads **that locator**, logs "Found running emulator hub for project … at <origin>", and asks **that hub** to
    export into the given absolute path.
  - `controller.js:390-397` + `constants.js:21-37` — eventarc/tasks start whenever functions has backends;
    with no configured port they are `FIND_AVAILBLE_PORT_BY_DEFAULT: true`, so they walk 9299→9300, 9499→9500.

### Root cause

Both suites run under the same projectId (singleProjectMode, the app's `demo-…` id — correct and required) in
the same container `/tmp`. The worktree suite never registers its hub, so on exit **main's hub exports MAIN's
data into the worktree's `.emulator-data-30000`** — silent data swap, worse than the report frames it. The
reverse order (worktree first) makes main export the worktree's data into `.emulator-data`; and when the
locator-owning suite exits first, the other's export fails outright. Separately: the shift only covers ports
firebase.json names, while firebase-tools occupies ports firebase.json doesn't (eventarc, tasks, websocket).

### Correct architectural fix

1. **Each stack gets a private tmp dir**: `emulators.sh` exports `TMPDIR` to a per-stack dir before `exec
   firebase` (Node's `os.tmpdir()` honours `TMPDIR`; the JVM emulators use `java.io.tmpdir`, unaffected). Do it
   for **every** stack including offset 0, so main is isolated from a worktree too. A path under the already
   ignored `/.emulator-data-*` glob (e.g. `.emulator-data-tmp` / `.emulator-data-tmp-<offset>`) needs no
   `.gitignore` change — the gitignore block is append-once by marker (`firebase-emulators/generator.ts:217`),
   so a new line would otherwise need a migration. The same isolation fixes `tools/seed/build-seeds.sh`
   (`emulators:exec` while a suite is up hits the same locator).
2. **firebase.json names every port the suite occupies.** The canonical block (`generator.ts:100-106`, asserted
   every run) pins hub, logging, eventarc, tasks and `firestore.websocketPort` explicitly; `emulator-ports.ts`
   `ALWAYS_ON` grows eventarc+tasks. Then "shift = add offset to every port-valued key" is complete by
   construction. Exclude eventarc/tasks from the `--only` derivation (`emulators.sh.tpl:143-150`) alongside
   hub/logging (they come up with functions).
3. **One port table at runtime, not four.** Today: `emulator-ports.ts` (TS), the inline node in
   `emulators.sh`, `reap-emulators.sh` literals, `proxy.conf.mjs` fallbacks, `environment.ts` literals. Emit a
   generated runtime module (e.g. `tools/firebase/suite-ports.mjs`, projected from `emulator-ports.ts` the way
   `layers.sh` is from the registry, drift-checked) exporting `shift(config, offset)` and `occupied(config)`;
   emulators.sh, reap-emulators.sh and proxy.conf.mjs import it. With A3's relay the browser needs none.

### Migration

**No** for the fix itself: emulators.sh, reap-emulators.sh, proxy.conf are owned; the firebase.json `emulators`
block is re-asserted each run; the tmp dir rides an existing ignore glob. dev.json's seeded `emulators`
process ports would miss eventarc/tasks — but they only size the offset block, and 4000..9499 still rounds to
the same 6000 step, so no migration is owed unless a project customised ports into a different step.

---

## D2 — a second dev-server in the same tree waits forever on the nx task lock

### Where it originates

- `generators/dev/fragments/nx.ts:23,49` — the app process is `nx run <project>:dev-server --port=${PORT:app}`
  with `NX_TREE_ENV` (`NX_DAEMON=false`, `NX_WORKSPACE_ROOT_PATH`); `firebase-emulators/dev-fragment.ts:123`
  — the suite is `nx run firebase:emulators`, same env.
- `adapters/angular/index.ts:232` (leaf), `_utils/dev-server.ts:55` (composer `serve`),
  `firebase-emulators/generator.ts:456` (emulators) — all `continuous: true`.
- Nx 23.1 `tasks-runner/task-orchestrator.js:897-920` — for a continuous task already present in
  `RunningTasksService` (the workspace-data DB, `utils/db-connection.js:43`), Nx does **not** start it; it
  creates a `SharedRunningTask` (`running-tasks/shared-running-task.js:22-28`) that prints "Waiting for <id> in
  another nx process" and polls until the other finishes. Nx's model: one instance of a continuous task per
  workspace, shared between invocations.

### Root cause

The dev engine exists to run **several isolated stacks of one tree** (port offsets), but drives each process
through `nx run`, whose task identity is `project:target:config` — no offset. Nx correctly (by its model)
dedups the second stack into the first, which is listening on the *other* stack's port; the dev engine waits
on a port nobody will open. This is not an edge case: the house's own **local-server-isolation** rule obliges
Claude to start its own server on a separate port while the developer's runs — i.e. D2 on every such check.
The emulators process has the same exposure (`firebase:emulators`).

### Correct architectural fix

**Don't detect the lock — remove the collision.** Detecting means reading Nx's private SQLite schema (brittle
across Nx bumps) and only produces a nicer failure for something that should work. Instead give each stack its
own Nx workspace-data dir: Nx honours `NX_WORKSPACE_DATA_DIRECTORY` (`utils/cache-directory.js:83`) and the
local DB lives there (the comment at `db-connection.js:~40` says it is per-workspace *precisely* to avoid false
conflicts across worktrees). Add it to the Nx fragment's env, keyed by offset (`${TREE}/.nx/workspace-data/stack-${OFFSET}`
— `${OFFSET}` and `${TREE}` are existing substitutions, `declaration.mjs.tpl:25`). The computation cache
(`.nx/cache`) is separate, so builds still share it; cost is one project-graph computation per new stack dir
(the daemon is already off). Verify the `nx` wrapper host behaves the same.

**Unify with D1 as one concept:** the dev engine models the stack and hands every process a **stack state dir**
(a new `${STACK_DIR}` substitution + env, owned by the stack-free engine); the Nx fragment points
`NX_WORKSPACE_DATA_DIRECTORY` into it, emulators.sh points `TMPDIR` into it. Any future tool with global
discovery state gets isolated the same way, with no engine change.

**Naming the holder, as information:** have `dev serve` record live stacks (pid, app, offset, URL) in that same
place, and log "also serving this tree: offset 0, pid N, http://…" at start — that is what the user actually
wanted to know, sourced from our own state, not Nx's.

**Open edge (unverified):** the outer `nx serve <app>` is the continuous composer `app:serve`; two `nx serve`
of the same app in one tree should hit the same dedup *before* the dev engine runs, where no env we set can
help. The report names `…:dev-server:development`, so the consumer probably reached it another way — this needs
a reproduction. If confirmed, options are: document `tools/dev/dev serve` as the second-stack entry point, or
reconsider `continuous: true` on the composer (it matters only for `dependsOn` consumers such as e2e).

### Migration

**Yes.** `.bespunky/dev.json` processes are seeded and then project-owned (`dev/declaration.ts:5-7` — seeding
never rewrites an existing process), so adding the env to existing `nx run` processes is a migration. It should
touch only processes whose `cmd` is the house `nx run <p>:dev-server` / `firebase:emulators` shape and whose env
still equals `NX_TREE_ENV`, and report any customised one it leaves.

---

## Extra ideas / pushback

- **Single port registry — yes, but in two halves.** Generator-time: `emulator-ports.ts` already is it; make it
  complete (eventarc, tasks, websocket) and make firebase.json pin everything. Runtime: one generated module
  instead of four hand-copied literal sets. And the browser should know **zero** ports (A3).
- `resolvePortOffset` probes only the **primary** process's ports (`dev/files/dev.mjs.tpl:198`,
  `lib/ports.mjs.tpl:86`). A block whose emulator ports are held by something foreign is accepted and the suite
  then fails to bind. Probe every declared port of the block (or at least every fixed-port process).
- The report frames D1 as "used the wrong hub"; the actual consequence is **cross-stack data overwrite** on
  exit. Worth a line in the fix's commit and a fixture case that runs two suites and checks each export.
- Everything here crosses the container boundary (host forwards, Vite proxy streaming, TMPDIR on firebase-tools,
  Nx DB dir). Per the finish gate it must be observed in a rebuilt devcontainer with two stacks up, Firestore
  live-listen through the relay, and an export-on-exit from each — fixtures can't prove any of it.
