# Serving a worktree in a house project (`web` layer)

> Applies when the project's `HOUSE.md` stamp lists `web` in `layers=`. The generic method and the two traps (restart instead of trusting HMR over a mount; rebase a long-lived tree before serving) live in the SKILL.

The house dev loop is **stack-free**: `tools/dev/dev serve` reads the app's committed dev declaration (`.bespunky/dev.json` — its processes, ports and readiness), derives an isolated port block, spawns everything, registers the pretty domain and drives the shared browser. `nx serve <app>` is a thin Nx wrapper over it, so both spellings work and take the same kebab-case flags:

```bash
<pm> nx serve <app> --worktree=<branch|slug>                       # serve a tree you're not in (omit --worktree = the current cwd tree)
<pm> nx serve <app> --worktree=<branch|slug> --port-offset=auto    # explicit auto-offset (already the default for a worktree)
<pm> nx serve <app> --worktree=<branch|slug> --dry-run             # print what it would serve, without serving

tools/dev/dev serve [app] [--worktree=<x>] [--port-offset=<n|auto>] [--dry-run]   # the same engine, no Nx in the call
```

It resolves the worktree (current cwd tree if `--worktree` is omitted; accepts a branch, slug, or path), installs that tree's deps if missing, then serves *its own* source with the `NX_WORKSPACE_ROOT_PATH` / `NX_DAEMON=false` overrides applied for you (see [`nx-worktree-override.md`](nx-worktree-override.md)) — every declared process (the app dev-server, plus whatever the project's other layers contribute: an emulator suite with `firebase`, the shared browser) under one Ctrl+C.

**Port isolation is automatic per worktree.** The main tree serves on the base/forwarded ports (`--port-offset=0`), while each *worktree* gets a stable, verified-free offset block derived from the tree — so a worktree serve never collides with a server already running, and the whole stack (every declared port) shifts together. Pin a block by hand with `--port-offset=<n>` if you must; see `bespunky-workflow:local-server-isolation` for when to isolate.

**Reaching it.** Because a worktree's ports are shifted (and not forwarded), each worktree is reached at a pretty **`http://<slug>.localhost`** domain (via the `worktree-domains` proxy) and watched live in the shared co-driven browser over its **noVNC URL** (`bespunky-browser-automation:shared-browser`).
