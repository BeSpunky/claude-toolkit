// 0.50.0 — recompose the two pre-0.3.0 serve shapes the 0.24.0/0.24.1 rungs left half-migrated.
//
// WHY. 0.24.0 (unify-serve-targets) found the app's dev-server only under `dev-server` or a legacy SIBLING name, and
// promoted it wholesale; 0.24.1 (relocate-emulator-targets) moved `emulators*` onto the `firebase` project and retired
// the `no-emulators` build variant. Two shapes that shipped carry what those rungs keyed on without the rest:
//   - e76c12a (2026-06-02 → 06-25): `serve` IS the Angular dev-server, `continuous`, `dependsOn: ['emulators']`, with
//     the `emulators*` targets on the app. 0.24.0 found no dev-server to promote (it is not a sibling), 0.24.1 moved
//     `emulators` away — leaving `serve` a bare dev-server whose `dependsOn` names a target the project no longer has.
//     Nx drops it, so `nx serve <app>` starts the app WITHOUT the emulator suite, against an emulator-wired env, and
//     with no composer every later serve rung (0.35.0's dev.json declaration among them) passed it by.
//   - 703ca41 (2026-06-25, ~2h): `serve-no-emulators` with `defaultConfiguration: 'no-emulators'`. 0.24.0 promoted it to
//     `dev-server` with that default; 0.24.1 re-pointed the configuration's buildTarget to `<app>:build` (its default:
//     production) but kept it the default — so the dev-server serves a PRODUCTION build.
// The per-app `serve` generator heals both, but only for the app an upgrade resolves; a multi-app workspace, or an
// UPGRADE_PARTIAL run, never reached the others. Every ladder that collects 0.24.0/0.24.1 also collects this rung (the
// payload is 0.50.0), so the repair lives here once rather than in two frozen rungs.
//
// WHAT IT CHANGES, per project carrying one of the two leftovers: drops the dangling `emulators*` dependsOn / the
// retired `no-emulators` configuration (the default falls back to `development`, else to none), then runs the `serve`
// generator for the project — the same per-app step an upgrade runs: `dev-server` leaf + `dev-stack` composer (+ its `serve` follower) + its
// `.bespunky/dev.json` entry, in the current shape. Nothing else is looked at.
import { type Tree, getProjects, logger, updateProjectConfiguration } from '@nx/devkit';
import serveGenerator from '../../generators/serve/generator';

const TAG = '[migrate 0.50.0 recompose-pre-0.3-serve-leftovers]';
const SERVE_EXECUTOR = '@bespunky/nx-tools:serve';
const RETIRED_CONFIGURATION = 'no-emulators';
const isEmulatorTarget = (name: unknown) => typeof name === 'string' && /^emulators(:[a-z]+)?$/.test(name);

type Target = {
  executor?: string;
  dependsOn?: unknown[];
  configurations?: Record<string, unknown>;
  defaultConfiguration?: string;
};

export default async function recomposePre03ServeLeftovers(tree: Tree): Promise<void> {
  const leftovers: string[] = [];
  for (const [name, config] of getProjects(tree)) {
    const targets = (config.targets ?? {}) as Record<string, Target>;
    let found = false;

    // e76c12a: a non-composer `serve` (no `dev-server` beside it) depending on an emulator target the project lacks.
    const serve = targets.serve;
    if (!targets['dev-server'] && serve && typeof serve === 'object' && serve.executor !== SERVE_EXECUTOR && Array.isArray(serve.dependsOn)) {
      const dangling = (entry: unknown) => {
        const target = typeof entry === 'string' ? entry : (entry as { target?: unknown; projects?: unknown })?.projects === undefined ? (entry as { target?: unknown })?.target : undefined;
        return isEmulatorTarget(target) && !(target as string in targets);
      };
      if (serve.dependsOn.some(dangling)) {
        serve.dependsOn = serve.dependsOn.filter((entry) => !dangling(entry));
        if (!serve.dependsOn.length) delete serve.dependsOn;
        found = true;
      }
    }

    // 703ca41: the retired configuration still the dev-server's default.
    const leaf = targets['dev-server'];
    if (leaf && typeof leaf === 'object' && leaf.defaultConfiguration === RETIRED_CONFIGURATION) {
      delete leaf.configurations?.[RETIRED_CONFIGURATION];
      if (leaf.configurations && 'development' in leaf.configurations) leaf.defaultConfiguration = 'development';
      else delete leaf.defaultConfiguration;
      found = true;
    }

    if (!found) continue;
    updateProjectConfiguration(tree, name, config);
    leftovers.push(name);
  }

  for (const project of leftovers) {
    try {
      await serveGenerator(tree, { project });
      logger.info(
        `${TAG} ${project}: recomposed its serve targets — a pre-0.3.0 shape (a dev-server on \`serve\` depending on the ` +
          `relocated \`emulators\`, or the retired \`no-emulators\` default) that 0.24.0/0.24.1 left half-migrated. ` +
          `\`nx serve ${project}\` now runs the declared stack again.`,
      );
    } catch (error) {
      logger.warn(
        `${TAG} ${project}: removed a pre-0.3.0 leftover (a dangling \`emulators\` dependsOn, or the retired ` +
          `\`no-emulators\` default), but could not compose its serve targets (${(error as Error).message}). Run ` +
          `\`nx g @bespunky/nx-tools:serve --project=${project}\`.`,
      );
    }
  }
}
