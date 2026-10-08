# U7 — small items E2–E5 (triage)

Read-only triage of the consumer's E2–E5. The consumer repo is not available here, so its claims are not verified. Upstream behaviour was checked against the published tarballs `@nx/angular@23.3.0`, `@nx/vite@23.3.0`, `@nx/vitest@23.3.0` and `@analogjs/vite-plugin-angular@2.8.0`, all `npm pack`ed into scratch.

## E2 — `__dirname` in vite/vitest configs triggers Vite's `configLoader: 'native'` warning

**Verdict: upstream (Nx). The toolkit writes no vite/vitest config. Upstream has already fixed it.**

- No toolkit template or generator writes a `vite.config.*` or `vitest.config.*`. A grep over `nx-tools/src` finds nothing. The configs come from Nx generators that the toolkit delegates to:
  - `adapters/angular/libs.ts:59`: `unitTestRunner: options.publishable ? 'vitest-angular' : 'vitest-analog'`. `vitest-analog` goes through `@nx/vitest`'s configuration generator.
  - `adapters/js.ts:63`: `unitTestRunner: 'vitest'`.
- Current Nx writes `root: import.meta.dirname` (`@nx/vitest` `dist/src/utils/generator-utils.js:207`, `@nx/vite` `generator-utils.js:365`). Nx also ships a migration for configs written earlier: `@nx/vitest` `migrations.json` → `update-23-2-0-use-import-meta-dirname` ("Replace `__dirname` with `import.meta.dirname` … so they work with Vite's `configLoader: 'native'`").
- So the consumer's configs were written by an Nx older than 23.2. The fix is `nx migrate latest` on the consumer side (or `nx migrate --run-migrations` with that rung). The toolkit's own nx-tools migration ladder is the wrong place: the shape belongs to Nx and Nx already carries the migration. Duplicating it would give one delta two owners.
- **Output class:** B (project state, owned by Nx). **Toolkit migration:** no.
- **Idea:** `house.sh upgrade` never moves Nx itself (only `NX_CHANNEL` at scaffold time). It is worth a line in HOUSE.md, or a probe notice, saying that an Nx floor older than the toolkit's tested baseline should be followed by `nx migrate latest`. Nx's own migrations (this one, among others) only reach consumers who move Nx. Our peer floor is `>= 23.0.0` (`nx-tools/package.json:27-30`), so a 23.0/23.1 project satisfies it and still carries `__dirname`.

## E3 — `@analogjs` warns that `libs/<lib>/tsconfig.app.json` is missing

**Verdict: upstream (an `@nx/vitest` × Analog default). Our own `navigation-core` almost certainly hits it too. `brand` and `atmosphere` are not toolkit libraries.**

- Mechanism: `@nx/vitest` writes a bare `plugins: ['angular()']` for `uiFramework: 'angular'` (`@nx/vitest` `dist/src/generators/configuration/configuration.js:141`). Analog's `getTsConfigPath` (`@analogjs/vite-plugin-angular` `src/lib/utils/plugin-config.js:34-73`) defaults to `./tsconfig.app.json`. It switches to `tsconfig.lib.json` only when `config.build.lib` is set, and to `tsconfig.spec.json` only when `VITEST` or `NODE_ENV=test` is set (`angular-vite-plugin.js:101,196`). When Nx loads the config outside a test run (project-graph inference through the vite/vitest plugin), neither condition holds. Analog then looks for `tsconfig.app.json`, which a library never has, and `console.error`s.
- The toolkit's part: `navigation-core` is created with `vitest-analog` (`generators/navigation-core/generator.ts:49-56` → `adapters/angular/libs.ts:59`). Every house project wearing `navigation` should therefore show the same warning. This is unverified; reproduce it in a fixture first.
- `libs/brand` and `libs/atmosphere` are not toolkit generator names. Nothing in `nx-tools/src` creates them. They are consumer-made, most likely through `@nx/angular:library` or the house `publishable-lib`. A publishable lib would get `vitest-angular` and no vite config, so `vitest-analog` points to a plain `@nx/angular:library`.
- **Correct fix:** upstream. `@nx/vitest` should pass `angular({ tsconfig: join(import.meta.dirname, 'tsconfig.spec.json') })` for the test-only config it writes. File an Nx issue with the evidence above. Toolkit side, in our own seam only: once Nx fixes it, nothing. Until then, the Angular adapter's `libs.create` could state the tsconfig in the config it just caused to be written, for the libraries the house creates. That is generator output at creation time, not healing.
- **Output class:** B. **Migration:** no for consumer-created libraries. Rewriting vite configs the house never wrote is overreach. For `navigation-core`'s existing config, a migration is defensible only if the warning reproduces, and only if Nx has not fixed it first. Otherwise the user should just hear that it is an upstream warning and harmless.
- **Pushback:** this is a noisy `console.error`, not a broken build (tests run with `VITEST` set and resolve `tsconfig.spec.json`). Rank it low.

## E4 — `libs/brand` has no Nx tags, so it sits outside the module-boundary firewall

**Verdict: the consumer's library, but it exposes a real toolkit design gap. The house firewall is opt-in per project, so an untagged project slips through silently.**

- What the house does today:
  - It tags the projects it creates. The design system gets `type:design-system,platform:web` (`generators/design-system/generator.ts:115`). The navigation kernel gets `type:navigation,platform:web` (`generators/navigation-core/generator.ts:55`). The Firebase suite and Functions get `platform:server` (`generators/firebase-emulators/generator.ts:402,467`). Apps get `platform:web` when Firebase is wired (`generators/firebase-client/generator.ts:39`).
  - `publishable-lib` passes `--tags` through, but its default is none (`generators/publishable-lib/schema.json:56`, `generator.ts:98`). A library made with the house's own entry point is therefore untagged unless the author remembers.
  - The firewall itself is inserted by `firebase-emulators` into the root flat ESLint config's `depConstraints` (`generators/firebase-emulators/generator.ts:254-273`, `addPlatformBoundaries` from `:505`). It consists only of `bannedExternalImports` keyed on `platform:web` and `platform:server`. The `@nx/enforce-module-boundaries` rule and its default `*` constraint come from Nx's ESLint setup, not ours.
- Why that is a gap: `bannedExternalImports` applies to the importing project's own source. An untagged library is matched by no `sourceTag`. It can import `firebase-admin`, and any `platform:web` app that imports that library carries `firebase-admin` into the browser/SSR bundle, past the firewall.
- **Correct fix (design, not a tag patch):** make the firewall fail closed.
  1. Add `onlyDependOnLibsWithTags: ['platform:web', 'platform:shared']` to the `platform:web` constraint, and the mirror on `platform:server`. Nx then reports any dependency on an untagged library, so `libs/brand` is caught by lint instead of silently trusted.
  2. Introduce a `platform:shared` tag (isomorphic code) so pure-TS libraries have an honest home.
  3. Make `publishable-lib`, the `app` generator and the adapters' `libs.create` require or default a `platform:` tag. A library created through the house would then never be untagged.
- **Output class:** the ESLint `depConstraints` are project state (B). Tightening them on existing projects is a one-way delta, so it needs **a migration**. That migration must report, not guess at, every untagged project it finds. Choosing `web`, `server` or `shared` for `libs/brand` is a human decision, and the migration should list the candidates. Defaulting tags in generators is not a migration (new output only).
- **Pushback / caution:** adding `onlyDependOnLibsWithTags` turns every untagged consumer library into a lint error on upgrade. The migration therefore has to say so loudly. One option is to also tag the libraries whose platform is unambiguous: a library imported only by `platform:web` projects can be tagged `platform:web`, reported as such.

## E5 — `site-chrome.scss` trips the 4 kB component-style budget when a skip link is added; the skip link and `<main>` belong to the generated shell or the design system

**Verdict: the budget and `site-chrome` are not toolkit output. The skip-link and landmark point is a fair request, aimed at the design system rather than an app shell.**

- `site-chrome` is consumer code. Nothing in `nx-tools/src` names it, and the toolkit generates no app shell markup: it calls `@nx/angular:application` with `minimal: true, routing: true` (`adapters/angular/index.ts:109-117`) and never touches `app.html`.
- The `anyComponentStyle` 4 kB warning budget is `@nx/angular`'s default (`@nx/angular` `dist/src/generators/application/lib/create-project.js:26,36`). It is project state, and the house must not reshape it. Raising it would mask the signal anyway.
- The design system is not inflating the stylesheet. Its SASS API is zero-output on `@use`: every forward is functions, mixins or `%placeholders` (`generators/design-system/files/styles/_index.scss.tpl:50-70`, `_utils/_placeholders.scss.tpl:4`). So 4 kB in one component's CSS is the component's own weight, which suggests `site-chrome` has outgrown one component (header, nav and footer in one).
- What the design system lacks: `%visually-hidden` exists (`_placeholders.scss.tpl:14`), but a skip link needs visually-hidden **until focused**, plus the focus ring. No such mixin or component exists, so every project hand-writes one. That is exactly the "model the missing concept in the design system" case.
- **Correct fix:**
  1. Add a parameterized `ds.visually-hidden($focusable: false)` mixin. A mixin, not a placeholder, because `@extend` does not cross component stylesheets; the placeholder file's own caveat says so.
  2. Add a design-system `skip-link` component (an Angular secondary entry point through the `ds-component` machinery) that targets a `<main id>` landmark.
  3. Teach the app's first scaffold (Angular adapter `apps.create`, seeded once: class C) an `app.html` with `<a dsSkipLink>` and `<main id="main"><router-outlet/></main>`, and mention it in HOUSE.md's design-system section.
- **Output class:** the design-system styles are seeded (C) and the components are new entry points. The app shell would be seeded on `new`/`app` only (C). **Migration:** no. Never rewrite an existing app's template. Existing projects adopt the component by hand, and HOUSE.md says how.
- **Pushback:** the budget trip is a design smell to split `site-chrome`, not a reason to bump the budget. The handoff's framing ("belongs in generated shell") is half right: the reusable part belongs in the design system, while the shell wiring is a one-time seed.
