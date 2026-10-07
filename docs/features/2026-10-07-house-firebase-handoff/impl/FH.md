# FH — review fixes: R7 (non-serve docs) + R9-2, R9-4..7

Worktree `hfh-fh` (branch `feat/house-firebase-handoff--fh`). Every finding reproduced before it is fixed; a finding that does not hold is rejected with evidence.

## Plan / status

| unit | finding(s) | who | status |
| --- | --- | --- | --- |
| docs | R7-1, R7-3 (non-serve half), R7-4..R7-11 | FH (inline) | in progress |
| ladder+harness | R9-2, R9-4, R9-5, R9-6, R9-7 | FH subagent (paths: `plugins/house/engine/nx-tools/migrations.json`, `src/migrations/0.50.0/*` except split-serve-follower, `tools/test-migrations/**`) | dispatched |

## Findings

### R7 (docs)

- **R7-1 — fixed** (5b1b431). Reproduced: `reap-emulators.sh.tpl` kills only `is_orphan` (PPID 1) pids; on a live owned port holder it prints "REFUSING … Nothing was killed" and `exit 1`; `emulators.sh.tpl:41` is `set -euo pipefail` and calls the reaper at `:328`, so the colliding launch stops. `HOUSE.rules.md.tpl` and `local-server-isolation/reference/firebase-emulators.md` now say a colliding suite *refuses to start* and the reaper kills orphans only; the attribution to `firebase emulators:start` is gone. Left as-is: the legacy strings in `_utils/inline-house-sections.ts` / `0.25.0/retire-inline-house-sections.ts` (they *recognise* text earlier releases shipped — changing them would break that recognition).
- **R7-3 — fixed, non-serve half only** (5b1b431). The "viewable ONLY through the shared browser" sentence is viewing, not serve mechanics, so it separated cleanly: it now says open the worktree at `<slug>.localhost` in the shared browser or a host tab via the forwarded `:80` (`layers/web.ts:123` forwards 80). The same stale claim in the `worktree-domains.tpl` header was fixed. **For FA:** the always-on rules' Firebase paragraph (nx-serve variant) still ends "…coexists with the developer's suite instead of killing it. Watch it in the shared browser over noVNC." — both phrases are now wrong in the same way (nothing kills it; a host tab at the domain works too). FA owns that paragraph.
- **R7-4 — fixed** (7d8c92c). firebase-tools 15.32.1 `lib/commands/init.js:144` is `new Command("init [feature]")`, one positional; `initAction(feature)` sets `setup.features = [feature]`. Both `init/features/{firestore,storage}/rules.js` fetch the live ruleset. Two commands now in HOUSE.md, the house tip, `firebase-deploy-rules.mjs.tpl`, the generator's one-time log, and the generator test.
- **R7-5 — fixed** (7d8c92c). `apphosting-backends-list.js:47` prints `codebase.repository.split("/").pop()` (the link id); `backends:get` returns the backend, so `--json` → `result.codebase.repository` = `…/connections/<conn>/gitRepositoryLinks/<id>`. Developer Connect REST docs: the state is `installationState.stage` ∈ {`PENDING_CREATE_APP`, `PENDING_USER_OAUTH`, `PENDING_INSTALL_APP`, `COMPLETE`}; `--format` is a gcloud global flag. `moving-accounts.md` uses `--format='table(name.basename(), installationState.stage)'` and the `--json` path.
- **R7-6 — fixed** (7d8c92c). FC's tree (`hfh-fc`, unchanged at the time) still has `setup-gcp.sh.tpl:67` dying with "binds several environments — choose one" when `--environment` is absent; the flag is `--environment <name>` (`:49`). HOUSE.md, the house tip and the deploy runner's road now show `--dry-run --environment <environment>` (which also works with one environment). **For FC:** if you make `--dry-run` iterate every environment, the docs still hold; the script's own header (`:9`) shows the bare `--dry-run` — yours.
- **R7-7 — fixed in part** (5b1b431). The CI paragraph is cut from 84 to 51 words: the rule (bindings not the workflow; never IAM; hand over the `!` line) stays, the mechanics were already in HOUSE.md *Continuous deployment (CI)*. **For FA:** the teardown paragraph (`tools/dev/dev ps` listing, `$!`/cwd check, the never-by-name list) is how-to in the always-on file; the rules are "stop by handle, never by name; confirm your ports are free; never kill what you didn't start" — move the rest to HOUSE.md *Running stacks* while you rewrite it.
- **R7-8 — fixed** (7d8c92c). `declaration.mjs.tpl` applies `url[]` with `when: skipped` only if declared; the house's own fragment (`firebase-emulators/dev-fragment.ts:38`) has it, the hand recipe did not. The recipe now includes it and says it is what makes `--skip=emulators` open `?emulate=none`.
- **R7-9 — fixed** (7d8c92c). The workflow tip now says to ask Claude which branch each backend rolls out from.
- **R7-10 — fixed** (7d8c92c). Trigger scoped to the web app / App Hosting, with an explicit "not for Functions/rules or CI deploys"; trimmed to 995 chars (check-descriptions ok).
- **R7-11 — fixed** (7d8c92c). One spelling: bare `firebase` in HOUSE.md and the skill, with the reason stated once in the deploy road (and the skill's ground rules): it is the project's pinned `firebase-tools`, on PATH through `node_modules/.bin` in the container; `npx firebase …` outside. The deploy runner's printed road keeps `npx` — it prints into whatever terminal runs it, where `npx` is the form that always works (FE's text).

**Overlap warning (merge):** R7-4, R7-6 and R7-11 edit lines inside FE's deploy road (HOUSE.md.tpl *Deploying the backend*) and FC's CI section; edits are line-local.

**Renders read** (scratchpad `fh/render/`, compiled payload, the five R7 fixtures): diffed against R7's renders of the pre-fix tree — only the intended lines changed, no unrendered `{{`. 
