import { createServer } from 'node:net';

/**
 * A running Firebase stack occupies a spread of ports (app 4200, UI 4000, auth 9099,
 * firestore 8080, storage 9199, functions 5001, hub 4400, logging 4500) — a span of
 * ~4000..9199. To let two stacks coexist we shift EVERY port of the isolated stack by a
 * single OFFSET. For the shifted ports to never touch the base stack's ports (nor another
 * offset stack's), the offset step must exceed that span — so we step in blocks of
 * {@link OFFSET_STEP}. Offset 0 is the base/forwarded stack (the main tree's); Claude's
 * isolated worktree serves take a non-zero block.
 */
export const OFFSET_STEP = 6000;
/** Max block index — offset OFFSET_STEP*MAX_BLOCK keeps every shifted port < 65535. */
export const MAX_BLOCK = 9;
/** House app dev-server base port (Angular default); the isolated app serves at BASE_APP_PORT + offset. */
export const BASE_APP_PORT = 4200;

/** Stable small hash of a string → a block index in [1, MAX_BLOCK]. */
export function blockForKey(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return (h % MAX_BLOCK) + 1;
}

/** Is a TCP port free to bind on localhost? */
export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '127.0.0.1');
  });
}

/**
 * Resolve the port offset for a serve.
 *
 * `spec` is the executor's `--portOffset` value:
 *   - undefined / '' / '0'  → 0 (base stack — no isolation, forwarded ports).
 *   - a positive integer    → that exact offset, pinned.
 *   - 'auto'                → derived from the RESOLVED TREE:
 *       · the MAIN tree is ALWAYS offset 0 (`isMain` → guaranteed base stack — the developer's
 *         forwarded ports belong to it, and there is exactly one main tree); so real Google OAuth on
 *         localhost:4200 is pinned to it.
 *       · a worktree gets a STABLE block derived from `treeKey` (same worktree → same ports across
 *         restarts), VERIFIED free at launch: if that block's app port is taken, walk to the next free
 *         block so two worktrees that hash alike still never collide. Throws if all blocks are busy.
 *
 * `probe` is injected so the resolution is unit-testable without real sockets.
 */
export async function resolvePortOffset(
  spec: string | number | undefined,
  treeKey: string,
  isMain = false,
  probe: (port: number) => Promise<boolean> = isPortFree
): Promise<number> {
  // Coerce to string first: the Nx CLI passes `--portOffset=12000` through as a NUMBER (it coerces
  // numeric args), while 'auto'/'0' arrive as strings — String() normalizes both so the parse below is
  // uniform (and .trim()/.toLowerCase() can't blow up on a number).
  const s = String(spec ?? '').trim().toLowerCase();
  if (s === '' || s === '0') return 0;

  if (s !== 'auto') {
    const n = Number(s);
    if (!Number.isInteger(n) || n < 0) {
      throw new Error(`[serve] --portOffset must be 'auto', 0, or a positive integer (got '${spec}').`);
    }
    return n;
  }

  // auto: the main tree owns the base/forwarded stack — never shift it.
  if (isMain) return 0;

  // auto (worktree): stable start block, then walk to the first block whose app port is free.
  const start = blockForKey(treeKey);
  for (let i = 0; i < MAX_BLOCK; i++) {
    const block = ((start - 1 + i) % MAX_BLOCK) + 1;
    const offset = block * OFFSET_STEP;
    if (await probe(BASE_APP_PORT + offset)) return offset;
  }
  throw new Error(
    `[serve] no free port block for an isolated worktree serve — all ${MAX_BLOCK} blocks are in use. ` +
      `Stop an existing isolated serve, or pass an explicit free --portOffset.`
  );
}
