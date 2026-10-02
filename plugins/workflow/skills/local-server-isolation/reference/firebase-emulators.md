# Worked example — the Firebase emulator suite

> Applies to projects wearing the `firebase` layer (their `HOUSE.md` stamp lists it in `layers=`). The generic fixed-port-backend rules live in the SKILL; this is them applied to Firebase.

The Firebase client connects to emulators at **hard-coded** addresses (`localhost:8080`, `9099`, …), and `firebase emulators:start` **reaps existing emulator processes first** — so naively "serving to test" would kill the user's running suite, which a random *app* port doesn't prevent.

- **Never start a second suite on the default ports** — it reaps the user's. If you need emulators, run your own on a **shifted port set** (below), so you never reap or collide with theirs.
- **Skipping the suite is not reusing theirs.** `--no-emulators` (Nx face) / `--skip=emulators` (the engine) serves the app with `?emulate=none`: every Firebase service resolves to the **real** backend. That is a deliberate choice for real/staging data — never a way to borrow the running suite, and never against production.
- In a house project, **`<serve> <app> --port-offset=auto`** (`<serve>` is what HOUSE.md names: `<pm> nx serve` for an Nx-served app, else `tools/dev/dev serve`) shifts the whole declared stack (the app + the emulator suite when the app's declaration lists it, including the hub/logging ports) onto a stable, verified-free port block, and reaps only *its own* shifted ports — so it coexists with the developer's suite instead of reaping it. Open the app at the printed `?portOffset=N` URL (or the worktree's `<slug>.localhost` domain) so the client connects to the shifted emulator ports. Prefer this over hand-rolling an offset.
