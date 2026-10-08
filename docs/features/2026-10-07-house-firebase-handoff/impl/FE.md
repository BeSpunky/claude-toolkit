# FE — review fixes: deploy targets, the house-targets record (R5 all + R9-3)

Branch `feat/house-firebase-handoff--fe`, worktree `hfh-fe`. Every finding was reproduced first: R5-2 and R5-5 with the
reviewer's probes (`scratchpad/fe/m2.mjs`, `r55.mjs`, against the real `.ts`); R5-1 by the existing deploy-script test,
which asserted the seeded indexes DO ship; R5-3 by the existing test-layers assertion, which asserted a re-ensure of a
detected Firebase DOES seed; R5-4 and R5-8 against firebase-tools 15.32.1 source and real Nx 23.1. None was rejected.

| # | Verdict | What changed |
| --- | --- | --- |
| R5-1 | fixed | **Indexes are never seeded.** I chose this over marking the entry's indexes as seeded alongside its rules. JSON cannot carry the marker, so a seeded indexes file looks exactly like the project's own. The Firestore emulator needs none. So any indexes file that is declared was written or pulled by a human, and `--force` (which deletes live indexes the file does not list, `firestore/api.js:85-104`) can only act against a real file. `firestore.indexes.json.tpl` is deleted. Test: the seeds deploy nothing, with or without `--force`. Indexes the project declares do ship. |
| R5-2 | fixed | `_utils/house-targets.ts`: **what a target runs** (`executor` + `options.command`/`commands`) is merged as ONE value. If the project runs its own executor, the house's options stay out. **A target the house introduces** that the project already defines (no record entry for it, or provenance `never`) is kept whole and reported on every upgrade. It is never recorded and never held to the contract. Provenance now has three states: `recorded` / `never` / `unknown`. |
| R5-3 | fixed | `PlanContext.detected` (computed in `cli.ts`/`attach.ts`). `--seedRules` now requires `ensured && !detected`. test-layers covers both: a re-ensure seeds nothing, a creation seeds. |
| R5-4 | fixed | The runner reads Firebase's own order (`command.js` `applyRC`/`configstoreProject`, `requireAuth.js`): `-P`, then configstore `activeProjects` walking up from ROOT, then the single alias, then `default`. Step 2 is ticked on aliases. **One correction to the review:** firebase-tools reads ADC through google-auth-library at `$HOME/.config/gcloud` only. It ignores `CLOUDSDK_CONFIG` (`googleauth.js:330-346`). So the runner checks the HOME path and *names* an ADC under `CLOUDSDK_CONFIG` as one the deploy will not see. |
| R5-5 | fixed | Sets with no base: every member put back is reported. With the new rung (below), a set is recorded only while all of 0.49.2's members are still present. |
| R5-6 | fixed (class) | The first record is written by a rung from 0.49.2's output, where it is proven. So a key the house dropped and the project left alone is removed by the ordinary three-way merge. Hand migrations per dropped key are no longer needed. |
| R5-7 | fixed | The record is keyed by **canonical house name**, each entry holding `{project, root, targets}`, so a rename or a move keeps provenance. Entries whose project and root are both gone are pruned. A deleted record now means `unknown` (every difference is reported) instead of a silent fall-back to 0.49.2. The record's note says how to resolve a merge conflict. |
| R5-8 | documented | Probed with real Nx 23.1: forwarded args are double-quoted, so `$`/backticks still expand, and `\$` escapes. Documented in HOUSE.md, the generator header and both runners. A guard was not possible: run-commands always uses a shell. |
| R9-3 | fixed | `read-functions-params-in-place` first sets `configDir` (in place) on the functions block whose `source` is the bundle, keeping one the project set. Only then does it remove the asset. With no such block the asset stays, and the rung reports it. |

## Design disputes

1. **Overrides reach the summary.** `_utils/upgrade-report.ts` warns, and appends the finding to `$BESPUNKY_UPGRADE_REPORT`. `house.sh` exports that variable into the upgrade lock and prints `UPGRADE_ATTENTION` from the extracted `_upgrade_attention`, which has a scaffold test. `/bespunky-house:upgrade` relays it. The house still wins a both-changed key, but it is now said loudly.
2. **The contract is enforced.** `cache: false`, `parallelism: false` and, on functions, `dependsOn: build` go through `HouseProjectConfig.contract` and are re-asserted every run. Any difference is reported. `lint` in `dependsOn` is a quality gate the project may drop: its removal is honoured.
3. **The baseline has one source and one story.** `house-targets-0.49.2.ts` is now data of the new rung `0.50.0/record-house-targets`, which writes the first record (rendered for the project's layout and names, proven values only) and never overwrites one. The generators know nothing of baselines, and no later release needs one.
4. **Runners are no longer inputs.** Verified with real Nx: a change to the runners alone affects nothing. `firebase.json` stays an input, deliberately. Nx `affected` is file- and project-granular (`workspace-projects.js` `getImplicitlyTouchedProjects`), and a `firebase.json` change can change any deploy. The house writes it only when a value it owns differs. A release that changes a deploying project's own targets still marks it affected. Firebase then skips unchanged rules and functions (`rulesDeploy.js:101`, `planner.js:42`).
5. **The two sources agree.** `firebase:deploy` refuses a declared rules file that no input watches (inputs come from its project definition plus named inputs; exact paths or globs). The refusal names the input to add. The upgrade watches every declared file.

FC compatibility: the deploy targets take no CI args. A named configuration FC adds is kept, because it is a project addition, or a house key when FC writes it through the owned targets.

## Verification

test-generators 186 ok / 23 skip · test-migrations 235/235 · test-layers 100/100 · test-scaffold 23 files.

Real Nx 23.1 (`scratchpad/fe/ws`, the compiled payload's generator on a real FS):
- `nx run firebase:deploy -P prod` skips both seeds and calls nothing.
- An unwatched declaration is refused with exit 1.
- `affected` for a runner-only change: none. For `firebase.json`: both projects. For a seeded rules file: `firebase`.
- A re-run leaves the tree clean.
- `parallelism: true` is re-asserted and lands in the report file.

## Left

- `stack-owned-dev-processes`' header still says the first upgrade "has no record" (not my rung; the rung is still correct).
- `docs/features/2026-10-03-*` untouched.
- No live Firebase project, so a real `firebase deploy` was not run.
