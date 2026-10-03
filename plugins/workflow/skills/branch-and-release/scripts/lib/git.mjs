// The engine's ONLY door to git — and it opens for reading alone.
//
// The engine plans and verifies; it never moves a branch. That promise is enforced here, not remembered at
// each call site: every invocation is checked against an allowlist of read-only subcommands, so a future edit
// that reaches for `git merge` fails loudly in the first test run instead of quietly in someone's repo.
import { execFileSync } from 'node:child_process';

const READ_ONLY = new Set([
  'rev-parse', 'show', 'log', 'merge-base', 'cherry', 'for-each-ref', 'rev-list', 'diff-tree', 'diff',
  'show-ref', 'cat-file', 'ls-files', 'config', 'worktree', 'patch-id',
]);
// Subcommands that are read-only only with these first arguments.
const READ_ONLY_ARGS = { config: ['--get', '--get-all', '--list'], worktree: ['list'] };

// One rendering for every patch whose id is compared: no colour, no external diff, renames as plain add/delete.
const DIFF_FLAGS = ['--no-color', '--no-ext-diff', '--no-renames'];

const ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' };

export class Git {
  constructor(cwd) {
    this.cwd = cwd;
  }

  /** Run a read-only git command (`input` → its stdin); returns trimmed stdout. Throws on a non-zero exit. */
  run(args, input) {
    const [sub, first] = args;
    if (!READ_ONLY.has(sub) || (READ_ONLY_ARGS[sub] && !READ_ONLY_ARGS[sub].includes(first))) {
      throw new Error(`branches.mjs refuses to run a state-changing git command: git ${args.join(' ')}`);
    }
    return execFileSync('git', args, { cwd: this.cwd, env: ENV, encoding: 'utf8', ...(input === undefined ? { stdio: ['ignore', 'pipe', 'pipe'] } : { input, stdio: ['pipe', 'pipe', 'pipe'] }), maxBuffer: 256 * 1024 * 1024 }).replace(/\s+$/, '');
  }

  /** Like run(), but null instead of throwing. */
  try(args, input) {
    try {
      return this.run(args, input);
    } catch {
      return null;
    }
  }

  lines(args) {
    const out = this.try(args);
    return out ? out.split('\n').filter(Boolean) : [];
  }

  /** True when the command exits 0 (e.g. merge-base --is-ancestor). */
  ok(args) {
    return this.try(args) !== null;
  }

  top() {
    return this.run(['rev-parse', '--show-toplevel']);
  }

  /** The ref a line name resolves to — the same rule as resolving the model (CONTRACT, Amendment 2): of the local
   *  branch and `<remote>/<name>`, whichever exists; both → the one that descends from the other; diverged → the
   *  local one. (Under PR flows a local line never moves, so "local first" would read a stale line.) */
  ref(name, remote = 'origin') {
    const [local, tracking] = [`refs/heads/${name}`, `refs/remotes/${remote}/${name}`].map((r) => (this.ok(['show-ref', '--verify', '--quiet', r]) ? r : null));
    if (local && tracking && this.isAncestor(local, tracking) && !this.isAncestor(tracking, local)) return tracking;
    return local ?? tracking;
  }

  sha(ref) {
    return this.try(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  }

  isAncestor(a, b) {
    return this.ok(['merge-base', '--is-ancestor', a, b]);
  }

  /** Every branch name, local and remote-tracking (remote prefix stripped), deduplicated. */
  branchNames(remote = 'origin') {
    const names = new Set();
    for (const line of this.lines(['for-each-ref', '--format=%(refname)', 'refs/heads', `refs/remotes/${remote}`])) {
      if (line.startsWith('refs/heads/')) names.add(line.slice('refs/heads/'.length));
      else {
        const name = line.slice(`refs/remotes/${remote}/`.length);
        if (name !== 'HEAD') names.add(name);
      }
    }
    return [...names].sort();
  }

  parents(sha) {
    return (this.try(['rev-list', '--parents', '-n', '1', sha]) || '').split(' ').slice(1);
  }

  message(sha) {
    return this.try(['log', '-1', '--format=%B', sha]) || '';
  }

  /** Stable patch-ids of a patch stream (`log -p` / `diff` args): [{ patch, commit }] — `commit` is all zeros
   *  for a bare diff. Both sides of a comparison must come through here, so they are rendered alike. */
  patchIds(args) {
    const patch = this.try([...args.slice(0, 1), ...DIFF_FLAGS, ...args.slice(1)]);
    if (!patch) return [];
    const out = this.try(['patch-id', '--stable'], `${patch}\n`);
    return (out ? out.split('\n').filter(Boolean) : []).map((l) => {
      const [p, c] = l.split(' ');
      return { patch: p, commit: c };
    });
  }

  subject(sha) {
    return this.try(['log', '-1', '--format=%s', sha]) || '';
  }
}
