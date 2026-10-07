# Brief — what the shir-halili-coaching handoff means for the toolkit

**Status:** analysis only. Nothing implemented, nothing released. Evidence per item in `analysis/`, full plan in `PLAN.md`.

## What came in

One day of real work on a house Firebase + Angular SSR project hit 22 problems. The report asks for each one to be fixed in the toolkit, and wants the version that fixes it back, so the project can drop its hand-made workarounds.

## What we found

**18 of the 22 are ours.** Three come from other tools (the Firebase CLI's own init, and Nx / Analog upstream). One (the skip link) is the project's own code, but it points at something the design system should offer.

**Four are worse than the report says:**

- **Staging ships production's config.** The toolkit writes `apphosting.yaml` and `apphosting.staging.yaml` at the repo root, where Firebase never reads them. Every house project's staging backend builds with production settings.
- **A worktree's emulators swap data with the main tree's.** Both stacks share one emulator "hub" lookup file, so on shutdown the main stack's data is exported into the worktree's folder.
- **The container's Node version follows whoever ran the last upgrade.** The upgrade copies the Node major of the machine running it, in every house project, not only Firebase ones.
- **Floating versions aren't just Firebase.** Three other generators write `latest` or similar. The two-copies-of-Firebase crash is one instance of that.

**One thing the project must hear now:** their next house upgrade will wipe the inputs they added by hand to `functions:deploy`. The toolkit rewrites those targets on every upgrade.

## The fix, as six ideas instead of 18 patches

1. **Every version comes from one place.** Generators can't write a floating version, AngularFire and Firebase are pinned as a matched pair, and the Node version lives once in the project.
2. **Nothing run locally can reach production.** The emulators get dummy secrets by default, worktrees no longer borrow the main tree's real ones, and seeding refuses to run against anything that isn't the emulators.
3. **Each running dev stack gets its own state folder.** That ends the data swap and the stuck `nx serve`. It also gives agents `dev ps` and `dev stop`, so they never kill processes by name.
4. **The browser reaches every emulator through the app's own address.** When the dev container shifts the forwarded ports, the app still finds its emulators.
5. **Deploys are declared.** Real deploy targets for Firestore rules and Functions, plus an opt-in CI layer that follows the project's branch model. The cloud-permissions script is one the human runs, never the agent.
6. **The docs say what's true.** Both App Hosting deploy modes, where `apphosting.yaml` must live, and how to move a project between accounts.

## Proposed order (four releases)

1. **Safety:** ideas 1 and 2, moving `apphosting.yaml` to where Firebase reads it, and ending the emulator data swap.
2. **Dev loop:** the rest of idea 3, plus idea 4.
3. **Deploy:** idea 5 and the account-move recipe.
4. **Cleanup:** stop untagged libraries from slipping past the platform firewall, add a skip-link primitive to the design system, and print who to sign in as after seeding.

## Decisions waiting on you

- **Backward compatibility for release 1:** it removes the container's global `firebase` command (the project's pinned copy replaces it) and stops the emulators from using real secrets unless someone opts in. Does any project need the old behaviour kept?
- **Emulator routing (release 2):** keep an option for existing projects to dial emulator ports directly?
- **CI deploy (release 3):** should the toolkit own this as an opt-in layer? It needs a small schema change to how the branch model describes deploys.
- **Firewall (release 4):** tightening it makes untagged libraries fail lint in existing projects until someone tags them.
