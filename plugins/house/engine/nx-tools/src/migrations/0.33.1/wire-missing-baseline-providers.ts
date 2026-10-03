// 0.33.1 — wire the house providers the `app` generator generated files for and then never wired.
//
// THE BUG THIS REPAIRS. The `app` generator composes three per-app generators and each of them owns a
// provider: `serve` → `provideWorktreeTabLabel()`, `design-system-styles` → `provideDesignSystem()`,
// `firebase-emulators` → `provideAppFirebase()`. Wiring is a BASELINE act (see _utils/wire-provider), so
// each generator only writes into `app.config.ts` when told it is ensuring the layer — and the `app`
// generator passed that flag to the design-system call ALONE. So every app the scaffolder has created
// SINCE THAT GATE LANDED (nx-tools 0.26.0 — before it, `wireProvider` was called unconditionally and
// older apps are correctly wired) carries `worktree-tab-label.ts` and `firebase.config.ts` on disk with
// nothing calling either.
//
// It went unnoticed for a long time because the two halves fail in opposite ways. A missing dev-only tab
// label looks exactly like nothing at all. A missing `provideAppFirebase()` is the reverse — the whole
// Firebase layer is generated, tagged, wired into project.json and the emulator suite, and then never
// initialised at runtime, so the app dies at its first `inject(Auth)` with a NullInjectorError pointing
// nowhere near the generator that owed the write. And the SYNC path passed the flag correctly all along,
// which is why the scaffold path's silence never showed up in anyone's sync.
//
// WHY A MIGRATION AND NOT JUST THE GENERATOR FIX. The generator fix (`wireProviders: true` on both calls)
// only ever runs when an app is CREATED, so it cannot reach a single project already on disk. For those,
// `app.config.ts` is class C — seeded, never owned — and a migration is the one sanctioned channel into
// it. This is not a preference being applied: it is the baseline write the toolkit already owed and
// dropped.
//
// SCOPED TO THE EXACT GAP, so it cannot overrule anybody:
//   • it acts only where the generator-owned FILE exists (`worktree-tab-label.ts` / `firebase.config.ts`)
//     — the app was given the capability, so it was meant to have the provider;
//   • and only where NOTHING in the app's sources calls the provider. A project that wired it by hand,
//     or deliberately moved it into a browser-only config, already has a call and is left alone. That
//     check is what keeps this from double-providing Firebase into an SSR config — the incident recorded
//     in _utils/wire-provider's header.
// Where the app config's shape is unrecognised, it REPORTS the exact line to add rather than guessing.
//
// THE ORDER WITH 0.33.0 IS DELIBERATE AND LANDS THESE APPS ON THE NEW DEFAULT. The ladder runs 0.33.0
// first, which finds no `provideAppFirebase()` call in these projects and says so; then this rung wires
// the call together with the commented service menu. So an app that never had Firebase working does not
// get four service providers it never had — it gets exactly what a freshly scaffolded 0.33.x app gets,
// which is the right end state: there was no working behaviour to preserve, only a gap to close.
import { type Tree, logger, formatFiles } from '@nx/devkit';
import { findAppRoots } from '../../generators/_utils/app-roots';
import { findProviderCallSites } from '../../generators/_utils/provider-call-sites';
import { wireProvider } from '../../generators/_utils/wire-provider';
import { firebaseProvidersNote } from '../../generators/firebase-emulators/service-configs';

/** A provider the `app` generator owed a baseline wiring for, and the file that proves it was owed. */
interface BaselineProvider {
  /** Generator-owned file whose presence means this app was given the capability. */
  readonly evidenceFile: string;
  readonly providerFn: string;
  readonly importFrom: string;
  /** Optional prose left beside the call — see wireProvider's `note`. */
  readonly note?: () => string;
  /** What the reader loses while it is unwired, for the report. */
  readonly symptom: string;
}

const BASELINE_PROVIDERS: readonly BaselineProvider[] = [
  {
    evidenceFile: 'worktree-tab-label.ts',
    providerFn: 'provideWorktreeTabLabel',
    importFrom: './worktree-tab-label',
    symptom: 'the dev-only worktree tab label never appears',
  },
  {
    evidenceFile: 'firebase.config.ts',
    providerFn: 'provideAppFirebase',
    importFrom: './firebase.config',
    note: firebaseProvidersNote,
    symptom: 'Firebase is never initialised, so the first inject(Auth) throws NullInjectorError',
  },
];

export default async function wireMissingBaselineProviders(tree: Tree): Promise<void> {
  const wired: string[] = [];
  const unresolved: string[] = [];

  for (const appRoot of findAppRoots(tree, (root) => tree.exists(`${root}/src/app/app.config.ts`))) {
    const appDir = `${appRoot}/src/app`;
    const appConfigPath = `${appDir}/app.config.ts`;
    if (!tree.exists(appConfigPath)) continue;

    for (const provider of BASELINE_PROVIDERS) {
      if (!tree.exists(`${appDir}/${provider.evidenceFile}`)) continue; // Capability never generated here.
      const existing = findProviderCallSites(tree, `${appRoot}/src`, provider.providerFn);
      // `null` means the compiler API would not load, so "is it wired?" is UNANSWERED — not "no". Wiring
      // on an unanswered question is how a provider gets added twice; skip and report instead.
      if (existing === null) {
        unresolved.push(
          `${appConfigPath} — ${provider.providerFn}() (could not load the TypeScript compiler API to check ` +
            `whether it is already wired; ${provider.symptom})`
        );
        continue;
      }
      if (existing.length > 0) continue; // Already wired somewhere in this app — the project's own choice.

      const before = tree.read(appConfigPath, 'utf8') ?? '';
      const after = wireProvider(before, appConfigPath, {
        providerFn: provider.providerFn,
        importFrom: provider.importFrom,
        // This IS the baseline write — the one the app generator owed and dropped. See the header.
        ensuring: true,
        ...(provider.note ? { note: provider.note() } : {}),
      });
      if (after === null || after === before) {
        unresolved.push(`${appConfigPath} — ${provider.providerFn}() (${provider.symptom})`);
        continue;
      }
      tree.write(appConfigPath, after);
      wired.push(`${appConfigPath} → ${provider.providerFn}()`);
    }
  }

  if (wired.length === 0 && unresolved.length === 0) return; // Nothing was missing — the common case.

  if (wired.length > 0) {
    logger.info(
      `[wire-missing-baseline-providers] Added house providers that the app generator generated files for ` +
        `but never wired: ${wired.join(', ')}. Until now they were dead capabilities — the code was on disk ` +
        `and nothing called it.`
    );
  }
  if (unresolved.length > 0) {
    logger.warn(
      `[wire-missing-baseline-providers] Could not wire these automatically (the app config's shape was not ` +
        `recognised — it must declare \`export const appConfig\` with a \`providers\` array):\n` +
        unresolved.map((u) => `  • ${u}`).join('\n') +
        `\n  Add the call to your providers array by hand, importing it from the file named beside it.`
    );
  }

  await formatFiles(tree);
}
