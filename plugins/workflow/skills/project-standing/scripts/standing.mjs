#!/usr/bin/env node
// standing.mjs — the project-standing DERIVATION (bespunky-workflow:project-standing).
//
// The ONE place that reads docs/features/ and git and says what each feature package is: its validated name,
// what it is about (one line), its closing status (from DECISION.md) and when it closed, whether it is live, dormant or concluded, its newest
// handoff baton, where its newest copy lives, and the repo-wide activity facts. An effort is found WHEREVER it lives, not
// only in the session's checkout: every worktree's docs/features/, every orphaned checkout under .claude/worktrees/ (on
// disk, git no longer knows it), and every branch that has not landed and is checked out nowhere readable (see
// `branchPackages`). Everything that needs those facts consumes THIS script, never its own copy of the rules:
//   - hooks/detect-standing.sh   (SessionStart) reads `--tsv` and decides whether to relay a notice;
//   - hooks/standing.tsx         (the /standing pane) reads `--json` and draws it;
//   - the project-standing skill may run `--json` as the mechanical half of its "orient" scope.
// Policy (when to speak, how to word it, what to draw) stays with each consumer; the rules live here.
//
// READ-ONLY by construction: it runs `git log`, `git status`, `git worktree list`, `git for-each-ref`, `git cat-file`,
// `git rev-parse` and the branch-model engine's `status`, with optional locks off (another session may be working in
// any of those worktrees), and reads files. It writes nothing — the hook's snooze file is the hook's own business. It
// never prunes or repairs: an orphaned checkout may hold someone's work, so it is reported and left exactly as it is.
//
// UNTRUSTED INPUT. Folder and file names come from the repo, which may be hostile. A package whose folder
// name fails the feature-package shape is SKIPPED, not echoed; a baton whose name fails a strict charset is
// not named; a branch or path that fails one is not read, because naming it is the point of reading it. Free text (about, summary, tags) is passed through only in `--json`, for DISPLAY; consumers must never
// put it into a model prompt.
//
// Usage: standing.mjs [--json | --tsv]     (project dir: $CLAUDE_PROJECT_DIR, else the cwd)
// Exit codes: 0 ok (including "not a git repo": `repo` is null) · 2 usage error.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DAY = 86400;
const STATUS_RE = /^status:[ \t\v\f\r]*(concluded|abandoned|superseded)\b/im;
const PACKAGE_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9]/;
const SLUG_RE = /^[a-z0-9-]+$/;
const BATON_RE = /^[A-Za-z0-9._-]{1,120}$/;
/** A handoff filed at the package's root instead of in `handoffs/` (`INBOUND-HANDOFF.md`): the baton when `handoffs/` has none. */
const ROOT_BATON_RE = /handoff[^/]*\.md$/i;
const MAX_PACKAGE_NAME = 80;

/** STALE_DAYS as the hook has always read it: a non-negative integer, else 14. */
function staleDays(env) {
  const raw = env.BESPUNKY_STANDING_STALE_DAYS ?? '14';

  return /^[0-9]+$/.test(raw) ? Number(raw) : 14;
}

const GIT_OPTIONS = { env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, maxBuffer: 64 << 20 };

function git(dir, args, input) {
  try {
    return execFileSync('git', ['-C', dir, ...args], {
      ...GIT_OPTIONS,
      encoding: 'utf8',
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'ignore'],
      input,
    });
  } catch {
    return undefined;
  }
}

/** Age in whole days, floored, as `find -mtime` counts it. */
const ageDays = (now, epoch) => Math.floor((now - epoch) / DAY);

/** Every regular file under `dir` (no symlinks followed), with its mtime; `skip` prunes top-level names. */
function walk(dir, skip = new Set()) {
  const out = [];
  const visit = (at, top) => {
    let entries;
    try {
      entries = fs.readdirSync(at, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (top && skip.has(entry.name)) continue;
      const full = path.join(at, entry.name);
      if (entry.isDirectory()) visit(full, false);
      else if (entry.isFile()) {
        try {
          out.push({ path: full, mtime: Math.floor(fs.lstatSync(full).mtimeMs / 1000) });
        } catch {
          /* vanished mid-walk */
        }
      }
    }
  };
  visit(dir, true);

  return out;
}

/** The leading `---` frontmatter of a DECISION.md: `summary`, `concluded`, `tags` (flow list or `- item`s). */
function frontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/.exec(text);
  if (!match) return {};
  const fields = {};
  const lines = match[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z][\w-]*):[ \t]*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    const [, key, raw] = kv;
    let value = raw.trim();
    if (key === 'tags') {
      if (value.startsWith('[')) {
        fields.tags = value.replace(/^\[|\]$/g, '').split(',').map(unquote).filter(Boolean);
      } else {
        const items = [];
        while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) items.push(unquote(lines[++i].replace(/^\s*-\s+/, '')));
        fields.tags = items.filter(Boolean);
      }
    } else {
      // A value may continue on more-indented lines: a block scalar (`summary: >-`, folded; `|`, kept) or a
      // multi-line plain scalar (folded).
      const isBlock = /^[>|][+-]?$/.test(value);
      const more = [];
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || (lines[i + 1].trim() === '' && /^\s+\S/.test(lines[i + 2] ?? '')))) {
        more.push(lines[++i].trim());
      }
      if (isBlock) fields[key] = more.join(value.startsWith('|') ? '\n' : ' ').trim();
      else fields[key] = unquote([value, ...more].join(' ').trim());
    }
  }

  return fields;
}

/** The length an `about` line is capped at, at a word boundary. */
const ABOUT_MAX = 140;

/** Markdown inline syntax as plain text, whitespace collapsed, capped at a word boundary. */
function plain(text) {
  const flat = text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // [text](url), ![alt](src)
    .replace(/\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g, (_, target, label) => label ?? target) // [[wiki|label]]
    .replace(/`+([^`]*)`+/g, '$1')
    .replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, '$2')
    .replace(/(^|[^\w*])([*_])(?=\S)(.+?)(?<=\S)\2(?![\w*])/g, '$1$3')
    .replace(/\s+/g, ' ')
    .trim();
  if (flat.length <= ABOUT_MAX) return flat;
  const cut = flat.slice(0, ABOUT_MAX);
  const space = cut.lastIndexOf(' ');

  return `${(space > ABOUT_MAX / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.\u2014-]+$/, '')}…`;
}

/** A line that only states metadata (`**Slug:** x · **Opened:** y`, `*Opened 2026-08-10.*`), not what the effort is about. */
const META_RE = /^(?:\*\*[^*]+:\*\*|\*[^*]+\*$|_[^_]+_$)/;

/** The first prose sentence after a markdown file's first heading: headings, quotes, tables, lists and metadata skipped. */
function firstSentence(text) {
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---[^\n]*\n/, '').split(/\r?\n/);
  const heading = body.findIndex(line => /^#{1,6}\s/.test(line));
  const paragraph = [];
  let inFence = false;
  for (const raw of body.slice(heading + 1)) {
    const line = raw.trim();
    if (/^(```|~~~)/.test(line)) inFence = !inFence;
    const isProse =
      !inFence && line !== '' && !/^(#|>|\||[-*+]\s|\d+[.)]\s|```|~~~|<!--|---$|\*\*\*$)/.test(line) && !META_RE.test(line);
    if (isProse) paragraph.push(line);
    else if (paragraph.length > 0) break;
  }
  if (paragraph.length === 0) return undefined;
  const joined = paragraph.join(' ');
  const end = /[.!?](?=\s|$)/.exec(joined);

  return end ? joined.slice(0, end.index + 1) : joined;
}

/**
 * What a package is about, in one line: DECISION.md's `summary:`, else BRIEF.md's `summary:`/`about:`, else
 * BRIEF.md's first prose sentence; null when none says. Free text: for display only, never a prompt.
 */
function aboutOf(decisionFront, brief) {
  const briefFront = brief ? frontmatter(brief) : {};
  const said = [decisionFront.summary, briefFront.summary, briefFront.about].find(v => typeof v === 'string' && v.trim());
  const text = said ?? (brief ? firstSentence(brief) : undefined);
  const line = text ? plain(text) : '';

  return line || null;
}

function unquote(s) {
  const t = s.trim();

  return /^(['"]).*\1$/.test(t) ? t.slice(1, -1) : t;
}

/** One `git log` over docs/features: newest commit epoch per path (all refs, so worktrees' branches count). */
function commitTimes(root) {
  const out = git(root, ['log', '--all', '--format=%x01%ct', '--name-only', '--', 'docs/features']);
  const times = new Map();
  if (!out) return times;
  let ct = 0;
  for (const line of out.split('\n')) {
    if (line.startsWith('\x01')) ct = Number(line.slice(1)) || 0;
    else if (line && !times.has(line)) times.set(line, ct);
  }

  return times;
}

/** Paths under docs/features that differ from HEAD (modified or untracked): their mtime is their activity. */
function dirtyPaths(root) {
  const out = git(root, ['status', '--porcelain', '-z', '--untracked-files=all', '--', 'docs/features']);
  const dirty = new Set();
  if (!out) return dirty;
  const parts = out.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const rec = parts[i];
    if (rec.length < 4) continue;
    dirty.add(rec.slice(3));
    if (rec[0] === 'R' || rec[0] === 'C') i++; // a rename carries its source as the next record
  }

  return dirty;
}

/** A worktree's location as consumers name it: relative to the session's project dir when inside it, else absolute. */
const WORKTREE_RE = /^\/?(?!\.\.?(?:\/|$))[A-Za-z0-9._@+-]+(?:\/(?!\.\.?(?:\/|$))[A-Za-z0-9._@+-]+)*$/;

/**
 * Every worktree of the repository (`git worktree list --porcelain`): its path and checked-out branch. Bare and
 * prunable entries have no files to read but still name a branch, which is what `hasWorktree` asks about.
 */
function worktrees(root) {
  const out = git(root, ['worktree', 'list', '--porcelain']) ?? '';
  const trees = [];
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) trees.push({ path: line.slice('worktree '.length), readable: true });
    const tree = trees.at(-1);
    if (!tree) continue;
    if (line.startsWith('HEAD ')) tree.head = line.slice('HEAD '.length);
    else if (line.startsWith('branch refs/heads/')) tree.branch = line.slice('branch refs/heads/'.length);
    else if (line === 'bare' || line.startsWith('prunable')) tree.readable = false;
  }

  return trees;
}

function realpath(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return undefined;
  }
}

/**
 * The feature packages of ONE checkout's docs/features/: validated names, closing status and frontmatter, newest
 * activity and baton. State is not decided here — a package may be seen in several checkouts, and only the copy
 * that wins the de-duplication gets one.
 */
function scanTree(features, { prefix, committed, dirty }) {
  /** A file's activity: its mtime while it differs from HEAD, else its newest commit, else its mtime. */
  const activity = (relFromFeatures, mtime) => {
    const key = `${prefix}/${relFromFeatures}`;
    if (dirty.has(key)) return mtime;

    return committed.get(key) ?? mtime;
  };

  // Codepoint order, as a C-locale shell glob lists them.
  let names;
  try {
    names = fs.readdirSync(features).filter(name => !name.startsWith('.')).sort();
  } catch {
    return [];
  }
  const packages = [];
  for (const dir of names) {
    const full = path.join(features, dir);
    try {
      if (!fs.statSync(full).isDirectory()) continue;
    } catch {
      continue;
    }
    if (!isPackageDir(dir)) continue;

    const read = name => {
      try {
        return fs.readFileSync(path.join(full, name), 'utf8');
      } catch {
        return ''; // absent: in flight, or no brief
      }
    };
    const files = walk(full).map(file => ({
      rel: path.relative(full, file.path).split(path.sep).join('/'),
      at: activity(path.relative(features, file.path).split(path.sep).join('/'), file.mtime),
    }));
    packages.push(
      describePackage(dir, {
        decision: read('DECISION.md'),
        brief: read('BRIEF.md'),
        files,
        lastActivity: files.reduce((newest, file) => Math.max(newest, file.at), 0),
      }),
    );
  }

  return packages;
}

/** A folder name the feature-package shape vouches for: anything else is never echoed. `archive` is a tier, not a package. */
function isPackageDir(dir) {
  return dir !== 'archive' && PACKAGE_RE.test(dir) && dir.length <= MAX_PACKAGE_NAME && SLUG_RE.test(dir.slice(11));
}

/**
 * What one copy of a package says, wherever it was read from. `files` are its files relative to the package, each with
 * its activity (as far as they are known: the baton rule only needs the ones at the top and in `handoffs/`).
 */
function describePackage(dir, { decision, brief, files, lastActivity }) {
  const closing = STATUS_RE.exec(decision);
  const decisionFront = frontmatter(decision);
  const front = closing ? decisionFront : {};
  const pkg = {
    dir,
    date: dir.slice(0, 10),
    slug: dir.slice(11),
    status: closing ? closing[1].toLowerCase() : 'in-flight',
    lastActivity,
    about: aboutOf(decisionFront, brief),
  };
  const baton = newestBaton(files);
  if (baton) pkg.baton = baton;
  if (closing) {
    if (typeof front.summary === 'string' && front.summary) pkg.summary = front.summary;
    if (typeof front.concluded === 'string' && front.concluded) pkg.concluded = front.concluded;
    if (front.tags?.length) pkg.tags = front.tags;
    pkg.closedAt = closedAt(front.concluded, files.find(file => file.rel === 'DECISION.md')?.at || lastActivity);
  }

  return pkg;
}

/** The baton to read first: the newest file in `handoffs/`, its one home; only without one, a handoff filed at the root. */
function newestBaton(files) {
  const newest = candidates =>
    candidates.reduce((best, file) => (!best || file.at > best.at || (file.at === best.at && file.rel > best.rel) ? file : best), undefined)?.rel;
  const named = files.filter(file => BATON_RE.test(path.posix.basename(file.rel)));

  return (
    newest(named.filter(file => path.posix.dirname(file.rel) === 'handoffs')) ??
    newest(named.filter(file => !file.rel.includes('/') && ROOT_BATON_RE.test(file.rel)))
  );
}

/** When a package closed: its `concluded:` date (UTC midnight) when that is a real date, else when DECISION.md last moved. */
function closedAt(concluded, fallback) {
  if (typeof concluded === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(concluded)) {
    const at = Date.parse(`${concluded}T00:00:00Z`);
    if (Number.isFinite(at) && new Date(at).toISOString().startsWith(concluded)) return Math.floor(at / 1000);
  }

  return fallback;
}

/**
 * The directories under the main checkout's `.claude/worktrees/` that git does not list as this project's worktrees,
 * which is where `git worktree add` puts them here. A checkout's `.git` file can point at a path this environment
 * cannot see (it was created on the host, this is a container), and then an explicit `git worktree prune` from here
 * deletes its registration while its files and branch stay. So:
 *   - `registered-elsewhere`: the registration exists, under a path that does not resolve from here. Do not prune.
 *   - `unregistered`:         the registration is gone. Its files may still hold uncommitted work.
 *   - `no-git-link`:          no `.git` at all: what a removed worktree left behind. Reported, never read.
 * A directory with a `.git` DIRECTORY is a repository of its own, nobody's orphan.
 */
function orphanedCheckouts({ mainRoot, commonDir, registered, branchNamed }) {
  const parent = path.join(mainRoot, '.claude', 'worktrees');
  let names;
  try {
    names = fs.readdirSync(parent, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  } catch {
    return [];
  }
  const orphans = [];
  for (const name of names) {
    const full = path.join(parent, name);
    if (registered.has(realpath(full))) continue;
    let link;
    try {
      const stat = fs.lstatSync(path.join(full, '.git'));
      if (!stat.isFile()) continue;
      link = /^gitdir:\s*(.+?)\s*$/m.exec(fs.readFileSync(path.join(full, '.git'), 'utf8'))?.[1];
    } catch {
      orphans.push({ full, reason: 'no-git-link' });
      continue;
    }
    if (!link) {
      orphans.push({ full, reason: 'no-git-link' });
      continue;
    }
    const admin = path.join(commonDir, 'worktrees', path.basename(link));
    if (fs.existsSync(admin)) {
      let head = '';
      try {
        head = fs.readFileSync(path.join(admin, 'HEAD'), 'utf8');
      } catch {
        /* a broken registration names no branch */
      }
      orphans.push({ full, reason: 'registered-elsewhere', branch: /^ref: refs\/heads\/(\S+)/.exec(head)?.[1] });
    } else orphans.push({ full, reason: 'unregistered', branch: branchNamed(name) });
  }

  return orphans;
}

const UNDECLARED_LINES = ['main', 'master', 'development', 'develop', 'staging'];
const BRANCHES_ENGINE = fileURLToPath(new URL('../../branch-and-release/scripts/branches.mjs', import.meta.url));

/**
 * The lines an unlanded branch is measured against and the protected names that are never efforts, from the branch-model
 * engine (`status --json`, its frozen contract: this script is not a third resolver). Undeclared or unreadable, the
 * protected names that exist stand in for integration, per the skill; an engine that did not answer leaves the fallback
 * every other reader of it keeps.
 */
function branchLines(root) {
  const ran = spawnSync(process.execPath, [BRANCHES_ENGINE, 'status', '--json'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  let model;
  try {
    model = JSON.parse(ran.stdout);
  } catch {
    model = undefined;
  }
  const isNames = value => Array.isArray(value) && value.every(name => typeof name === 'string' && name !== '');
  if (!['declared', 'undeclared', 'unreadable'].includes(model?.state) || !isNames(model.protected) || !isNames(model.protectedPatterns)) {
    return { integration: UNDECLARED_LINES, protectedNames: UNDECLARED_LINES, protectedPatterns: [] };
  }
  const integration = model.state === 'declared' && typeof model.projection?.integration === 'string' ? [model.projection.integration] : model.protected;

  return { integration, protectedNames: model.protected, protectedPatterns: model.protectedPatterns };
}

const globRegex = glob => new RegExp(`^${glob.replace(/[.+^${}()|[\]\\?]/g, '\\$&').replace(/\*/g, '.*')}$`);

/** `refs/heads/feat/x` → `feat/x`; `refs/remotes/origin/feat/x` → `feat/x`, the line's name on any remote. */
const lineName = ref => ref.replace(/^refs\/heads\//, '').replace(/^refs\/remotes\/[^/]+\//, '');
const shortName = ref => ref.replace(/^refs\/(?:heads|remotes)\//, '');

/**
 * The branches a checkout cannot show: every ref that is not checked out in a readable worktree and has not landed.
 * Bounded no matter how many branches exist: `for-each-ref` is one process, the model is only asked when such a branch
 * exists at all (a repo whose branches are all checked out pays nothing), and a landed branch is out before anything of
 * it is read. A remote branch counts only when no local one has its name: a local branch is the user's own, and is the
 * copy that moves. Protected lines are never efforts.
 */
function unlandedRefs(root, heldBranches) {
  const out = git(root, ['for-each-ref', '--format=%(refname)%09%(symref)', 'refs/heads', 'refs/remotes']) ?? '';
  const refs = out.split('\n').filter(Boolean).map(line => line.split('\t')).filter(([, symref]) => !symref).map(([ref]) => ref);
  const locals = new Set(refs.filter(ref => ref.startsWith('refs/heads/')).map(lineName));
  const strays = refs.filter(ref =>
    ref.startsWith('refs/heads/') ? !heldBranches.has(lineName(ref)) : !locals.has(lineName(ref)) && !ref.endsWith('/HEAD'),
  );
  if (strays.length === 0) return { refs: [], bases: [] };

  const { integration, protectedNames, protectedPatterns } = branchLines(root);
  const patterns = protectedPatterns.map(globRegex);
  const isLine = name => protectedNames.includes(name) || patterns.some(pattern => pattern.test(name));
  // Every copy of an integration line counts: a stale local line must not make everything look unlanded.
  const bases = refs.filter(ref => integration.includes(lineName(ref)));
  const candidates = new Set(strays.filter(ref => !isLine(lineName(ref)) && WORKTREE_RE.test(shortName(ref))));
  if (candidates.size === 0) return { refs: [], bases };
  const unmerged = git(root, ['for-each-ref', '--format=%(refname)', ...bases.map(base => `--no-merged=${base}`), 'refs/heads', 'refs/remotes']);

  return { refs: (unmerged ?? '').split('\n').filter(ref => candidates.has(ref)), bases };
}

/** One `git cat-file --batch` over many objects, in order: `{ type, data }`, or null for what the ref does not hold. */
function readObjects(root, specs) {
  if (specs.length === 0) return [];
  let out;
  try {
    out = execFileSync('git', ['-C', root, 'cat-file', '--batch'], { ...GIT_OPTIONS, input: `${specs.join('\n')}\n`, stdio: ['pipe', 'pipe', 'ignore'] });
  } catch {
    return specs.map(() => null);
  }
  const objects = [];
  let at = 0;
  for (let i = 0; i < specs.length && at < out.length; i++) {
    const end = out.indexOf(0x0a, at);
    const header = /^([0-9a-f]+) (blob|tree|commit|tag) ([0-9]+)$/.exec(out.toString('utf8', at, end));
    at = end + 1;
    if (!header) {
      objects.push(null);
      continue;
    }
    const size = Number(header[3]);
    objects.push({ type: header[2], oidBytes: header[1].length / 2, data: out.subarray(at, at + size) });
    at += size + 1;
  }

  return objects;
}

/** The regular files directly in a tree object (raw entries: `<mode> <name>\0<oid>`); symlinks and subtrees are not. */
function treeFiles(object) {
  if (object?.type !== 'tree') return [];
  const { data, oidBytes } = object;
  const names = [];
  for (let at = 0; at < data.length; ) {
    const space = data.indexOf(0x20, at);
    const nul = data.indexOf(0, space);
    if (/^100/.test(data.toString('utf8', at, space))) names.push(data.toString('utf8', space + 1, nul));
    at = nul + 1 + oidBytes;
  }

  return names;
}

const blobText = object => (object?.type === 'blob' ? object.data.toString('utf8') : '');

/**
 * The packages only unlanded branches carry. What a branch is ABOUT is what it changed: a package counts for a branch
 * only when a commit no checkout and no integration line holds touched it. A branch forked before a package concluded or
 * was archived still has the old copy, and has said nothing about it. One `git log` finds them all, its cost the
 * branches' own commits, and one `cat-file --batch` reads them; a copy's activity is those commits' times, never
 * `committed`, which also counts other refs.
 *
 * A package that concluded and aged out to `archive/` is not back in flight because a squash-landed branch was never
 * deleted (`archived`). Several branches can hold one commit (`--source` names one of them), so a branch named for the
 * slug is preferred.
 */
function branchPackages(root, { prefix, refs, exclude, committed }) {
  if (refs.length === 0) return [];
  const stdin = [...refs, '--not', ...exclude, ''].join('\n');
  const log = git(root, ['log', '--stdin', '--source', '--format=%x01%ct%x09%S', '--name-only', '--', 'docs/features'], stdin);
  if (!log) return [];

  const archived = new Set();
  const archive = new RegExp(`^${prefix}/archive/[^/]+/([^/]+)/`);
  for (const key of committed.keys()) {
    const hit = archive.exec(key);
    if (hit) archived.add(hit[1]);
  }

  const touched = new Map();
  let at = 0;
  let source = '';
  for (const line of log.split('\n')) {
    if (line.startsWith('\x01')) {
      const [time, ref] = line.slice(1).split('\t');
      at = Number(time) || 0;
      source = ref;
    } else if (line.startsWith(`${prefix}/`)) {
      const [dir, ...rest] = line.slice(prefix.length + 1).split('/');
      if (rest.length === 0 || !isPackageDir(dir) || archived.has(dir)) continue;
      const seen = touched.get(dir) ?? { ref: source, times: new Map(), lastActivity: 0 };
      const rel = rest.join('/');
      if (!seen.times.has(rel)) seen.times.set(rel, at);
      seen.lastActivity = Math.max(seen.lastActivity, at);
      touched.set(dir, seen);
    }
  }

  const reads = [...touched].flatMap(([dir, seen]) => {
    const slug = dir.slice(11);
    const named = refs.find(ref => lineName(ref) === slug || lineName(ref).endsWith(`/${slug}`));

    return [...new Set([named, seen.ref])].filter(Boolean).map(ref => ({ dir, ref, seen }));
  });
  const objects = readObjects(
    root,
    reads.flatMap(({ dir, ref }) => {
      const at = `${ref}:${prefix}/${dir}`;

      return [at, `${at}/handoffs`, `${at}/DECISION.md`, `${at}/BRIEF.md`];
    }),
  );

  const packages = new Map();
  reads.forEach(({ dir, ref, seen }, i) => {
    const [tree, handoffs, decision, brief] = objects.slice(i * 4, i * 4 + 4);
    if (packages.has(dir) || tree?.type !== 'tree') return; // the first ref that still holds it; moved or deleted there: nothing
    const known = rel => seen.times.get(rel) ?? committed.get(`${prefix}/${dir}/${rel}`) ?? 0;
    const files = [...treeFiles(tree), ...treeFiles(handoffs).map(name => `handoffs/${name}`)].map(rel => ({ rel, at: known(rel) }));
    const pkg = describePackage(dir, { decision: blobText(decision), brief: blobText(brief), files, lastActivity: seen.lastActivity });
    packages.set(dir, { ...pkg, branch: shortName(ref), ...(ref.startsWith('refs/remotes/') ? { remote: true } : {}) });
  });

  return [...packages.values()];
}

export function derive(projectDir, env = process.env, now = Math.floor(Date.now() / 1000)) {
  const stale = staleDays(env);
  const base = { version: 1, staleDays: stale, now, repo: null, packages: [], orphans: [] };
  const [top, commonDir] = git(projectDir, ['rev-parse', '--show-toplevel', '--path-format=absolute', '--git-common-dir'])?.trim().split('\n') ?? [];
  if (!top) return base;

  const lastCommit = Number(git(projectDir, ['log', '-1', '--format=%ct'])?.trim()) || 0;
  const features = path.join(projectDir, 'docs', 'features');
  const hasFeatures = fs.existsSync(features) && fs.statSync(features).isDirectory();
  const liveFiles = hasFeatures ? walk(features, new Set(['archive'])) : [];

  const repo = {
    lastCommit,
    commitAgeDays: Math.trunc((now - lastCommit) / DAY),
    hasFeatures,
    hasRecentDoc: liveFiles.some(file => ageDays(now, file.mtime) < stale),
  };

  // In-flight packages live on their own branches, usually checked out in their own worktrees, so the session's
  // checkout alone misses them. Every readable worktree is scanned at the same place relative to its toplevel; the
  // session's own checkout first, so it wins a tie.
  const all = worktrees(projectDir);
  const branches = all.filter(tree => tree.branch).map(tree => tree.branch);
  const sub = path.relative(top, projectDir);
  const prefix = path.relative(top, features).split(path.sep).join('/');
  const home = realpath(projectDir) ?? projectDir;
  const topReal = realpath(top) ?? top;
  /** A path as consumers name it; undefined when it fails the charset, so it is never echoed (it would reach a prompt through Resume and the notice). */
  const whereOf = real => {
    const rel = path.relative(home, real);
    const where = rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.split(path.sep).join('/') : real;

    return WORKTREE_RE.test(where) ? where : undefined;
  };
  const trees = [{ project: projectDir, root: projectDir, where: undefined }];
  for (const tree of all) {
    if (!tree.readable || (realpath(tree.path) ?? tree.path) === topReal) continue;
    const project = path.join(tree.path, sub);
    const real = realpath(project);
    if (!real) continue;
    const where = whereOf(real);
    if (where === undefined) continue;
    trees.push({ project, root: tree.path, where });
  }

  // What no checkout git knows about can show: branches that have not landed, and checkouts git has lost track of.
  const held = all.filter(tree => tree.readable);
  const { refs, bases } = unlandedRefs(projectDir, new Set(held.filter(tree => tree.branch).map(tree => tree.branch)));
  const branchNamed = name => refs.map(lineName).find(line => line === name || line.endsWith(`/${name}`));
  const registered = new Set(held.map(tree => realpath(tree.path)));
  const lost = all.length === 0 ? [] : orphanedCheckouts({ mainRoot: all[0].path, commonDir, registered, branchNamed });
  const orphans = lost.flatMap(({ full, reason, branch }) => {
    const where = whereOf(realpath(full) ?? full);

    return where === undefined ? [] : [{ path: where, reason, ...(branch ? { branch } : {}), full }];
  });
  for (const orphan of orphans) {
    if (orphan.reason !== 'no-git-link') trees.push({ project: path.join(orphan.full, sub), where: orphan.path, orphaned: true });
  }
  const report = { ...base, orphans: orphans.map(({ full, ...orphan }) => orphan) };

  const scanned = trees.filter(tree => fs.existsSync(path.join(tree.project, 'docs', 'features')));
  if (!hasFeatures && scanned.length === 0 && refs.length === 0) return { ...report, repo };

  // One `git log --all` serves every tree (they share the repository); what differs from HEAD is per tree. A lost
  // checkout has no index to ask, so its uncommitted edits to committed files cannot be seen; new files still can.
  const committed = commitTimes(projectDir);
  /** The same package seen in several places: the copy with the newest activity wins (a tie keeps the earlier). */
  const chosen = new Map();
  const offer = (pkg, winsTie = false) => {
    const kept = chosen.get(pkg.dir);
    if (!kept || kept.lastActivity < pkg.lastActivity || (winsTie && kept.lastActivity === pkg.lastActivity)) chosen.set(pkg.dir, pkg);
  };
  for (const tree of scanned) {
    const dirty = tree.root === undefined ? new Set() : dirtyPaths(tree.root);
    for (const pkg of scanTree(path.join(tree.project, 'docs', 'features'), { prefix, committed, dirty })) {
      offer(tree.where === undefined ? pkg : { ...pkg, worktree: tree.where, ...(tree.orphaned ? { orphaned: true } : {}) });
    }
  }
  // A branch copy is offered last and wins a tie: every commit it is measured by is one no checkout holds, while a
  // checkout's time comes from `committed`, which counts every ref. Equal times mean that checkout was credited with
  // this branch's own commit.
  const exclude = [...bases, ...held.map(tree => tree.head).filter(Boolean)];
  for (const pkg of branchPackages(projectDir, { prefix, refs, exclude, committed })) offer(pkg, true);

  const packages = [...chosen.values()]
    .sort((a, b) => (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0))
    .map(pkg => {
      const hasWorktree = branches.some(branch => branch === pkg.slug || branch.endsWith(`/${pkg.slug}`));
      const state =
        pkg.status !== 'in-flight' ? 'concluded' : hasWorktree || ageDays(now, pkg.lastActivity) < stale ? 'live' : 'dormant';
      const { dir, date, slug, status, lastActivity, about, ...rest } = pkg;

      return { dir, date, slug, status, state, lastActivity, hasWorktree, about, ...rest };
    });

  // Work committed in another worktree or on a local branch is activity here too: the session's HEAD never sees it.
  // Someone else's push is not.
  const elsewhere = packages.some(pkg => (pkg.worktree !== undefined || (pkg.branch !== undefined && !pkg.remote)) && ageDays(now, pkg.lastActivity) < stale);

  return {
    ...report,
    repo: { ...repo, hasFeatures: hasFeatures || scanned.length > 0 || packages.length > 0, hasRecentDoc: repo.hasRecentDoc || elsewhere },
    packages,
  };
}

/** Line format for shell consumers: no free text, only validated names and enums. */
function tsv(standing) {
  if (!standing.repo) return '';
  const { repo } = standing;
  const lines = [['repo', repo.hasFeatures ? 1 : 0, repo.hasRecentDoc ? 1 : 0, repo.lastCommit, repo.commitAgeDays].join('\t')];
  for (const pkg of standing.packages) {
    lines.push(['pkg', pkg.dir, pkg.status, pkg.state, pkg.baton ?? '', pkg.worktree ?? '', pkg.branch ?? '', pkg.remote ? 1 : ''].join('\t'));
  }

  return `${lines.join('\n')}\n`;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const args = process.argv.slice(2);
  const format = args.length === 0 ? '--json' : args[0];
  if (args.length > 1 || !['--json', '--tsv'].includes(format)) {
    process.stderr.write('usage: standing.mjs [--json | --tsv]\n');
    process.exit(2);
  }
  const standing = derive(process.env.CLAUDE_PROJECT_DIR || process.cwd());
  process.stdout.write(format === '--tsv' ? tsv(standing) : `${JSON.stringify(standing, null, 2)}\n`);
}
