---
name: local-server-isolation
description: How to launch a local server for your own testing WITHOUT colliding with a server the user is running. Use whenever you are about to start a dev server, app server, emulator, or any long-running local process to verify a change (nx serve, npm run dev, vite, a Firebase emulator suite, serve-worktree, a Playwright target that boots a server, etc.). The rule — bind a RANDOM free port, never the project's default/forwarded port, because that port belongs to whatever the user launched manually; you test headless so you never need the forwarded ports anyway. Covers the Firebase-emulator case (don't reap the user's suite) and how to point your headless browser at the ephemeral port.
---

# Local server isolation — never clobber the user's running server

**When you launch a local server to test or verify a change, you MUST bind it to a random free port — never the project's default or container-forwarded port.** This is mandatory. The user frequently has a dev server running manually; the default port (and any devcontainer-forwarded port) belongs to *that* server. Grabbing it either fails ("port in use"), silently attaches to their process, or forces a restart that disrupts their session.

## Why a random port costs you nothing

You verify **headless** — Playwright (or similar) running *inside* the container/host, which connects to `localhost:<port>` **directly**. Port forwarding exists only so a *human* can open the app in their real browser; your headless client doesn't go through forwarding, so it can reach any port. Fixed/forwarded ports are the human's; ephemeral ports are yours.

## The rules

- **Pick a random free port** for the server you start (`--port 0` for an OS-assigned port where supported, or a random high port). **Read the actual bound URL/port from the server's own startup output** — don't assume it — and point your browser/tests there.
- **Never kill or restart a server you didn't start** to free a port. If the default port is taken, that's the user's server: choose another port, don't reap theirs.
- **Tear down** the server you started when the check is done (don't leave orphans holding a port).

## Fixed-port backends (e.g. a Firebase emulator suite)

Some stacks have backends the app connects to at **hardcoded** addresses (a Firebase emulator suite at `localhost:8080`/`9099`/…), and their launcher often **reaps existing emulator processes first** — so naively "serving to test" would kill the user's running suite, which a random *app* port doesn't prevent.

- **Reuse an already-running suite** rather than starting a colliding one: serve the app alone (a no-emulators / app-only serve) on your random port, pointed at the suite the user already has up.
- **Only start your own suite if none is running** — and then on a **shifted port set**, not the defaults, so you never reap or collide with theirs.
- In a BeSpunky-scaffolded Nx workspace, **`nx run <app>:serve-worktree --portOffset=auto`** does exactly this: it shifts the whole stack (app dev-server + the emulator suite, including the hub/logging ports) onto a stable, verified-free port block derived from the worktree, and reaps only *its own* shifted ports — so it coexists with the developer's suite instead of reaping it. Open the app at the printed `?portOffset=N` URL so the client connects to the shifted emulator ports. Prefer this over hand-rolling an offset.
