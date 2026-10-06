# Brief — shared browser fills the viewer's screen

User, 2026-10-06 (verbatim):
> The machine rendered is not occupying the entire screen, because it's maintaining resolution and aspect ratio. That means my actual montor doesn't get taken advantage of and the mock app is compacted. Also, the browser in the machine takes part of the screen realestate [...] We need to optimize it and make the experience a lot more accessible at all levels - VNC, machine, browser, mock app, mock app modules, etc.

Approved plan, phase 1 (user: "Good."):
- Replace Xvfb + x11vnc with TigerVNC `Xvnc`, noVNC `resize=remote` — the desktop matches the viewer's tab.
- fluxbox without toolbar/decorations; Chromium maximized and following resizes.
- `shared-browser fullscreen on|off` over CDP (keep tabs/omnibox for co-driving by default).
- HiDPI: an opt-in scale factor (noVNC can't report host DPR).
- Fix docs/shared-browser-DESIGN.md (:112 SB_GEOM contract, :202 claims resize=remote) and the skill.

## Investigation findings (anchors in generators/shared-browser/shared-browser.tpl unless noted)
- Stack: Xvfb :99 → fluxbox → Chromium → x11vnc :5900 → websockify/noVNC (header :8, START_ORDER :109).
- `SB_GEOM="${SB_GEOM:-1440x900x24}"` (:34), passed once to Xvfb (:526). No xrandr anywhere. x11vnc (:553-554) `-localhost -forever -shared -nopw -noxdamage -quiet`.
- Packages: apt `xvfb x11vnc novnc websockify fluxbox` + fonts in `layers/web.ts:174-178`.
- noVNC = Debian apt `novnc`, /usr/share/novnc (:62), copied to a runtime webroot (:567-569). URL `vnc.html?autoconnect=true&resize=scale&reconnect=true&show_dot=true` (:330, index.html redirect :571).
- Chromium: `--window-position=0,0 --window-size=$WIN_W,$WIN_H about:blank` (:538-542), WIN_W/H from SB_GEOM (:73-75). fluxbox unconfigured (:532).
- verify.mjs.tpl:33-37 viewport presets; viewport() :137-144 uses page.setViewportSize.
- x11vnc `-desktop "<project> (shared browser)"` names the tab — keep that property (Xvnc `-desktop`).
- Owned template artifacts (class A): no migration for the script. Package change in web.ts osPackages: removal of xvfb/x11vnc may owe cleanup in adopted devcontainers via houseWrote() — decide deliberately.
