# Emulator seeds

**Generated artifacts — never hand-edit anything in this folder.** The single source of
truth is [`tools/seed/world.mjs`](../seed/world.mjs); rebuild the seeds from it with:

```bash
yarn nx run firebase:seed:build
```

## Catalog

| Seed | What it is | Sign in as |
| --- | --- | --- |
| `default` | The starter world (replace with your app's real model in `world.mjs`) | `demo@demo.test` |

Add worlds by adding keys to `WORLDS` in `world.mjs` — the build orchestrator derives
the seed list from it automatically. Update this table when you do.

## How seeds are used

- `nx serve` imports the **gitignored working dir** `.emulator-data/` (`.emulator-data-<offset>/`
  for an isolated stack), which is primed from the `default` seed on first use (see `tools/emulator-data.sh`).
- Onboard once; your session + data persist across serves (the full suite exports back
  to the working dir on a clean exit).
- Sign in with a seeded email and the Auth emulator matches the existing account by
  email — you inherit its uid and its docs, no re-onboarding.
- **Reset** to a pristine world anytime: `yarn nx run firebase:reset` (the `default`
  seed; pass another seed by adding a `reset:<name>` target to the `firebase` project). It resets
  every working dir of this tree, or one stack's with `PORT_OFFSET=<n>`, and is refused while a suite
  it would reset is running, because that suite would export over it. Takes effect on the next serve.

## The contract

The seeds are part of the schema contract: whenever a Firestore document shape changes
or a feature gains a backend, update the matching world in `world.mjs`, rebuild, and
commit this folder — so the seed never drifts from the code.
