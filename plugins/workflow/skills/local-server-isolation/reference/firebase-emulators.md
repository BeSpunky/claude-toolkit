# Worked example — the Firebase emulator suite

> Applies to projects wearing the `firebase` layer (their `HOUSE.md` stamp lists it in `layers=`). The generic fixed-port-backend rules live in the SKILL; this is them applied to Firebase.

The Firebase client connects to emulators at **hard-coded** addresses (`localhost:8080`, `9099`, …), and `firebase emulators:start` **reaps existing emulator processes first** — so naively "serving to test" would kill the user's running suite, which a random *app* port doesn't prevent.

- **Reuse an already-running suite** rather than starting a colliding one: serve the app alone (`<pm> nx serve <app> --no-emulators --port-offset=auto` — the app goes real via `?emulate=none`) on your isolated port, pointed at the suite the user already has up.
- **Only start your own suite if none is running** — and then on a **shifted port set**, not the defaults, so you never reap or collide with theirs.
- In a house project, **`<pm> nx serve <app> --port-offset=auto`** does exactly this: it shifts the whole stack (app dev-server + the emulator suite, including the hub/logging ports) onto a stable, verified-free port block, and reaps only *its own* shifted ports — so it coexists with the developer's suite instead of reaping it. Open the app at the printed `?portOffset=N` URL (or the worktree's `<slug>.localhost` domain) so the client connects to the shifted emulator ports. Prefer this over hand-rolling an offset.
