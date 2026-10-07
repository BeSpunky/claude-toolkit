---
name: local-server-isolation
description: >-
  How to launch a local server for your own testing WITHOUT colliding with a server the user is running. Use whenever you are about to start a dev server, app server, API server, database, emulator, or any long-running local process to verify a change (npm run dev, vite, nx serve, a worktree serve, python -m http.server, uvicorn/flask/rails, go run, docker compose up, a Firebase or other emulator suite, a Playwright target that boots a server, etc.). The rule — bind a RANDOM free port, never the project's default/forwarded port, because that port belongs to whatever the user launched manually; you test headless so you never need the forwarded ports anyway. Covers fixed-port backends the app hard-codes (reuse the user's running backend or shift your own — never reap theirs), with the Firebase emulator suite as the worked example, and how to point your headless browser at the ephemeral port.
---

# Local server isolation — never clobber the user's running server

**When you launch a local server to test or verify a change, you MUST bind it to a random free port — never the project's default or container-forwarded port.** This is mandatory. The user frequently has a dev server running manually; the default port (and any devcontainer-forwarded port) belongs to *that* server. Grabbing it either fails ("port in use"), silently attaches to their process, or forces a restart that disrupts their session.

## Why a random port costs you nothing

You verify **headless** — Playwright (or similar) running *inside* the container/host, which connects to `localhost:<port>` **directly**. Port forwarding exists only so a *human* can open the app in their real browser; your headless client doesn't go through forwarding, so it can reach any port. Fixed/forwarded ports are the human's; ephemeral ports are yours.

## The rules

- **Pick a random free port** for the server you start (`--port 0` for an OS-assigned port where supported, or a random high port). **Read the actual bound URL/port from the server's own startup output** — don't assume it — and point your browser/tests there.
- **Never kill or restart a server you didn't start** to free a port. If the default port is taken, that's the user's server: choose another port, don't reap theirs.
- **Tear down** the server you started when the check is done (don't leave orphans holding a port).
- **Never *pin* a port inside `6080-6119`.** That band belongs to the shared browser's per-container noVNC allocator (`bespunky-browser-automation:shared-browser`), and a squatter there costs someone their viewer URL. An OS-assigned port (`--port 0`) is always outside it; a hand-rolled "random high port" should be too.

## Fixed-port backends — never reap the user's

Some stacks have backends the app connects to at **hard-coded** addresses — an emulator suite, a local database, a queue, a mock auth server — and their launchers often **reap existing processes first** or simply fail on a taken port. A random *app* port doesn't protect the user's running backend from that.

- **Reuse an already-running backend** rather than starting a colliding one: serve the app alone on your isolated port, pointed at the backend the user already has up.
- **Only start your own backend if none is running** — and then on a **shifted port set**, not the defaults, so you never reap or collide with theirs. The app must be told the shifted addresses (env var, query param, config) — find how *this* project does it before shifting.
- **Shift the whole stack together.** If the project declares its processes and ports (a house project with the `web` layer does, in `.bespunky/dev.json`), `<pm> nx serve <app> --port-offset=auto` (or the stack-free `tools/dev/dev serve [app] --port-offset=auto`) moves every declared port onto one stable, verified-free block and reaps only *its own* shifted ports. Prefer it over hand-rolling an offset.

**Worked example — the Firebase emulator suite** (projects wearing the `firebase` layer): reuse vs. shift, the `?emulate=none` client switch, and the hub/logging ports that must move with it → [`reference/firebase-emulators.md`](reference/firebase-emulators.md).
