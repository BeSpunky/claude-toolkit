// House generator: scaffold Firebase emulator config + Cloud Functions + Nx targets + app initialization.
// Idempotent and safe in --repair mode.
//
// IMPORTANT: this generator NEVER writes `.firebaserc`. The cloud-project linkage is the
// Firebase CLI's responsibility — `firebase use --add` validates against the user's actual
// account and writes `.firebaserc` properly. Fabricating one here would lie about the cloud
// state and break `firebase deploy` / `firebase use` the moment the user touches them.
// Emulators don't need `.firebaserc`: the launch script (tools/emulators.sh) passes `--project`
// explicitly, DERIVING it from the app's environment.ts (its single source of truth) and falling
// back to `demo-<workspaceName>`. The `demo-` prefix is Firebase's documented convention for
// "offline only, no cloud calls," so emulators work without login and without a real GCP project;
// deriving the id keeps the emulator suite and the client on the same project once any service
// goes real (singleProjectMode), instead of the emulator staying pinned to demo- and drifting.
//
// Writes:
//   - firebase.json     (workspace root) — emulator suite config (auth/firestore/storage/functions/ui),
//                        singleProjectMode, all emulators bound to 0.0.0.0 for Docker/devcontainer
//                        compatibility, AND a `functions` block pointing at the built Nx output
//                        (dist/apps/functions). The functions block is REQUIRED: configuring the
//                        functions emulator with no backend behind it makes `emulators:start`
//                        fatally abort. The generator asserts the `emulators` + `functions` keys
//                        and preserves any other top-level keys the user added (firestore rules,
//                        storage rules, …). NO top-level `hosting` block — the BeSpunky default is
//                        Firebase App Hosting (framework-aware), whose config lives in apphosting.yaml.
//   - apphosting.yaml   (workspace root) — Firebase App Hosting deploy config. Starter ships empty
//                        with commented examples. Created only if absent (preserves user edits).
//   - .gitignore        — emulator debug logs (*-debug.log) + the working data dir (/.emulator-data).
//   - nx.json           — `tui.enabled = false`: the interactive TUI multiplexes the continuous
//                        `serve` + `firebase:emulators` pair into a redrawing multi-pane terminal
//                        that's awkward for humans and agents alike; plain streamed, prefixed logs
//                        and a single Ctrl+C are the right dev loop here.
//   - apps/<project>/src/environments/* — Angular environment-files pattern (see section 2):
//                        environment.ts (per-service emulator toggle via the EMULATE map — going
//                        all-real is a RUNTIME choice via `?emulate=none`/`?real=all`, resolved
//                        against this file's `firebase` block, NOT a separate env file),
//                        environment.prod.ts, environment.interface.ts.
//   - apps/<project>/src/app/firebase.config.ts — provideAppFirebase(), gating EACH service on
//                        committed-default ⊕ runtime-override (see section 2b).
//   - apps/<project>/src/app/emulator-overrides.ts — the per-session ?emulate=/?real=/localStorage
//                        resolver firebase.config.ts applies (generator-owned).
//   - apps/functions/   — Cloud Functions as a first-class Nx app: esbuild-bundled to
//                        dist/apps/functions with a generated deploy-manifest package.json;
//                        runtime deps (firebase-admin/firebase-functions) live at the WORKSPACE
//                        ROOT (no per-project node_modules); lints via the workspace flat config.
//                        Source files (+ .secret.local.example, the secrets shape doc) are written
//                        only if absent (the user owns their functions); project.json's build / lint /
//                        deploy / push-secrets targets are generator-owned (re-asserted), extra
//                        targets are preserved.
//   - firebase/project.json — the emulator suite as its own workspace-level Nx project (it's a
//                        workspace concept, not an app concern): `emulators` (full suite, dependsOn
//                        functions:build), `emulators:<svc>` (one + UI), `seed:build`, `reset`.
//                        All funnel through tools/emulators.sh. Generator-owned targets are
//                        re-asserted; user-added targets (e.g. `reset:<seed>`) are preserved.
//   - tools/emulators.sh — the single launch path: reap → prime → start, importing the gitignored
//                        .emulator-data/ working dir and (full runs only) exporting back on a clean
//                        exit, so session + data survive every serve. Focused `--only` runs
//                        import-only (a partial export would clobber the other services' data).
//   - tools/emulator-data.sh — owns the working-dir ↔ committed-seeds lifecycle: `ensure` (prime
//                        from the default seed when empty) and `reset [<seed>]` (on-call wipe).
//   - tools/seed/{world.mjs,build.mjs} + tools/seed/build-seeds.sh — declarative seed worlds
//                        (world.mjs is USER-OWNED once written — it models the app's schema) and
//                        the one-command rebuild (`nx run firebase:seed:build`) that exports each
//                        world into tools/emulator-seeds/<name>/ (committed, generated artifacts).
//   - tools/reap-emulators.sh — verified port + process reclaim before each start: pass 0 kills
//                        orphaned emulator JVMs by cache path (catches fallback-port and
//                        alive-but-unbound orphans), pass 1 polls the configured ports until they
//                        are ACTUALLY free (SIGTERM → grace → SIGKILL), so an ungraceful prior
//                        death (closed terminal, container stop, SIGKILL) can't break the next start.
//   - tools/push-secrets.sh — push apps/functions/.secret.local (KEY=VALUE) into Google Secret
//                        Manager for the deploy project (prod counterpart of the emulator's local
//                        .secret.local injection); each value goes via stdin, never a cmdline/log.
//                        Nx target: functions:push-secrets.
//   - tools/firebase-welcome.sh — self-extinguishing cloud-linkage banner (see section 3a).
//   - apps/<project>/project.json targets: firebase-emulators no longer creates or reshapes any
//     serve/dev-server target. The unified `serve` (the @bespunky/nx-tools:serve executor) and the
//     `dev-server` leaf (@angular/build:dev-server) are owned by the SEPARATE `serve` generator.
//     Emulators-on/off is a RUNTIME concern now — the app resolves all-real via `?emulate=none`
//     (see emulator-overrides.ts) and the serve executor skips the suite for `--no-emulators` — so
//     there's no build variant and no per-mode serve target. This generator only HEALS away the
//     retired split targets (`serve-with-emulators`, `serve-no-emulators`) + the `build:no-emulators`
//     configuration + the `environment.no-emulators.ts` env file when re-run on an older project.
//   - root eslint.config.mjs — best-effort insertion of the `platform:` dependency-constraint
//                       firewall: `platform:web` bans firebase-admin/firebase-functions imports,
//                       `platform:server` bans firebase/@angular. The app is tagged platform:web,
//                       functions + firebase are tagged platform:server.
import {
  type Tree,
  type GeneratorCallback,
  type TargetConfiguration,
  type ProjectConfiguration,
  readProjectConfiguration,
  updateProjectConfiguration,
  formatFiles,
  addDependenciesToPackageJson,
  installPackagesTask,
  applyChangesToString,
  type StringChange,
  ChangeType,
  readJson,
  writeJson,
  updateJson,
  logger,
} from '@nx/devkit';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// Still needed by this file's OTHER AST routine (the ESLint depConstraints inserter). The app.config
// `providers` wiring, however, is now shared — see the import below.
import * as ts from 'typescript';
// The app.config `providers` wiring is shared with the `serve` and `design-system-styles` generators —
// it used to be copy-pasted here in full (the same TS-AST walk, three times over).
import { wireProvider } from '../_utils/wire-provider';

interface FirebaseEmulatorsSchema {
  project: string;
  workspaceName?: string;
  // Opt-in: also scaffold the staging environment bundle (environment.staging.ts + a `staging` build
  // configuration + apphosting.staging.yaml). See schema.json for the rationale.
  staging?: boolean;
}

const EMULATORS = ['auth', 'firestore', 'storage', 'functions'] as const;

// The canonical `emulators` block. Every backend-service emulator binds to `0.0.0.0`
// (all interfaces) — required when running inside Docker / devcontainers, where the
// firebase-tools probe (`127.0.0.1:<port>`) otherwise fails with "Port X is not open on
// localhost (127.0.0.1)" because the emulator bound to ::1 (IPv6) or a container-internal
// interface only.
function canonicalEmulatorsBlock() {
  return {
    auth:      { host: '0.0.0.0', port: 9099 },
    firestore: { host: '0.0.0.0', port: 8080 },
    storage:   { host: '0.0.0.0', port: 9199 },
    functions: { host: '0.0.0.0', port: 5001 },
    ui:        { enabled: true, host: '0.0.0.0', port: 4000 },
    singleProjectMode: true,
  };
}

// The canonical `functions` block — REQUIRED whenever the functions emulator is configured:
// without a functions backend behind it, `firebase emulators:start` fatally aborts. The
// source points at the BUILT Nx output (dist/apps/functions, which carries a generated
// package.json), and predeploy routes lint + build through Nx so `firebase deploy` and
// `nx run functions:deploy` take the same path.
function canonicalFunctionsBlock() {
  return [
    {
      source: 'dist/apps/functions',
      codebase: 'default',
      disallowLegacyRuntimeConfig: true,
      ignore: ['node_modules', '.git', 'firebase-debug.log', 'firebase-debug.*.log', '*.local'],
      predeploy: ['yarn nx lint functions', 'yarn nx build functions'],
    },
  ];
}

// .gitignore additions (idempotency marker: `/.emulator-data`).
const GITIGNORE_BLOCK = `# Firebase emulator-generated logs (firebase-debug.log, firestore-debug.log, ui-debug.log, …)
*-debug.log
firebase-debug.*.log

# The emulator working data — the cache \`nx serve\` imports/exports each run. Ephemeral and
# machine-local; the committed seed worlds live in tools/emulator-seeds/ (see its README).
/.emulator-data

# Isolated port-offset stacks (\`<app>:serve --portOffset\`): each gets its own data dir
# and a generated offset firebase.json. Ephemeral and machine-local.
/.emulator-data-*
/.firebase.offset-*.json
`;

// Local Functions secrets ignore — kept separate from GITIGNORE_BLOCK (its own idempotency
// marker) so a project already past the emulator block self-heals to ignore .secret.local on --repair.
const SECRET_GITIGNORE_BLOCK = `# Local Cloud Functions secrets — the gitignored source for \`nx run functions:push-secrets\`
# (which sets them in Google Secret Manager for production) and the emulator's local injection.
# The committed apps/functions/.secret.local.example documents the shape.
apps/functions/.secret.local
`;

export default async function firebaseEmulatorsGenerator(
  tree: Tree,
  options: FirebaseEmulatorsSchema
): Promise<GeneratorCallback> {
  if (!options.project) {
    throw new Error('firebase-emulators generator requires --project=<app-name>.');
  }
  const projectName = options.project;
  const workspaceName = options.workspaceName ?? projectName;
  const project = readProjectConfiguration(tree, projectName);
  const appRoot = project.root;

  const substitute = (tpl: string) => tpl.split('{{workspaceName}}').join(workspaceName);
  const template = (name: string) => readFileSync(join(__dirname, name), 'utf8');

  // 1) firebase.json at workspace root. The `emulators` and `functions` keys are
  //    generator-owned (asserted to canonical on every run); any other top-level keys the
  //    user added (firestore/storage rules paths, …) are preserved.
  //    Note: `.firebaserc` is deliberately NOT generated — see the file header.
  const firebaseJson: Record<string, unknown> = tree.exists('firebase.json')
    ? readJson(tree, 'firebase.json')
    : {};
  firebaseJson.emulators = canonicalEmulatorsBlock();
  firebaseJson.functions = canonicalFunctionsBlock();
  writeJson(tree, 'firebase.json', firebaseJson);

  // 1b) apphosting.yaml at workspace root — Firebase App Hosting's deploy config.
  //     Don't clobber user edits; only write if absent.
  if (!tree.exists('apphosting.yaml')) {
    tree.write('apphosting.yaml', template('apphosting.yaml.tpl'));
  }
  // 1b-staging) Opt-in (--staging): tell the `staging` App Hosting backend to build the Angular `staging`
  //     configuration (which swaps in environment.staging.ts) instead of the framework-default prod build.
  //     Write-if-absent (user owns edits). Merged OVER apphosting.yaml for the backend named `staging`.
  if (options.staging && !tree.exists('apphosting.staging.yaml')) {
    tree.write(
      'apphosting.staging.yaml',
      template('apphosting.staging.yaml.tpl').split('{{projectName}}').join(projectName)
    );
  }

  // 1c) .gitignore — emulator debug logs + the working data dir. Without these,
  //     firebase-debug.log / firestore-debug.log pile up untracked at the workspace
  //     root and the (machine-local) .emulator-data/ cache risks being committed.
  const gitignore = tree.exists('.gitignore') ? tree.read('.gitignore', 'utf8') ?? '' : '';
  if (!gitignore.includes('/.emulator-data')) {
    tree.write('.gitignore', `${gitignore.trimEnd()}\n\n${GITIGNORE_BLOCK}`);
  }
  // Secret ignore — separate marker so an older-scaffold project (already past the emulator
  // block above) still self-heals to ignore apps/functions/.secret.local on --repair.
  const gitignoreNow = tree.exists('.gitignore') ? tree.read('.gitignore', 'utf8') ?? '' : '';
  if (!gitignoreNow.includes('apps/functions/.secret.local')) {
    tree.write('.gitignore', `${gitignoreNow.trimEnd()}\n\n${SECRET_GITIGNORE_BLOCK}`);
  }

  // 1d) nx.json — disable the interactive TUI. It multiplexes the continuous
  //     `serve` + `firebase:emulators` pair into one redrawing multi-pane terminal that's
  //     awkward to drive (for humans and agents); disabled, Nx streams plain, scrollable,
  //     prefixed logs and a single Ctrl+C stops the whole run.
  if (tree.exists('nx.json')) {
    updateJson(tree, 'nx.json', (json) => {
      json.tui = { ...(json.tui ?? {}), enabled: false };
      return json;
    });
  }

  // 2) Environment files — Angular's environment-files pattern, per-service emulator-aware.
  //    - `environment.interface.ts`  — shared shape (always rewrite — generator-owned, no user values).
  //    - `environment.ts`            — dev defaults + the per-service emulator toggle (write if absent;
  //                                    the legacy single-string-emulators shape is migrated to the new
  //                                    per-service-`default` shape). Its `firebase` block is the ONE
  //                                    "go real" path: a service resolved OFF (via the EMULATE map or a
  //                                    `?emulate=none`/`?real=all` runtime override) talks to it.
  //    - `environment.prod.ts`       — production target (write if absent; legacy productionFirebaseConfig
  //                                    is migrated in before writing).
  //    There is NO `environment.no-emulators.ts` anymore — going all-real is a runtime override, not a
  //    separate env file (any stale one from an older scaffold is healed away below).
  const envDir = `${appRoot}/src/environments`;
  const envInterfacePath = `${envDir}/environment.interface.ts`;
  const envDevPath = `${envDir}/environment.ts`;
  const envProdPath = `${envDir}/environment.prod.ts`;
  const envStagingPath = `${envDir}/environment.staging.ts`;
  const firebaseConfigPath = `${appRoot}/src/app/firebase.config.ts`;
  const emulatorOverridesPath = `${appRoot}/src/app/emulator-overrides.ts`;

  // The shared Environment shape — WRITE-IF-ABSENT (not a blind rewrite). Projects legitimately
  // EXTEND this interface: they complete the `firebase` block with the keys their app uses and add
  // app-specific top-level fields (e.g. a `google: { oauthClientId }` block for Calendar OAuth).
  // Those are real per-project values, so overwriting the file every run would silently drop them
  // (and break the app's types). New scaffolds get the full standard shape from the template; an
  // existing project owns and keeps its own. (If the toolkit ever changes the shared shape itself,
  // that migration is a manual per-project step (these files hold real per-project values) — the same reason environment.ts /
  // environment.prod.ts are also write-if-absent.)
  if (!tree.exists(envInterfacePath)) {
    tree.write(envInterfacePath, template('environment.interface.ts.tpl'));
  }

  // environment.ts — write if absent; migrate the LEGACY emulators shape (each service was a bare
  // endpoint with no per-service `default`) to the new per-service-toggle shape. The dev env carries
  // demo credentials (regenerated identically), so the rewrite is safe; warn in case the user
  // customized emulator ports there.
  const existingDevEnv = tree.exists(envDevPath) ? tree.read(envDevPath, 'utf8') ?? '' : null;
  const devEnvIsLegacy =
    existingDevEnv !== null && existingDevEnv.includes('emulators') && !existingDevEnv.includes('default:');
  if (existingDevEnv === null || devEnvIsLegacy) {
    if (devEnvIsLegacy) {
      logger.info(
        `[firebase-emulators] Upgrading ${envDevPath} to the per-service emulator-toggle shape ` +
        `(each emulator now carries a \`default\` flag, toggled by the EMULATE map). Re-check any custom ` +
        `emulator ports you set there.`
      );
    }
    tree.write(envDevPath, substitute(template('environment.ts.tpl')));
  }

  // HEAL: `environment.no-emulators.ts` (and its interim `environment.standalone.ts` name) are retired.
  // "No emulators" is no longer a build/env variant — it's a RUNTIME choice: the app goes all-real via
  // `?emulate=none` / `?real=all` (resolved by emulator-overrides.ts against the `firebase` block in
  // environment.ts), and the serve executor simply skips the emulator suite for `--no-emulators`. Remove
  // any stale env files a pre-unification scaffold left behind so they can't compile into a build.
  for (const stale of [`${envDir}/environment.no-emulators.ts`, `${envDir}/environment.standalone.ts`]) {
    if (tree.exists(stale)) tree.delete(stale);
  }

  // emulator-overrides.ts — the pure per-session override resolver (?emulate=/?real=/localStorage).
  // Generator-owned glue, no user values — always rewritten so fixes propagate.
  tree.write(emulatorOverridesPath, template('emulator-overrides.ts.tpl'));

  if (!tree.exists(envProdPath)) {
    // Migration: if the project still has the legacy firebase.config.ts shape
    // with a populated `productionFirebaseConfig`, carry those values into the
    // new environment.prod.ts. Empty placeholders stay empty (their job is to
    // make a half-wired prod build fail loud).
    const migrated = tree.exists(firebaseConfigPath)
      ? extractLegacyProdConfig(tree.read(firebaseConfigPath, 'utf8') ?? '')
      : { projectId: '', apiKey: '', appId: '', authDomain: '' };
    if (migrated.projectId || migrated.apiKey || migrated.appId) {
      logger.info(
        `[firebase-emulators] Migrated productionFirebaseConfig from ${firebaseConfigPath} into ${envProdPath} ` +
        `(legacy shape detected). Verify the new file before committing.`
      );
    }
    tree.write(
      envProdPath,
      template('environment.prod.ts.tpl')
        .split('{{projectId}}').join(migrated.projectId)
        .split('{{apiKey}}').join(migrated.apiKey)
        .split('{{appId}}').join(migrated.appId)
        .split('{{authDomain}}').join(migrated.authDomain)
    );
  }

  // environment.staging.ts — OPT-IN (--staging). A first-class staging env: write-if-absent, empty
  // placeholders (fill from `firebase apps:sdkconfig`, like prod). Pairs with the `staging` build
  // configuration + apphosting.staging.yaml so the staging App Hosting backend builds its OWN
  // config/database instead of silently building prod's.
  if (options.staging && !tree.exists(envStagingPath)) {
    tree.write(
      envStagingPath,
      template('environment.staging.ts.tpl')
        .split('{{projectId}}').join('')
        .split('{{apiKey}}').join('')
        .split('{{appId}}').join('')
        .split('{{authDomain}}').join('')
    );
  }

  // 2b) src/app/firebase.config.ts — GENERATOR-OWNED logic, rewritten IN FULL on every run (exactly like
  //     emulator-overrides.ts above). It carries NO per-project values by design: per-environment config
  //     (the `firebase` web config, emulator toggles, `databaseId`, `functionsRegion`, functions `proxied`)
  //     lives in environment.ts, and app-specific PROVIDERS live in app.config.ts beside
  //     `provideAppFirebase()`. Because there is nothing here to preserve, we don't guess whether the file
  //     is "customized" — the old marker-sniffing heuristic could not tell a current file from a stale one
  //     that merely carried the same old markers, so a customized file silently froze and stopped receiving
  //     template improvements (e.g. the port-offset emulator wiring). Always rewriting removes that whole
  //     drift class. The file header states the contract; --repair's git backup covers a project that
  //     edited it anyway. (The legacy prod-config MIGRATION still ran above, off the pre-rewrite contents.)
  if (tree.exists(firebaseConfigPath)) {
    logger.info(
      `[firebase-emulators] Rewrote ${firebaseConfigPath} to the current generator-owned shape (it holds no ` +
      `per-project values — customize via environment.ts for config, app.config.ts for providers, never this file).`
    );
  }
  tree.write(firebaseConfigPath, template('firebase.config.ts.tpl'));

  // 2c) apps/<app>/proxy.conf.mjs — dev-server proxy that relays Functions callables through the app's own
  //     origin (see the file header). Generator-owned, always rewritten. Baked with THIS app's env path so
  //     it reads the project id (its single source of truth). The serve executor auto-wires it for a
  //     Firebase serve when the developer didn't pass their own --proxyConfig.
  tree.write(
    `${appRoot}/proxy.conf.mjs`,
    template('proxy.conf.mjs.tpl').split('{{appEnvPath}}').join(envDevPath)
  );

  // 3a) tools/firebase-welcome.sh — self-extinguishing banner that nudges the user
  //     toward the cloud-linkage steps every time they open a terminal in the devcontainer,
  //     and goes silent once setup is complete. Sourced by /etc/profile.d/zz-firebase-welcome.sh
  //     which the devcontainer's postCreateCommand installs (when --firebase=true).
  //     Always (re)write — small file, our content, no user edits expected.
  tree.write('tools/firebase-welcome.sh', template('firebase-welcome.sh.tpl'));

  // 3b) The emulator tooling scripts. All generator-owned (always rewritten) EXCEPT
  //     tools/seed/world.mjs and tools/emulator-seeds/README.md, which model the APP'S data
  //     and are user-owned once written:
  //       - tools/reap-emulators.sh   — verified process+port reclaim before each start.
  //       - tools/emulators.sh        — the single launch path: reap → prime → start
  //                                     (import .emulator-data; export-on-exit on full runs).
  //       - tools/emulator-data.sh    — working-dir lifecycle: ensure / reset [<seed>].
  //       - tools/seed/build-seeds.sh — rebuild every committed seed from world.mjs.
  //       - tools/seed/build.mjs      — the per-world command emulators:exec runs.
  //       - tools/seed/world.mjs      — the DECLARATIVE seed worlds (user-owned: it mirrors
  //                                     the app's real document shapes; written only if absent).
  //       - tools/emulator-seeds/README.md — seed catalog + usage (user-extended; if absent).
  tree.write('tools/reap-emulators.sh', template('reap-emulators.sh.tpl'));
  // emulators.sh derives its --project from the app's dev env file at serve time (single source
  // of truth), so point {{appEnvPath}} at THIS app's environment.ts. One suite = one project
  // (singleProjectMode), so it follows the primary app this workspace was wired with.
  tree.write(
    'tools/emulators.sh',
    substitute(template('emulators.sh.tpl')).split('{{appEnvPath}}').join(envDevPath),
  );
  tree.write('tools/emulator-data.sh', template('emulator-data.sh.tpl'));
  // Push local Functions secrets to Google Secret Manager (prod counterpart of the emulator's
  // local .secret.local injection). Derives the deploy project from the app's environment.prod.ts.
  tree.write(
    'tools/push-secrets.sh',
    template('push-secrets.sh.tpl').split('{{appEnvProdPath}}').join(envProdPath),
  );
  tree.write('tools/seed/build-seeds.sh', substitute(template('seed-build-seeds.sh.tpl')));
  tree.write('tools/seed/build.mjs', template('seed-build.mjs.tpl'));
  if (!tree.exists('tools/seed/world.mjs')) {
    tree.write('tools/seed/world.mjs', substitute(template('seed-world.mjs.tpl')));
  }
  if (!tree.exists('tools/emulator-seeds/README.md')) {
    tree.write('tools/emulator-seeds/README.md', template('emulator-seeds-README.md.tpl'));
  }

  // 3c) Cloud Functions as a first-class Nx app (apps/functions). REQUIRED for the emulator
  //     suite to boot at all: firebase.json configures the functions emulator, and a configured
  //     functions emulator with no backend behind it fatally aborts `emulators:start`.
  //     Source files (manifest package.json, tsconfigs, main.ts) are written only if absent —
  //     the user owns their functions code. The project.json's build/lint/deploy targets are
  //     generator-owned (re-asserted); any extra targets the user added are preserved.
  ensureFunctionsProject(tree);

  // 3d) The emulator suite as its own workspace-level Nx project (firebase/project.json) —
  //     the emulators are a workspace concept, not an app concern. Generator-owned targets
  //     are re-asserted; user-added targets (e.g. `reset:<seed>` for extra worlds) survive.
  ensureFirebaseProject(tree);

  // 4) Nx targets on the app's project.json.
  project.targets ??= {};
  const targets = project.targets;

  // The app is browser code — tag it so the platform firewall (4c) applies.
  ensureTag(project, 'platform:web');

  // The app's `serve` + `dev-server` targets are owned by the SEPARATE `serve` generator (the unified
  // `@bespunky/nx-tools:serve` executor + the `@angular/build:dev-server` leaf). firebase-emulators no
  // longer creates or reshapes any serve/dev-server target: emulators-on/off is a RUNTIME concern now —
  // the app resolves all-real via `?emulate=none` (emulator-overrides.ts, against environment.ts's
  // `firebase` block) and the serve executor skips the emulator suite for `--no-emulators` — so there's
  // no build variant and no per-mode serve target to wire.
  //
  // HEAL: retire the split serve targets a pre-unification scaffold created. The old trio was `serve`
  // (an nx:run-commands orchestrator), plus `serve-with-emulators` / `serve-no-emulators` (dev-servers
  // pinned to the emulator / no-emulator env). We drop ONLY the now-orphaned inner dev-server targets
  // (and their interim names); we deliberately DON'T touch `serve`/`dev-server` — the `serve` generator
  // re-asserts those to the unified shape, so healing them here would just fight it.
  for (const name of ['serve-with-emulators', 'serve-no-emulators', 'serve-standalone', 'serve-app']) {
    delete targets[name];
  }

  // The per-app `emulators*` targets of earlier generations moved to the workspace-level
  // `firebase` project — drop them from the app so there's exactly one home.
  delete targets.emulators;
  for (const svc of EMULATORS) {
    delete targets[`emulators:${svc}`];
  }

  // 4b) Build configuration that selects the environment file:
  //     - `production`  swaps environment.ts → environment.prod.ts (the default `nx build <app>`).
  //     We touch ONLY `configurations.production` (de-duplicated) — never `build.options`, so a user's
  //     own staging config is unaffected.
  //     HEAL: the retired `no-emulators` build configuration (and its interim `standalone` name) are
  //     removed — going all-real is a runtime override (`?emulate=none`) now, not a build variant.
  const buildTarget = targets.build as
    | {
        configurations?: Record<
          string,
          { fileReplacements?: Array<{ replace: string; with: string }> } & Record<string, unknown>
        >;
      }
    | undefined;
  if (buildTarget) {
    buildTarget.configurations ??= {};
    buildTarget.configurations.production ??= {};
    const prodCfg = buildTarget.configurations.production;
    const prodReplacement = { replace: envDevPath, with: envProdPath };
    const existing = Array.isArray(prodCfg.fileReplacements) ? prodCfg.fileReplacements : [];
    const alreadyPresent = existing.some(
      (entry) => entry?.replace === prodReplacement.replace && entry?.with === prodReplacement.with
    );
    prodCfg.fileReplacements = alreadyPresent ? existing : [...existing, prodReplacement];

    // OPT-IN staging build configuration (--staging): swaps environment.ts → environment.staging.ts, so
    // `nx build <app> --configuration=staging` (run by apphosting.staging.yaml) compiles the staging env.
    // Mirrors the production config's other settings (budgets, outputHashing, …) so staging builds like
    // prod, without overwriting any user tweaks. Idempotent.
    if (options.staging) {
      const stagingCfg = (buildTarget.configurations.staging ??= {});
      for (const [k, v] of Object.entries(prodCfg)) {
        if (k !== 'fileReplacements' && !(k in stagingCfg)) stagingCfg[k] = v;
      }
      const stagingReplacement = { replace: envDevPath, with: envStagingPath };
      const stExisting = Array.isArray(stagingCfg.fileReplacements) ? stagingCfg.fileReplacements : [];
      const stPresent = stExisting.some(
        (entry) => entry?.replace === stagingReplacement.replace && entry?.with === stagingReplacement.with
      );
      stagingCfg.fileReplacements = stPresent ? stExisting : [...stExisting, stagingReplacement];
    }

    // Drop the retired build configurations if an older scaffold left them behind.
    delete buildTarget.configurations['no-emulators'];
    delete buildTarget.configurations['standalone'];
  } else {
    logger.warn(
      `[firebase-emulators] No \`build\` target on project \`${projectName}\` — skipped registering the ` +
      `environment-files fileReplacements. Add it manually: the production configuration swaps ` +
      `"${envDevPath}" → "${envProdPath}".`
    );
  }

  updateProjectConfiguration(tree, projectName, project);

  // 4c) Best-effort: the `platform:` dependency-constraint firewall in the root flat
  //     ESLint config. Server-only SDKs (firebase-admin/firebase-functions pull in Node
  //     natives and admin credentials) must never reach browser code; the browser SDK and
  //     Angular must never reach the functions runtime.
  const eslintConfigPath = 'eslint.config.mjs';
  if (tree.exists(eslintConfigPath)) {
    const current = tree.read(eslintConfigPath, 'utf8') ?? '';
    const patched = addPlatformBoundaries(current, eslintConfigPath);
    if (patched === current) {
      // Already present — idempotent no-op.
    } else if (patched) {
      tree.write(eslintConfigPath, patched);
    } else {
      logger.warn(
        `[firebase-emulators] Could not auto-insert the platform: dependency constraints into ${eslintConfigPath}. ` +
        `Add these entries to the @nx/enforce-module-boundaries depConstraints array manually:\n` +
        `  { sourceTag: 'platform:web', bannedExternalImports: ['firebase-admin', 'firebase-admin/*', 'firebase-functions', 'firebase-functions/*'] },\n` +
        `  { sourceTag: 'platform:server', bannedExternalImports: ['firebase', 'firebase/*', '@angular/*'] }`
      );
    }
  }

  // 5) Best-effort: wire provideAppFirebase() into app.config.ts.
  const appConfigPath = `${appRoot}/src/app/app.config.ts`;
  if (tree.exists(appConfigPath)) {
    const current = tree.read(appConfigPath, 'utf8') ?? '';
    const wired = wireProvider(current, appConfigPath, {
      providerFn: 'provideAppFirebase',
      importFrom: './firebase.config',
    });
    if (wired === current) {
      // Already wired or no changes needed.
    } else if (wired) {
      tree.write(appConfigPath, wired);
    } else {
      logger.warn(
        `[firebase-emulators] Could not auto-wire ${appConfigPath}. ` +
        `Add \`import { provideAppFirebase } from './firebase.config';\` and ` +
        `include \`provideAppFirebase()\` in your providers array manually.`
      );
    }
  }

  // 6) Runtime + build deps. `latest` resolves to current at install time; the lockfile pins
  //    after install. Existing entries are never overwritten (preserves user pins on --repair).
  //      - firebase / @angular/fire          — the browser SDK (dependencies).
  //      - firebase-admin / firebase-functions — the Cloud Functions runtime, at the WORKSPACE
  //        ROOT (no per-project node_modules; local build/lint/emulate resolve from root).
  //        Keep these aligned with apps/functions/package.json (the deploy manifest).
  //      - @nx/esbuild — the functions build executor, pinned to the workspace's own Nx
  //        version (Nx plugin packages must move in lockstep with `nx` itself).
  const rootPkg = readJson(tree, 'package.json') as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const missing = (deps: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(deps).filter(
        ([name]) => !rootPkg.dependencies?.[name] && !rootPkg.devDependencies?.[name]
      )
    );
  const nxVersion =
    rootPkg.devDependencies?.['nx'] ?? rootPkg.dependencies?.['nx'] ?? 'latest';
  addDependenciesToPackageJson(
    tree,
    missing({
      'firebase': 'latest',
      '@angular/fire': 'latest',
      'firebase-admin': '^13.6.0',
      'firebase-functions': '^7.0.0',
    }),
    missing({ '@nx/esbuild': nxVersion })
  );

  await formatFiles(tree);

  // Post-commit: install the new deps via the workspace's package manager.
  return () => {
    installPackagesTask(tree);
  };
}

/** Ensure a tag is present on a project configuration (idempotent). */
function ensureTag(project: ProjectConfiguration, tag: string): void {
  project.tags ??= [];
  if (!project.tags.includes(tag)) {
    project.tags.push(tag);
  }
}

/**
 * Merge generator-owned targets into a project.json-style config file, preserving any
 * user-added targets and tags. Writes the file when absent.
 */
function ensureProjectFile(
  tree: Tree,
  path: string,
  canonical: {
    name: string;
    projectType: 'application' | 'library';
    sourceRoot?: string;
    tags: string[];
    targets: Record<string, TargetConfiguration>;
  },
  schemaRelativePrefix: string
): void {
  if (!tree.exists(path)) {
    writeJson(tree, path, {
      name: canonical.name,
      $schema: `${schemaRelativePrefix}node_modules/nx/schemas/project-schema.json`,
      projectType: canonical.projectType,
      ...(canonical.sourceRoot ? { sourceRoot: canonical.sourceRoot } : {}),
      tags: canonical.tags,
      targets: canonical.targets,
    });
    return;
  }
  updateJson(tree, path, (json) => {
    json.tags ??= [];
    for (const tag of canonical.tags) {
      if (!json.tags.includes(tag)) json.tags.push(tag);
    }
    json.targets = { ...(json.targets ?? {}), ...canonical.targets };
    return json;
  });
}

/** Cloud Functions as a first-class Nx app at apps/functions. */
function ensureFunctionsProject(tree: Tree): void {
  const root = 'apps/functions';

  // Source files: user-owned once written (the manifest's deps, the functions code, and the
  // compiler options are all things a project legitimately evolves).
  const ifAbsent = (path: string, templateName: string) => {
    if (!tree.exists(path)) {
      tree.write(path, readFileSync(join(__dirname, templateName), 'utf8'));
    }
  };
  ifAbsent(`${root}/package.json`, 'functions-package.json.tpl');
  ifAbsent(`${root}/tsconfig.json`, 'functions-tsconfig.json.tpl');
  ifAbsent(`${root}/tsconfig.app.json`, 'functions-tsconfig.app.json.tpl');
  ifAbsent(`${root}/src/main.ts`, 'functions-main.ts.tpl');
  // The committed shape doc for local Functions secrets (.secret.local itself is gitignored).
  // User-owned once written — it grows with each `defineSecret` the functions add.
  ifAbsent(`${root}/.secret.local.example`, 'functions-secret.local.example.tpl');

  ensureProjectFile(
    tree,
    `${root}/project.json`,
    {
      name: 'functions',
      projectType: 'application',
      sourceRoot: `${root}/src`,
      tags: ['platform:server'],
      targets: {
        // esbuild-bundle to dist/apps/functions with a generated package.json (merging the
        // manifest's deps + the built `main` entry) — that dist output is what firebase.json's
        // `functions.source` points at, for both the emulator and `firebase deploy`.
        build: {
          executor: '@nx/esbuild:esbuild',
          outputs: ['{options.outputPath}'],
          options: {
            outputPath: 'dist/apps/functions',
            main: `${root}/src/main.ts`,
            tsConfig: `${root}/tsconfig.app.json`,
            platform: 'node',
            format: ['cjs'],
            bundle: true,
            thirdParty: false,
            generatePackageJson: true,
            deleteOutputPath: true,
            // Copy the committed public-params file beside the bundle. apps/functions/.env holds
            // PUBLIC (non-secret) function params and is a build asset (secrets go through
            // .secret.local / Secret Manager, never here). Without this the deploy/emulator bundle
            // ships without .env and the functions lose their params at runtime.
            assets: [{ glob: '.env', input: root, output: '.' }],
            esbuildOptions: { outExtension: { '.js': '.js' } },
          },
        },
        // Lints via the workspace flat config — no per-project ESLint island.
        lint: { executor: '@nx/eslint:lint' },
        deploy: {
          executor: 'nx:run-commands',
          dependsOn: ['build'],
          options: { command: 'firebase deploy --only functions', cwd: '{workspaceRoot}' },
        },
        // Push apps/functions/.secret.local (KEY=VALUE) into Google Secret Manager for the deploy
        // project — one source of truth for which secrets exist (tools/push-secrets.sh).
        'push-secrets': {
          executor: 'nx:run-commands',
          options: { command: 'bash tools/push-secrets.sh', cwd: '{workspaceRoot}' },
        },
      },
    },
    '../../'
  );
}

/** The emulator suite as its own workspace-level Nx project (firebase/project.json). */
function ensureFirebaseProject(tree: Tree): void {
  const emulatorsTarget = (only?: string): TargetConfiguration => ({
    continuous: true,
    executor: 'nx:run-commands',
    options: {
      command: `bash tools/emulators.sh${only ? ` --only ${only},ui` : ''}`,
      cwd: '{workspaceRoot}',
    },
  });
  const dependsOnFunctionsBuild = [{ projects: ['functions'], target: 'build' }];

  ensureProjectFile(
    tree,
    'firebase/project.json',
    {
      name: 'firebase',
      projectType: 'application',
      tags: ['platform:server'],
      targets: {
        // The full suite. Depends on the functions build: firebase.json points the functions
        // emulator at dist/apps/functions, so the backend must exist before the suite boots.
        emulators: { ...emulatorsTarget(), dependsOn: dependsOnFunctionsBuild },
        'emulators:auth': emulatorsTarget('auth'),
        'emulators:firestore': emulatorsTarget('firestore'),
        'emulators:storage': emulatorsTarget('storage'),
        'emulators:functions': { ...emulatorsTarget('functions'), dependsOn: dependsOnFunctionsBuild },
        // Rebuild the committed seeds from tools/seed/world.mjs (run after schema changes).
        'seed:build': {
          executor: 'nx:run-commands',
          options: { command: 'bash tools/seed/build-seeds.sh', cwd: '{workspaceRoot}' },
        },
        // On-call reset to the default pristine world (takes effect on the next serve).
        // Add `reset:<seed>` siblings here for extra worlds — they survive --repair.
        reset: {
          executor: 'nx:run-commands',
          options: { command: 'bash tools/emulator-data.sh reset', cwd: '{workspaceRoot}' },
        },
      },
    },
    '../'
  );
}

/**
 * Insert the `platform:` dependency constraints into the root flat ESLint config's
 * `depConstraints` array (the `@nx/enforce-module-boundaries` rule).
 *
 * Uses the TypeScript compiler API to locate the array (no regex on source — source code
 * is a tree, not text), then applies a text insert via `applyChangesToString` so the
 * surrounding formatting is preserved and `formatFiles` polishes the result.
 *
 * Returns:
 *   - the updated source when the constraints are inserted,
 *   - the original `source` when they're already present (idempotent no-op),
 *   - `null` when no `depConstraints` array literal is found — the caller logs an
 *     actionable warning with the manual snippet.
 */
function addPlatformBoundaries(source: string, sourcePath: string): string | null {
  // Idempotency: the tag literal anywhere in the file means the firewall is already declared.
  if (source.includes('platform:web') || source.includes('platform:server')) {
    return source;
  }

  const sf = ts.createSourceFile(
    sourcePath,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.JS
  );

  let constraintsArray: ts.ArrayLiteralExpression | null = null;
  const findConstraints = (node: ts.Node): void => {
    if (constraintsArray) return;
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'depConstraints' &&
      ts.isArrayLiteralExpression(node.initializer)
    ) {
      constraintsArray = node.initializer;
      return;
    }
    ts.forEachChild(node, findConstraints);
  };
  findConstraints(sf);
  if (!constraintsArray) return null;

  const found: ts.ArrayLiteralExpression = constraintsArray;
  const snippet =
    `// by platform: the server-only Firebase Admin/Functions SDKs belong to Cloud\n` +
    `// Functions alone — they must never reach browser/SSR Angular code (they pull in\n` +
    `// Node-native modules and admin credentials). Symmetrically, the browser Firebase\n` +
    `// SDK and Angular have no place in the functions runtime.\n` +
    `{\n` +
    `  sourceTag: 'platform:web',\n` +
    `  bannedExternalImports: ['firebase-admin', 'firebase-admin/*', 'firebase-functions', 'firebase-functions/*'],\n` +
    `},\n` +
    `{\n` +
    `  sourceTag: 'platform:server',\n` +
    `  bannedExternalImports: ['firebase', 'firebase/*', '@angular/*'],\n` +
    `},`;
  const elements = found.elements;
  const text =
    elements.length === 0
      ? snippet
      : elements.hasTrailingComma
      ? `\n${snippet}`
      : `,\n${snippet}`;

  const changes: StringChange[] = [
    {
      type: ChangeType.Insert,
      index: found.getEnd() - 1, // position just before the closing `]`
      text,
    },
  ];
  return applyChangesToString(source, changes);
}


/**
 * Extract the field values of the legacy `productionFirebaseConfig` const from
 * an old-shape firebase.config.ts (the pre-environment-files version that
 * carried the two-consts-plus-ngDevMode pattern).
 *
 * Used by the generator's migration path: when `--repair --firebase` runs on a
 * project that still has the legacy file, we don't want to drop the user's
 * real production config on the floor — those values get carried into the new
 * `environment.prod.ts` before the legacy file is overwritten with the new
 * structural shape.
 *
 * Uses the TypeScript compiler API (no regex on source — source code is a tree,
 * not text) to find the `productionFirebaseConfig` variable declaration and
 * read the string fields. Returns empty strings for any field that's
 * absent, non-literal, or itself an empty string — same shape as the template's
 * placeholders, so missing values stay missing.
 *
 * Returns all-empty when the source is the new shape (no
 * `productionFirebaseConfig` const) — the caller treats all-empty as
 * "no migration needed."
 */
function extractLegacyProdConfig(source: string): {
  projectId: string;
  apiKey: string;
  appId: string;
  authDomain: string;
} {
  const empty = { projectId: '', apiKey: '', appId: '', authDomain: '' };
  if (!source.includes('productionFirebaseConfig')) return empty;

  const sf = ts.createSourceFile(
    'firebase.config.ts',
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TS
  );

  let prodObject: ts.ObjectLiteralExpression | null = null;
  const findProd = (node: ts.Node): void => {
    if (prodObject) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'productionFirebaseConfig' &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      prodObject = node.initializer;
      return;
    }
    ts.forEachChild(node, findProd);
  };
  findProd(sf);
  if (!prodObject) return empty;

  const readField = (name: string): string => {
    for (const prop of prodObject!.properties) {
      if (
        ts.isPropertyAssignment(prop) &&
        ts.isIdentifier(prop.name) &&
        prop.name.text === name &&
        ts.isStringLiteral(prop.initializer)
      ) {
        return prop.initializer.text;
      }
    }
    return '';
  };

  return {
    projectId: readField('projectId'),
    apiKey: readField('apiKey'),
    appId: readField('appId'),
    authDomain: readField('authDomain'),
  };
}
