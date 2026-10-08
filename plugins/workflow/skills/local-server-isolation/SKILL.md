---
name: local-server-isolation
description: >-
  How to run a local server for your own testing WITHOUT colliding with one the user runs, and how to STOP it without touching theirs. Use whenever you are about to start a dev server, app or API server, database, emulator suite or any long-running process to verify a change (npm run dev, vite, nx serve, tools/dev/dev serve, a worktree serve, python -m http.server, uvicorn, go run, docker compose up, a Playwright target that boots a server), AND whenever you are about to stop, kill or clean up one, or check that nothing you started is still listening. Start: bind a RANDOM free port, never the default or forwarded one, which is the user's. Fixed-port backends: reuse theirs or shift your own, never reap theirs (Firebase as the worked example). Stop: by the handle you launched with (tools/dev/dev stop, TaskStop, the captured PID), NEVER by name (pkill, killall, pgrep -f piped to kill, fuser -k), then prove your ports are free.
---

# Local server isolation — never clobber the user's running server

**When you launch a local server to test or verify a change, you MUST bind it to a random free port — never the project's default or container-forwarded port.** This is mandatory. The user frequently has a dev server running manually; the default port (and any devcontainer-forwarded port) belongs to *that* server. Grabbing it either fails ("port in use"), silently attaches to their process, or forces a restart that disrupts their session.

## Why a random port costs you nothing

You verify **headless** — Playwright (or similar) running *inside* the container/host, which connects to `localhost:<port>` **directly**. Port forwarding exists only so a *human* can open the app in their real browser; your headless client doesn't go through forwarding, so it can reach any port. Fixed/forwarded ports are the human's; ephemeral ports are yours.

## The rules

- **Pick a random free port** for the server you start (`--port 0` for an OS-assigned port where supported, or a random high port). **Read the actual bound URL/port from the server's own startup output** — don't assume it — and point your browser/tests there.
- **Never kill or restart a server you didn't start** to free a port. If the default port is taken, that's the user's server: choose another port, don't reap theirs.
- **Tear down** the server you started when the check is done — **by its handle**, then **prove** it (see *Teardown* below). Don't leave orphans holding a port.
- **Never *pin* a port inside `6080-6119`.** That band belongs to the shared browser's per-container noVNC allocator (`bespunky-browser-automation:shared-browser`), and a squatter there costs someone their viewer URL. An OS-assigned port (`--port 0`) is always outside it; a hand-rolled "random high port" should be too.

## Fixed-port backends — never reap the user's

Some stacks have backends the app connects to at **hard-coded** addresses — an emulator suite, a local database, a queue, a mock auth server — and their launchers often **reap existing processes first** or simply fail on a taken port. A random *app* port doesn't protect the user's running backend from that.

- **Reuse an already-running backend** rather than starting a colliding one: serve the app alone on your isolated port, pointed at the backend the user already has up.
- **Only start your own backend if none is running** — and then on a **shifted port set**, not the defaults, so you never reap or collide with theirs. The app must be told the shifted addresses (env var, query param, config) — find how *this* project does it before shifting.
- **Shift the whole stack together.** If the project declares its processes and ports (a house project with the `web` layer does, in `.bespunky/dev.json`), its serve (`tools/dev/dev serve [app]`, or `nx serve <app>` for an Nx-served app — each is its own stack) **claims** one free block for every declared port before it starts anything, against every other stack of the repository (a serve, an emulator suite run on its own, a seed build): `auto` (the default) takes the next free block, a pinned `--port-offset` another stack holds is refused naming it. Prefer it over hand-rolling an offset.

**Worked example — the Firebase emulator suite** (projects wearing the `firebase` layer): reuse vs. shift, the `?emulate=none` client switch, and the hub/logging ports that must move with it → [`reference/firebase-emulators.md`](reference/firebase-emulators.md).

## Teardown — by handle, never by name

A server you cannot name exactly, you cannot stop safely. So **launch it so you hold a handle**, and stop it by that handle — never by a name or a pattern.

**Launch with a handle, in this order of preference:**

1. **The house dev runner**, when the project has one (`tools/dev/dev`): `tools/dev/dev serve <app> --no-shared-browser`, as a `run_in_background` Bash call. Under an agent it never takes the base ports (`auto` skips them; `--port-offset=0` is refused). It prints its handle at start (`Stack: <app>@<offset> · pid … · stop with: …`), writes a run record, and that printed `tools/dev/dev stop <app> --offset=<n>` takes the whole stack down — every process it started, gracefully, then checks the ports. A Claude Code session is ONE owner for itself and every subagent, so under it `stop` never *selects* ("my stack here", `--all-mine`): name the stack, or — in a fan-out — give each agent its own owner label (`DEV_OWNER=<unit-id>` on the serve and the stop), whose `stop --all-mine` then reaches only its own stacks.
2. **A `run_in_background` Bash task** whose *foreground* command is the server (no `&`, `nohup`, `setsid` or `disown` of its own) — then `TaskStop <id>` stops it and every child it spawned.
3. **The PID you captured at launch** (`cmd & echo $!`), recorded the moment you start it. Before you signal it, check it is still that process — `/proc/<pid>/cwd` is your tree and `/proc/<pid>/cmdline` is your command (PIDs are reused).

A detached process (`nohup … &`, `setsid`, `disown`) is in no task and has no recorded PID: never start a test server that way.

**Banned — they match your own shell and other people's servers:** `pkill <name>` / `killall <name>`, `pkill --newest` / `--oldest` (the newest match *in the container*, which may be the developer's or a sibling agent's), `pgrep -f <pattern> | xargs kill` (matches the `bash -c '…<pattern>…'` that ran it), and `fuser -k <port>` / `kill $(lsof -t -i:<port>)` without first proving the holder is yours (cwd + start time after your launch). If all you have is a port and you cannot prove the holder is yours, **report it** — do not kill it.

**Prove it, then say it.** "I stopped it" is a claim; a free port is the proof. After teardown, check that nothing of yours still listens — `tools/dev/dev ps` (house projects: every running stack, its owner and ports, any ORPHANED one whose serve died and left processes, and any FINISHING one — stopped, still saving its data, e.g. an emulator export: wait for it; it ends itself by its own deadline, and only its owner ends it sooner, with `tools/dev/dev stop … --abandon`) or `ss -ltnp` on the ports you used — and only then report done. A subagent stops everything it started **before it returns** and lists it (PID or stack, port, stopped / left running and why); see `bespunky-workflow:delegate-and-parallelize`.

**Never stop a server you didn't start.** `tools/dev/dev stop` enforces it: another owner's stack is refused unless `--any-owner`, which is for the human who owns it — not for you clearing a port.

