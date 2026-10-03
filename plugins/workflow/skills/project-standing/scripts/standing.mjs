#!/usr/bin/env node
// standing.mjs — the project-standing DERIVATION (bespunky-workflow:project-standing).
//
// The ONE place that reads docs/features/ and git and says what each feature package is: its validated name,
// what it is about (one line), its closing status (from DECISION.md) and when it closed, whether it is live, dormant or concluded, its newest
// handoff baton, which worktree holds its newest copy, and the repo-wide activity facts. Every worktree's
// docs/features/ is read, not only the session's: in-flight work lives on its own branch, in its own checkout. Everything that needs those facts consumes THIS script, never its own
// copy of the rules:
//   - hooks/detect-standing.sh   (SessionStart) reads `--tsv` and decides whether to relay a notice;
//   - hooks/standing.tsx         (the /standing pane) reads `--json` and draws it;
//   - the project-standing skill may run `--json` as the mechanical half of its "orient" scope.
// Policy (when to speak, how to word it, what to draw) stays with each consumer; the rules live here.
//
// READ-ONLY by construction: it runs `git log`, `git status`, `git worktree list`, `git rev-parse` and reads
// files. It writes nothing — the hook's snooze file is the hook's own business.
//
// UNTRUSTED INPUT. Folder and file names come from the repo, which may be hostile. A package whose folder
// name fails the feature-package shape is SKIPPED, not echoed; a baton whose name fails a strict charset is
// not named. Free text (about, summary, tags) is passed through only in `--json`, for DISPLAY; consumers must never
// put it into a model prompt.
//
// Usage: standing.mjs [--json | --tsv]     (project dir: $CLAUDE_PROJECT_DIR, else the cwd)
// Exit codes: 0 ok (including "not a git repo": `repo` is null) · 2 usage error.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const DAY = 86400;
const STATUS_RE = /^status:[ \t\v\f\r]*(concluded|abandoned|superseded)\b/im;
const PACKAGE_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9]/;
const SLUG_RE = /^[a-z0-9-]+$/;
const BATON_RE = /^[A-Za-z0-9._-]{1,120}$/;
const MAX_PACKAGE_NAME = 80;

/** STALE_DAYS as the hook has always read it: a non-negative integer, else 14. */
function staleDays(env) {
  const raw = env.BESPUNKY_STANDING_STALE_DAYS ?? '14';

  return /^[0-9]+$/.test(raw) ? Number(raw) : 14;
}

function git(dir, args) {
  try {
    return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 });
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
    if (line.startsWith('branch refs/heads/')) tree.branch = line.slice('branch refs/heads/'.length);
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
    if (dir === 'archive') continue;
    const full = path.join(features, dir);
    try {
      if (!fs.statSync(full).isDirectory()) continue;
    } catch {
      continue;
    }
    if (!PACKAGE_RE.test(dir) || dir.length > MAX_PACKAGE_NAME) continue;
    const slug = dir.slice(11);
    if (!SLUG_RE.test(slug)) continue;

    let decision = '';
    try {
      decision = fs.readFileSync(path.join(full, 'DECISION.md'), 'utf8');
    } catch {
      /* no DECISION.md: in flight */
    }
    let brief = '';
    try {
      brief = fs.readFileSync(path.join(full, 'BRIEF.md'), 'utf8');
    } catch {
      /* no BRIEF.md */
    }
    const closing = STATUS_RE.exec(decision);
    const status = closing ? closing[1].toLowerCase() : 'in-flight';
    const decisionFront = frontmatter(decision);
    const front = closing ? decisionFront : {};

    let lastActivity = 0;
    let decisionAt = 0;
    let baton;
    for (const file of walk(full)) {
      const rel = path.relative(features, file.path).split(path.sep).join('/');
      const at = activity(rel, file.mtime);
      lastActivity = Math.max(lastActivity, at);
      if (file.path === path.join(full, 'DECISION.md')) decisionAt = at;
      const inHandoffs = path.dirname(file.path) === path.join(full, 'handoffs');
      const name = path.basename(file.path);
      if (inHandoffs && BATON_RE.test(name) && (!baton || at > baton.at || (at === baton.at && name > baton.name))) {
        baton = { name, at };
      }
    }

    const pkg = { dir, date: dir.slice(0, 10), slug, status, lastActivity, about: aboutOf(decisionFront, brief) };
    if (baton) pkg.baton = `handoffs/${baton.name}`;
    if (closing) {
      if (typeof front.summary === 'string' && front.summary) pkg.summary = front.summary;
      if (typeof front.concluded === 'string' && front.concluded) pkg.concluded = front.concluded;
      if (front.tags?.length) pkg.tags = front.tags;
      pkg.closedAt = closedAt(front.concluded, decisionAt || lastActivity);
    }
    packages.push(pkg);
  }

  return packages;
}

/** When a package closed: its `concluded:` date (UTC midnight) when that is a real date, else when DECISION.md last moved. */
function closedAt(concluded, fallback) {
  if (typeof concluded === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(concluded)) {
    const at = Date.parse(`${concluded}T00:00:00Z`);
    if (Number.isFinite(at) && new Date(at).toISOString().startsWith(concluded)) return Math.floor(at / 1000);
  }

  return fallback;
}

export function derive(projectDir, env = process.env, now = Math.floor(Date.now() / 1000)) {
  const stale = staleDays(env);
  const base = { version: 1, staleDays: stale, now, repo: null, packages: [] };
  const top = git(projectDir, ['rev-parse', '--show-toplevel'])?.trim();
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

  // In-flight packages live on their own branches, checked out in their own worktrees, so the session's checkout
  // alone misses them. Every readable worktree is scanned at the same place relative to its toplevel; the session's
  // own checkout first, so it wins a tie.
  const all = worktrees(projectDir);
  const branches = all.filter(tree => tree.branch).map(tree => tree.branch);
  const sub = path.relative(top, projectDir);
  const prefix = path.relative(top, features).split(path.sep).join('/');
  const home = realpath(projectDir) ?? projectDir;
  const topReal = realpath(top) ?? top;
  const trees = [{ project: projectDir, root: projectDir, where: undefined }];
  for (const tree of all) {
    if (!tree.readable || (realpath(tree.path) ?? tree.path) === topReal) continue;
    const project = path.join(tree.path, sub);
    const real = realpath(project);
    if (!real) continue;
    const rel = path.relative(home, real);
    const where = rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.split(path.sep).join('/') : real;
    // A path that fails the charset is never echoed (it would reach a prompt through Resume and the notice).
    if (!WORKTREE_RE.test(where)) continue;
    trees.push({ project, root: tree.path, where });
  }
  const scanned = trees.filter(tree => fs.existsSync(path.join(tree.project, 'docs', 'features')));
  if (!hasFeatures && scanned.length === 0) return { ...base, repo };

  // One `git log --all` serves every tree (they share the repository); what differs from HEAD is per tree.
  const committed = commitTimes(projectDir);
  /** The same package seen in several checkouts: the copy with the newest activity wins (a tie keeps the earlier). */
  const chosen = new Map();
  for (const tree of scanned) {
    const found = scanTree(path.join(tree.project, 'docs', 'features'), { prefix, committed, dirty: dirtyPaths(tree.root) });
    for (const pkg of found) {
      const held = chosen.get(pkg.dir);
      if (held && held.lastActivity >= pkg.lastActivity) continue;
      chosen.set(pkg.dir, tree.where === undefined ? pkg : { ...pkg, worktree: tree.where });
    }
  }

  const packages = [...chosen.values()]
    .sort((a, b) => (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0))
    .map(pkg => {
      const hasWorktree = branches.some(branch => branch === pkg.slug || branch.endsWith(`/${pkg.slug}`));
      const state =
        pkg.status !== 'in-flight' ? 'concluded' : hasWorktree || ageDays(now, pkg.lastActivity) < stale ? 'live' : 'dormant';
      const { dir, date, slug, status, lastActivity, about, ...rest } = pkg;

      return { dir, date, slug, status, state, lastActivity, hasWorktree, about, ...rest };
    });

  // Work committed in another worktree is activity here too: the session's HEAD never sees it.
  const elsewhere = packages.some(pkg => pkg.worktree !== undefined && ageDays(now, pkg.lastActivity) < stale);

  return { ...base, repo: { ...repo, hasFeatures: hasFeatures || scanned.length > 0, hasRecentDoc: repo.hasRecentDoc || elsewhere }, packages };
}

/** Line format for shell consumers: no free text, only validated names and enums. */
function tsv(standing) {
  if (!standing.repo) return '';
  const { repo } = standing;
  const lines = [['repo', repo.hasFeatures ? 1 : 0, repo.hasRecentDoc ? 1 : 0, repo.lastCommit, repo.commitAgeDays].join('\t')];
  for (const pkg of standing.packages) {
    lines.push(['pkg', pkg.dir, pkg.status, pkg.state, pkg.baton ?? '', pkg.worktree ?? ''].join('\t'));
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
