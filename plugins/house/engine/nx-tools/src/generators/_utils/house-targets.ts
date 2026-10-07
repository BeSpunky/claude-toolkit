// HOUSE TARGETS ARE SHARED GROUND — the house writes them, and the project is entitled to extend them.
//
// A house project's targets (`functions:build`, `functions:deploy`, `firebase:emulators`, …) are re-asserted on
// every upgrade. They used to be REPLACED WHOLE: a developer (or Claude) who added an input, an `args` option or a
// `configurations` entry to `functions:deploy` lost it on the next upgrade — silently, so the fix was then re-made
// by hand, and lost again. The opposite answer, "merge, and keep whatever is there", is no better: the house could
// then never change or drop a value it once wrote, because yesterday's house value and today's hand edit look
// identical in the file.
//
// The missing concept was PROVENANCE: what the house wrote last time. With it, every upgrade is a THREE-WAY MERGE —
// the same one git does — per key, between
//
//   base    what the house last wrote (the record, `.bespunky/house-targets.json`, committed beside the project)
//   theirs  what the project's file holds now
//   ours    what the house writes today
//
// and every outcome follows from that:
//   - a key nobody touched follows the house (changed, added, or — when the house drops it — removed);
//   - a key the PROJECT changed, and the house did not, keeps the project's value, upgrade after upgrade;
//   - a key BOTH changed takes the house's value — a house change is usually a fix the project needs — and the
//     upgrade SAYS SO, with the value it replaced, so a hand edit is never lost silently;
//   - a key the project ADDED (an option, a configuration, an input) is the project's: kept;
//   - `inputs` / `outputs` / `dependsOn` are SETS: the project's additions are kept, its removals honoured, and an
//     entry the house newly adds arrives anyway.
// Without a record (a project from before this mechanism, or a renamed project) the base is unknown: house-declared
// keys take the house's value — and where that replaces a different one, the upgrade says so, because it cannot
// tell a hand edit from an older house value — while keys the house does not declare are kept. From then on the
// record exists.
//
// What this does NOT do: remove a whole target the house stopped shipping (still a migration's job — the project
// may run it), or let a project delete a house target (the next upgrade re-adds it: targets are the house's
// contract; a key inside one is the extension point).
import { type Tree, type TargetConfiguration, readJson, writeJson } from '@nx/devkit';

/** The provenance record — what the house last wrote into each house project's targets. */
export const HOUSE_TARGETS_RECORD = '.bespunky/house-targets.json';

type Json = unknown;
type Targets = Record<string, TargetConfiguration>;

interface Record_ {
  '//'?: string;
  projects?: Record<string, Targets>;
}

const NOTE =
  'Written by the house generators on every upgrade: what each house-owned target looked like when the house last ' +
  'wrote it, so an upgrade can tell your edits to those targets from its own (your edits survive unless the house ' +
  'changes the same key, which the upgrade reports). Commit it; never edit it.';

/** One value the merge replaced — reported, never silent. */
export interface TargetOverride {
  target: string;
  /** Dotted path inside the target (`options.command`). */
  key: string;
  /** What the project's file held. */
  was: Json;
  /** What the house wrote instead. */
  now: Json;
  /** true: the project changed it AND the house changed it (a real conflict); false: there was no record to tell. */
  conflict: boolean;
}

/** Top-level target keys whose arrays are sets — merged element-wise, not replaced. */
const SET_KEYS = new Set(['inputs', 'outputs', 'dependsOn']);

/** What the house last wrote into `project`'s targets (undefined: no record). */
export function recordedHouseTargets(tree: Tree, project: string): Targets | undefined {
  if (!tree.exists(HOUSE_TARGETS_RECORD)) return undefined;
  try {
    return readJson<Record_>(tree, HOUSE_TARGETS_RECORD).projects?.[project];
  } catch {
    return undefined; // an unreadable record is no record — the merge degrades to "house keys win, said aloud"
  }
}

/** The house projects the record knows — the projects whose targets the house writes (sorted; none: no record). */
export function recordedHouseProjects(tree: Tree): string[] {
  if (!tree.exists(HOUSE_TARGETS_RECORD)) return [];
  try {
    return Object.keys(readJson<Record_>(tree, HOUSE_TARGETS_RECORD).projects ?? {}).sort();
  } catch {
    return [];
  }
}

/** Record what the house wrote into `project`'s targets this run. Writes only when it changed (idempotence). */
export function recordHouseTargets(tree: Tree, project: string, targets: Targets): void {
  let record: Record_ = {};
  if (tree.exists(HOUSE_TARGETS_RECORD)) {
    try {
      record = readJson<Record_>(tree, HOUSE_TARGETS_RECORD);
    } catch {
      record = {};
    }
  }
  if (same(record.projects?.[project], targets) && record['//'] === NOTE) return;
  const projects = { ...(record.projects ?? {}), [project]: targets };
  writeJson(tree, HOUSE_TARGETS_RECORD, {
    '//': NOTE,
    projects: Object.fromEntries(Object.keys(projects).sort().map((name) => [name, projects[name]])),
  });
}

/**
 * Merge the house's `owned` targets into the project's `current` ones (see the header). Targets the house does not
 * own are untouched. Returns the merged target map and every value the merge replaced.
 */
export function mergeHouseTargets(
  current: Targets | undefined,
  owned: Targets,
  recorded: Targets | undefined,
  /**
   * With no record: what the last record-less release wrote (./house-targets-0.49.2.ts). Not a record — it never
   * decides a removal or a set merge — only proof that a value is the house's own, so replacing it is not news.
   */
  before?: Targets,
): { targets: Targets; overrides: TargetOverride[] } {
  const overrides: TargetOverride[] = [];
  const targets: Targets = { ...(current ?? {}) };
  for (const [name, ours] of Object.entries(owned)) {
    const theirs = current?.[name];
    // A house target the project deleted (or never had) comes back whole: the target is the house's contract.
    if (theirs === undefined || !isPlainObject(theirs)) {
      targets[name] = clone(ours);
      continue;
    }
    const base = recorded ? recorded[name] : before?.[name];
    targets[name] = mergeObject(base, theirs, ours, recorded !== undefined, [], (key, was, now, conflict) =>
      overrides.push({ target: name, key, was, now, conflict }),
    ) as TargetConfiguration;
  }
  return { targets, overrides };
}

type Report = (key: string, was: Json, now: Json, conflict: boolean) => void;

function mergeObject(base: Json, theirs: Record<string, Json>, ours: Record<string, Json>, hasRecord: boolean, path: string[], report: Report): Json {
  const baseObj = isPlainObject(base) ? base : undefined;
  const out: Record<string, Json> = {};
  // The project's key order first — an upgrade that only reorders a file is a diff nobody asked for.
  const keys = [...new Set([...Object.keys(theirs), ...Object.keys(ours), ...Object.keys(baseObj ?? {})])];
  for (const key of keys) {
    const merged = mergeValue(baseObj?.[key], theirs[key], ours[key], hasRecord, [...path, key], report);
    if (merged !== undefined) out[key] = merged;
  }
  return out;
}

function mergeValue(base: Json, theirs: Json, ours: Json, hasRecord: boolean, path: string[], report: Report): Json {
  const key = path.join('.');
  // The house does not declare this key.
  if (ours === undefined) {
    if (theirs === undefined) return undefined;
    // It once did, and the project left it as written → the house dropped it, so it goes.
    if (hasRecord && base !== undefined && same(theirs, base)) return undefined;
    return clone(theirs); // the project's own key (or its edit of one the house has since dropped)
  }
  // The project does not have it.
  if (theirs === undefined) {
    // It removed a key the house still writes unchanged → its removal holds. Otherwise the house's value arrives.
    if (hasRecord && base !== undefined && same(ours, base)) return undefined;
    return clone(ours);
  }
  if (isPlainObject(ours) && isPlainObject(theirs)) return mergeObject(base, theirs, ours, hasRecord, path, report);
  if (path.length === 1 && SET_KEYS.has(path[0]) && Array.isArray(ours) && Array.isArray(theirs)) {
    return mergeSet(Array.isArray(base) && hasRecord ? base : [], theirs, ours);
  }
  // A scalar (or an array that is one value — `commands`, `format`). Equal in meaning → the project's own form.
  if (same(theirs, ours)) return clone(theirs);
  if (hasRecord && base !== undefined) {
    if (same(theirs, base)) return clone(ours); // the house's own previous value — follows the house
    if (same(ours, base)) return clone(theirs); // the project's edit, and the house did not change it — kept
    report(key, theirs, ours, true); // both changed it — the house's wins, said aloud
    return clone(ours);
  }
  // No record. A value the last record-less release wrote is the house's own: replaced, and nothing to report.
  if (base !== undefined && same(theirs, base)) return clone(ours);
  report(key, theirs, ours, false); // otherwise an edit and an older house value look alike — said aloud
  return clone(ours);
}

/**
 * Set merge: the house's entries, minus those the project removed, plus those the project added — in the PROJECT's
 * order and in its own form (a member equal in meaning is the project's copy), the house's arrivals appended.
 */
function mergeSet(base: Json[], theirs: Json[], ours: Json[]): Json[] {
  const has = (list: Json[], item: Json) => list.some((other) => same(other, item));
  const removedByProject = base.filter((item) => !has(theirs, item));
  // The project's entries the house still declares, or that the house never declared (the project's additions);
  // one the house wrote before (in the record) and has since dropped goes.
  const kept = theirs.filter((item) => has(ours, item) || !has(base, item));
  const arriving = ours.filter((item) => !has(theirs, item) && !has(removedByProject, item));
  return [...kept, ...arriving].map(clone);
}

function isPlainObject(value: Json): value is Record<string, Json> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Structural equality, insensitive to object key order (JSON values only). */
function same(a: Json, b: Json): boolean {
  return canonical(a) === canonical(b);
}

function canonical(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

/** One human line per override — what was replaced, with what, and how to keep an edit. */
export function describeOverride(project: string, o: TargetOverride): string {
  const show = (v: Json) => JSON.stringify(v);
  return o.conflict
    ? `${project}:${o.target} — ${o.key}: your ${show(o.was)} was replaced by the house's new ${show(o.now)} (you and ` +
        `the house both changed it). Re-apply your edit if you still need it — it will then survive upgrades.`
    : `${project}:${o.target} — ${o.key} was ${show(o.was)}; the house's value is ${show(o.now)}. There was no record of ` +
        `what the house wrote before (${HOUSE_TARGETS_RECORD}), so an edit and an older house value look alike — if ` +
        `it was your edit, re-apply it: from now on it survives upgrades.`;
}
