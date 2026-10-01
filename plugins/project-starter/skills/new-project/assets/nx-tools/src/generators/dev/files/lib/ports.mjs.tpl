// Port blocks — which offset a serve lands on. GENERATOR-OWNED (@bespunky/nx-tools:dev); rewritten every sync.
//
// A served app declares every port its stack occupies (.bespunky/dev.json → processes[].ports). To let two
// stacks of the same app coexist — the main tree and a worktree, or two worktrees — EVERY declared port is
// shifted by ONE offset. For a shifted stack never to touch the base stack (nor another shifted one), the
// offset must step by more than the span the declared ports cover. So the block is SIZED FROM THE
// DECLARATION, never from a constant: an app that declares only :4200 steps by 1000 and has dozens of
// blocks; the Firebase suite (4000..9199) steps by 6000 and has nine — exactly what the old hard-coded
// executor used, which is why that case is unchanged.
import { createServer } from 'node:net';

/** Highest TCP port. Every shifted port must stay at or under it. */
const MAX_PORT = 65535;
/** Steps are rounded up to a whole thousand, so an offset reads as a human number (6000, not 5200). */
const STEP_GRAIN = 1000;

/**
 * The offset block for a set of declared base ports: `step` (the distance between blocks — larger than the
 * span, so blocks never overlap) and `blocks` (how many non-zero blocks fit under 65535).
 */
export function portBlock(ports) {
  if (!ports.length) throw new Error('an app must declare at least one port');
  const min = Math.min(...ports);
  const max = Math.max(...ports);
  const step = Math.ceil((max - min + 1) / STEP_GRAIN) * STEP_GRAIN;
  const blocks = Math.floor((MAX_PORT - max) / step);
  if (blocks < 1) throw new Error(`declared ports ${min}..${max} leave no room for an offset block under ${MAX_PORT}`);
  return { min, max, step, blocks };
}

/** Stable small hash of a string → a block index in [1, blocks]. Same tree → same block across restarts. */
export function blockForKey(key, blocks) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return (h % blocks) + 1;
}

/** Is a TCP port free to bind on loopback? */
export function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '127.0.0.1');
  });
}

async function allFree(ports, offset, probe) {
  for (const port of ports) if (!(await probe(port + offset))) return false;
  return true;
}

/**
 * Resolve the offset for a serve.
 *
 *   spec      `--port-offset`: '' / '0' → 0 (base stack); a non-negative integer → pinned; 'auto' → derived.
 *   key       the tree's stable identity (branch, else path) — its natural block.
 *   isMain    the repository's primary worktree.
 *   probed    the ports whose freedom decides a block (the PRIMARY process's ports — the app's own).
 *   block     portBlock() of every declared port.
 *   probe     injected so the rule is testable without sockets.
 *
 * auto: the MAIN tree PREFERS offset 0 — the forwarded ports are the developer's, and an OAuth origin may be
 * registered on them — but takes it only when FREE. Occupied means a stack is already serving there, and a
 * preference is not a licence to evict it, so the run shifts like any other. A worktree takes its natural
 * block, verified free, walking to the next free block on a collision. All busy → throw, never collide.
 */
export async function resolvePortOffset(spec, { key, isMain = false, probed, block, probe = isPortFree }) {
  const s = String(spec ?? '').trim().toLowerCase();
  if (s === '' || s === '0') return 0;

  if (s !== 'auto') {
    const n = Number(s);
    if (!Number.isInteger(n) || n < 0) {
      throw new Error(`--port-offset must be 'auto', 0, or a positive integer (got '${spec}')`);
    }
    if (block.max + n > MAX_PORT) throw new Error(`--port-offset=${n} pushes declared port ${block.max} past ${MAX_PORT}`);
    return n;
  }

  if (isMain && (await allFree(probed, 0, probe))) return 0;

  const start = blockForKey(key, block.blocks);
  for (let i = 0; i < block.blocks; i++) {
    const index = ((start - 1 + i) % block.blocks) + 1;
    const offset = index * block.step;
    if (await allFree(probed, offset, probe)) return offset;
  }
  throw new Error(
    `no free port block for an isolated serve — all ${block.blocks} blocks are in use. ` +
      `Stop an existing isolated serve, or pass an explicit free --port-offset.`,
  );
}
