---
effort: devcontainer-clipboard
status: concluded
concluded: 2026-11-06
summary: Every house devcontainer reaches the host clipboard — the agent layer installs wl-clipboard, xclip and xsel (nx-tools 0.55.0)
tags: [house, devcontainer, agent-layer, clipboard, gh]
---

# Devcontainer clipboard

## The ask

> When I run `gh auth login` it gives this before the code: "Failed to copy one-time code to clipboard — No clipboard
> utilities available. Please install xsel, xclip, wl-clipboard or Termux:API …"
> Make our DevContainers support clipboard manipulation. Find the best way for us that is compatible with what gh is
> asking for but also think of additional things, scenarios, tools that would need it and factor them in.

## What we found (observed in a running house container, not assumed)

- VS Code Dev Containers **bind-mounts the host's own Wayland socket** into the container
  (`/run/user/1000/wayland-0` → `/tmp/vscode-wayland-<uuid>.sock`, `$WAYLAND_DISPLAY` set) and runs an X11 forwarder on
  `/tmp/.X11-unix/X0` (`$DISPLAY=:0`). Only the client binaries were missing.
- With `wl-clipboard` present, `wl-copy`/`wl-paste` round-trip through the host compositor — the real host clipboard.
- The X11 forwarder answered `Authorization required` (no cookie forwarded) on this Wayland host. Not needed here, but
  it is the path on an X11 host, so the X clients come along.
- Who probes what, in order:
  - `gh` (atotto/clipboard): `$WAYLAND_DISPLAY` → `wl-copy`/`wl-paste`, else `xclip`, else `xsel`, else Termux.
  - Claude Code: copy via `wl-copy` when Wayland, else `xclip`/`xsel` (OSC 52 otherwise); **screenshot paste (Ctrl+V)**
    via `xclip -t image/png -o || wl-paste --type image/png`. So the same packages unlock image paste.
  - pyperclip, Neovim, and most editors' clipboard providers probe the same three names.

## Decision

One `osPackages` group in the **`agent` layer** (every house devcontainer): `wl-clipboard xclip xsel` — the exact names
these tools look for, in a cached image layer. No wrappers, no config, no env: the editor already supplies the socket.
Nothing to persist — the clients hold no state. Nothing to migrate — `house.packages.sh` is an owned artifact,
regenerated on every upgrade. Available on both Debian releases the images use (bookworm, trixie).

## Roads not taken

- **Shimming `xclip`/`wl-copy` with an OSC 52 writer** for hosts that forward no display: it would shadow real binaries,
  and whether VS Code's terminal honours OSC 52 writes could not be observed from here. Claude Code already falls back
  to OSC 52 on its own.
- **Bridging the shared browser's Xvnc clipboard to the host**: a separate surface; noVNC already carries that
  clipboard to the human's tab.

## Limits, stated

- Verified on a Linux/Wayland host. On a host where the editor forwards no display (some macOS/Windows setups, a bare
  `docker exec`, a tmux session opened from outside without `$WAYLAND_DISPLAY`), the clients have nothing to reach and
  tools fall back to printing, as before.
- The X11 path was not observed working (the forwarder refused without a cookie on this host).
