// WHAT THE CONTAINER IS BUILT FROM — the one definition, and the before/after comparison house.sh's UPGRADE_NEXT asks.
//
// An upgrade reports `rebuild-container` when the container it leaves behind would differ from the one running. That
// used to be read off the diff's FILE LIST: anything under `.devcontainer/` moved → rebuild. But `.devcontainer/` also
// holds things no container is built from — the house's ownership RECORD (`.bespunky-devcontainer.json`, whose
// `layers` list moves whenever any layer is added) and the prose comments in every composed file (the post-create
// header names the layers too). So adding a layer with no container share at all (`ci`) demanded a rebuild that
// changed nothing, and a boundary that fires for nothing is one everyone learns to ignore.
//
// So the question is asked of CONTENT: every file under `.devcontainer/` (the house's and the project's own — an
// `os-packages.txt` line or a `post-create.local.sh` edit is as much an input as a house one), minus the records,
// each reduced to what its consumer actually reads:
//   - JSON / JSONC (devcontainer.json, devcontainer-lock.json, a feature's manifest) → its parsed value; comments
//     and formatting are nothing the CLI reads.
//   - shell scripts, Dockerfiles and the `#`-commented package list → without their whole-line comments and blank
//     lines. A heredoc body is content (it is written somewhere), so it is kept verbatim, and a comment line that
//     follows a `\` continuation is kept, since removing it would join two lines that were not joined.
//   - anything else → its exact bytes.
// Every reduction errs one way: when unsure it KEEPS text, so the cost of a mistake is an unneeded rebuild report —
// never a needed one swallowed. A file that does not parse is compared raw for the same reason.
//
// The CLI (`node container-inputs.js <base>`, run in the project) compares the committed `<base>` against the
// working tree — tracked plus untracked-not-ignored, the same set `_upgrade_next` diffs — and prints `same` or
// `changed` (then the differing paths). house.sh runs it at the end of the upgrade program, where Node is
// guaranteed, and the outer reporter reads the verdict; a missing verdict falls back to "any change rebuilds".
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, join, posix } from 'node:path';
import { parse, type ParseError } from 'jsonc-parser';
import { DEVCONTAINER_MARKER } from '../_utils/devcontainer-provenance';

export const CONTAINER_DIR = '.devcontainer';

/** Files under `.devcontainer/` that RECORD what the house did — read by the house, never by a container build. */
export const CONTAINER_RECORDS: readonly string[] = [DEVCONTAINER_MARKER];

/** A path's content as a container build sees it (see the header). `raw` is the file's text, or its latin1 bytes. */
export function containerInput(path: string, raw: string): string {
  switch (kindOf(path)) {
    case 'json':
      return parsedJson(raw) ?? raw;
    case 'hash-commented':
      return withoutComments(raw);
    default:
      return raw;
  }
}

/** How a path is read: as JSON(C), as a `#`-commented script or list, or as opaque bytes. */
function kindOf(path: string): 'json' | 'hash-commented' | 'bytes' {
  const name = basename(path);
  if (name.endsWith('.json')) return 'json';
  if (name.endsWith('.sh') || /(^|\.)Dockerfile$|^Dockerfile\./.test(name) || name === 'os-packages.txt') return 'hash-commented';
  return 'bytes';
}

/** The paths whose container input differs between two `{ path: content }` snapshots — empty means "same container". */
export function containerInputsDiffer(before: Record<string, string>, after: Record<string, string>): string[] {
  const inputs = (files: Record<string, string>) =>
    new Map(
      Object.entries(files)
        .map(([path, raw]) => [posix.normalize(path), raw] as const)
        .filter(([path]) => isContainerInput(path))
        .map(([path, raw]) => [path, containerInput(path, raw)] as const),
    );
  const a = inputs(before);
  const b = inputs(after);
  return [...new Set([...a.keys(), ...b.keys()])].filter((path) => a.get(path) !== b.get(path)).sort();
}

function isContainerInput(path: string): boolean {
  return path.startsWith(`${CONTAINER_DIR}/`) && !CONTAINER_RECORDS.includes(path);
}

function parsedJson(raw: string): string | undefined {
  const errors: ParseError[] = [];
  const value = parse(raw, errors, { allowTrailingComma: true, disallowComments: false });
  return errors.length ? undefined : JSON.stringify(value);
}

/** Whole-line `#` comments and blank lines removed — outside heredocs, and never after a `\` continuation. */
function withoutComments(raw: string): string {
  const kept: string[] = [];
  let heredoc: { word: string; dashed: boolean } | undefined;
  raw.split(/\r?\n/).forEach((line, index) => {
    if (heredoc) {
      kept.push(line);
      if ((heredoc.dashed ? line.replace(/^\t+/, '') : line) === heredoc.word) heredoc = undefined;
      return;
    }
    const continued = (kept[kept.length - 1] ?? '').endsWith('\\');
    const comment = /^\s*#/.test(line) && !(index === 0 && line.startsWith('#!'));
    if (!continued && (comment || line.trim() === '')) return;
    kept.push(line);
    // A heredoc opened on this line (`<<WORD`, `<<-WORD`, `<<'WORD'`) — never a here-string (`<<<`).
    const opened = /(?<!<)<<(-?)\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2/.exec(line);
    if (opened && !comment) heredoc = { word: opened[3], dashed: opened[1] === '-' };
  });
  return kept.join('\n');
}

// ── the CLI: <base> (committed) against the working tree, both read in the project's own coordinates ────────────

function git(cwd: string, args: string[]): Buffer {
  return execFileSync('git', args, { cwd, maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
}
const paths = (out: Buffer) => out.toString('utf8').split('\0').filter(Boolean);
/** Text kinds decode as UTF-8; everything else keeps its exact bytes (latin1 is lossless, UTF-8 is not). */
const decode = (path: string, bytes: Buffer) => bytes.toString(kindOf(path) === 'bytes' ? 'latin1' : 'utf8');

/** The files under `.devcontainer/` committed at `base`, keyed by their path relative to `cwd` (the project). */
export function snapshotAt(base: string, cwd = process.cwd()): Record<string, string> {
  const files: Record<string, string> = {};
  // `ls-tree` and `<rev>:./<path>` both speak paths relative to the cwd, as `git diff --relative` does in house.sh.
  for (const path of paths(git(cwd, ['ls-tree', '-r', '-z', '--name-only', base, '--', CONTAINER_DIR]))) {
    files[path] = decode(path, git(cwd, ['cat-file', 'blob', `${base}:./${path}`]));
  }
  return files;
}

/** The same set in the working tree — tracked plus untracked-not-ignored, as `_upgrade_next` diffs it. */
export function snapshotNow(cwd = process.cwd()): Record<string, string> {
  const files: Record<string, string> = {};
  for (const path of paths(git(cwd, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', CONTAINER_DIR]))) {
    const file = join(cwd, path);
    if (existsSync(file) && statSync(file).isFile()) files[path] = decode(path, readFileSync(file));
  }
  return files;
}

if (require.main === module) {
  const base = process.argv[2];
  if (!base) {
    console.error('Usage: node container-inputs.js <base-commit-or-tree>');
    process.exit(2);
  }
  const differing = containerInputsDiffer(snapshotAt(base), snapshotNow());
  console.log(differing.length ? ['changed', ...differing].join('\n') : 'same');
}
