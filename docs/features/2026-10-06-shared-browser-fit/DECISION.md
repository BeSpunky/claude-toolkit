---
effort: shared-browser-fit
summary: The shared browser's desktop follows the viewer's tab size (no letterboxing, no blur) and the browser window gives the page all of it.
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
