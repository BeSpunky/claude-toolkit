---
name: shared-browser
description: One live browser that you and the human drive together — the human WATCHES and clicks it in a normal host tab (over noVNC); you attach over loopback CDP to navigate, mutate DOM/CSS, and read console/network on the SAME instance, at the same time. Use whenever the human wants to watch or co-drive a browser, when you need in-place visual / CSS-DOM verification with MEASURED proof (getComputedStyle, getBoundingClientRect, overflow, before/after screenshots), when reproducing a user-reported bug live with a human present, or when pairing on a flow while you observe the rendered DOM, console, and network. Triggers — "watch me do this", "let's debug this together", "open it so I can see", "co-drive", "verify this CSS fix in the running app", "reproduce the bug with me", "check both themes / responsive in the real view", "why is this overflowing", "pair on this flow". NOT for pure solo headless automation with no human watching — use `browser-automation:playwright` for that.
---

# Shared Co-Driven Browser (`shared-browser`)

**One persistent Chromium inside the container that a human and Claude drive together, live.** The human watches and clicks it in a normal host-OS tab over noVNC; Claude attaches over a loopback CDP port to navigate, mutate DOM/CSS, and read console/network — on the *same* browser instance, at the same time.

## What it is

| Piece | How |
|---|---|
| The browser | One **persistent** headed Chromium inside the container (software-GL). It outlives any single automation. |
| Human path | noVNC in a normal host tab on the **forwarded `:6080`** — `http://localhost:6080/vnc.html?autoconnect=true&resize=remote&reconnect=true`. |
| Claude path | Playwright `connectOverCDP` on **loopback `127.0.0.1:9223`** (never forwarded — full browser control never leaves the container). |
| Attach/detach | Claude attaches and detaches freely **without disturbing the human's session** — `browser.close()` only detaches the CDP session; the shared browser stays up. |

Only `6080` is forwarded. CDP (`9223`) and VNC (`5900`) bind loopback only.

## Decision tree — which browser tool? (read this first)

The single most important seam — it prevents tool sprawl. Pick by *who is watching and what proof you need*.

| Situation | Tool |
|---|---|
| Pure automated check, **no human watching**, headless is fine | **`browser-automation:playwright`** (headless script artifact) |
| Human wants to **watch / co-drive**, OR in-place **visual / CSS-DOM verify with measured proof** | **`shared-browser`** (this skill) |
| Quick static preview of a **file / artifact** | `Claude_Preview` MCP |
| Must use the human's **real logged-in profile** (their live cookies/sessions) | **Approach A** escape hatch — documented, opt-in, NOT the default (see below) |

If nobody is watching and you just need a screenshot or a scrape from a script, that's `playwright`. The moment the human wants to *see it happen*, or you need `getComputedStyle`/`getBoundingClientRect`/overflow numbers to *prove* a visual fix, it's `shared-browser`.

## The flow

```
1. nx run <app>:serve-with-shared-browser        # serve + shared-browser up + auto-navigate, one command
   (or, standalone:  tools/shared-browser/shared-browser up)
2. Hand the human the printed noVNC URL           # they open it in a host tab and watch
3. Attach:  withPage(fn)  (preferred, leak-proof) # attach() is the raw escape hatch
4. Drive / observe                                # navigate, fill, mutate, measure, read recorder
5. Detach:  browser.close()                       # DETACHES only — does NOT close the shared browser
```

- `up` is **idempotent** and **readiness-gated** — it blocks until `5900/6080/9223` are listening, auto-starts the recorder, and prints the noVNC URL. Never attach to a half-up stack; `status --json` is the machine-readable preflight.
- **`withPage(fn)` is the default** — it attaches, runs `fn(page)`, and **detaches even on throw** (leak-proof). Raw `attach()` is the escape hatch for long-lived sessions; if you use it you own the `browser.close()`.
- `attach({ pageUrl })` selects a tab by URL pattern; `pages()` lists open tabs. **Default is the *first* open tab, which may not be the one the human is looking at** — in a multi-tab co-drive, call `pages()` and target the right one with `pageUrl` rather than assuming.

## The verify loop (the headline use)

The crown jewel: fix a visual/CSS/layout bug **in the real running view**, with objective proof, then make the fix real in source.

```
reproduce   →  see the bug in the actual running app (the human's live view)
live-patch  →  verify.injectStyle / setCssVar / (toggle classes) via CDP  — EPHEMERAL
prove       →  verify.measure  (getComputedStyle, getBoundingClientRect, overflow)
               verify.screenshotPair (before/after)  ·  theme (dark/light)
               viewport (mobile/tablet/desktop)  ·  pseudo (:hover/:focus/:active)
               layoutShift (rect-diff CLS check)
PORT        →  write the fix into REAL SOURCE — the component's own SCSS/template
               (architecture-first: fix the root, not the symptom)
confirm     →  reload  →  the SOURCE reproduces the live fix, unaided
```

> **HARD LINE — live CDP edits are EPHEMERAL scaffolding to *find* the fix. They vanish on reload. The deliverable is the SOURCE change, confirmed after reload.** An injected `<style>` or a `setCssVar` is never the fix — it is how you discover the fix cheaply. If you stop before porting to source and reloading, you have shipped nothing. Clean up every injected style (`injectStyle(...).remove()`) when done exploring.

Prove it, don't eyeball it: `measure` gives you `scrollWidth == clientWidth` for an overflow fix, real computed values for a spacing fix, `layoutShift.deltas` for a "zero shift" claim. Screenshots are corroboration, not the proof.

## The recorder (console + network are a LIVE STREAM)

Console and network events only exist *while something is attached* — so a long-lived **recorder** (`connectOverCDP`) stays attached the whole session and appends timestamped JSONL to `logs/events.jsonl`. It captures console (all levels + uncaught), request method/url, response status/timing, `requestfailed`, **and `framenavigated`** — so you can see *where the human went*, not just side-effects. It auto-reconnects if Chromium restarts, rotates by size (keep last 2), and streams to disk (flat RAM).

```
tools/shared-browser/shared-browser logs --since=<ts> --level=<lvl>   # read the stream, filtered
```

- `up` auto-starts the recorder — nothing is missed while the **human** drives.
- **DOM needs no recorder** — it's read fresh on each `attach`.
- Metadata only by default (`--bodies` is heavy, opt-in). Redacted before write: page + resource **URL query *and* fragment** token params, and `Authorization`/`Cookie`/`Set-Cookie` headers. This is best-effort, **not** exhaustive — response bodies (under `--bodies`) and other headers may still carry secrets, so **never share or commit `events.jsonl`**.

## Co-drive etiquette (the human's session is sacrosanct)

Co-driving is **turn-taking**, not a fight for the cursor.

- **Observe and read while the human drives.** Default to watching (DOM/recorder) rather than grabbing control.
- **Announce before you navigate or mutate** — "I'm going to inject a style / navigate to X" — so the view never changes under their hands.
- **Never yank the view mid-interaction.** Wait for a natural handoff.
- **Clean up after yourself** — remove injected styles (`injectStyle(...).remove()`), close tabs you opened. Leave the view as you found it.

## Composition (the big payoff, one line)

`serve-with-shared-browser` composes with the worktree/offset stack. `serve-worktree` already takes `--serveTarget`, so:

```
nx run <app>:serve-worktree --portOffset=auto --serveTarget=serve-with-shared-browser
```

= **isolated worktree** (code) + **offset port stack** (emulators/app) + **shared browser navigated to the offset URL**, human watching over noVNC. The navigate URL is offset-aware for free (`http://localhost:$((4200 + ${PORT_OFFSET:-0}))`). Worktree isolates the code, the offset isolates the ports, `serve-with-shared-browser` co-drives the result.

## CLI reference — `tools/shared-browser/shared-browser`

| Verb | Does |
|---|---|
| `up` | Start missing components (Xvfb→fluxbox→Chromium→x11vnc→websockify), readiness-gate `5900/6080/9223`, auto-start recorder, print noVNC URL. Idempotent, `flock`-serialized, reaps stale-by-PID+cmdline before starting. |
| `navigate --url=<u> [--wait]` | Ensure up; with `--wait`, poll `<u>` until it answers; navigate the shared browser via CDP. (The single primitive `serve-with-shared-browser` composes — there is no `codrive` verb.) |
| `status [--json]` | Per-component up/down + ports + URL. `--json` = machine-readable preflight. |
| `url` | Print the noVNC URL (scripting). |
| `logs [component] [--since=<ts>] [--level=<lvl>]` | Tail a component log, or the filtered recorder JSONL. |
| `down` | Graceful `SIGTERM`→`SIGKILL` via PID files; verify ports freed. **Never pattern-kills.** |
| `restart` | `down` + `up` (recycle Chromium when the view gets sluggish / RSS climbs). |
| `clean` | Wipe profile + logs + screenshots — reset to a fresh session. |

**Workspace Nx targets** (thin wrappers over the CLI): `shared-browser:up | down | status | restart | clean | url | logs`. Per-app: **`serve-with-shared-browser`** (serve + navigate `--wait`, parallel + continuous).

## Helper signatures — `tools/shared-browser/*.mjs`

```
attach.mjs
  attach({ cdp='http://127.0.0.1:9223', pageUrl } = {}) -> { browser, context, page }
  pages({ cdp } = {})                                   -> [{ url, title }]
  withPage(fn, opts = {})                               -> <fn result>   // ALWAYS detaches, even on throw
  // browser.close() DETACHES the CDP session — it does NOT close the shared browser.

verify.mjs
  injectStyle(page, css)              -> { remove() }                    // ephemeral <style>
  setCssVar(page, name, value, sel=':root')                             // CSS custom property
  measure(page, selector)             -> { rect, computed, overflow }    // rect + computed + scroll/client
  screenshotPair(page, name, mutate)  -> { before, after }              // writes to logs/screenshots/
  theme(page, 'dark'|'light')                                          // prefers-color-scheme + data-theme
  viewport(page, 'mobile'|'tablet'|'desktop'|{ w, h })                  // responsive / thumb-reach
  pseudo(page, selector, ':hover'|':focus'|':active')                  // CDP forcePseudoState
  layoutShift(page, selector, mutate) -> { deltas }                    // rect-diff CLS check

recorder.mjs
  // long-lived connectOverCDP; per-page console/response/requestfailed/pageerror/framenavigated
  // -> timestamped JSONL in logs/events.jsonl; auto-reconnect; size-cap rotation; secrets redacted.
```

## Approach A — the real-profile escape hatch (opt-in, not default)

If (and only if) the task **must** use the human's real logged-in profile (their live cookies/sessions on the host browser), Approach A attaches to the *host* browser over CDP instead. It's documented as an opt-in escape hatch, **not the default** — it depends on the WSL→Docker network hop and Chrome's DevTools Host-header guard, needs a host-side launch each session, and is fragile across WSL networking modes. The default (this skill's approach B) uses a **fresh in-container profile** — usually *desirable* for testing, and it carries no host credentials.

## Pitfalls (already fixed in the tooling — recognize them if you port to a new base)

These seven cost a debug cycle each in the prototype. The CLI bakes in every fix; this table is so a future agent recognizes them if porting to a new base image.

| # | Symptom | Cause | Already fixed by |
|---|---|---|---|
| 1 | `page.screenshot` → `Unable to capture screenshot` (headed launch OK) | Headed Chromium composites via the GPU process; container has no GPU | `--disable-gpu --use-gl=swiftshader --in-process-gpu` |
| 2 | `x11vnc` exits immediately, log says *"Wayland sessions … Exiting"* | Devcontainer exports a VS Code `WAYLAND_DISPLAY`; x11vnc refuses to serve the X11 Xvfb | `unset WAYLAND_DISPLAY XDG_SESSION_TYPE` for the whole stack |
| 3 | `xvfb-run` → `xauth command not found` | `xauth` not in the base image | Start `Xvfb` manually (no auth cookie), or `apt-get install xauth` |
| 4 | A pre-existing `DISPLAY=:12` exists; browsers launch on it but screenshots fail | It's an off-screen/unmapped compositor surface, not a real framebuffer | Always run our **own** `Xvfb`; don't rely on the ambient `:12` |
| 5 | `pkill -f "Xvfb :99"` killed the shell running it (exit 144) | `pkill -f` matches the killer's own command line | **PID-file lifecycle, never pattern-kill** (bracket trick if forced) |
| 6 | Screenshot written to `…/undefined/…` | `NAME=val` after `node -e '…'` is a positional arg, not an env var | Pass params via `argv` or a real env prefix; validate output paths |
| 7 | (Approach A only) CDP connect from container rejected | Chrome DevTools Host-header guard + loopback-only bind | Non-issue for approach B (loopback CDP); documented so nobody re-hits it |

## Robustness quick notes

- **Reads before restarts:** `status`/`status --json` answers "is it up" anytime; `up` reaps orphaned daemons (validate by PID *and* cmdline — a reused PID is never killed) and reclaims stale ports.
- **Foreign port holder** (the app, another tool): `up` errors clearly instead of killing it — only *our* stale components are reaped.
- **Sluggish view / rising RSS** on a long SPA session: `restart` recycles Chromium.
- **Everything is gitignored** — runtime lives under `${XDG_RUNTIME_DIR:-/tmp}/shared-browser` and never touches the repo.
