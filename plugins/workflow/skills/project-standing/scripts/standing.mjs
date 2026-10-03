#!/usr/bin/env node
// standing.mjs — the project-standing DERIVATION (bespunky-workflow:project-standing).
//
// The ONE place that reads docs/features/ and git and says what each feature package is: its validated name,
// its closing status (from DECISION.md), whether it is live, dormant or concluded, its newest handoff baton,
// and the repo-wide activity facts. Everything that needs those facts consumes THIS script, never its own
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
// not named. Free text (summary, tags) is passed through only in `--json`, for DISPLAY; consumers must never
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
      fields[key] = unquote(value);
    }
  }

  return fields;
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

/** Branch short names checked out in any worktree. */
function worktreeBranches(root) {
  const out = git(root, ['worktree', 'list', '--porcelain']) ?? '';

  return out
    .split('\n')
    .filter(line => line.startsWith('branch refs/heads/'))
    .map(line => line.slice('branch refs/heads/'.length));
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
  if (!hasFeatures) return { ...base, repo };

  // git reports paths from the toplevel; map them back onto docs/features/<pkg>/... under projectDir.
  const prefix = path.relative(top, features).split(path.sep).join('/');
  const committed = commitTimes(projectDir);
  const dirty = dirtyPaths(projectDir);
  const branches = worktreeBranches(projectDir);

  /** A file's activity: its mtime while it differs from HEAD, else its newest commit, else its mtime. */
  const activity = (relFromFeatures, mtime) => {
    const key = `${prefix}/${relFromFeatures}`;
    if (dirty.has(key)) return mtime;

    return committed.get(key) ?? mtime;
  };

  // Codepoint order, as a C-locale shell glob lists them.
  const names = fs.readdirSync(features).filter(name => !name.startsWith('.')).sort();
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
    const closing = STATUS_RE.exec(decision);
    const status = closing ? closing[1].toLowerCase() : 'in-flight';
    const front = closing ? frontmatter(decision) : {};

    const files = walk(full);
    let lastActivity = 0;
    let baton;
    for (const file of files) {
      const rel = path.relative(features, file.path).split(path.sep).join('/');
      const at = activity(rel, file.mtime);
      lastActivity = Math.max(lastActivity, at);
      const inHandoffs = path.dirname(file.path) === path.join(full, 'handoffs');
      const name = path.basename(file.path);
      if (inHandoffs && BATON_RE.test(name) && (!baton || at > baton.at || (at === baton.at && name > baton.name))) {
        baton = { name, at };
      }
    }
    const hasWorktree = branches.some(branch => branch === slug || branch.endsWith(`/${slug}`));
    const state =
      status !== 'in-flight' ? 'concluded' : hasWorktree || ageDays(now, lastActivity) < stale ? 'live' : 'dormant';

    const pkg = { dir, date: dir.slice(0, 10), slug, status, state, lastActivity, hasWorktree };
    if (baton) pkg.baton = `handoffs/${baton.name}`;
    if (closing) {
      if (typeof front.summary === 'string' && front.summary) pkg.summary = front.summary;
      if (typeof front.concluded === 'string' && front.concluded) pkg.concluded = front.concluded;
      if (front.tags?.length) pkg.tags = front.tags;
    }
    packages.push(pkg);
  }

  return { ...base, repo, packages };
}

/** Line format for shell consumers: no free text, only validated names and enums. */
function tsv(standing) {
  if (!standing.repo) return '';
  const { repo } = standing;
  const lines = [['repo', repo.hasFeatures ? 1 : 0, repo.hasRecentDoc ? 1 : 0, repo.lastCommit, repo.commitAgeDays].join('\t')];
  for (const pkg of standing.packages) lines.push(['pkg', pkg.dir, pkg.status, pkg.state, pkg.baton ?? ''].join('\t'));

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
