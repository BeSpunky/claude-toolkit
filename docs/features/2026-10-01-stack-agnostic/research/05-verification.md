# 05 — Adversarial verification (U-verify)

Branch `feat/stack-agnostic` at `910490b` (payload 0.36.0, unpublished → every run passes `--local`).
Scratch: `scratchpad/verify/<scenario>/`. Node 22.23.2, no Docker. Written as the runs happen.

Pre-note: syncs on a fresh repo's `main` stop at `SYNC_ASK: no-branch-model` (by design, no override) — each
sync scenario therefore runs on a `work` branch.

Checks per scenario (`scratchpad/verify/check.sh`): every tracked `devcontainer*.json`/`dev.json` parses as
JSONC (`jsonc-parser`), every tracked bash script passes `bash -n` (the feature's `install.sh` is `/bin/sh`:
`sh -n`), HOUSE.md / HOUSE.rules.md / CLAUDE.md grepped for 4200 / Angular / yarn / `npm nx` / Firebase.

## S1 — fresh default scaffold
`PROJECTS_DIR=… scaffold.sh --local --no-github s1proj` → `SCAFFOLD_OK … layers=nx,agent host=wrapper`.
- One commit (`chore: scaffold BeSpunky project (layers: nx, agent)`), clean tree. Tracked: `nx`, `nx.bat`,
  `.nx/nxw.js`, `nx.json` (installation pins `@bespunky/nx-tools: 0.36.0` plain — the `file:` pin did not leak),
  `.devcontainer/*`, `.claude/settings.json`, `.vscode/*`, house docs. No package.json, no Angular.
- devcontainer: `base:debian` + node feature; JSONC ok; `bash -n` ok. HOUSE.md says `./nx` throughout, "no
  JavaScript/TypeScript layer"; no 4200/Angular/yarn.
- Fresh `git clone` + `./nx --version`: fails with `ETARGET @bespunky/nx-tools@0.36.0` — **only because 0.36.0 is
  unpublished**. With the pin swapped to the published 0.34.0 in the clone: `./nx` installs, reports Nx 23.2.1,
  and `./nx g @bespunky/nx-tools:house-doc --help` resolves the plugin. Wrapper mechanics: PASS.
- Re-sync (`--sync --local --yes`, on a `work` branch): `SYNC_OK`, tree clean, no new commit. Idempotent.
- Cosmetic: `SYNC_OK … app=apps/s1proj` is printed for a project with no apps (same in S3–S6).
**PASS.**

## S3 — fresh `--preset=node`
`scaffold.sh --local --no-github --preset=node s3proj` → `layers=nx,agent,node host=node`; detected afterwards
as `nx,agent,node,js`. package.json: nx, @nx/js, @nx/workspace, @playwright/test (the js layer's piece),
`@bespunky/nx-tools` exact. No Angular package, no app. HOUSE.md uses `yarn nx` (yarn.lock — correct). Re-sync:
`SYNC_OK`, clean, no commit. **PASS.**

## S4 (part 1) — existing Python repo, `--sync --local --yes --ensure=agent`
`SYNC_OK`. Wrapper host: `nx`, `.nx/nxw.js`, `nx.json` installation pins; no package.json / lockfile /
node_modules. Docs: `./nx`, no Angular/4200/yarn. Generator output is left **uncommitted** for review (as
sync.md describes — only migrations commit); committed by hand as "house sync 1". Re-sync (no `--ensure`):
`SYNC_OK`, clean. **PASS.**

## S5 — Go repo with its own commented devcontainer + post-create.sh
`SYNC_OK`. `devcontainer.json` merged additively: every comment kept (incl. the inline one inside the
extensions array), `"image": "mcr.microsoft.com/devcontainers/go:1.22"` kept, docker-in-docker kept, trailing
comma kept, its `postCreateCommand` kept; house adds node/claude-code/github-cli features + the
`./features/bespunky-house-setup` chain feature, extensions, mounts. Its `post-create.sh` is byte-identical; the
house script is `post-create.bespunky.sh` (Nx-wrapper install + plugin pre-install; OS packages tmux, curl
only — no Playwright/browser floor). No node_modules, no whole-`.nx` mount, nothing Angular.
- Edge (reported by the sync, not silent): the image declares no `remoteUser`, so the `.claude` mount targets
  `/root/.claude`; the go image actually runs as `vscode` (image metadata). The sync warns and says to declare
  `remoteUser`. Accepted as a reported limitation — reading image metadata needs a container engine.
Re-sync: `SYNC_OK`, clean. **PASS.**

## S6 — plain npm repo (package.json + scripts, package-lock)
`SYNC_OK`, `layers=nx,agent,node`. `nx init` on the package.json host with **npm** (package-lock updated, no
yarn.lock); devDeps `nx 23.2.1` + `@bespunky/nx-tools 0.36.0` exact; `scripts` untouched; nx init adds
`"nx": {}`. HOUSE.md uses `npx nx`; post-create self-detects npm. Re-sync: `SYNC_OK`, clean. **PASS.**

## S4 (part 2) — hand-written `.bespunky/dev.json` → web layer
Declaration `{"apps":{"site":{"processes":[{"id":"app","cmd":"python3 -m http.server ${PORT:app}","ports":{"app":8000},"primary":true,"ready":{"http":"/"}}]}}}`,
committed, then `--sync --local --yes .` → `SYNC_OK`, stamp `layers=nx,agent,web`; `tools/dev/*`,
`tools/shared-browser/*`, `tools/worktree-domains/*`, `tools/port-claim/*` written; still no package.json.
- `tools/dev/dev serve site --port-offset=23337 --dry-run` → app port 31337, `python3 -m http.server 31337`.
- Second worktree (`git worktree add ../pyrepo-wt -b feat-x`), auto offset → 57000 (port 65000).
- Served **both concurrently** (`--no-shared-browser`): `curl :31337` → main tree's page, `curl :65000` → the
  worktree's page. Ctrl+C semantics (SIGINT to each engine's process group): both stacks exit cleanly.
- **Open (design):** SIGINT/SIGTERM sent to the engine PID *alone* (not its group — what `kill <pid>`, `timeout`,
  or a supervisor that signals one process does) is swallowed by design (`lib/stack.mjs`: "we forward
  NOTHING", to avoid the emulator double-signal), so the engine waits forever and the python servers keep
  running. Needs a decision (e.g. forward on SIGTERM only, or escalate after a grace period) — not fixed here.
- **DEFECT D1:** HOUSE.md's *Serving the app* section, rendered for this Python repo, says `nx serve <app>`,
  "the `dev-server` target → `@angular/build:dev-server`", "app on `http://localhost:4200`", Angular
  env-file `--configuration`. None of that exists here; the command is `tools/dev/dev serve`. → fixed, see below.

## S7 — old-shaped (1e36ef5 / nx-tools 0.34.0) Angular + Firebase + design system, synced with the new scaffolder
Old: `git archive 1e36ef5 …/assets`, `scaffold.sh --firebase --no-github oldproj shop` (published 0.34.0) →
stamp `nx-tools=0.34.0 layers=agent,angular,design-system,firebase,js,nx,web`.
New: `scaffold.sh --sync --local --yes <oldproj> shop` (on `work`) → `SYNC_OK`; `--local` collected 5 rungs,
**4 commits** (checkpoint + one per rung that changed something):
- `retarget-nx-cache-volume` — the whole-`.nx` volume replaced in place by `.nx/cache` + `.nx/workspace-data`; no
  `.nx,type=volume` left.
- `declare-dev-processes` — `.bespunky/dev.json` with `app` (`nx run shop:dev-server --port=${PORT:app}`, 4200)
  and `emulators` (all 7 ports, `portOffset`/`emulate=none` url params, OAuth advice) + `install: yarn install`.
- `relocate-port-claim` — `git mv` to `tools/port-claim/`, the two house CLIs re-pointed; nothing left at the old
  path. (Leftover found: the regenerated `shared-browser` CLI's *comment* still named the old path — template
  fixed in `62f20f7`.)
- `pin-playwright` — `@playwright/test` `latest` → `1.63.0` (lockfile's).
- `tag-navigation-library` — no navigation library: no-op, no commit (correct).
After: `nx run-many -t build -p shop functions design-system` ✔ (all 3), `lint` ✔ (the eslint firewall splice
loads), `nx serve shop --dry-run --port-offset=27000` → app 31200 with proxyConfig, emulators shifted (auth 36099
…), `?portOffset=27000`. `.claude/settings.json` enables `bespunky-angular@claude-toolkit`. HOUSE.md (Angular
shape) correct. Known/documented: the migration commits capture the `file:` tarball pin of `--local`; the
generator step rewrites it to plain `0.36.0` afterwards.
Re-sync after committing: `SYNC_OK`; it changed only HOUSE.md + that CLI comment (the fixes below), then no-op.

## S8 — `--ensure=firebase` on the S6 npm repo
`SYNC_OK firebase=1`, layers `nx,agent,node,firebase`. Root deps: only `firebase-admin`, `firebase-functions`
(+ devDeps `@nx/esbuild`, esbuild, typescript, @types/node) — **no Angular / @angular/fire**. Projects:
`functions`, `firebase`. `nx build functions` ✔ → `dist/apps/functions/{main.js,package.json}`. Defects:
- **D3** `dist/` left untracked — `nx init` (unlike create-nx-workspace) does not ignore `/dist`. → fixed:
  `firebase` and `js` descriptors contribute `/dist` via the layer gitignore seam (`2f4462e`).
- **D2** HOUSE.md's Firebase section documented the Angular client (environment.ts, `provideApp*`,
  proxy.conf, staging env files) and `tools/dev/dev serve <app>` (no dev loop here). → fixed: client
  subsections gated on `angular`, serve rows on `web`; core-only text points at `run firebase:emulators`.
- **D4** `tools/firebase-welcome.sh` could never go silent (waits for an Angular `environment.prod.ts`) and told
  the user to paste config into one. → fixed: with no house-wired client, `.firebaserc` completes setup
  (behaviour-tested in scratch: no rc → banner; rc + no client → silent; rc + empty client → banner w/ step 5;
  filled → silent).
- Observed, not fixed: `apphosting.yaml` (App Hosting) is seeded for a repo with no web app.

## S9 — refusal paths (each: nothing written)
- `scaffold.sh --local s9a myapp` (agent preset) → `ERROR: an app name ('myapp') was given, but nothing this
  scaffold ensures creates an app … e.g. scaffold.sh --preset=angular s9a myapp`; no directory created. Same
  for `--preset=node`.
- `--ensure=bogus` (scaffold) / `--ensure=reactt` (sync) → `unknown layer … Known layers: …`; tree clean.
- `--sync --ensure=angular` → refused: not sync-ensurable, with the hint (`nx add @nx/angular` — says `nx`, not
  `./nx`, on a wrapper repo: cosmetic).
- Downgrade: S1 clone with stamp `nx-tools=9.9.9` → `[preflight] downgrade: … NEWER than this checkout's 0.36.0
  (installed=none, HOUSE.md stamp=9.9.9)`, `migrations: NOT started`, HEAD unchanged, tree clean.
  (A package.json pin of a non-existent `9.9.9` with no node_modules instead fails at `yarn install`, clean —
  an artificial case.)
**PASS.**

## S2 — fresh `--preset=angular --firebase s2proj shop`
`SCAFFOLD_OK … layers=nx,agent,node,web,angular,design-system,firebase host=node app=apps/shop`; one commit,
clean; pin plain `0.36.0`. `nx run-many -t build -p shop functions design-system` ✔ ×3. `nx serve shop
--dry-run --port-offset=41000` → app 45200 with proxyConfig + shifted emulators.
- **DEFECT D5:** `nx serve shop --skip=emulators` → `Property 'skip' does not match the schema` (Nx's CLI
  validator rejects the `["string","array"]` union) — the documented flag was unusable through Nx. → fixed:
  `"type": "array"` (`ae75b3c`); verified on the installed copy: `--skip=emulators`, `--skip=a,b`, repeated
  `--skip` all parse; test-layers now rejects any union containing array/object in a payload schema.
- Real serve (fixed schema): `nx serve shop --port-offset=41000 --skip=emulators --no-shared-browser` →
  `[serve] Up: http://localhost:45200/?portOffset=41000&emulate=none`; `curl :45200` → the Angular index.html.
  SIGINT to the process group → everything down in 2 s, port closed.
- Re-sync: the first re-sync moves `implicitDependencies` above `targets` in `apps/shop/project.json` (devkit
  key-order round trip; pre-existing, noted by U-scaffold); the next re-sync is a no-op. **Open (cosmetic).**
**PASS** (after D5).

## Fixes, then every sync scenario re-run
Fixes on `feat/stack-agnostic`: `62f20f7` + `79a97de` (D1 serve docs by evidence + stale port-claim comment),
`2f4462e` (D2/D3/D4 Firebase core without Angular), `ae75b3c` (D5 `--skip`), `f3883a5` (D3 follow-up: ignore as
`dist` — `/dist` duplicated create-nx-workspace's `dist` line on S2/S7), `8209c15` (D6, below).
Re-ran `--sync --local --yes` on S2, S4, S7, S8 with the fixed tree: each picked up only the fixed artifacts
(HOUSE.md, `tools/firebase-welcome.sh`, the `.gitignore` block on S8), committed, then **a further re-sync on each
was a no-op** (`git status` clean). S4's HOUSE.md now says `tools/dev/dev serve <app>` throughout, no 4200 /
Angular / `nx serve`; S7/S2 keep `yarn nx serve`, 4200, `--configuration`, `--no-emulators`; S8 documents the
core (`npx nx run firebase:emulators`, Cloud Functions, seeds) with no environment.ts / provideApp* / serve rows,
and a fresh `nx build functions` leaves the tree clean.

## SessionStart drift hook (`hooks/check-house-version.sh`, run with `CLAUDE_PROJECT_DIR`/`CLAUDE_PLUGIN_ROOT`)
- Silent on S1, S3, S5 (current), S8 after sync. Relays the correct downgrade fact on the 9.9.9-stamped clone.
- Python repo at its `nx,agent` stamp + a new `.bespunky/dev.json` → "grown a layer: web" — correct.
- **DEFECT D6:** the old 0.34 project (S7 before sync) was told "This project has grown a layer … node" instead
  of "the installed house tooling is NEWER (0.34.0 → 0.36.0)": the newer registry detects a layer the stamping
  registry had no name for. Every existing house project would see this false sentence on the first session
  after updating. → fixed (`8209c15`): layer drift only when stamp version == installed; now relays the version
  notice. Regression: `tools/test-scaffold/house-hook.test.sh` (fails on the old hook, passes now).

## Open — not fixed here (design questions / pre-existing)
1. **Dev engine and a lone signal.** `tools/dev/dev serve` forwards nothing on SIGINT/SIGTERM (by design: the
   terminal signals the group; forwarding double-signals the emulator suite). `kill <engine-pid>` / `timeout` /
   a supervisor that signals one PID leaves the engine waiting forever and the children serving. Needs a rule
   (forward on SIGTERM only? escalate after a grace period?).
2. **`.claude/data` bind mount on a fresh clone** (pre-existing; identical at 1e36ef5): the devcontainer
   bind-mounts `${localWorkspaceFolder}/.claude/data`, which is gitignored (its `.gitkeep` too), so a fresh clone
   has no source dir and Docker refuses the mount. Likely an `initializeCommand: mkdir -p .claude/data` in the
   agent fragment — but that key is contested in adopted devcontainers, so it is a design call.
3. Adopted devcontainer on an image whose user is not root and is not declared (S5, go image runs as `vscode`):
   `.claude` mount targets `/root/.claude`; the sync warns. Reading image metadata needs a container engine.
4. Cosmetic: `SYNC_OK … app=apps/<repo>` printed for projects with no app; `firebase=0` printed on syncs of
   Firebase projects (detected, not ensured); the not-sync-ensurable hint says `nx add …` on a `./nx` repo;
   first re-sync after an Angular scaffold reorders `implicitDependencies`; `apphosting.yaml` seeded with no web
   app (S8).
5. `--local` artifacts are expected: a fresh clone's `./nx` fails with `ETARGET @bespunky/nx-tools@0.36.0` until
   0.36.0 is published (verified the wrapper itself works with a published pin).

## Verdicts
S1 PASS · S2 PASS (after D5) · S3 PASS · S4 PASS (after D1; open #1) · S5 PASS (open #3) · S6 PASS ·
S7 PASS (after D6 for the hook) · S8 PASS (after D2–D4) · S9 PASS.
Suites after the fixes: test-layers 52/52, test-migrations 46/46, test-scaffold 10 files, script-modes ok.
`check-release-invariants` now (correctly) asks for a payload + project-starter bump — left to the orchestrator.
Migrations question for those fixes: **nothing to migrate** — every changed output is generator-owned and
regenerated on every sync (HOUSE.md, `tools/firebase-welcome.sh`, the `.gitignore` block — additive), or shipped
inside the package/plugin itself (the serve executor schema, the hook).
Agents spent by U-verify: 0.

## Follow-up fixes (open items 1, 2, 4)
Re-verified on throwaway repos under `scratchpad/fix/` (`--local`, port offset 29000 → :37000, everything torn down).

1. **Dev engine and a lone signal — fixed (`26d301d`).** The rule is now decided by the signal's name:
   SIGINT = the terminal's Ctrl+C, already delivered to the whole group → forward nothing, wait (as before);
   SIGTERM/SIGHUP = a stop aimed at the engine → the existing graceful shutdown (one SIGTERM per remaining child
   tree, then wait). First stop wins; later signals are absorbed (so Ctrl+C followed by Nx's own SIGTERM is not a
   double). The `nx serve` executor applies the same rule one level up (forwards one SIGTERM to the engine).
   Regression: `tools/test-scaffold/dev-engine.checks.mjs` runs real children that record every signal they get —
   targeted SIGTERM (argv and `sh -c` child) and SIGHUP → child got exactly one SIGTERM, nothing listening; group
   SIGINT → exactly one SIGINT; SIGINT-then-SIGTERM → only the SIGINT. (Fails on the old engine.)
   Live, Python repo (`tools/dev/dev serve site`): `timeout 5 …` → exit 124, :37000 closed; `kill -TERM <engine>`
   / `kill -HUP <engine>` / `kill -INT -- -<pgid>` → engine gone, :37000 closed. Through Nx (npm repo,
   `npx nx serve site`): SIGTERM to the run-executor process alone, SIGTERM to the nx CLI process alone, group
   SIGINT, and `timeout 8 npx nx serve …` → all down, nothing listening, no stray processes.
   Residue, documented in `stack.mjs`: a SIGTERM/SIGHUP sent to the whole GROUP (`kill -- -<pgid>`, GNU `timeout`
   without `--foreground`, a shell re-sending SIGHUP on terminal close) reaches the children directly AND through
   the engine — a signal carries no readable sender. Not live-tested against a real emulator suite (no Java /
   Firebase CLI in this container).
2. **`.claude/data` on a fresh clone — fixed (`a011476`).** The host probe (`initializeCommand`, previously
   voice-only) is now contributed whenever the declared mounts name a `${localWorkspaceFolder}` bind source, and is
   rendered with those sources: it creates each missing one on the host before every open (never touching an
   existing one), then bridges audio only with voice. The `.claude/data/.gitkeep` that claude-settings wrote is
   gone — it was gitignored, so it only ever existed on the scaffolding machine. Regression (test-layers): no-voice
   and voice devcontainers carry the probe; the rendered probe run on an on-disk "fresh clone" leaves no bind
   source missing and a second run keeps existing data; an adopted string `initializeCommand` is lifted beside it.
   Live: Python repo synced, committed, `git clone` → no `.claude/data`; `sh .devcontainer/host-probe.sh` → created,
   exit 0, tree clean. (No Docker here, so the mount itself was not exercised.) **Migrations: none owed** — the
   owned and adopted devcontainers are both merged on every sync and `initializeCommand` is a composable command,
   so an adopted repo gains the probe additively; `host-probe.sh` is generator-owned.
4. **Cosmetics — fixed (`373bd8a`).** `SYNC_OK` now reads back the stamped layer set and names the app only when it
   exists (live: `SYNC_OK … layers=nx,agent,web voice=0 …` on the Python repo; `layers=nx,agent,node,web,firebase`
   on the npm+Firebase repo — no `app=`, no `firebase=0`). The not-sync-ensurable hint spells `./nx add …` on a
   wrapper host (the pure HOST decision moved ahead of the ensure validation; render.test.sh asserts it).
   `apphosting.yaml` is seeded only with a client app (test-layers: core-only → none, also with `--staging`;
   client app → seeded once, never clobbered; live: none in the npm+Firebase repo). An already-seeded one in a
   core-only repo is a user-owned seed and is left as-is (deleting it would be a guess). The
   `implicitDependencies` reorder was not in scope and is unchanged.

Found while re-verifying, fixed:
- **`6d28e0d`** — a Firebase core with no client app: `apps/functions` was the only `project.json`; the inference
  excluded it by name, then the no-project.json fallback re-picked it by directory, so `serve --project=functions`
  killed the sync. The fallback now applies only when no `project.json` exists under `apps/` (render.test.sh).
- **`b4d2954`** — a plain npm repo with `.bespunky/dev.json` + `agent`: `nx init` makes the root a project, the web
  layer ran `serve` on it because it EXISTED, and serve refused ("nothing to serve") → `SYNC_FAILED`. The per-app
  skip predicate now asks serve's own precondition (a dev-server of its own, or a stack that supplies one);
  `findExistingDevServer` moved to `_utils/dev-server` so both share it (test-layers; fails on the old predicate).
  Migrations: none (planner behaviour only).

Suites: test-layers 55/55, test-migrations 46/46, test-scaffold 10 files, script-modes ok. No version bumps.
