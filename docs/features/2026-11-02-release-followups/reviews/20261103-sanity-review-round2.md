# Sanity review, round 2 (fix mode)

Scope: `git diff dd3c883a..HEAD` on `chore/release-followups`, for @bespunky/nx-tools 0.51.2.

Frame: a house project's `nx test` / `build` / `lint` tell the truth from birth and after upgrade. secondary-entrypoint/ds-component output builds and its specs run; passWithNoTests only where the house deleted the only spec and the runner reads a config; rung truthful-angular-library-tests and pass-libraries-with-no-specs.

Lenses: migration correctness on real shapes; generator correctness and false greens (real workspace); architecture + reuse + clean code; completeness + tests. Verifier: one, over high and medium findings.

## Findings and outcomes

Fixed:
- Truthful rung wrote through devkit: comments lost, project.json spread, nx block data copied. Now `updateProjectConfigInPlace` and `updateJsonInPlace`.
- Walks crossed project roots: a root app's target aimed at every library's specs; a nested project counted as an entry. `_utils/library-files.ts` stops at other roots; applications are skipped.
- Root `.` and trailing-slash paths: false "outside the library" warning, `../../` include. Normalized in `judgeEntryPointReach`, shared by generator and rung; the two had drifted on a configuration's include.
- A typeless app named design-system taken for the design system: both rungs ask `projectRole`.
- A design system's runner under another target name ignored: every unit-test target is aimed.
- `@angular/build:unit-test` same blindness: same treatment. Other runners on a library with entries are warned, Jest excepted.
- Anchor matched in comments, strings, nested objects, with a success log and a red target: the config is read with comments and strings blanked, one `test:` key required. Block-comment option, computed option, CRLF, `{projectRoot}` tokens, configurations naming a config or saying false, jest decided by executor. One mechanic, `statePassWithNoTests`, replaces the copy in the rung.
- The seam wrote to a config its runner never reads (unit-test + vite.config): `other-runner` result. Design system now warns on a gap; adopt-extracted's warning says the target stays red.
- `type: ''` on componentGenerator: @nx/angular 23 below Angular 20 wrote `<name>.component.ts` under a `./<name>` barrel (verified on the 23.0.0 source at 19.2, 20.0, 22.2).
- ds-component ensures the library's root styleIncludePaths (build 0, test 1 without it, `--library`), and re-asserts the reach over an entry that already exists.
- Exclude `../dist/**`, not `../**/dist/**`: a failing spec in `<entry>/src/dist/` exited 0 (real run).
- passWithNoTests note and headers overclaimed: a spec outside the runner's include reads as no tests (real run on Analog). Reworded.
- Stray `src.ts` reported for any library with entries, with its own remedy.
- Names and comments: includeEntrySourcesInSpecTsconfig, the "jest passes with no specs" case, design-system case title, `same` -> `sameJson`, deduped globs.
- Tests: vacuous ds-component assertion, decided/other-runner seam cases, new rung cases for every shape above.
- Dogfood never touched the changed generators: `verifyDsComponent` on the upgrade road and both Angular presets.
- No tripwire on the builder's glob: tools/test-angular-ts-solution asserts real exit codes; workflow paths gained both generators.
- generators.json states the new side effects.

Needs decision:
- F1: an entry made outside house generators (direct @nx/angular, by hand, or after the rung ran on a library with none) stays false green. Options: (a) state the include at birth on every unit-test library and widen the rung (a later entry is reached by construction; also removes the design-system asymmetry); (b) re-assert from a sync generator; (c) document it, hole stays.
- F3: `adopt-extracted --keepShim` on @nx/angular:unit-test stays red; warning now accurate. Options: remove the shim's test target, or seed a spec of the re-export, or stay red and reported.
- Low: `**/src/**/*.ts` in tsconfig.spec also reaches `<lib>/dist/*/src`, `schematics/*/src`, nested projects. Keep; or per-entry includes; or a stated exclude.
- Low: a Jest library's entry spec is in no TS project (its tsconfig.spec covers src only). Run tsconfig step for every runner; not observed on Jest, so not applied.

Rejected: seeded SCSS red on first ds-component (real runs: classic and TS-solution 0, 0, 0; failing 1); node_modules reached by the tsconfig include (`**` skips it); rung order and `layer` gating (order stable, `layer` descriptive); historicalShapes owed (nothing released carries the markers); V8 during a `--local` run (`file:` stays for the whole run); N5 Angular 20 real run (the brief's decision, untested stands).

Owed by the session:
- Bumps: bespunky-house, bespunky-design-system, bespunky-angular, then the payload.
- After a finished `--local` run package.json says plain 0.51.1 and the lock entry is scrubbed: any installing generator (publishable-lib, navigation-core) run by hand then swaps in the registry's 0.51.1, silently, before the bump. Repack first.
- DECISION.md body still ends at "superseded before landing"; it needs the outcome. CLAUDE.md gains one line on `entry-point-specs` and its tripwire (not an agent's to edit here).
- A library with `--library` and no `styles/` fails loudly on the seeded `@use`: pre-existing, not touched.
- Worktree `node_modules` holds @nx/js and @nx/angular, installed --no-save for `--strict`; the removal was refused by a safety check. It turns three 0.50.0 migration cases red (they assume no @nx/angular). Clear it before running the suite there.

Not covered: UX, scalability, security, visual lenses: no surface for them here.

## Verification after the fixes

test-migrations 386 (clean copy, no peers), test-generators --strict 303, test-layers 103, descriptions and script modes ok. Extended Angular tripwire, real run on Nx 23.1: passing 0, failing spec in `card/src` 1, in `src/lib` 1. Every changed module loads alone when compiled. The tripwire caught an import cycle this review's first fix introduced (the adapter reaching the layer registry through entry-point-specs): the pure half moved to `adapters/angular/entry-point-reach.ts`. Owed again: `tools/dogfood-consumer/run.mjs`, with the new `verifyDsComponent` step, not yet run through the tool (a verifier dry-ran its commands by hand: 0, 0, 0, 0, failing 1, clean).

## Decisions taken after this review

- F1, F3 and the `tsconfig.spec.json` dist exclude: implemented.
- `tsconfig.lib.json` also reaches `<lib>/dist/*/src`, through the same `**/src/**/*.ts` that secondary-entrypoint's reset writes (observed: a type error planted there fails `nx typecheck` on a library with an entry). Left alone: pre-existing, and nothing observed failing on a real output.
- `adopt-extracted --version` never reached the generator, because Nx's CLI keeps the flag: renamed `--packageVersion`, no alias. `--keepShim` now peers the package and drops the Angular peers nothing imports, so it passes its own lint.
