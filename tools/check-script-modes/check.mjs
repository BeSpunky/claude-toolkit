#!/usr/bin/env node
/**
 * Guard ONE invariant: a tracked file that declares a shebang must be executable.
 *
 * WHY THIS EXISTS — and why "Permission denied is loud" was the wrong reason not to build it.
 *
 * `tools/publish-nx-tools/publish.sh` sat at mode 100644 for an unknown length of time while CLAUDE.md
 * (three places), the tool's own README (twice) and docs/reusable-tool-extraction.md all documented running
 * it as a bare command. Nothing caught it, because every caller INSIDE the repo routes through an
 * interpreter — the publish workflow runs `bash tools/publish-nx-tools/publish.sh`, run.sh runs `bash "$t"`,
 * the pre-push hook runs `node …`. CI was green while running the very script that was broken. A failure
 * that is loud when it fires but is never fired is, in practice, silent: it is discovered by a human
 * following the documentation, which is the worst place to discover it.
 *
 * The fix was applied by hand across six files — and the hand-run sweep that verified it was WRONG,
 * reporting two remaining exceptions where there were thirteen, because it silently excluded `.tpl` files.
 * That is the real argument for a checker: not that the failure is subtle, but that the SWEEP is, and a
 * sweep re-run by hand is a sweep that will be wrong again.
 *
 * SCOPE — the forward direction only: shebang ⇒ executable. The reverse (executable ⇒ shebang) holds in
 * this repo today, but it is not a rule worth asserting: a committed binary would be a legitimate
 * counter-example, and a guard that would have to be argued with is a guard that gets disabled.
 *
 * Uses only node builtins and `git`, exactly like tools/check-release-invariants/check.mjs — so it cannot
 * be broken by a dependency that failed to resolve.
 */
import { execFileSync } from 'node:child_process';
import { openSync, readSync, closeSync } from 'node:fs';

/**
 * Paths that legitimately carry a shebang while staying non-executable, each with the reason.
 *
 * NEVER a bare glob with no justification: an exemption nobody can read is how thirteen files hid behind a
 * sweep that claimed two. Every entry is a PREDICATE plus the sentence that earns it, and the reasons are
 * printed on every run so the exemption surface stays visible rather than accumulating in silence.
 */
const EXEMPT = [
  {
    reason:
      'A `.tpl` is generator INPUT — content this repo stores and a generator copies into a consumer ' +
      'project. It is never executed from this repo, so its mode here means nothing. (What mode the ' +
      'generator gives its OUTPUT is a separate question, decided in the generator via ' +
      "`tree.write(path, content, { mode: 0o755 })` — see the shared-browser and worktree-domains generators.)",
    matches: (path) => path.endsWith('.tpl'),
  },
  {
    reason:
      'Written into THIS repo by the devcontainer generator (the dogfooded container), and invoked as ' +
      '`bash <path>` by devcontainer.json. Its mode is inert, and forcing 755 here would make this repo ' +
      'the one project whose copy differs from what the generator produces everywhere else.',
    matches: (path) => path === '.devcontainer/post-create.sh' || path === '.devcontainer/post-create.local.sh',
  },
];

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/** First two bytes of a file, or null when it cannot be read. Never throws — the caller must SEE a miss. */
function firstTwoBytes(path) {
  let fd;
  try {
    fd = openSync(path, 'r');
    const buf = Buffer.alloc(2);
    const read = readSync(fd, buf, 0, 2, 0);
    return read === 2 ? buf.toString('latin1') : '';
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

// `git ls-files -s` → "<mode> <sha> <stage>\t<path>". The INDEX mode is the one that travels in a clone,
// which is what actually matters; the filesystem mode is a local detail (and is ignored outright wherever
// core.fileMode is false, e.g. a Windows checkout).
const entries = git(['ls-files', '-s'])
  .split('\n')
  .filter(Boolean)
  .map((line) => {
    const [meta, path] = line.split('\t');
    const [mode] = meta.split(' ');
    return { mode, path };
  });

// NEVER GUESS GREEN. An empty enumeration means the checker could not see the repo, not that the repo is
// clean — the same stance check-release-invariants takes on a shallow clone.
if (entries.length === 0) {
  console.error('check-script-modes: `git ls-files` returned nothing — refusing to report success.');
  process.exit(2);
}

const violations = [];
const exempted = [];
const unreadable = [];
let shebangCount = 0;

for (const { mode, path } of entries) {
  const head = firstTwoBytes(path);
  if (head === null) {
    unreadable.push(path);
    continue;
  }
  if (head !== '#!') continue;
  shebangCount++;

  const exemption = EXEMPT.find((rule) => rule.matches(path));
  if (exemption) {
    exempted.push({ path, reason: exemption.reason });
    continue;
  }
  if (mode !== '100755') violations.push({ path, mode });
}

console.log(
  `check-script-modes: ${entries.length} tracked files, ${shebangCount} with a shebang, ` +
    `${exempted.length} exempt, ${violations.length} violating.`
);

// The exemption surface is printed EVERY run, passing or failing. A silent exemption is the thing that let
// eleven templates hide behind a sweep that reported two.
const reasons = [...new Set(exempted.map((e) => e.reason))];
for (const reason of reasons) {
  const paths = exempted.filter((e) => e.reason === reason).map((e) => e.path);
  console.log(`\n  exempt (${paths.length}): ${reason}`);
  for (const path of paths) console.log(`    - ${path}`);
}

if (unreadable.length) {
  console.error(`\ncheck-script-modes: could not read ${unreadable.length} tracked file(s) — refusing to report success.`);
  for (const path of unreadable) console.error(`    - ${path}`);
  process.exit(2);
}

if (violations.length) {
  console.error(`\n${violations.length} script(s) declare a shebang but are not executable:\n`);
  for (const { path, mode } of violations) console.error(`  ✗ ${path} (${mode})`);
  console.error(
    `\n  fix: git update-index --chmod=+x ${violations.map((v) => v.path).join(' ')}\n` +
      `       (and \`chmod +x\` the same paths so your working tree agrees)\n\n` +
      `A shebang is a declaration that the file may be run directly. When it cannot be, the failure is\n` +
      `discovered by whoever follows the documentation — every caller inside this repo passes scripts to\n` +
      `an interpreter explicitly, so nothing else will ever notice.\n\n` +
      `If a file genuinely should stay non-executable, add it to EXEMPT in this checker WITH ITS REASON —\n` +
      `never by loosening the rule.`
  );
  process.exit(1);
}

console.log('\nok: every tracked file with a shebang is executable.');
