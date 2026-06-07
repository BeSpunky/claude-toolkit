// House generator: mark an existing Nx library as a reusable-tool extraction candidate.
//
// What it does — the MARKING, not the abstraction:
//   1. Adds the `reusable-tool:extraction-candidate` tag to the library's project config.
//   2. Writes an `extraction.json` marker next to the library's project.json, capturing the
//      metadata the host-side `extract-tool` needs to lift it into the shared @bespunky
//      workspace later (proposed package name, kind, declared deps, and the installed ranges
//      of well-known frameworks so the published package can track their major versions).
//
// What it deliberately does NOT do: recognise genericity, abstract the code, or move arbitrary
// source out of a feature. That is the developer's architecture-first judgment. PREREQUISITE:
// the generic code must already live in its own clean Nx library (scaffold with the standard
// `nx g @nx/js:lib` / `@nx/angular:library` and move the code in), then mark THAT library.
//
// Sandbox-safe: touches only this workspace. The committed marker is the hand-off across the
// sandbox boundary to a host context that can reach the shared library workspace.
//
// See docs/reusable-tool-extraction.md in the claude-toolkit for the full mechanism.
import {
  type Tree,
  readProjectConfiguration,
  updateProjectConfiguration,
  readJson,
  writeJson,
  joinPathFragments,
  formatFiles,
} from '@nx/devkit';

interface MarkExtractableSchema {
  lib: string;
  summary?: string;
  rationale?: string;
  package?: string;
  scope?: string;
  kind?: 'auto' | 'js' | 'angular';
}

const EXTRACTION_TAG = 'reusable-tool:extraction-candidate';

// Well-known frameworks whose installed major the extracted package must track (decision #2).
const FRAMEWORK_PATTERNS: RegExp[] = [
  /^@angular\//,
  /^@nx\//,
  /^nx$/,
  /^rxjs$/,
  /^zone\.js$/,
  /^tslib$/,
  /^typescript$/,
];

const isFramework = (dep: string): boolean => FRAMEWORK_PATTERNS.some((re) => re.test(dep));

const readJsonSafe = (tree: Tree, path: string): Record<string, unknown> =>
  tree.exists(path) ? (readJson(tree, path) as Record<string, unknown>) : {};

export default async function markExtractableGenerator(
  tree: Tree,
  options: MarkExtractableSchema
): Promise<void> {
  const project = readProjectConfiguration(tree, options.lib);

  if (project.projectType && project.projectType !== 'library') {
    throw new Error(
      `mark-extractable: "${options.lib}" is a ${project.projectType}, not a library. ` +
        `Extract the generic code into its own Nx library first ` +
        `(nx g @nx/js:lib / @nx/angular:library), then mark that library.`
    );
  }

  // 1. Tag the project (idempotent).
  project.tags ??= [];
  if (!project.tags.includes(EXTRACTION_TAG)) project.tags.push(EXTRACTION_TAG);
  updateProjectConfiguration(tree, options.lib, project);

  // 2. Detect kind from the build executor / the lib's own deps.
  const libPkg = readJsonSafe(tree, joinPathFragments(project.root, 'package.json'));
  const libDeps = {
    ...((libPkg.dependencies as Record<string, string>) ?? {}),
    ...((libPkg.peerDependencies as Record<string, string>) ?? {}),
  };
  const buildExecutor = String(project.targets?.build?.executor ?? '');
  const looksAngular = /angular/i.test(buildExecutor) || '@angular/core' in libDeps;
  const kind: 'js' | 'angular' =
    options.kind && options.kind !== 'auto' ? options.kind : looksAngular ? 'angular' : 'js';

  // 3. Capture the installed ranges of well-known frameworks (for the major-tracking rule).
  const rootPkg = readJsonSafe(tree, 'package.json');
  const rootDeps: Record<string, string> = {
    ...((rootPkg.dependencies as Record<string, string>) ?? {}),
    ...((rootPkg.devDependencies as Record<string, string>) ?? {}),
  };
  const frameworkVersions: Record<string, string> = {};
  for (const [dep, range] of Object.entries(rootDeps)) {
    if (isFramework(dep)) frameworkVersions[dep] = range;
  }

  // 4. Proposed package name.
  const scope = (options.scope ?? '@bespunky').replace(/\/+$/, '');
  const baseName = options.lib.split(/[\\/]/).pop()!.replace(/^@[^/]+\//, '');
  const proposedPackageDefault = `${scope}/${baseName}`;

  // 5. The library's public entry.
  const entry = project.sourceRoot
    ? joinPathFragments(project.sourceRoot, 'index.ts')
    : joinPathFragments(project.root, 'src', 'index.ts');

  // 6. Merge with any existing marker (idempotent re-runs preserve lifecycle + prior input).
  const markerPath = joinPathFragments(project.root, 'extraction.json');
  const existing = readJsonSafe(tree, markerPath);

  const marker = {
    status: existing.status === 'ingested' ? 'ingested' : 'candidate',
    proposedPackage: options.package ?? (existing.proposedPackage as string) ?? proposedPackageDefault,
    summary: options.summary ?? (existing.summary as string) ?? '',
    rationale: options.rationale ?? (existing.rationale as string) ?? '',
    sourceWorkspace: (rootPkg.name as string) ?? (existing.sourceWorkspace as string) ?? null,
    sourceLib: options.lib,
    sourceLibRoot: project.root,
    entry,
    kind,
    declaredDeps: {
      dependencies: (libPkg.dependencies as Record<string, string>) ?? {},
      peerDependencies: (libPkg.peerDependencies as Record<string, string>) ?? {},
    },
    // installed ranges of @angular/*, @nx/*, nx, rxjs, etc. — the extract-tool pins the
    // published package's peerDeps / version line to these majors (decision #2).
    frameworkVersions,
    ingestedPackage: existing.ingestedPackage ?? null,
    markedAt: (existing.markedAt as string) ?? new Date().toISOString().slice(0, 10),
    notes: (existing.notes as string) ?? '',
  };

  writeJson(tree, markerPath, marker);

  await formatFiles(tree);
}
