# BRIEF — tmux in the BeSpunky devcontainer standard

**Slug:** `devcontainer-tmux` · **Branch/worktree:** `feat/devcontainer-tmux` · **Opened:** 2026-08-06

## The ask, in the user's words

> "tmux present and on PATH for the remoteUser (node) in every BeSpunky devcontainer, surviving container rebuilds."

> "Zanshin (the new control platform) opens interactive shells inside project devcontainers from a browser.
> Durability lives in tmux inside the container, not in Zanshin's daemon — deliberately, because the Docker
> Engine API has no endpoint to re-attach to an existing exec, so without tmux the process survives a daemon
> restart but the terminal doesn't. With tmux, restarting Zanshin costs a redraw; without it, every open shell dies."

> "Surveyed all 7 devcontainers on this machine: NO_TMUX on every one, including zanshin and claude-toolkit.
> So the capability is currently unreachable in practice."

> "Where. The devcontainer generator in @bespunky/nx-tools — whichever of devcontainer.json (a feature) or the
> generator-owned post-create.sh is the house-correct seam. **Not post-create.local.sh, which is the user's seam
> and must stay untouched.**"

## Facts handed over (already established, not to be re-discovered)

- Base image `mcr.microsoft.com/devcontainers/typescript-node` → Debian 13 (trixie).
- tmux installs cleanly from trixie as **3.5a**; verified working in that exact image. ~2 MB.
- **No configuration file is needed** — Zanshin passes every option explicitly.
- Two things learned the hard way (Zanshin's problem, not the generator's, but recorded so nobody re-learns them):
  - `tmux set-option -g` does **not** start a server. It fails with `error connecting to /tmp/tmux-0/default`,
    and every option after it is silently dropped. Options must come **after** `start-server`, in one invocation.
  - Zanshin sets its options on **its own session** (`-t <name>`), never `-g`. The tmux server is shared with
    whatever the human runs in that container; unbinding their prefix server-wide would be a nasty side effect.
    **Nothing in the generator should set global options either.**

## Surface Zanshin uses (so nothing gets stripped as "unnecessary")

```
tmux -u start-server
tmux set-option -g history-limit 10000 ; -s escape-time 0
tmux new-session -d -s <name> -x <cols> -y <rows> <shell>
tmux set-option -t <name> prefix None ; prefix2 None ; status off ; mouse off
tmux has-session -t <name>
tmux list-sessions
tmux capture-pane -t <name> -p -e -S -<n>
tmux attach -t <name>
```

## Acceptance

`tmux -V` inside a freshly built container returns `tmux 3.5a`, as the remoteUser `node`, without `sudo`.

## Open question raised by the user (deferred to us)

> "Optional, your call: history-limit defaults to 10,000 lines. A build printing 40,000 lines loses its
> beginning before anyone scrolls back. If you'd rather that be a house parameter than a Zanshin constant,
> say so and Zanshin will read it."

See `DECISION.md`.
