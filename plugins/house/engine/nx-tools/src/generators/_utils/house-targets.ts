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
//     upgrade REPORTS it, with the value it replaced, in its final summary (UPGRADE_ATTENTION), never only in a log;
//   - a key the project ADDED (an option, a configuration, an input) is the project's: kept;
//   - `inputs` / `outputs` / `dependsOn` are SETS: the project's additions are kept, its removals honoured, and an
//     entry the house newly adds arrives anyway;
//   - WHAT A TARGET RUNS — `executor` with run-commands' `options.command` / `options.commands` — is ONE value, never
//     three keys: Nx lets `command` win over `commands`, so merging them separately let a house `command` arrive
//     beside the project's `commands` and silently replace what the target ran. And when the project runs its own
//     executor, the house's options (written for another executor) are not merged into it.
//
// TWO THINGS ARE NOT ORDINARY KEYS.
//   - A TARGET THE HOUSE INTRODUCES that the project already defines (a hand-made `firebase:deploy` before the house
//     shipped one; any target name a later release adds) is the PROJECT'S, whole: kept as it is, reported on every
//     upgrade, and left out of the record — the house never wrote it, so nothing in it is the house's to merge.
//     Delete it (or rename it) to take the house's.
//   - THE CONTRACT: the few values other machinery relies on (`nx affected -t deploy` relies on a deploy never being
//     cached, never running beside another task, and building what it ships). The generator names them; they are
//     re-asserted on every upgrade, and a project value that differed is reported.
//
// PROVENANCE has three states, and each is a different answer:
//   recorded  the record holds what the house last wrote here — the three-way merge above;
//   never     the record exists and names no such house project: the house never wrote to it (the project made a
//             project of that name itself) — every house target it already defines is the project's own (above);
//   unknown   there is no readable record at all (deleted, or a generator run that skipped the upgrade's migration
//             ladder, whose 0.50.0 rung writes the first record): house-declared keys take the house's value, and
//             every difference — a replaced value, a set member added back — is reported, because an edit and an
//             older house value cannot be told apart.
//
// What this does NOT do: remove a whole target the house stopped shipping (still a migration's job — the project
// may run it), or let a project delete a house target (the next upgrade re-adds it: targets are the house's
// contract; a key inside one is the extension point).
import { type Tree, type TargetConfiguration, getProjects, readJson, writeJson } from '@nx/devkit';

/** The provenance record — what the house last wrote into each house project's targets. */
export const HOUSE_TARGETS_RECORD = '.bespunky/house-targets.json';

type Json = unknown;
export type Targets = Record<string, TargetConfiguration>;

/** One house project in the record, keyed by its CANONICAL house name — so a rename or a move keeps its provenance. */
interface Entry {
  /** Its Nx project name now. */
  project: string;
  /** Its workspace-relative root now. */
  root: string;
  /** What the house wrote into its targets. */
  targets: Targets;
}

interface Record_ {
  '//'?: string;
  projects?: Record<string, Entry>;
}

const NOTE =
  'Written by the house generators on every upgrade: what each house-owned target looked like when the house last ' +
  'wrote it, so an upgrade can tell your edits to those targets from its own (your edits survive unless the house ' +
  'changes the same key, which the upgrade reports). Commit it; never edit it. On a merge conflict, keep either ' +
  'side (prefer the one from the newer upgrade): the worst an older side does is make the next upgrade report a ' +
  'value it already reported.';

/** Top-level target keys whose arrays are sets — merged element-wise, not replaced. */
export const SET_KEYS: ReadonlySet<string> = new Set(['inputs', 'outputs', 'dependsOn']);

/** What the house knows of what it last wrote into one house project (see PROVENANCE in the header). */
export type Provenance = { kind: 'recorded'; targets: Targets } | { kind: 'never' } | { kind: 'unknown' };

/** One finding of the merge — a value the project should look at. Every one is reported, never silent. */
export interface TargetFinding {
  target: string;
  /** Dotted path inside the target (`options.command`), `runs` for what the target runs; absent for a whole target. */
  key?: string;
  /**
   * conflict    the project and the house both changed it — the house's value is in the file now;
   * unknown     no record: the house's value is in the file, and the project's may have been an edit;
   * contract    a value deploys rely on, re-asserted over the project's;
   * own-target  a target the house introduces that the project already defines — the project's is kept, whole.
   */
  kind: 'conflict' | 'unknown' | 'contract' | 'own-target';
  /** What the project's file held. */
  was: Json;
  /** What the house wrote instead (for own-target: what the house would have written). */
  now: Json;
}

/** The values of a target other machinery relies on (THE CONTRACT): top-level keys, a set key's required members. */
export type TargetContract = Record<string, Partial<Record<keyof TargetConfiguration, Json>>>;

function readRecord(tree: Tree): Record_ | undefined {
  if (!tree.exists(HOUSE_TARGETS_RECORD)) return undefined;
  try {
    const record = readJson<Record_>(tree, HOUSE_TARGETS_RECORD);
    return isPlainObject(record) ? record : undefined;
  } catch {
    return undefined; // an unreadable record is no record — provenance unknown, said aloud by the merge
  }
}

/** What the house knows of house project `canonical` (its canonical house name). */
export function houseTargetsProvenance(tree: Tree, canonical: string): Provenance {
  const record = readRecord(tree);
  if (!record) return { kind: 'unknown' };
  const entry = record.projects?.[canonical];
  return isPlainObject(entry) && isPlainObject(entry.targets) ? { kind: 'recorded', targets: entry.targets } : { kind: 'never' };
}

/** The house projects the record knows, by their Nx names now — the projects whose targets the house writes (sorted). */
export function recordedHouseProjects(tree: Tree): string[] {
  const projects = readRecord(tree)?.projects ?? {};
  return [...new Set(Object.values(projects).map((entry) => entry?.project).filter((name): name is string => typeof name === 'string'))].sort();
}

/**
 * Record what the house wrote into house project `canonical` (now `project` at `root`) this run — and prune every
 * entry whose project is gone (neither its name nor its root is a project any more: the layer that owned it was
 * removed). Writes only when something changed (idempotence).
 */
export function recordHouseTargets(tree: Tree, canonical: string, at: { project: string; root: string }, targets: Targets): void {
  const record = readRecord(tree) ?? {};
  const entries: Record<string, Entry> = { ...(record.projects ?? {}), [canonical]: { project: at.project, root: at.root, targets } };
  let live: Map<string, { root: string }> | undefined;
  try {
    live = getProjects(tree);
  } catch {
    live = undefined; // an unreadable graph prunes nothing
  }
  const roots = new Set([...(live?.values() ?? [])].map((project) => project.root));
  const kept = Object.keys(entries)
    .filter((name) => name === canonical || !live || live.has(entries[name]?.project) || roots.has(entries[name]?.root))
    .sort();
  const next: Record_ = { '//': NOTE, projects: Object.fromEntries(kept.map((name) => [name, entries[name]])) };
  if (tree.exists(HOUSE_TARGETS_RECORD) && same(readRecord(tree), next)) return;
  writeJson(tree, HOUSE_TARGETS_RECORD, next);
}

/**
 * Merge the house's `owned` targets into the project's `current` ones (see the header). Targets the house does not
 * own are untouched. Returns the merged target map, every finding, and what to RECORD as the house's writing — the
 * owned targets minus those that stayed the project's own.
 */
export function mergeHouseTargets(
  current: Targets | undefined,
  owned: Targets,
  provenance: Provenance,
  contract: TargetContract = {},
): { targets: Targets; findings: TargetFinding[]; recorded: Targets } {
  const findings: TargetFinding[] = [];
  const targets: Targets = { ...(current ?? {}) };
  const recorded: Targets = {};
  for (const [name, ours] of Object.entries(owned)) {
    const theirs = current?.[name];
    // A house target the project deleted (or never had) comes back whole: the target is the house's contract.
    if (theirs === undefined || !isPlainObject(theirs)) {
      targets[name] = clone(ours);
      recorded[name] = ours;
      continue;
    }
    const introduced = provenance.kind === 'never' || (provenance.kind === 'recorded' && provenance.targets[name] === undefined);
    if (introduced && !same(theirs, ours)) {
      findings.push({ target: name, kind: 'own-target', was: theirs, now: ours });
      continue; // the project's, whole — not merged, not recorded, not held to the contract
    }
    const base = provenance.kind === 'recorded' ? provenance.targets[name] : undefined;
    const report: Report = (key, kind, was, now) => findings.push({ target: name, key, kind, was, now });
    const merged = mergeTarget(base, theirs as Record<string, Json>, ours as Record<string, Json>, provenance.kind === 'recorded', report);
    targets[name] = enforce(merged, contract[name] ?? {}, report) as TargetConfiguration;
    recorded[name] = ours;
  }
  return { targets, findings, recorded };
}

type Report = (key: string, kind: TargetFinding['kind'], was: Json, now: Json) => void;

// WHAT A TARGET RUNS — one value (see the header).
const RUNNER_OPTIONS = ['command', 'commands'] as const;

function runnerOf(target: Json): Record<string, Json> | undefined {
  if (!isPlainObject(target)) return undefined;
  const options = isPlainObject(target.options) ? target.options : {};
  const runner: Record<string, Json> = {};
  if (target.executor !== undefined) runner.executor = target.executor;
  for (const key of RUNNER_OPTIONS) if (options[key] !== undefined) runner[key] = options[key];
  return Object.keys(runner).length ? runner : undefined;
}

function withoutRunner(target: Record<string, Json>): Record<string, Json> {
  const { executor: _executor, ...rest } = target;
  if (!isPlainObject(rest.options)) return rest;
  const options = { ...rest.options };
  for (const key of RUNNER_OPTIONS) delete options[key];
  return { ...rest, options };
}

function mergeTarget(base: Json, theirs: Record<string, Json>, ours: Record<string, Json>, hasBase: boolean, report: Report): Record<string, Json> {
  const runner = decide(runnerOf(base), runnerOf(theirs), runnerOf(ours), hasBase, 'runs', report);
  const baseRest = isPlainObject(base) ? withoutRunner(base) : undefined;
  const merged = mergeObject(baseRest, withoutRunner(theirs), withoutRunner(ours), hasBase, [], report) as Record<string, Json>;
  // The project runs its own executor: the house's options were written for another one, so they stay out of it.
  if (isPlainObject(runner) && runner.executor !== (ours as { executor?: Json }).executor && same(runner, runnerOf(theirs))) {
    merged.options = isPlainObject(theirs.options) ? withoutRunner({ options: theirs.options }).options : undefined;
    if (merged.options === undefined) delete merged.options;
  }
  // Put what it runs back, in the project's key order where it had one.
  const out: Record<string, Json> = {};
  const keys = [...new Set([...Object.keys(theirs), ...Object.keys(merged), 'executor'])];
  for (const key of keys) {
    if (key === 'executor') {
      if (isPlainObject(runner) && runner.executor !== undefined) out.executor = clone(runner.executor);
    } else if (key in merged) out[key] = merged[key];
  }
  const runnerOptions = isPlainObject(runner) ? RUNNER_OPTIONS.filter((key) => runner[key] !== undefined) : [];
  if (runnerOptions.length) {
    const options = isPlainObject(out.options) ? out.options : {};
    const ordered: Record<string, Json> = {};
    for (const key of [...new Set([...Object.keys(isPlainObject(theirs.options) ? theirs.options : {}), ...runnerOptions, ...Object.keys(options)])]) {
      if ((RUNNER_OPTIONS as readonly string[]).includes(key)) {
        if (isPlainObject(runner) && runner[key] !== undefined) ordered[key] = clone(runner[key]);
      } else if (key in options) ordered[key] = options[key];
    }
    out.options = ordered;
  }
  return out;
}

function mergeObject(base: Json, theirs: Record<string, Json>, ours: Record<string, Json>, hasBase: boolean, path: string[], report: Report): Json {
  const baseObj = isPlainObject(base) ? base : undefined;
  const out: Record<string, Json> = {};
  // The project's key order first — an upgrade that only reorders a file is a diff nobody asked for.
  const keys = [...new Set([...Object.keys(theirs), ...Object.keys(ours), ...Object.keys(baseObj ?? {})])];
  for (const key of keys) {
    const merged = mergeValue(baseObj?.[key], theirs[key], ours[key], hasBase, [...path, key], report);
    if (merged !== undefined) out[key] = merged;
  }
  return out;
}

function mergeValue(base: Json, theirs: Json, ours: Json, hasBase: boolean, path: string[], report: Report): Json {
  const key = path.join('.');
  if (isPlainObject(ours) && isPlainObject(theirs)) return mergeObject(base, theirs, ours, hasBase, path, report);
  if (path.length === 1 && SET_KEYS.has(path[0]) && Array.isArray(ours) && (theirs === undefined || Array.isArray(theirs))) {
    // The project removed the whole set the house still writes unchanged → its removal holds.
    if (theirs === undefined && hasBase && base !== undefined) return same(ours, base) ? undefined : clone(ours);
    const mine = (theirs ?? []) as Json[];
    // With a record, the base decides what the project removed; without one nothing is known to be removed, and
    // every member the house puts back is reported — it may be one the project took out.
    const merged = mergeSet(hasBase && Array.isArray(base) ? base : [], mine, ours);
    if (!hasBase && theirs !== undefined && merged.length !== mine.length) report(key, 'unknown', theirs, merged);
    return merged;
  }
  return decide(base, theirs, ours, hasBase, key, report);
}

/** Three-way for one value (a scalar, an array that is one value — `commands`, `format` — or what a target runs). */
function decide(base: Json, theirs: Json, ours: Json, hasBase: boolean, key: string, report: Report): Json {
  if (same(theirs, ours)) return clone(theirs); // equal in meaning → the project's own form
  // The house does not declare it.
  if (ours === undefined) {
    // It once did, and the project left it as written → the house dropped it, so it goes.
    if (hasBase && base !== undefined && same(theirs, base)) return undefined;
    return clone(theirs); // the project's own key (or its edit of one the house has since dropped)
  }
  // The project does not have it.
  if (theirs === undefined) {
    if (!hasBase || base === undefined) return clone(ours); // a value the house newly writes — it arrives
    if (same(ours, base)) return undefined; // the project removed it and the house did not change it — removal holds
    report(key, 'conflict', theirs, ours); // the project removed it, the house changed it — the house's arrives
    return clone(ours);
  }
  if (hasBase) {
    if (base !== undefined && same(theirs, base)) return clone(ours); // the house's own previous value — follows the house
    if (base !== undefined && same(ours, base)) return clone(theirs); // the project's edit, the house unchanged — kept
    report(key, 'conflict', theirs, ours); // both changed it (or both introduced it) — the house's wins, said aloud
    return clone(ours);
  }
  report(key, 'unknown', theirs, ours); // no record: an edit and an older house value look alike — said aloud
  return clone(ours);
}

/** Re-assert the contract on a merged target, reporting every project value it replaces. */
function enforce(target: Record<string, Json>, contract: Record<string, Json>, report: Report): Record<string, Json> {
  const out = { ...target };
  for (const [key, value] of Object.entries(contract)) {
    if (SET_KEYS.has(key) && Array.isArray(value)) {
      const have = Array.isArray(out[key]) ? (out[key] as Json[]) : [];
      const missing = value.filter((member) => !have.some((item) => same(item, member)));
      if (!missing.length) continue;
      report(key, 'contract', out[key], [...have, ...missing]);
      out[key] = [...have, ...missing].map(clone);
    } else if (!same(out[key], value)) {
      report(key, 'contract', out[key], value);
      out[key] = clone(value);
    }
  }
  return out;
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

export function isPlainObject(value: Json): value is Record<string, Json> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Structural equality, insensitive to object key order (JSON values only). */
export function same(a: Json, b: Json): boolean {
  return canonical(a) === canonical(b);
}

function canonical(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

/** One human line per finding — what happened, what the project held, and what to do about it. */
export function describeFinding(project: string, f: TargetFinding): string {
  const show = (v: Json) => (v === undefined ? '(nothing)' : JSON.stringify(v));
  const at = `${project}:${f.target}${f.key ? ` — ${f.key}` : ''}`;
  switch (f.kind) {
    case 'conflict':
      return `${at}: your ${show(f.was)} was replaced by the house's new ${show(f.now)} (you and the house both changed it). ` +
        'Re-apply your edit if you still need it — it will then survive upgrades.';
    case 'unknown':
      return `${at} was ${show(f.was)}; the house's value ${show(f.now)} is in place now. There is no record of what the ` +
        `house wrote before (${HOUSE_TARGETS_RECORD}), so an edit and an older house value look alike — if it was your ` +
        'edit, re-apply it: from now on it survives upgrades.';
    case 'contract':
      return `${at}: ${show(f.was)} → ${show(f.now)}. Deploys rely on this value (\`nx affected -t deploy\`, by hand or ` +
        'CI), so every upgrade re-asserts it; extend the target with your own inputs, options or configurations instead.';
    case 'own-target':
      return `${at}: this project already defines a \`${f.target}\` target of its own, so it is KEPT and the house's is ` +
        `not applied (the house's: ${show(f.now)}). To take the house's, delete or rename yours; until then every ` +
        'upgrade says this again.';
  }
}
