# Brief: what the shir-halili-coaching handoff means for the toolkit

**Status:** analysis only. Nothing has been implemented or released. Every claim below was checked twice: first a triage against the toolkit's code (`analysis/`), then a pass whose only job was to disprove it (`verification/`), running the behaviour wherever that could be done. The plan is in `PLAN.md`.

## What came in

One day of real work on a house Firebase + Angular SSR project hit 22 problems. The report asks for each to be fixed in the toolkit, and wants back the version that fixes each one, so the project can drop its hand-made workarounds.

## What survived verification

**18 of the 22 are toolkit problems.** Three come from other tools: the `undefined` support email is a Firebase CLI init bug, and the `__dirname` and `tsconfig.app.json` warnings are Nx and Analog behaviour. The skip link is the project's own code, but it points at something the design system should provide.

**Shown by actually running it:**
- **Two copies of the Firebase SDK.** Installing `latest` of both packages gave Firebase 12 at the root, with 11 nested under `@angular/fire`. Every upgrade also puts back a `latest` someone removed.
- **A worktree's emulators lose or swap data.** If the worktree stops first, it exports the main stack's data and loses its own. If main stops first, the worktree's export fails.
- **A second `dev-server` in the same tree waits on the first.** When the first stops, it reports success without having run anything.
- **Upgrades overwrite hand edits.** Running the generator twice wipes hand-edited `inputs`, `args` and `configurations` on house targets. The project's next upgrade will undo their `functions:deploy` fix.

**Confirmed by reading the source:**
- **Local emulators can read production secrets.** The emulator is fed the production `.secret.local`, and worktrees borrow the main tree's copy. A secret that is missing or empty makes the emulator fetch the real value from Google's Secret Manager.
- **The container's Node version follows whoever ran the last upgrade.** It comes from the upgrading machine's Node, or from the newest base image on the Docker fallback. The project's existing value is never consulted.
- **The deploy targets are incomplete.** There is no deploy target for Firestore rules, Functions builds twice on every deploy, and `nx affected` can't see the root Firebase files.
- **The firewall misses untagged libraries.** The platform firewall checks only projects that carry a `platform:` tag, and only direct imports. An untagged library is unchecked.
- **Firestore and Storage emulators break when ports shift.** They always dial their emulator port directly, so a shifted port forward breaks them.

## What my first brief got wrong

- **"Staging ships production config because the yaml is in the wrong place": false.** Firebase's builder starts at the backend's root directory and walks up the folders, so the root files *are* read. I checked its source myself. The real staging bug: the toolkit says to create the backend with `backends:create --environment staging`, and **that flag doesn't exist**. I checked the Firebase CLI. So the staging environment name is never set unless someone finds the console setting. Two smaller issues: the toolkit never tells Nx users they must set the backend's Root Directory (Firebase says the build fails without it), and any `apphosting.yaml` under the app folder silently shadows the root one. That may be what the project actually hit.
- **The proposed fix for the stuck `dev-server` doesn't work.** The house's own `nx serve` target collides the same way before our code runs. This needs a redesign, not an environment variable.
- **"Make the forwarded port fail loudly" isn't possible.** VS Code's `requireLocalPort` doesn't fail. It forwards to another port and shows a dialog. Routing everything through the app's address does work, but only over http, and Storage uploads need special handling.
- **The emulator port collisions were overstated.** Emulators the offset doesn't move pick free ports themselves, so they don't collide unless a project pins their ports.

## The fix, as six ideas instead of 18 patches

1. **Every version comes from one place.** Generators never write a floating version. `@angular/fire` follows the installed Angular major, and `firebase` follows `@angular/fire`. That matters because no stable `@angular/fire` supports Angular 21 or 22 yet. Node is declared once in the project.
2. **Nothing run locally can reach production.** The emulators get a dummy value for every declared secret, worktrees no longer borrow the main tree's real ones, and seeding refuses to run against anything that isn't the emulators.
3. **Each running dev stack gets its own identity.** Its own emulator-hub file, and a fix for the Nx lock that still needs designing. Agents get `dev ps` and `dev stop`, so they never kill processes by name.
4. **The browser reaches every emulator through the app's own address**, over http.
5. **Deploys are declared.** Owned deploy targets with the right inputs, an opt-in CI layer that follows the branch model, and a cloud-permissions script that the human runs.
6. **The docs say what's true.** The missing `--environment` flag, the Root Directory requirement for Nx, both App Hosting deploy modes, and the account-move recipe.

## Still unverified

- That a subagent's background servers survive after it returns. That would explain the leaked servers, but nobody has seen it happen.
- The account-move recipe, the probe for which branch a backend deploys from, and the CI design. These are proposals, not claims.

## Decisions waiting on you

- **Backward compatibility for release 1:** it drops the container's global `firebase` command (the project's pinned copy replaces it) and dummy-fills the emulators' secrets unless someone opts in. Does any project need the old behaviour?
- **Emulator routing:** keep an option for existing projects to dial emulator ports directly?
- **CI deploy:** should the toolkit own it as an opt-in layer? It needs a small schema change to how the branch model describes deploys.
- **Firewall:** tightening it makes untagged libraries fail lint in existing projects until they're tagged.
