// 0.50.0 — the house-targets record is born: what the house last wrote into each house project's targets.
//
// WHY. From 0.50.0 house targets merge three-way against `.bespunky/house-targets.json` (generators/_utils/
// house-targets.ts), so a project's edits inside a house target survive upgrades and the house can still change and
// drop its own values. A project coming from before 0.50.0 has no record — and a merge without a base cannot tell a
// hand edit from an older house value: it would keep every key the house has since dropped as "the project's", and
// put back every set member the project removed. Before 0.50.0 nothing recorded what the house wrote, but the house
// WROTE THE SAME THING into every project (house targets were replaced whole on every upgrade): 0.49.2's output,
// frozen in ./house-targets-0.49.2.ts. That is the base this rung records, once — and only where it is PROVEN:
//
//   - a key whose value in the project still equals what 0.49.2 wrote is recorded (it is the house's own);
//   - a key that differs is left out, so the generator's merge treats it as UNKNOWN and reports it rather than
//     guess (an edit, or an older release's value — the record cannot say);
//   - a set (`inputs`, `outputs`, `dependsOn`) is recorded whole when the project still has every member 0.49.2
//     wrote (its extra members are its own additions); with one missing, it is left out — a removal by hand and an
//     older release that never wrote that member look alike, so the merge reports what it puts back;
//   - a target the project has and 0.49.2 wrote is always recorded (at least as `{}`): the house wrote it, so it
//     is never mistaken for a target of the project's own. A target 0.49.2 did NOT write (`firebase:deploy` is new
//     in 0.50.0) is not recorded — one the project already defines is its own, and stays so.
//
// Each house project is found the way its generator finds it (canonical root, else name), and the frozen values are
// rendered for where it actually lives (the capture was made in the apps/ layout). Writes nothing when a record
// already exists — from then on the record is the generators', and a guess must never overwrite it — and nothing for
// a house project that is absent.
import { type Tree, type TargetConfiguration, logger, readProjectConfiguration } from '@nx/devkit';
import { houseProjectHome } from '../../generators/_utils/project-files';
import { resolveAppsDir } from '../../generators/_utils/workspace-layout';
import { HOUSE_TARGETS_RECORD, SET_KEYS, type Targets, isPlainObject, recordHouseTargets, same } from '../../generators/_utils/house-targets';
import { CAPTURED, HOUSE_TARGETS_AS_OF_0_49_2 } from './house-targets-0.49.2';

const TAG = '[migrate 0.50.0 record-house-targets]';

type Json = unknown;

export default function recordHouseTargetsRung(tree: Tree): void {
  if (tree.exists(HOUSE_TARGETS_RECORD)) return;
  const appsDir = resolveAppsDir(tree);
  const canonicalRoots: Record<string, string> = {
    functions: `${appsDir}/functions`,
    firebase: 'firebase',
    'shared-browser': 'tools/shared-browser',
    'worktree-domains': 'tools/worktree-domains',
  };
  const functions = houseProjectHome(tree, 'functions', canonicalRoots.functions);
  const render = renderFor(functions.root, functions.name);
  const recorded: string[] = [];
  for (const [canonical, baseline] of Object.entries(HOUSE_TARGETS_AS_OF_0_49_2)) {
    const home = houseProjectHome(tree, canonical, canonicalRoots[canonical] ?? canonical);
    if (!home.exists) continue;
    let current: Targets;
    try {
      current = readProjectConfiguration(tree, home.name).targets ?? {};
    } catch {
      continue;
    }
    const proven: Targets = {};
    for (const [name, wrote] of Object.entries(render(baseline) as Targets)) {
      if (!isPlainObject(current[name])) continue;
      proven[name] = provenTarget(current[name] as Record<string, Json>, wrote as Record<string, Json>) as TargetConfiguration;
    }
    recordHouseTargets(tree, canonical, { project: home.name, root: home.root }, proven);
    recorded.push(home.name);
  }
  if (recorded.length) {
    logger.info(
      `${TAG} wrote .bespunky/house-targets.json for ${recorded.join(', ')}: what the house last wrote into their targets ` +
        '(0.49.2), where your targets still hold it — so upgrades from now on keep your edits to house targets and ' +
        'report any value they replace. Commit it.',
    );
  }
}

/** The frozen values, rendered for where the functions project lives and what it is called. */
function renderFor(functionsRoot: string, functionsName: string): (value: Json) => Json {
  const render = (value: Json, key?: string): Json => {
    if (typeof value === 'string') return value.split(CAPTURED.functionsRoot).join(functionsRoot);
    if (Array.isArray(value)) {
      return value.map((item) => (key === 'projects' && item === CAPTURED.functionsName ? functionsName : render(item)));
    }
    if (isPlainObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, render(v, k)]));
    return value;
  };
  return (value) => render(value);
}

/** What of `wrote` the project's target still holds (see the header) — `{}` at least. */
function provenTarget(current: Record<string, Json>, wrote: Record<string, Json>): Record<string, Json> {
  const out: Record<string, Json> = {};
  for (const [key, value] of Object.entries(wrote)) {
    if (SET_KEYS.has(key) && Array.isArray(value)) {
      const mine = current[key];
      if (Array.isArray(mine) && value.every((member) => mine.some((item) => same(item, member)))) out[key] = value;
      continue;
    }
    const kept = proven(current[key], value);
    if (kept !== undefined) out[key] = kept;
  }
  return out;
}

function proven(current: Json, wrote: Json): Json {
  if (isPlainObject(current) && isPlainObject(wrote)) {
    const out: Record<string, Json> = {};
    for (const [key, value] of Object.entries(wrote)) {
      const kept = proven(current[key], value);
      if (kept !== undefined) out[key] = kept;
    }
    return Object.keys(out).length || !Object.keys(wrote).length ? out : undefined;
  }
  return same(current, wrote) ? wrote : undefined;
}
