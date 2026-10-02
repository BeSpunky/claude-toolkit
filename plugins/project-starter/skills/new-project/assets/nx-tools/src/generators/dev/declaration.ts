// The dev declaration, generator side — reading and SEEDING `.bespunky/dev.json` on a Tree.
//
// The declaration is the project's: what it serves, as data. The engine (tools/dev, written by the `dev`
// generator) reads it; adapters SEED it — each stack or capability the house knows contributes the processes
// it is responsible for (fragments/). Seeding only ever ADDS a process id the app does not have yet; an
// existing process is never rewritten, because the moment it is written it belongs to the project (its
// command, ports and env are exactly what a developer tunes). A later change to a seeded process's shape is a
// migration, like any other project state.
//
// The shape (validated by the engine — tools/dev/lib/declaration.mjs — which is the authority on it):
import type { Tree } from '@nx/devkit';

export const DECLARATION_PATH = '.bespunky/dev.json';

export type DevCmd = string | string[];

export interface DevProcess {
  id: string;
  cmd: DevCmd;
  ports?: Record<string, number>;
  env?: Record<string, string>;
  primary?: boolean;
  ready?: { http: string };
  url?: { param: string; value: string; when?: 'always' | 'offset' | 'running' | 'skipped' }[];
  advice?: { text: string; when?: 'always' | 'base' | 'offset' | 'contended' }[];
}

export interface DevInstall {
  cmd: DevCmd;
  creates?: string;
}

export interface DevDeclaration {
  install?: DevInstall;
  apps: Record<string, { processes: DevProcess[] }>;
}

/** What an adapter contributes for one app: its processes, and (optionally) how a fresh tree is installed. */
export interface DevFragment {
  processes: DevProcess[];
  install?: DevInstall;
  /** Why this fragment contributes nothing, when the reader should hear it — logged with the seed report. */
  skipped?: string;
}

export function readDeclaration(tree: Tree): DevDeclaration | null {
  if (!tree.exists(DECLARATION_PATH)) return null;
  return JSON.parse(tree.read(DECLARATION_PATH, 'utf8') ?? '{}') as DevDeclaration;
}

export function writeDeclaration(tree: Tree, decl: DevDeclaration): void {
  tree.write(DECLARATION_PATH, `${JSON.stringify(decl, null, 2)}\n`);
}

/** One line per thing seeding did or declined to do — the caller logs them. */
export type SeedReport = string[];

/**
 * Add the fragment's processes that app `app` does not declare yet. Never rewrites an existing process.
 *
 * Two rules keep a merged app valid: a contributed process loses `primary` when the app already has one (the
 * project chose its primary), and a process whose port NAME is already taken in the app is not added (the
 * names are the app's substitution namespace) — it is reported instead, so the conflict is visible.
 */
export function seedApp(tree: Tree, app: string, fragment: DevFragment): SeedReport {
  const report: SeedReport = fragment.skipped ? [fragment.skipped] : [];
  if (fragment.processes.length === 0 && !fragment.install) return report;

  const decl: DevDeclaration = readDeclaration(tree) ?? { apps: {} };
  decl.apps ??= {};
  if (!decl.install && fragment.install) {
    decl.install = fragment.install;
    report.push(`declared the install step: ${[fragment.install.cmd].flat().join(' ')}`);
  }

  const entry = (decl.apps[app] ??= { processes: [] });
  entry.processes ??= [];
  const ids = new Set(entry.processes.map((p) => p.id));
  const portNames = new Set(entry.processes.flatMap((p) => Object.keys(p.ports ?? {})));
  let hasPrimary = entry.processes.some((p) => p.primary);

  for (const contributed of fragment.processes) {
    if (ids.has(contributed.id)) continue;
    const clash = Object.keys(contributed.ports ?? {}).filter((name) => portNames.has(name));
    if (clash.length) {
      report.push(
        `NOT declaring process "${contributed.id}" for ${app}: its port name(s) ${clash.join(', ')} are already used ` +
          `by another process of the app. Declare it by hand under a different port name.`,
      );
      continue;
    }
    const process: DevProcess = { ...contributed };
    if (process.primary && hasPrimary) delete process.primary;
    hasPrimary ||= Boolean(process.primary);
    entry.processes.push(process);
    ids.add(process.id);
    Object.keys(process.ports ?? {}).forEach((name) => portNames.add(name));
    report.push(`declared process "${process.id}" for ${app}`);
  }

  if (entry.processes.length === 0) delete decl.apps[app];
  if (report.length) writeDeclaration(tree, decl);
  return report;
}
