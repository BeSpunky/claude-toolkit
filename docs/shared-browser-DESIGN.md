# Design — Shared Co-Driven Browser (`shared-browser`) for claude-toolkit

Response to `crushit/BRIEF-shared-codriven-browser.md`. This is the implementation plan for approval.

## Update — serve unification, worktree domains, observe-only (supersedes the serve/composition layers below)

The `serve-with-shared-browser` target and the separate `serve-worktree` executor named throughout this record have since been **folded into one public `@bespunky/nx-tools:serve` executor**. The current surface (canonical in the scaffolded project's `CLAUDE.md` and in `browser-automation:shared-browser`):

- **Unified `serve`.** `nx serve <app>` composes the app `dev-server` + shared browser (up + navigated) — plus the emulator suite in a Firebase workspace — under one Ctrl+C. Flags: `--no-shared-browser`, `--no-emulators`, `--worktree=<branch|slug|path>`, `--port-offset=auto|<n>`, `--configuration=production|development`, `--dry-run`. Main tree → offset 0 (`localhost:4200`); each worktree → its own stable, verified-free offset block. The retired `serve-with-shared-browser` / `serve-worktree` / `serve-with-emulators` / `serve-no-emulators` targets no longer exist; Layer 3 and the composition one-liner below are historical.
- **Pretty worktree domains.** A new `worktree-domains` generator writes `tools/worktree-domains/` — an in-container `*.localhost` proxy (register/unregister/list/reconcile) that routes `<slug>.localhost` → `127.0.0.1:<appPort>`, listening on loopback `:80`, **not forwarded** (`*.localhost` auto-resolves in Chromium; it proxies websockets for HMR). The `serve` executor registers the route on start and unregisters on teardown. Each worktree tab gets a per-worktree title + tinted favicon (dev-only, hostname-derived). Because a worktree's offset ports aren't forwarded, its serve is **`:6080`-only** — viewable solely through the shared browser.
- **Observe-only mode.** The `shared-browser` CLI gains `observe` / `resume`, and `status` reports the mode; the flag persists in `SB_RUNTIME`. `attach.mjs` / `verify.mjs` / the recorder honor it and refuse to navigate/click/type while set. Claude enters observe-only before handing the human an interactive step (real OAuth / captcha) and resumes after. Real Google OAuth is pinned to the main-tree serve on `localhost:4200` (the only registered origin); emulator auth works on any tree/origin.

The layers below are preserved as the original design record; where they mention `serve-with-shared-browser` or `serve-worktree`, read the unified `serve` above.

## Locked decisions (from discussion)
- **Home:** fold into the **existing `browser-automation` plugin** (skill) + **project-starter** (provisioning + generator). No new plugin.
- **Availability:** deps **installed always** in every BeSpunky devcontainer; the stack **starts on demand** (lazy).
- **Packaging:** extend the existing **`post-create.sh` + `devcontainer` generator** seam. **No devcontainer features.**
- **Composition:** ship the **full orchestrator** — a `serve-with-shared-browser` target (serve + shared-browser + auto-navigate, one command) composing with `serve-worktree --portOffset`.

## Architecture (each layer a black box over the one below)

```
Human (host tab)  http://localhost:6080  ──► noVNC ─ websockify ─ x11vnc ─┐
                                                                          ├─ Xvfb :99 ─ Chromium (persistent, CDP :9223 loopback)
Claude (Playwright) http://127.0.0.1:9223 ──► connectOverCDP ─────────────┘
```
- **Persistent Chromium** is the shared object; Claude attaches/detaches without disturbing the human.
- **Only `6080` is forwarded.** CDP `9223` + VNC `5900` bind loopback — full control never leaves the container.
- **In-container browser** reaches `localhost:<port>` directly → composes with `serve-worktree --portOffset` (navigate to the isolated offset URL; human watches that stack over noVNC).

---

## File-by-file layout

```
plugins/browser-automation/
  skills/shared-browser/SKILL.md                      # NEW — Claude's knowledge (decision tree, flow, verify loop, gotchas)
  skills/playwright/SKILL.md                          # EDIT — cross-link + decision tree entry

plugins/project-starter/.../assets/nx-tools/src/generators/
  shared-browser/                                     # NEW generator — writes tools/shared-browser/*, wires targets
    generator.ts, schema.json
  devcontainer/post-create.sh.tpl                     # EDIT — apt install deps (best-effort, retry) + ensure chromium
  devcontainer/generator.ts (+ devcontainer.json.tpl) # EDIT — forwardPorts 6080 + labeled portsAttributes
  app/generator.ts                                    # EDIT — wire per-app `serve-with-shared-browser` target

# Written INTO each scaffolded project by the shared-browser generator (like tools/emulators.sh):
tools/shared-browser/
  shared-browser            # the CLI primitive (bash)
  attach.mjs                # attach() -> {browser,context,page}
  verify.mjs               # the in-place verify-loop helpers
  recorder.mjs              # persistent console/network/pageerror -> JSONL
```

The **skill** is the only piece in `browser-automation` (knowledge, auto-updates). Everything runnable is generator-written into the project's `tools/` (like the Firebase tooling), so it's reproducible and versioned with the project.

---

## Layer 1 — the CLI contract (`tools/shared-browser/shared-browser`)

The single public seam. Idempotent, PID-file supervised, readiness-gated. All seven brief gotchas baked in by construction.

```
shared-browser up                          # start missing components (Xvfb→fluxbox→Chromium→x11vnc→websockify),
                                          #   readiness-gate on 5900/6080/9223, auto-start recorder, print noVNC URL. Idempotent.
shared-browser navigate --url=<u> [--wait]  # ensure up, (optionally wait until <u> answers), navigate the shared browser to it
shared-browser status [--json]              # per-component up/down + ports + URL (machine-readable with --json)
shared-browser url                          # print the noVNC URL (scripting)
shared-browser logs [component] [--since=<ts>] [--level=<lvl>]   # tail a component log, or filtered recorder JSONL
shared-browser down                         # graceful→force teardown via PID files; verify ports freed. Never pattern-kill.
shared-browser restart                      # down + up
shared-browser clean                        # wipe profile + logs + screenshots — reset to a fresh session
```
The `navigate --wait` verb (ensure-up + wait-for-app + navigate) is the single primitive the `serve-with-shared-browser` target composes — there's no separate `codrive` verb.

- **Constants, env-overridable:** `SB_DISPLAY=:99` `SB_GEOM=1440x900x24` `SB_VNC=5900` `SB_WEB=6080` `SB_CDP=9223` `SB_RUNTIME=${XDG_RUNTIME_DIR:-/tmp}/shared-browser` (holds `*.pid`, `profile/`, `logs/`).
- **Baked-in gotcha fixes:** `unset WAYLAND_DISPLAY XDG_SESSION_TYPE` (#2); own `Xvfb` not ambient `:12` (#4); Chromium `--disable-gpu --use-gl=swiftshader --in-process-gpu --disable-dev-shm-usage` (#1); **PID-file lifecycle, never `pkill -f`** (#5); validated output paths (#6); loopback CDP (#7).
- **Detach:** every daemon `setsid`-detached so it survives Claude's shell and the CLI process.
- **Readiness:** poll all three ports with timeout; on failure dump each component's log tail and exit non-zero (no silent half-up).
- **Guards:** apt deps present (else clear message); Chromium present (else `npx playwright install chromium`); resolve binary via whichever of `playwright`/`playwright-core`/`@playwright/test` is installed.

---

## Layer 2 — Claude ergonomics (the `.mjs` helpers)

### `attach.mjs`
```
attach({ cdp='http://127.0.0.1:9223', pageUrl } = {}) -> { browser, context, page }  // pageUrl selects a tab by URL pattern
pages({ cdp } = {})                                   -> [{ url, title }]              // list open tabs
withPage(fn, opts = {})                               -> <fn result>                   // attach → run fn(page) → ALWAYS detach (even on throw)
```
`browser.close()` **detaches the CDP session — it does NOT close the shared browser** (the human keeps their session). **`withPage` is the leak-proof default** (guaranteed detach); raw `attach` is the escape hatch. Resolves Playwright from whichever package is installed.

### `verify.mjs` — the in-place CSS/DOM verify loop, as a few calls
```
injectStyle(page, css)                 -> handle{ remove() }        // ephemeral <style>
setCssVar(page, name, value, sel=':root')                          // CSS custom property
measure(page, selector)                -> { rect, computed, overflow }  // getBoundingClientRect + getComputedStyle + scrollWidth/clientWidth
screenshotPair(page, name, mutate)     -> { before, after }         // before/after screenshots around a mutation
theme(page, 'dark'|'light')                                        // emulate prefers-color-scheme + set data-theme
viewport(page, 'mobile'|'tablet'|'desktop'|{w,h})                   // responsive / thumb-reach
pseudo(page, selector, ':hover'|':focus'|':active')                // CDP forcePseudoState
layoutShift(page, selector, mutate)    -> { deltas }                // rect-diff CLS check
```
These make the crown-jewel loop a handful of lines instead of boilerplate.

### `recorder.mjs`
Long-lived `connectOverCDP`; context `page` event → attach `console`/`requestfailed`/`response`/`pageerror`/**`framenavigated`** per tab (so Claude sees where the human went, not just side-effects); append **timestamped JSONL** to `logs/events.jsonl`; **auto-reconnect** if Chromium restarts; **size-capped rotation** (keep last 2). **Metadata only** by default (method/url, status/timing, console level+text, uncaught); bodies opt-in (`--bodies`, heavy). **Secrets redacted before write** (`Authorization` headers, common token query params). Streams to disk — **no in-memory buffering** (own RAM stays flat). Solves the core nuance: console/network are a **live stream** — the recorder stays attached so nothing is missed while the *human* drives; Claude `tail`s (filtered via `logs --since/--level`) on demand.

---

## Layer 3 — the `serve-with-shared-browser` orchestrator (full composition)

**Explicit, no-guessing target name** matching the house `serve-with-emulators` / `serve-no-emulators` pattern: **`serve-with-shared-browser`**. It serves the app *and* opens it in the shared browser. Per-app, wired by the app generator (beside serve-options / worktree-serve):
```
serve-with-shared-browser = nx:run-commands (parallel, continuous):
  - nx run <app>:serve                                    # whatever serve is (plain dev-server, or firebase emulators+app)
  - shared-browser navigate --url=http://localhost:$((4200 + ${PORT_OFFSET:-0})) --wait
```
- Same `$((4200 + ${PORT_OFFSET:-0}))` shell-arithmetic as the Firebase serve orchestrator → the navigate URL is **offset-aware** for free.
- `shared-browser navigate --wait` ensures the stack is up, waits for the app to answer, navigates, and the recorder is already running (auto-started by `up`) — all while `serve` runs in parallel.

**Worktree composition — no new flag needed.** `serve-worktree` already takes `--serveTarget` (default `serve`), so:
```
nx run <app>:serve-worktree --portOffset=auto --serveTarget=serve-with-shared-browser
```
= isolated worktree + offset emulators/app + shared browser navigated to the offset URL + human watching over noVNC. Worktree isolates the code, offset isolates the ports, `serve-with-shared-browser` co-drives the result. The whole session's machinery clicks together.

**Workspace lifecycle targets** — a `shared-browser` Nx project wraps the CLI with explicit names: `shared-browser:up`, `shared-browser:down`, `shared-browser:status`, `shared-browser:restart`, `shared-browser:clean`, `shared-browser:url`, `shared-browser:logs`.

---

## Layer 0 — provisioning (always-on, via the existing seam)

- **`post-create.sh.tpl`:** `apt-get install -y x11vnc novnc websockify fluxbox fonts-liberation fonts-noto-color-emoji` + ensure Playwright Chromium. Best-effort with retry (mirrors the Angular-skills fetch block), never fails the build.
- **`devcontainer` generator + `devcontainer.json.tpl`:** `forwardPorts += 6080`; `portsAttributes["6080"] = { label: "Shared Browser (noVNC)", onAutoForward: "notify" }` (a clickable toast when the stack opens the port — not silent, not intrusive).
- **`shared-browser` generator (nx-tools):** writes `tools/shared-browser/*`; wires the workspace `shared-browser` lifecycle project; adds a `/.shared-browser` `.gitignore` entry (covers a relocated in-workspace `SB_RUNTIME`). The **app generator** wires the per-app `serve-with-shared-browser` target. Runs for every scaffold (no flag) and is `--repair`-idempotent. *(Follow-up: a self-extinguishing devcontainer welcome-banner line for discoverability — deferred to v2; for now the printed noVNC URL, the `:6080` forward toast, and the skill carry discovery.)*

---

## Layer 4 — the skill (`browser-automation:shared-browser`)

**Decision tree (the reconciliation — prevents tool sprawl):**
| Situation | Tool |
| --- | --- |
| Pure automated check, no human watching, headless is fine | `browser-automation:playwright` (headless script) |
| Human wants to **watch / co-drive**, OR in-place **visual / CSS-DOM verify** with measured proof | **`shared-browser`** (`serve-with-shared-browser` / `up`, `attach`, `verify`) |
| Quick static preview of a file/artifact | `Claude_Preview` MCP |
| Must use the human's **real logged-in profile** | approach A escape hatch (documented, opt-in, not default) |

**Teaches:** `serve-with-shared-browser` (or `up`) → hand the human the URL → `attach` → drive → detach; the **verify loop** (reproduce live → patch via CDP → measure/screenshot → **port the fix to real source** → reload & confirm); tail the recorder; the gotchas as pitfalls.

**Hard line (architecture-first):** live CDP edits are **ephemeral scaffolding to *find* the fix** — the deliverable is the **source change**, confirmed after reload. The skill states this unmissably.

---

## Ecosystem & friction — the hidden gaps, closed

The capability is only as good as the seams around it. What each party actually needs, and how the design removes the friction:

### Developer (the human)
| Gap / friction | Closed by |
| --- | --- |
| "Where's the URL? Is it running?" | `up`/`navigate` print the noVNC URL prominently; `6080` `portsAttributes` = `{ label: "Shared Browser (noVNC)", onAutoForward: "notify" }` → VS Code toasts a clickable link the moment the stack opens the port. `status` answers "is it up" anytime. |
| Hunting for the command | The `browser-automation` skill teaches it; the devcontainer welcome banner adds one line ("Shared browser: `nx run <app>:serve-with-shared-browser`") — self-extinguishing style, like the Firebase banner. |
| Clunky noVNC session | URL ships `?autoconnect=true&resize=remote&reconnect=true&show_dot=true`; **clipboard sync enabled** (paste a URL into the VNC browser, copy text out). x11vnc `-forever -shared` so the human's view survives Claude detach/attach and auto-reconnects. |
| Onboarding lost on rebuild | Profile is **fresh by default** (desirable for testing). To keep a signed-in session across rebuilds, `SB_RUNTIME`/profile is **overridable to a persisted workspace volume** (documented, opt-in). |
| Fighting Claude for the cursor | Skill etiquette: co-drive is **turn-taking** — Claude observes/reads while the human drives, announces before it navigates or mutates, and never yanks the view mid-interaction. |

### Claude
| Gap / friction | Closed by |
| --- | --- |
| "Is it safe to attach?" | `up` blocks until ready (readiness-gated); `status --json` is the machine-readable preflight. No attaching to a half-up stack. |
| Which tab? multi-tab targeting | `attach({ pageUrl })` selects a page by URL pattern; `pages()` lists them; default = the active tab. |
| Leaking CDP sessions | `withPage(fn)` auto-attaches, runs, and **detaches even on throw** — the leak-proof default for ad-hoc driving (raw `attach()` is the escape hatch). |
| Reading the live stream | `logs --since=<ts> --level=error` filters the recorder JSONL; the recorder logs **navigations** too, so Claude can tell where the human went, not just console/network side-effects. |
| Feeding screenshots back | `verify.screenshotPair` writes to a **predictable, gitignored** `logs/screenshots/` — Claude reads the PNGs by known path. |
| Diagnosing a failed start | Readiness-gate failure dumps each component's log tail; `logs <component>` for detail. The seven gotchas are the skill's "pitfalls" table. |
| Not knowing when to use it | The decision tree (above) — the single most important anti-sprawl seam. |

### What the design deliberately does NOT try to solve
- **Human input capture** (clicks/keys) — inherent to VNC; Claude infers from DOM/network/navigations or asks. Not worth an input-logger.
- **Multiple simultaneous shared browsers** — one singleton per container (matches "one forwarded port set, one serve"). Multi-instance is env-parameterizable later, not v1.

## Robustness — leaks, cleanup & lifecycle safety (what to prevent, and how)

A long-lived, multi-process, human+agent-shared stack is a leak magnet. Every failure mode below is designed out, not left to discipline.

### Process leaks
- **Orphaned daemons after an ungraceful death** (container stop/crash, closed terminal): `up` **reaps before it starts** — validates each PID file by **PID *and* matching process cmdline** (a reused PID owned by something else is never killed), and reclaims stale ports (SIGTERM→SIGKILL, poll until free) — the same verified-reclaim discipline as `reap-emulators.sh`.
- **Concurrent `up` races**: an `flock` on `SB_RUNTIME/up.lock` serializes startup — two `up`s can't half-start the stack.
- **Partial start**: if the readiness gate fails, `up` **tears down what it started** (clean slate) after dumping diagnostics — never leaves a half-up stack for the next run to trip over.
- **`down` that doesn't fully stop**: graceful `SIGTERM` → wait → `SIGKILL`, then **verify 5900/6080/9223 are actually free** before returning (kill ≠ freed).
- **Zombie daemons**: `setsid`-detached and reparented to the container's init (PID 1) which reaps; documented as an assumption.

### Disk leaks
- **Recorder JSONL grows unbounded** on network-heavy apps → **size-capped rotation** (rotate at N MB, keep last 2) + truncate-on-`up` option; `clean` clears it.
- **Screenshots accumulate** → written under `logs/screenshots/`, **capped to the last N** (oldest pruned); `clean` wipes them.
- **Chromium profile bloat** (cache, IndexedDB, service workers) → Chromium self-caps its disk cache; `clean` resets the profile; fresh-by-default on a clean session.
- **Everything is gitignored** — the generator adds `/.shared-browser`-style ignores (runtime dir if placed in-workspace, or it lives under `${XDG_RUNTIME_DIR:-/tmp}` and never touches the repo). Nothing in scratchpad.

### Memory (RAM) leaks
- **Chromium long-session growth** (SPA leaks, accumulated tabs): the recorder streams to disk (no in-memory buffering); `withPage`/tab hygiene closes tabs Claude opens; `restart` recycles Chromium when it gets heavy (skill notes the tell: sluggish view / rising RSS). Optional idle auto-restart deferred to v2.
- **Recorder process**: stateless-in-memory by construction — append-and-forget to JSONL, listeners attached per page and removed on page close.

### Correctness / safety
- **Port already held by a non-ours process** (the app, another tool): `up` detects a foreign holder and **errors clearly instead of killing it** — only *our* stale components are reaped.
- **Secret leakage into the recorder**: metadata-only by default, and **`Authorization` headers + common token query params are redacted** before write. The skill warns never to share/commit `events.jsonl`.
- **CDP blast radius**: `9223` bound `127.0.0.1` and **never** in `forwardPorts`; only `6080` is forwarded.
- **The human's session is sacrosanct**: `browser.close()` only detaches; Claude cleans up its own injected styles (`injectStyle().remove()`) and tabs so the human's view is left as it was.

## Validation (Docker, before merge — the brief's §9 criteria)
All testable in the `typescript-node` image (Debian+apt; Xvfb *is* the display — no host GUI):
1. `up` → 5900/6080/9223 listening within timeout; `status` all-green.
2. `curl 127.0.0.1:9223/json/version` → Chrome build; `curl 6080/vnc.html` → 200.
3. `attach()` → navigate → `page.screenshot()` **succeeds** (proves the software-GL fix).
4. DOM/console/network readable; console + `requestfailed` captured.
5. **CSS verify loop:** reproduce overflow → inject override → `scrollWidth==clientWidth` + before/after screenshots.
6. Recorder accrues while "the human" drives; survives a Chromium restart (auto-reconnect).
7. `down` → no stray processes, no self-kill.

A `tools/shared-browser`-driven validation script runs these in one container pass.

---

## Security & constraints (unchanged from brief)
- `x11vnc -nopw` acceptable only because VNC/noVNC are loopback + reached solely via the user's own forwarded localhost. Offer opt-in `-rfbauth` for shared/remote hosts.
- **Never** forward/bind CDP `9223` beyond `127.0.0.1`.
- Fresh `--user-data-dir` (no host creds). Approach A (real profile) documented as opt-in only.

## Open sub-decisions (small; my leans)
1. **Idle auto-shutdown** — v1: **explicit `down` only** (simplest); revisit if RAM bites.
2. **Recorder response bodies** — **off by default**, `--bodies` opt-in.
3. **Approach A escape hatch** — **document only** (a note in the skill), don't build the host-CDP variant in v1.
4. **`--repair` for existing projects** — the generator + devcontainer/post-create edits back-fill on `scaffold.sh --repair` (same as every other house capability).

## Effort / sequencing (feature branch, small commits, Docker-validated)
1. CLI primitive + PID/readiness (validate up/down/status in Docker).
2. `attach.mjs` + `recorder.mjs` (validate attach+screenshot+recorder).
3. `verify.mjs` (validate the CSS loop).
4. `shared-browser` generator + `serve-with-shared-browser` target + app-generator wiring.
5. Provisioning (post-create apt + forwardPorts).
6. Skill + playwright cross-link.
7. Full Docker validation pass (§9) + a fresh-scaffold e2e asserting the target + provisioning land.
