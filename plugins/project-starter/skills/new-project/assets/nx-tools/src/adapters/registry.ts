// THE ADAPTER REGISTRY — which stacks the house generators can build with, and the ONE way to ask
// "which stack owns this project?" and "can its app take this capability?".
//
// Registration order is precedence: the most specific stack first. A project is owned by the first adapter
// that claims it — an Angular library built by @nx/angular is Angular, not "plain TS".
//
// To add a stack (React/Vite, say): write `adapters/<id>.ts` implementing the ports it can honour, register it
// here, and register its layer. (Which of these stacks a WORKSPACE wears is `./workspace` — kept out of this
// module so it never imports the layer registry, which imports it.) Every capability then attaches to its apps through those ports — no capability
// generator changes, because none of them names a framework.
import { type Tree, getProjects, logger } from '@nx/devkit';
import type { StackAdapter } from './stack-adapter';
import { angular } from './angular';
import { js } from './js';

export type { StackAdapter } from './stack-adapter';

export const ADAPTERS: readonly StackAdapter[] = [angular, js];

/** The ports a capability can ask an app's adapter for. */
export type Port = 'apps' | 'libs' | 'env' | 'providers' | 'styles' | 'devServer' | 'designSystem' | 'firebase';

/** The adapter with this id. Throws on an unknown id — a typo is a bug, and the message lists what exists. */
export function adapter(id: string): StackAdapter {
  const found = ADAPTERS.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Unknown stack "${id}". Known stacks: ${ADAPTERS.map((a) => a.id).join(', ')}.`);
  return found;
}

/** The stack that owns this project, or null (a project no registered stack builds — Python, Go, a script). */
export function adapterOf(tree: Tree, project: string): StackAdapter | null {
  return (
    ADAPTERS.find((candidate) => safely(() => candidate.ownsProject(tree, project), false, `asking the ${candidate.id} stack whether it owns \`${project}\``)) ??
    null
  );
}

/** Is this project an application? (`projectType` is what Nx itself means by it.) */
export function isApplication(tree: Tree, project: string): boolean {
  // An unknown project is an ordinary "no", not an error — only an unreadable workspace is worth reporting.
  return safely(() => getProjects(tree).get(project)?.projectType === 'application', false, `reading \`${project}\``);
}

/**
 * `port` of the stack that owns this app — or null, REPORTED. A capability calls this to attach to an app; a
 * missing port is a sentence, never a crash, and the capability still does its framework-neutral part.
 *
 * @param capability who is asking (the generator name, for the report).
 * @param what       what the port was needed for (the rest of the sentence).
 */
export function portOf<P extends Port>(
  tree: Tree,
  project: string,
  port: P,
  capability: string,
  what: string,
): NonNullable<StackAdapter[P]> | null {
  const owner = adapterOf(tree, project);
  const found = owner?.[port];
  if (found) return found as NonNullable<StackAdapter[P]>;
  logger.warn(
    `[${capability}] Skipped ${what} for \`${project}\`: ` +
      (owner
        ? `its stack (${owner.id}) has no \`${port}\` port.`
        : `no registered stack builds it (known: ${ADAPTERS.map((a) => a.id).join(', ')}).`) +
      ` The framework-neutral part was still applied.`,
  );
  return null;
}

/**
 * Every APPLICATION whose stack has `port` — the apps a capability can attach to, found without reporting the
 * ones it can't (e.g. Cloud Functions, a Node app, is an application with no stylesheet: not a gap, just not a
 * consumer). Never throws: an unreadable workspace has no apps.
 */
export function applicationsWith<P extends Port>(
  tree: Tree,
  port: P,
): Array<{ project: string; adapter: StackAdapter; port: NonNullable<StackAdapter[P]> }> {
  const found: Array<{ project: string; adapter: StackAdapter; port: NonNullable<StackAdapter[P]> }> = [];
  for (const project of safely(() => [...getProjects(tree).keys()], [] as string[], 'listing the projects')) {
    if (!isApplication(tree, project)) continue;
    const owner = adapterOf(tree, project);
    const value = owner?.[port];
    if (owner && value) found.push({ project, adapter: owner, port: value as NonNullable<StackAdapter[P]> });
  }
  return found;
}

/**
 * A read that must never take a generator down — an unreadable project config degrades to `fallback` — but is
 * never SILENT about it either: "could not tell" is reported (once per distinct cause), so a malformed
 * project.json shows up as the reason a capability skipped an app instead of as an unexplained skip.
 */
function safely<T>(read: () => T, fallback: T, what: string): T {
  try {
    return read();
  } catch (error) {
    reportOnce(`[adapters] Could not finish ${what}: ${error instanceof Error ? error.message : String(error)} — treating it as absent.`);
    return fallback;
  }
}

const reported = new Set<string>();
function reportOnce(message: string): void {
  if (reported.has(message)) return;
  reported.add(message);
  logger.warn(message);
}
