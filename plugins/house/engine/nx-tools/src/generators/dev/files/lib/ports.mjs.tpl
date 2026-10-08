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

/** A port question the user can act on (a bad --port-offset, no room to shift) — reported plainly, never as a stack. */
export class PortError extends Error {}

/**
 * The offset block for a set of declared base ports: `step` (the distance between blocks — larger than the
 * span, so blocks never overlap) and `blocks` (how many non-zero blocks fit under 65535). `blocks` may be 0:
 * ports declared high up leave no room to SHIFT, which matters only to a serve that needs to — the base stack
 * (offset 0) is always servable, so the refusal belongs to resolvePortOffset, not here.
 */
export function portBlock(ports) {
  if (!ports.length) throw new PortError('an app must declare at least one port');
  const min = Math.min(...ports);
  const max = Math.max(...ports);
  const step = Math.ceil((max - min + 1) / STEP_GRAIN) * STEP_GRAIN;
  const blocks = Math.max(0, Math.floor((MAX_PORT - max) / step));
  return { min, max, step, blocks };
}

/** Stable small hash of a string → a block index in [1, blocks]. Same tree → same block across restarts. */
export function blockForKey(key, blocks) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return (h % blocks) + 1;
}

/**
 * The addresses a dev server may be listening on. A probe of 127.0.0.1 alone reads a server on ::1 as free — and
 * `localhost` resolves to ::1 first on many hosts (Node 17+ and Vite bind there), so that was the common case,
 * not an edge. The wildcards catch a server bound to every interface.
 */
const PROBE_HOSTS = ['127.0.0.1', '::1', '0.0.0.0', '::'];
/** A host this machine cannot bind at all (no IPv6) says nothing about the port. */
const UNSUPPORTED = new Set(['EADDRNOTAVAIL', 'EAFNOSUPPORT']);

function bindable(port, host) {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once('error', (err) => resolve(UNSUPPORTED.has(err?.code)));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen({ port, host, exclusive: true });
  });
}

/** Is a TCP port free — bindable on every address a server could hold it on? */
export async function isPortFree(port) {
  for (const host of PROBE_HOSTS) if (!(await bindable(port, host))) return false;
  return true;
}

export async function allFree(ports, offset, probe) {
  for (const port of ports) if (!(await probe(port + offset))) return false;
  return true;
}

/**
 * The offsets a serve may take, in the order it should try them — the port-block rule, without the probing.
 *
 *   spec      `--port-offset`: '0' → 0 (base stack); a non-negative integer → pinned; 'auto' → derived.
 *   key       the tree's stable identity (branch, else path) — its natural block.
 *   isMain    the repository's primary worktree.
 *   block     portBlock() of every declared port.
 *
 * An explicit offset is the one candidate (`pinned: true`). auto: the MAIN tree PREFERS offset 0 — the forwarded
 * ports are the developer's, and an OAuth origin may be registered on them — but takes it only when free; a
 * worktree prefers its natural block; then every other block in turn. The first candidate is the PREFERRED one.
 */
export function offsetCandidates(spec, { key, isMain = false, block }) {
  const s = String(spec ?? '').trim().toLowerCase();

  if (s !== 'auto') {
    const n = s === '' ? NaN : Number(s);
    if (!Number.isInteger(n) || n < 0) {
      throw new PortError(`--port-offset must be 'auto', 0, or a positive integer (got '${spec}')`);
    }
    if (block.max + n > MAX_PORT) throw new PortError(`--port-offset=${n} pushes declared port ${block.max} past ${MAX_PORT}`);
    return { pinned: true, offsets: [n] };
  }

  const offsets = isMain ? [0] : [];
  if (block.blocks < 1 && !isMain) {
    throw new PortError(
      `declared ports ${block.min}..${block.max} leave no room to shift by a block under ${MAX_PORT}. ` +
        'Serve the base stack (--port-offset=0), or declare lower ports in .bespunky/dev.json.',
    );
  }
  if (block.blocks >= 1) {
    const start = blockForKey(key, block.blocks);
    for (let i = 0; i < block.blocks; i++) offsets.push((((start - 1 + i) % block.blocks) + 1) * block.step);
  }
  return { pinned: false, offsets };
}

/**
 * Resolve the offset for a serve by probing alone: the first candidate whose `probed` ports are all free (see
 * offsetCandidates). An explicit offset is honoured unprobed. All busy → throw, never collide. The engine claims
 * through lib/stacks.mjs claimStack, which applies the same candidates against the run records as well.
 */
export async function resolvePortOffset(spec, { key, isMain = false, probed, block, probe = isPortFree }) {
  const { pinned, offsets } = offsetCandidates(spec, { key, isMain, block });
  if (pinned) return offsets[0];
  for (const offset of offsets) if (await allFree(probed, offset, probe)) return offset;
  throw noFreeBlock(block, isMain);
}

/** Every block is in use. */
export function noFreeBlock(block, isMain) {
  if (block.blocks < 1) {
    return new PortError(
      `declared ports ${block.min}..${block.max} leave no room to shift by a block under ${MAX_PORT}, and the base ports are in use. ` +
        'Serve the base stack (--port-offset=0) once they are free, or declare lower ports in .bespunky/dev.json.',
    );
  }
  return new PortError(
    `no free port block for an isolated serve — all ${block.blocks} blocks${isMain ? ' and the base ports' : ''} are in use. ` +
      'Stop an existing isolated serve, or pass an explicit free --port-offset.',
  );
}
