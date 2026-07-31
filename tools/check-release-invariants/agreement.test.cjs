// Pin the version comparators that CANNOT be unified.
//
// `rules.cjs` is the single implementation for everything in this repo — the invariants checker, publish.sh,
// and the publish workflow all call it. `scaffold.sh` cannot: it ships to consumers and runs inside THEIR
// projects, where this repo does not exist. That is the same self-containment constraint the migrations live
// under, so its two comparators are a deliberate, permanent duplicate.
//
// A duplicate you have decided to keep needs a TEST. A duplicate you merely tolerate gets a comment asking
// people to keep it in sync — which is what publish.sh had, and the copies had already diverged anyway.
//
// ── WHAT MUST AGREE, AND WHAT MUST NOT ─────────────────────────────────────────────────────────────────────
//
// On WELL-FORMED semver the three must order identically, or the two halves of one decision disagree: the
// probe decides which version a project is on, the collector decides which migrations fall in the range, and
// the release guard decides whether a migration is reachable at all. A prerelease sorting above its release
// in one of them and below it in another is how a migration gets skipped with nothing reporting it.
//
// On MALFORMED input they deliberately differ, and the test asserts that too:
//   - `_vlt` (scaffold.sh's probe) degrades to "equal", so an unreadable stamp makes a sync a no-op for that
//     comparison rather than refusing — refusing would block a consumer over a typo they cannot see.
//   - `rules.cjs` throws / reports, because a version that cannot be ordered cannot be shown reachable, and
//     this side is a guard whose whole job is to refuse when it cannot tell.
// Both are right for where they run. Encoding it here stops a future reader "fixing" one into the other.
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { compareVersions, parseVersion } = require('./rules.cjs');

const SCAFFOLD = join(__dirname, '../../plugins/project-starter/skills/new-project/assets/scaffold.sh');
const source = readFileSync(SCAFFOLD, 'utf8');

/** Undo bash double-quote escaping, so the embedded node source can be evaluated as written. */
const unescapeBash = (s) => s.replace(/\\(["`$\\])/g, '$1');

/**
 * scaffold.sh's `--local` migration COLLECTOR comparator, lifted out of the file rather than restated here —
 * a restatement would be a fourth copy, and could drift from the thing it claims to pin.
 */
function extractCollectorComparator() {
  const m = /const p=v=>String\(v\)\.split\('-'\)[\s\S]*?const c=\(a,b\)=>\{[\s\S]*?return 0\};/.exec(source);
  if (!m) throw new Error('Could not find the collector comparator in scaffold.sh — has it moved or changed shape?');
  // eslint-disable-next-line no-new-func
  return new Function(`${unescapeBash(m[0])} return c;`)();
}

/** scaffold.sh's PROBE predicate `_vlt a b` — "is a strictly less than b". */
function extractProbeLessThan() {
  // Bounded to the whole `node -e` body: the block contains several `process.exit(1)` calls, so a
  // non-greedy match stops at the first one and silently yields a truncated (and useless) comparator.
  const m = /const core=v=>\{[\s\S]*?\n\s*process\.exit\(1\);\n\s*\\"/.exec(source);
  if (!m) throw new Error('Could not find _vlt in scaffold.sh — has it moved or changed shape?');
  // The bound above deliberately includes the closing `\"` of the bash string so the match cannot run past
  // the block; drop it (and anything after the final statement) before evaluating.
  const END = 'process.exit(1);';
  const body = unescapeBash(m[0].slice(0, m[0].lastIndexOf(END) + END.length))
    .replace(/const a=process\.argv\[1\],b=process\.argv\[2\];/, '')
    // `process.exit(` -> `return LT(` rather than a regex that tries to capture the argument: the
    // arguments contain nested parens (`isPre(a)?0:1`), and a non-greedy `(.+?)\)` closes on the inner
    // one, silently producing `return (isPre(a) === 0?0:1)` — which returns 1, not a boolean.
    .replace(/process\.exit\(/g, 'return LT(');
  // eslint-disable-next-line no-new-func
  return new Function('a', 'b', `const LT = (code) => code === 0;\n${body}`);
}

const collectorCompare = extractCollectorComparator();
const probeLessThan = extractProbeLessThan();

// Well-formed versions only — the domain all three are required to agree on.
const VERSIONS = [
  '0.0.1', '0.24.0', '0.24.1', '0.24.6', '0.25.0', '0.25.1', '0.26.0', '1.0.0', '1.0.1', '1.2.3', '2.0.0',
  '0.25.0-rc.1', '0.25.0-rc.2', '0.24.0-rc.1', '1.0.0-alpha', '1.0.0-beta',
];

const sign = (n) => (n < 0 ? -1 : n > 0 ? 1 : 0);
let pass = 0;
const failures = [];
const check = (name, ok, detail) => (ok ? pass++ : failures.push(`${name}${detail ? ` — ${detail}` : ''}`));

/**
 * Two prereleases of the SAME core (0.25.0-rc.1 vs 0.25.0-rc.2) are outside the shared contract.
 *
 * scaffold.sh's comparators distinguish prerelease PRESENCE only — an rc is below its own release — and treat
 * two rcs of one release as equal, which is all the migration range ever needs to know. `rules.cjs` orders
 * them, because the ceiling check may have to rank two prerelease payload versions. The coarser answer is
 * asserted explicitly below rather than quietly skipped, so the difference stays a decision.
 */
const bothPreOfSameCore = (a, b) => {
  const [x, y] = [parseVersion(a), parseVersion(b)];
  return x.prerelease !== null && y.prerelease !== null &&
    x.core.join('.') === y.core.join('.') && x.prerelease !== y.prerelease;
};

for (const a of VERSIONS) {
  for (const b of VERSIONS) {
    const mine = sign(compareVersions(a, b));

    if (bothPreOfSameCore(a, b)) {
      check(`collector is coarse for ${a} vs ${b}`, sign(collectorCompare(a, b)) === 0);
      check(`probe is coarse for ${a} vs ${b}`, probeLessThan(a, b) === false);
      continue;
    }

    check(
      `collector vs rules: ${a} ? ${b}`,
      sign(collectorCompare(a, b)) === mine,
      `collector=${sign(collectorCompare(a, b))} rules=${mine}`
    );
    check(
      `probe vs rules: ${a} < ${b}`,
      probeLessThan(a, b) === mine < 0,
      `probe=${probeLessThan(a, b)} rules=${mine < 0}`
    );
  }
}

// The intentional divergence, asserted so nobody "fixes" it.
const MALFORMED = ['', 'not-a-version', '1.2', 'v1.2.3'];
for (const bad of MALFORMED) {
  check(`rules refuses to order ${JSON.stringify(bad)}`, parseVersion(bad) === null);
  let threw = false;
  try {
    compareVersions(bad, '1.0.0');
  } catch {
    threw = true;
  }
  check(`rules throws comparing ${JSON.stringify(bad)}`, threw);
  check(
    `probe degrades ${JSON.stringify(bad)} to a non-refusal`,
    typeof probeLessThan(bad, '1.0.0') === 'boolean'
  );
}

if (failures.length) {
  console.error(`\n${failures.length} comparator disagreement(s):\n`);
  for (const f of failures.slice(0, 20)) console.error(`  ✗ ${f}`);
  if (failures.length > 20) console.error(`  …and ${failures.length - 20} more`);
  console.error(
    '\nscaffold.sh and tools/check-release-invariants/rules.cjs must order well-formed versions identically.\n' +
      'They are separate implementations by necessity (scaffold.sh runs in consumers\' projects), so this test\n' +
      'is the only thing keeping them honest.\n'
  );
  process.exit(1);
}

console.log(`ok: ${pass} comparator assertions agree (${VERSIONS.length}² orderings × 2 + malformed-input contract)`);
