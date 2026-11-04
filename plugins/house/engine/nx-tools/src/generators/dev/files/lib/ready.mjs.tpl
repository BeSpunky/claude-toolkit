// READINESS — what "up" means for a process, and the one way it is asked. GENERATOR-OWNED (@bespunky/nx-tools:dev);
// rewritten every sync.
//
// A probe is the RESOLVED form of a declaration's `ready` (lib/declaration.mjs): ports shifted, substitutions done.
//   { http: '<url>' }   the URL answers at all (any status: a 404 still means the server is up)
//   { tcp: <port> }     the port accepts a connection, on localhost
//   { cmd: '<shell>' }  the command exits 0 — through `sh -c`, in the process's own environment
//
// The stack gates on it (a dependency, lib/stack.mjs), and so do `serve`'s "Up:" line and `with` (the primary). Which
// kind a process uses says nothing about what it is: a port that accepts a connection is not always a server that is
// ready (a database accepts them before its migrations ran), and a command can ask the real question.
import { spawn } from 'node:child_process';
import { get } from 'node:http';
import { connect } from 'node:net';

const ATTEMPT_MS = 2000;
const POLL_MS = 150;

/** The probe, in words — for whoever is told what is being waited on. */
export function describeProbe(probe) {
  if (probe.http !== undefined) return `HTTP ${probe.http}`;
  if (probe.tcp !== undefined) return `TCP port ${probe.tcp}`;
  return `command: ${probe.cmd}`;
}

function http(url) {
  return new Promise((done) => {
    const req = get(url, (res) => {
      res.resume();
      done({ ok: true });
    });
    req.setTimeout(ATTEMPT_MS, () => req.destroy());
    req.on('error', (err) => done({ ok: false, said: err.message }));
  });
}

function tcp(port) {
  return new Promise((done) => {
    const socket = connect({ port, host: 'localhost' });
    const end = (result) => {
      socket.destroy();
      done(result);
    };
    socket.setTimeout(ATTEMPT_MS, () => end({ ok: false, said: 'no answer' }));
    socket.on('connect', () => end({ ok: true }));
    socket.on('error', (err) => end({ ok: false, said: err.message }));
  });
}

/**
 * The command, in a process group of its own, because it may hang, and whatever it started must go with it when the
 * wait ends. It holds no lock: a probe is not a member of the stack (fd 3 is the stack's), so it can never keep one alive.
 */
function command(cmd, { cwd, env, signal }) {
  return new Promise((done) => {
    const proc = spawn('sh', ['-c', cmd], { cwd, env, detached: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let said = '';
    proc.stderr.on('data', (chunk) => (said = `${said}${chunk}`.slice(-400)));
    const kill = () => {
      try {
        process.kill(-proc.pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    };
    signal?.addEventListener('abort', kill, { once: true });
    const end = (result) => {
      signal?.removeEventListener('abort', kill);
      proc.stderr.destroy(); // a descendant it left behind may hold the pipe open
      done({ ...result, said: said.trim() || result.said });
    };
    proc.on('error', (err) => end({ ok: false, said: err.message }));
    proc.on('exit', (code, sig) => end({ ok: code === 0, said: `exited ${sig ?? code}` }));
  });
}

/** Ask once. `{ ok, said }`: `said` is what the failed attempt answered, for the report. */
export function probeOnce(probe, { cwd, env, signal } = {}) {
  if (probe.http !== undefined) return http(probe.http);
  if (probe.tcp !== undefined) return tcp(probe.tcp);
  return command(probe.cmd, { cwd, env, signal });
}

/**
 * Ask until it says yes, the time runs out, or `signal` ends the wait. `{ ok, aborted, said }`; never throws. A command
 * that hangs is killed at the deadline, so a wait is bounded whatever the probe does.
 */
export async function waitUntilReady(probe, { cwd, env, signal, timeoutMs }) {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), timeoutMs);
  const either = AbortSignal.any([deadline.signal, ...(signal ? [signal] : [])]);
  let said;
  try {
    while (!either.aborted) {
      const attempt = await probeOnce(probe, { cwd, env, signal: either });
      if (attempt.ok && !either.aborted) return { ok: true };
      said = attempt.said ?? said;
      if (either.aborted) break;
      await new Promise((resume) => {
        const wake = () => {
          clearTimeout(pause);
          either.removeEventListener('abort', wake);
          resume();
        };
        const pause = setTimeout(wake, POLL_MS);
        either.addEventListener('abort', wake);
      });
    }
    return { ok: false, aborted: Boolean(signal?.aborted), said };
  } finally {
    clearTimeout(timer);
  }
}
