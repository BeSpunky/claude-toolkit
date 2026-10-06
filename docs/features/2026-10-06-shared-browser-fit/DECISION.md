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
