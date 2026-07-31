// `resolvePortOffset` — which port block a serve lands on.
//
// WHAT THIS GUARDS. The main tree used to take offset 0 unconditionally, which is what made a second
// serve destructive: both stacks claimed the base ports, and since the launch chain reaps before it
// starts, the second took them by tearing down the first — a suite the developer was using. The rule
// is now "prefer the base ports, take them only when free". If that probe is ever dropped, the
// symptom is not a test failure anywhere: it is someone's emulators dying again.
//
// The module injects `probe` precisely so this is testable without sockets. It had never been used.
import { resolvePortOffset, OFFSET_STEP, MAX_BLOCK, BASE_APP_PORT, blockForKey } from '../../plugins/project-starter/skills/new-project/assets/nx-tools/src/executors/serve/port-offset.ts';

let failed = 0;
const ok = (label, cond) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}`);
  if (!cond) failed = 1;
};

const freeAll = async () => true;
const busy = (...ports) => async (p) => !ports.includes(p);

// ── Explicit specs are honoured verbatim ──────────────────────────────────────────────────────────
ok('undefined -> base stack',            (await resolvePortOffset(undefined, 'k', false, freeAll)) === 0);
ok("'0' -> base stack",                  (await resolvePortOffset('0', 'k', false, freeAll)) === 0);
ok('pinned integer is returned as-is',   (await resolvePortOffset(12000, 'k', false, freeAll)) === 12000);
ok('numeric string is accepted',         (await resolvePortOffset('12000', 'k', false, freeAll)) === 12000);
let threw = false;
try { await resolvePortOffset('nonsense', 'k', false, freeAll); } catch { threw = true; }
ok('a bad spec throws rather than guessing', threw);

// ── auto, MAIN tree: prefer the base ports, but only when free ────────────────────────────────────
ok('auto + main + base free -> 0 (unchanged)', (await resolvePortOffset('auto', 'k', true, freeAll)) === 0);

// THE REGRESSION GUARD. Base occupied means something is already serving there; a preference is not
// a licence to evict it.
const shifted = await resolvePortOffset('auto', 'k', true, busy(BASE_APP_PORT));
ok('auto + main + base BUSY -> shifts away', shifted !== 0);
ok('  ...onto a real block',                 shifted % OFFSET_STEP === 0 && shifted > 0);

// ── auto, worktree: stable, and verified free ─────────────────────────────────────────────────────
const a = await resolvePortOffset('auto', 'tree-a', false, freeAll);
const b = await resolvePortOffset('auto', 'tree-a', false, freeAll);
ok('auto + worktree is stable across runs', a === b && a > 0);
ok('  ...and matches its key block',         a === blockForKey('tree-a') * OFFSET_STEP);

// Its natural block is taken (another worktree that hashes alike) — walk to the next free one.
const natural = blockForKey('tree-b') * OFFSET_STEP;
const walked = await resolvePortOffset('auto', 'tree-b', false, busy(BASE_APP_PORT + natural));
ok('a busy block walks to the next',         walked !== natural && walked > 0);

// Everything busy: throw rather than return a colliding offset.
threw = false;
const allBusy = async (p) => false;
try { await resolvePortOffset('auto', 'tree-c', false, allBusy); } catch { threw = true; }
ok('no free block throws rather than collide', threw);

// A main tree with everything busy must throw too, not silently fall back to 0 — falling back is the
// old behaviour, and it would evict whatever holds the base ports.
threw = false;
try { await resolvePortOffset('auto', 'tree-d', true, allBusy); } catch { threw = true; }
ok('main + nothing free throws, never falls back to 0', threw);

process.exit(failed);
