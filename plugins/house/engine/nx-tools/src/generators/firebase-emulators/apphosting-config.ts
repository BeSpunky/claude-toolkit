// Where Firebase App Hosting finds a backend's `apphosting*.yaml` — the ONE rule, modelled once.
//
// App Hosting's builder (GoogleCloudPlatform/buildpacks, `filesystem.DetectAppHostingYAMLPath`) starts at the
// backend's Root Directory and walks UP towards the repository root, stopping at the FIRST directory that holds
// any file matching `apphosting(.<env>)?.yaml`. The environment override (`apphosting.<env>.yaml`, chosen by the
// backend's Environment name) is then read BESIDE the base file it found — never anywhere else. Two consequences
// every caller here acts on:
//   - the house seed at the workspace root IS read by a backend rooted at `<appsDir>/<app>` (walk-up), and
//   - any `apphosting*.yaml` nearer to that root (say `<appsDir>/<app>/apphosting.yaml`) SHADOWS the root files
//     entirely — silently: the root `apphosting.staging.yaml` stops applying with no error anywhere.
// So the seed goes to whichever directory is ALREADY effective for the client app (never creating a second,
// shadowed home), and a shadowed one is reported on every run.
import { type Tree, getProjects } from '@nx/devkit';
import { posix } from 'node:path';

/** firebase-tools' and the builder's own pattern (`APPHOSTING_YAML_FILE_REGEX`). */
export const APPHOSTING_YAML = /^apphosting(\.[a-z0-9_]+)?\.yaml$/;

/** The `apphosting*.yaml` files directly in `dir` (`'.'` is the workspace root), sorted. */
export function appHostingFilesIn(tree: Tree, dir: string): string[] {
  return tree.children(dir === '.' ? '' : dir).filter((f) => APPHOSTING_YAML.test(f) && tree.isFile(join(dir, f))).sort();
}

/** `dir` and every directory above it, nearest first, ending at the workspace root (`'.'`). */
export function selfAndAncestors(dir: string): string[] {
  const out: string[] = [];
  let current = posix.normalize(dir || '.').replace(/\/+$/, '') || '.';
  for (;;) {
    out.push(current);
    if (current === '.') return out;
    const parent = posix.dirname(current);
    current = parent === '' ? '.' : parent;
  }
}

/** The directory App Hosting reads config from for a backend rooted at `rootDir`, or `undefined` when none has any. */
export function effectiveAppHostingDir(tree: Tree, rootDir: string): string | undefined {
  return selfAndAncestors(rootDir).find((dir) => appHostingFilesIn(tree, dir).length > 0);
}

export interface ShadowedAppHostingConfig {
  /** The directory whose files a backend rooted at or below `by` never reads. */
  shadowed: string;
  shadowedFiles: string[];
  /** The nearer directory that wins. */
  by: string;
  byFiles: string[];
}

/**
 * Every pair (nearer dir, farther dir) where both hold `apphosting*.yaml` and the nearer one sits on the walk-up
 * path of a project root — i.e. a backend rooted at that project would read the nearer files and silently ignore
 * the farther ones. Candidate roots are the workspace's projects (where a backend's Root Directory points).
 */
export function shadowedAppHostingConfigs(tree: Tree): ShadowedAppHostingConfig[] {
  const found = new Map<string, ShadowedAppHostingConfig>();
  for (const [, project] of getProjects(tree)) {
    const chain = selfAndAncestors(project.root).filter((dir) => appHostingFilesIn(tree, dir).length > 0);
    // chain[0] wins for a backend rooted here; every other entry is shadowed by it.
    for (const shadowed of chain.slice(1)) {
      const key = `${chain[0]}→${shadowed}`;
      if (!found.has(key)) {
        found.set(key, { shadowed, shadowedFiles: appHostingFilesIn(tree, shadowed), by: chain[0], byFiles: appHostingFilesIn(tree, chain[0]) });
      }
    }
  }
  return [...found.values()];
}

/** The one-paragraph explanation of a shadowed home, shared by the generator's warning and the migration's report. */
export function describeShadow(s: ShadowedAppHostingConfig): string {
  const at = (dir: string, files: string[]) => files.map((f) => join(dir, f)).join(', ');
  return (
    `${at(s.by, s.byFiles)} SHADOW ${at(s.shadowed, s.shadowedFiles)}: App Hosting walks up from a backend's Root ` +
    `Directory and reads only the NEAREST directory holding any apphosting*.yaml (the environment override included), ` +
    `so a backend rooted at or below ${s.by === '.' ? 'the workspace root' : s.by} never sees the ${s.shadowed === '.' ? 'root' : s.shadowed} ` +
    `files. Keep ONE home per backend: fold what you still need into ${s.by === '.' ? 'the root files' : s.by} and delete the other copy.`
  );
}

function join(dir: string, file: string): string {
  return dir === '.' ? file : `${dir}/${file}`;
}
