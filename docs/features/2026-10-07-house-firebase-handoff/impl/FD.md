# FD — review fixes for R4 (emulator routing through the app's origin)

Branch `feat/house-firebase-handoff--fd`. Binding: DECISION.md review round ("Proxy becomes composable … anchored
routes; SSR gets the emulate decision from the dev engine's env") and the orchestrator's R4 brief. Every finding was
reproduced first; none was rejected. The 0.50.0 rung `route-emulators-through-origin` was reshaped, not stacked on.
Scratch: `scratchpad/fd/` (fixture copy `fd/coach` of `r4/coach`; proof rig `fd/proof/`; wds6 toolchain `fd/wp/`).

## Findings

| id | verdict | reproduced → fixed |
| --- | --- | --- |
| R4-1 | fixed | Reproduced by reading (`useProxy` → set-if-absent `setLeafOption` returned `true` for a foreign leaf; the rung never looked at `proxyConfig`) and by a new test that failed. Now `proxy.conf.mjs` exports `emulatorRoutes` (Angular/webpack dialect) and `viteEmulatorRoutes` (bare Vite `server.proxy`), and merges a SEEDED, never-rewritten `proxy.local.mjs` (object or webpack array form) after its own routes. `DevServerPort.useProxy` returns a `ProxyWiring` outcome (`wired`, `foreign`, `unconfigurable`, `none`). `generators/firebase-emulators/proxy-wiring.ts` turns each outcome into exact advice: for a foreign proxy, move your routes into proxy.local.mjs, or (for an ES module) a one-line `import { emulatorRoutes } from '<relative>'`; for an executor the house can't configure, which export to use. Both the generator (firebase-client attach) and the rung call it. It goes onto the upgrade's attention list (`reportToUpgrade`, from FE). The rung also points a dev server that names no proxy config at the house file. **Never silent at runtime either:** the first emulated service asks the hub through the origin (`/__bespunky/emulator-hub/emulators`, rewritten to the hub's `/emulators`). A missing relay, a suite that is down, or an emulator the suite lacks each becomes a `[firebase.config.ts]` console error. |
| R4-2 | fixed | Reproduced: `/emulators`, `/emulator-settings`, `/v0/blog`, `/demo-coach-landing` all matched (`scratchpad/fd/repro-r4-2-4.mjs`). Keys now end at a segment boundary (`/emulator/`, `/v0/b/`, `/google.firestore.v1.Firestore/`, …). Plain prefixes work in every engine. Regex keys (`^…`) would NOT work: webpack-dev-server passes them to http-proxy-middleware as literal string paths. The false "none collides" header and the HOUSE.md line now state the exact residue (`/<x>/<region>/<y>`). Test: `tools/test-generators/cases/emulator-relay.mjs` (it fails on the old template). |
| R4-3 | fixed | Reproduced: `resolveEmulated` with no window returned all-true under a `--no-emulators` stack. The dev engine now exports the stack's URL switches to every process as **`DEV_URL_QUERY`** (generic, so the engine names no capability). The server branch of `emulator-overrides.ts` applies it the way the browser applies its URL. This is a small `planApp` hunk in `dev/files/lib/declaration.mjs.tpl` (FA's file: query computed before the processes, one env key). HOUSE.md documents it. Per-tab overrides stay browser-only, by necessity: one server serves every tab, and a connected SDK instance can't be un-emulated per request. Checks in `dev-engine.checks.mjs`. |
| R4-4 | fixed at the root | Reproduced: a commented `projectId:` won, and a computed one dropped the Functions and Firestore-REST routes. Now **nothing keys on the project id**. Firestore REST is `/v1/projects/*/databases/**`. Functions is `/*/<GCP area>-*[0-9]/**`. This also keeps the relay right whatever id FB's emulator-projectId choice uses (demo- or real). The `{{appEnvPath}}` substitution in the proxy is gone, and `writeFirebaseClientGlue(tree, appRoot)` lost its third argument. |
| R4-5 | fixed | Documented in HOUSE.md: the host-tab UI needs same-number forwards, and a shifted stack's UI is reachable only from the shared browser. The serve banner says which applies: the firebase dev fragment seeds `EMULATOR_UI_ADVICE` (base / offset, `${PORT:ui}`), and the rung adds it to the house's existing `emulators` process when it has a `ui` port. Engine: a `--skip`ped process's advice is no longer printed. `requireLocalPort` was not added: V8 §3 shows it only produces a dialog. |
| https | one policy | The SDKs: Auth accepts an https URL, and Firestore could via `initializeFirestore({host, ssl})`. **Storage and Functions force http** (`isCloudWorkstation` only; `_protocol` and `emulatorOrigin` are private: firebase 12 SDK, `index.esm2017.js:3171`/`:496`). So https cannot work for all four, and Firestore was not made special. The throw is gone: a console error at bootstrap, the same policy as the demo-config dev guard. The rung's https report text matches. |

## Proven end to end (real firebase-tools 15.32.1 suite, auth+firestore+storage+functions, random ports; headless Chromium)
- **Angular's loader + its Vite 8.3.0** (`@angular/build` 22.2.2), **webpack-dev-server 6.0.0 + http-proxy-middleware 4.2.0** (what `@angular-devkit/build-angular` 22.2.2 runs, fed through its own object→array normalisation), and a **bare Vite with `viteEmulatorRoutes`**. Each one passed:
  - anonymous sign-in and token refresh;
  - Firestore set/get/onSnapshot and REST runQuery;
  - a 2.1 MB resumable upload (5 chunks, byte-identical; `x-goog-upload-url` arrived origin-relative, so `on.proxyRes` works under hpm 4);
  - a Functions callable;
  - the hub probe;
  - a **real `signInWithPopup` through `/emulator/auth/handler`**, driven by clicking the emulator's account picker.
  - On all three, `/emulators`, `/emulator-settings`, `/v0/blog`, `/demo-fd-landing` and `/demo-fd/about` served the app, with 0 console errors (`fd/proof/run-{vite,wds,bare}.log`).
- **The real Angular dev server** (`nx run web:dev-server`, fixture copy with the new templates) was run three ways:
  - relay present: hub 200, no errors;
  - `proxyConfig` → a project `proxy.api.json`: the "does not relay" console error;
  - `--ssl`: the https console error, and the app still bootstraps (`fd/proof/ng-*.log`).
- `tools/dev/dev serve web --skip=emulators --dry-run` shows `DEV_URL_QUERY=emulate=none` on the app process. The server resolver under node gives all-off for `emulate=none`, firestore-only for `emulate=firestore`.
- The compiled rung on the fixture copy rewrote the owned files and added the UI advice. The dev server was already wired, so it reported nothing.
- NOT run: a real SSR app (the house scaffolds none). Server-side behaviour is proven at the resolver and engine level only.

## Suites (after merging feat/house-firebase-handoff with FH/FC/FE)
test-migrations 244/0 · test-generators 194/0 (23 skipped, optional peers) · test-layers 101/0 · test-scaffold 23 files ok.
One run of `emulators-stop.test.sh`'s "restart waited for the previous save" failed once and passed on both reruns.
It is timing in emulators.sh, outside this change.

## Cleanup
Every server started here was stopped: emulators 493457 (+java 493713), Vite 498947, wds 498949, bare Vite 629993,
and Angular 634000 / 738826 (and its ssl successor). No listener is left on any port used.
