---
effort: shared-browser-fit
status: concluded
concluded: 2026-10-06
summary: The shared browser runs on TigerVNC Xvnc with noVNC resize=remote, so its desktop is exactly the viewer's tab; borderless WM, maximized Chromium, `fullscreen on|off`, one tab per start, logins kept across down. HiDPI scaling dropped (noVNC sends CSS px). Dogfooded on the consumer path; nothing to migrate.
tags: [shared-browser, novnc, xvnc, house, nx-tools-0.46.0]
---

# Decisions and findings (appended as they happen)

## 2026-10-06 — prototype, before touching the template

Hand-built stack on a scratch display (`:57`) and random ports, in this container (Debian 13 trixie; apt
candidates `tigervnc-standalone-server 1.15.0`, `novnc 1:1.6.0`, `websockify 0.12.0`, `fluxbox 1.3.7` — the
same package names exist in bookworm, which `typescript-node` / `base:debian` images use).

**Xvnc replaces Xvfb + x11vnc as ONE process.** `Xvnc :57 -geometry 1440x900 -depth 24 -rfbport <p> -localhost
-SecurityTypes None -desktop "proto (shared browser)" -AlwaysShared -nolisten tcp` listened on `127.0.0.1:<p>` and
`[::1]:<p>` only; `xrandr` reported `maximum 32768 x 32768` (RandR-resizable). The `-desktop` name still titles
the noVNC tab: `title "proto (shared browser) - noVNC"`.

**A real noVNC viewer resizes the desktop** (headless Playwright driving `vnc.html?...&resize=remote` at three
viewport sizes; desktop from `xdpyinfo`, window from CDP `Browser.getWindowForTarget`):

    viewer 1280x720  → desktop 1280x720  window 1280x720 maximized
    viewer 1900x1000 → desktop 1900x1000 window 1900x1000 maximized
    viewer 800x600   → desktop 800x600   window 800x600 maximized

**fluxbox: the config must live in a private HOME.** `fluxbox -rc <file>` is NOT enough: on a first run fluxbox
creates `~/.fluxbox` and copies Debian's default `init` OVER the `-rc` file (every key then logged as
"Failed to read"), so the toolbar and 4 workspaces came back (`_NET_WORKAREA = 0, 0, 1440, 880`). Running it with
`HOME=<runtime>/fluxbox` and the config at `<runtime>/fluxbox/.fluxbox/{init,apps,keys,menu}` (plus `-no-toolbar
-no-slit`) gave `_NET_WORKAREA = 0, 0, 1440, 900`, `_NET_NUMBER_OF_DESKTOPS = 1`, and no `~/.fluxbox` in the
user's real home (the old unconfigured `fluxbox` did write one there).

**Fullscreen over CDP works and follows resizes.** `Browser.setWindowBounds {windowState:"fullscreen"}` then the
viewer at 1500x900 and 1100x700 → window `1500x900 fullscreen`, `1100x700 fullscreen`. Going back needs two
steps: `maximized` straight from fullscreen is refused by Chromium ("To maximize a minimized or fullscreen window,
restore it to normal state first."), so `off` = `normal` then `maximized`.

**Chrome for Testing shows an infobar that eats 56 px.** In fullscreen the page still got only `ih 644` of 700.
A screenshot showed "Chrome for Testing v153 is only for automated testing…". `--test-type` does not remove it;
`--disable-infobars` does: maximized `ih 613` of 700 (87 px = tab strip + omnibox), fullscreen `ih 700` of 700.
`--enable-automation` was NOT used: it sets `navigator.webdriver`, which real OAuth providers refuse.

**HiDPI scale is incoherent with resize=remote — dropped.** noVNC 1.6 sizes its request from
`this._screen.getBoundingClientRect()` (`core/rfb.js` `_screenSize`), i.e. CSS px, and has no devicePixelRatio
handling anywhere in `core/` or `app/`. So the framebuffer is always the tab's CSS size. Adding
`--force-device-scale-factor=2` inside a 1100x700 desktop gave the page `{"iw":550,"sw":550,"dpr":2}`: the app
gets a phone-sized viewport and everything is drawn twice as large — magnification, not sharpness. That is what
Chromium's own zoom (Ctrl +) already does, without a restart. A sharp HiDPI view would need a framebuffer of
CSS px × host DPR that noVNC then scales down, which `resize=remote` cannot request. So no `SB_SCALE` /
`--scale` ships. (Bandwidth was never reached as a question: there is nothing to pay for.)

## 2026-10-06 — implementation verified end to end (the generated script, real noVNC)

The templates were rendered exactly as `generator.ts` substitutes them into a scratch workspace and run with
random ports (`SB_DISPLAY=:58`, VNC/CDP/web in 20000-49999 — never the 6080-6119 band). A real noVNC page
(headless Playwright, the URL `shared-browser url` printed, and the bare root through the `index.html` redirect)
was driven at several sizes; desktop from `xdpyinfo`, window from CDP:

    viewer 1680x1050 → desktop 1680x1050, window maximized 1680x1050, page innerHeight 963 (87 px of browser chrome)
    viewer 1024x640  → desktop 1024x640,  window maximized 1024x640
    fullscreen on    → viewer 1440x810 → page 1440x810;  viewer 1920x1080 → page 1920x1080 (fullscreen follows)
    fullscreen off   → maximized 1920x1080, page innerHeight 993
    viewer 900x1400 (portrait) → desktop 900x1400, window maximized 900x1400

Tab title throughout: `"ws (shared browser) - noVNC"`. `status --json` gained `"window":{"state","width","height"}`
(`null` when Chromium is down) and its `components` are now `xvnc fluxbox chrome websockify recorder`; it runs in
~0.2 s, which matters because the browser-automation status line polls it every 10 s.

**Window control uses raw browser-level CDP, not Playwright** — a deliberate change after the first version: the
status line polls `status --json`, and a Playwright `connectOverCDP` attaches to every tab on each poll. Window
state is a `Browser`-domain question (`Browser.getWindowForTarget` with the page's `targetId`), so no page is
attached. Needs Node's built-in `WebSocket` (Node 22+, the house floor); without it `window` is `null`.

**Upgrade while the old stack runs** (the case the script already guards for the noVNC port): an OLD
Xvfb + x11vnc stack was brought up from the previous template, then the NEW `up` ran over it:
`retiring the previous Xvfb + x11vnc stack (this version runs Xvnc) — the shared browser restarts once`, then a
clean start, `status` all up, and no `Xvfb :58` / `x11vnc` left. The new `down` also stops an old stack.
Without this, x11vnc on the VNC port would be reported as a FOREIGN process and `up` would refuse — and `down`
would not know how to stop it. Retired components are known only by PID file + cmdline signature (x11vnc's
signature is `x11vnc -display :99`, because `-rfbport` alone also matches Xvnc's cmdline).

`SB_GEOM` keeps its name and now means the INITIAL desktop (`WxH` or `WxHxDepth`); `SB_GEOM=1280x800` gave
`Xvnc :58 -geometry 1280x800 -depth 24` and a window `maximized 1280x800`. Renaming it would have broken anyone
who sets it, for no gain: its meaning narrowed, its shape did not.

## Migration verdict: none owed

The web layer's `osPackages` are rendered ONLY into the composed post-create script
(`compose.ts` `renderOsPackages` → `{{OS_PACKAGES}}` in `post-create.sh`, or `post-create.bespunky.sh` beside an
adopted one) — class (A), owned and regenerated on every upgrade. Nothing in `devcontainer.json` names a package,
so `houseWrote()` / `adopted.houseAdded` have nothing to clean up. A container that already installed
`xvfb`/`x11vnc` keeps them until its next rebuild, where they simply are not installed; nothing calls them
(the script retires a still-running old stack, above). The script and `verify.mjs` are class (A) too. So the
payload release owes a version bump (the generators changed) but no migration rung — "nothing to migrate" is a
finding here, to be stated in the release commit.

What the upgrade cannot do by itself: a project upgraded but not yet rebuilt has no `Xvnc`, so `up` stops with
`missing dependencies: Xvnc` and names the package and the rebuild. That is the container-reaching case of the
dogfood rule (a rebuild must be observed before the release).

Package availability for the images the web layer uses: `tigervnc-standalone-server` is `1.12.0+dfsg-8` in
bookworm and `1.15.0+dfsg-2.1~deb13u1` in trixie (packages.debian.org). Verified here on 1.15 only.

## 2026-10-06 — review fixes (orchestrator's adversarial review: no blockers, two fixes)

**`window_cdp` had no deadline** on the websocket open or on command replies, so a Chromium that answers HTTP
but stalls on CDP would hang `status` / `status --json` / `fullscreen` forever (and the status line would drop
its entry after its 8 s budget, silently). Now one overall deadline per call (a timer that exits non-zero with
"no answer from Chromium over CDP (<url>) within <n> ms"): 3 s from `status`, 10 s from `fullscreen` (whose
`off` may wait out two WM state changes). `status` reports `"window":{"state":"unknown","width":null,"height":null}`
(text: "unknown — Chromium did not answer over CDP within 3s") when Chromium is up but silent; `null` still means
Chromium is down. Proved with a fake endpoint (serves `/json/list` + `/json/version`, swallows the websocket
upgrade, runs with `--user-data-dir=<profile>` so the CLI counts it as our chrome):

    status --json → "window":{"state":"unknown",...}   real 0m3.298s
    fullscreen on → "no answer from Chromium over CDP (http://127.0.0.1:35009) within 10000 ms", rc=1, real 0m10.030s

**`clean` now also removes `$WM_HOME` and the noVNC webroot** (both rewritten by the next `up`). Real cycle after
both fixes: up → status (`maximized 1440x900`, 0.198 s) → fullscreen on → off → down (ports free) → clean: runtime
left with only `host-verified logs profile up.lock` (`fluxbox`, `novnc-web`, `web.port` gone; `logs`/`profile`
are re-created empty by `ensure_dirs`, as before). bash -n, test-layers 87/0, test-scaffold, check-script-modes pass.

## 2026-10-06 — Dogfood — consumer path

Run in this container (Debian 13 trixie, `typescript-node:22`), scratch project outside the repo
(`<scratchpad>/dogfood/sbdog`), default ports (`:99`, VNC 5900, CDP 9223 — checked free with `ss -ltnp` first;
noVNC allocated 6094 from the band).

**Before (current release, nx-tools 0.45.1 from npm).** `house.sh new --add-layer=web` is refused ("a scaffold can
ensure the 'web' layer only together with 'angular'"), so the scaffold was `new --preset=angular --no-github sbdog web`
from the development checkout. `xvfb x11vnc` installed by hand; `shared-browser up` → `Xvfb :99 -screen 0 1440x900x24`
+ `x11vnc -display :99 -rfbport 5900 …`, URL `…&resize=scale…`. The old stack.

**Upgrade with the old stack live** — `house.sh upgrade --local --yes <scratch>` from this worktree. Two gates first, both
correct: no `--yes` → refused (no TTY); on `main` with no branch model → `UPGRADE_REFUSED: protected-branch`, so it ran on a
scratch branch. Preflight: "would have migrated 0.45.1 -> 0.45.1" (the payload is not bumped yet — expected; the release
owes the bump). The WHOLE diff: `tools/shared-browser/shared-browser` (the template), `.devcontainer/post-create.sh`
(only the shared-browser package line + its comment: `xvfb x11vnc` → `tigervnc-standalone-server`), `HOUSE.md` (the
one shared-browser paragraph), and `yarn.lock` — the `@bespunky/nx-tools@0.45.1` registry entry is DELETED (8 lines).
That last one is the known `--local` artifact (the engine itself warns "Do not commit the lockfile from this run"),
not a branch defect. Nothing else: no `devcontainer.json`, `HOUSE.rules.md`, `verify.mjs`/`attach.mjs` change.
`sudo apt-get install -y tmux curl tigervnc-standalone-server novnc websockify fluxbox fonts-liberation
fonts-noto-color-emoji iproute2 procps` (exactly the composed list) → rc 0.

**The upgraded CLI, as a consumer.** `up` over the live old stack: "retiring the previous Xvfb + x11vnc stack (this
version runs Xvnc) — the shared browser restarts once", then UP in 2.06 s; no `Xvfb`/`x11vnc` left; `Xvnc :99
-geometry 1440x900 -depth 24 …` + `fluxbox -no-toolbar -no-slit`. `status` all up, `window maximized 1440x900`;
`status --json` 0.19 s with `components` `xvnc fluxbox chrome websockify recorder` and `window`; `url` →
`http://localhost:6094/vnc.html?autoconnect=true&resize=remote&reconnect=true&show_dot=true`. noVNC tab title
`"sbdog (shared browser) - noVNC"`. Headless Playwright on that URL; X screen from `xdpyinfo -display :99`, window
from CDP `Browser.getWindowForTarget`, page from the active tab's `innerWidth/innerHeight`:

    viewer 2560x1440 → X 2560x1440 → maximized 2560x1440 → page 2560x1353
    viewer 1920x1080 → X 1920x1080 → maximized 1920x1080 → page 1920x993
    viewer 1280x800  → X 1280x800  → maximized 1280x800  → page 1280x713   (87 px of tab strip + omnibox)
    fullscreen on:
    viewer 2560x1440 → X 2560x1440 → fullscreen 2560x1440 → page 2560x1440
    viewer 1920x1080 → X 1920x1080 → fullscreen 1920x1080 → page 1920x1080
    viewer 1280x800  → X 1280x800  → fullscreen 1280x800  → page 1280x800
    fullscreen off   → maximized 1280x800, page 1280x713

Screenshot (borderless, no infobar): `<scratchpad>/dogfood/novnc-1920x1080.png` (+ `-fullscreen.png`).

**Serve path.** `yarn nx serve web --port-offset=1717` → `tools/dev/dev serve` brought the browser up (already up),
printed the `resize=remote` viewer URL, registered `sbdog.localhost`, and navigated the shared browser to it
(tab title `web`, page 1280x713 in a 1280x800 desktop). **Attach.** `attach.mjs` `pages()` / `withPage()` and
`verify.mjs` `measure()` / `injectStyle()` / `screenshotPair()` all worked over CDP 9223 and detached cleanly.

**Defects in this branch: none found.**

**Pre-existing, NOT from this branch (reproduced with the 0.45.1 script too):** Chromium's tabs accumulate across
restarts — every `up` of an existing profile restores the previous session's tabs AND opens the `about:blank`
argument (1 → 2 → 3 tabs after two `restart`s, identically with the old script on a separate display/runtime).
Background tabs keep a stale size (1042x789) until activated, so a measurement must pick the active tab. Worth its
own fix (e.g. `--restore-last-session` off / no URL argument), outside this effort. Also cosmetic and pre-existing:
`up` prints `started <comp> (pid ?)` for most components.

Still not covered: a real devcontainer REBUILD on the bookworm image (Xvnc 1.12) — no Docker here.

## 2026-10-06 — tabs pile up one per restart (dogfood finding; pre-existing in 0.45.1)

**Reproduced** on an own instance (display `:61`, random ports, own runtime; the live dogfood stack on :99 /
:6094 untouched): `up`/`down` cycles gave `pages=1`, `2`, `3` `about:blank` (CDP `/json/list`).

**Root cause: Chromium's startup preference, not the exit type.** The profile's `sessions.event_log` showed
`{"restore_browser":true,"type":5}` with `"crashed":false` on EVERY start. A first fix (quit with
`Browser.close` so `exit_type` becomes `"Normal"` instead of `"SessionEnded"`) changed the exit type and still
piled up (`C1..C3: 1, 2, 3` on a fresh profile). So this build's default `session.restore_on_startup` is
"continue where you left off": each start restores the last session and ALSO opens the `about:blank` argument.
Seeding `{"session":{"restore_on_startup":5}}` into a fresh profile gave `1, 1, 1`, and on an EXISTING profile
(with Chrome's pref MACs) it held as well.

**Fix:** `write_browser_prefs` merges `session.restore_on_startup = 5` into `Default/Preferences` before each
Chromium launch (only that key; atomic rename; no-op when already 5). Not a wipe — cookies and storage are
elsewhere in the profile. A profile already carrying piled-up tabs drops to one on its next `up` (rt2, 8 saved
tabs → `1`).

**Crash path:** after a SIGKILL the next `up` showed one tab and NO "Restore pages?" bubble (screenshot through
noVNC), so `--hide-crash-restore-bubble` was tried and left out — nothing to hide.

**Found on the way, and fixed: logins made just before `down` were lost.** A persistent cookie set 1 s before
`down` was gone on the next `up` (`none`) when Chromium stopped by SIGTERM — it treats SIGTERM as the OS session
ending and skips flushing the cookie store (written otherwise every ~30 s; after a 35 s wait the cookie survived
SIGTERM). With `Browser.close` the same 1 s case gave `sb_login=kept`. So `down` now asks Chromium to quit over
CDP first (`stop_gracefully` → `window_cdp close`, 5 s deadline) and falls through to SIGTERM/SIGKILL as before.

**Proof (final template):**

    rt2 (8 restored tabs on record), pref fix:  P1 1 · P2 1 · P3 1 (then SIGKILL) · P4 1
    fresh profile, pref fix:                    F1 1 · F2 1 (then SIGKILL) · F3 1 · F4 1
    with Browser.close quit as well:            G1 1 · G2 1 · G3 1 (then SIGKILL) · G4 1 · exit_type "Normal"
    cookie set 1 s before down → after up:      sb_login=kept, pages 1
