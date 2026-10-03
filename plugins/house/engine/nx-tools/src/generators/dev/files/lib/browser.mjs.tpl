// The serve's view layer — the shared co-driven browser, the pretty `<slug>.localhost` route, and who owns
// the host ports. GENERATOR-OWNED (@bespunky/nx-tools:dev); rewritten every sync.
//
// Each piece is a sibling workspace tool this module DRIVES and never re-implements:
//   tools/shared-browser/shared-browser    up | url | navigate
//   tools/worktree-domains/worktree-domains register | unregister
//   tools/port-claim/port-claim.mjs        advise
// Every step is best-effort: a missing tool or a failing step WARNS and is skipped — the stack still serves.
import { execFile, execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const pexec = promisify(execFile);
const tool = (root, ...parts) => join(root, 'tools', ...parts);
const stderrOf = (err) => String(err?.stderr ?? err?.message ?? '').trim();

/**
 * The shared browser's viewer URL, straight from the tool that owns it. The noVNC port is ALLOCATED per
 * container, so it is knowable only by asking; the fallback is an honest instruction, never a guessed port.
 */
export async function sharedBrowserUrl(root, env) {
  const sb = tool(root, 'shared-browser', 'shared-browser');
  try {
    const { stdout } = await pexec('bash', [sb, 'url'], { cwd: root, env });
    const url = String(stdout).trim();
    if (url) return url;
  } catch {
    /* fall through */
  }
  return `(run \`${sb} url\` for the viewer URL)`;
}

/**
 * The identity host ports are claimed with. MUST match `container_key` in tools/shared-browser/shared-browser
 * and tools/worktree-domains/worktree-domains (the devcontainer id, else the git common dir @ hostname), or
 * one container would look like two claimants to the registry.
 */
function containerIdentity(root) {
  const id = process.env.BESPUNKY_DEVCONTAINER_ID;
  if (id) return `dc:${id}`;
  let common = root;
  try {
    const out = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (out) common = resolve(root, out);
  } catch {
    /* not a git tree — the root is the identity */
  }
  let host = 'unknown';
  try {
    host = readFileSync('/etc/hostname', 'utf8').trim() || host;
  } catch {
    /* keep 'unknown', as the shell does */
  }
  return `${common}@${host}`;
}

/**
 * Does ANOTHER devcontainer own this host port? Returns its owner, or null (mine, unclaimed, or unknowable).
 *
 * A base port can be baked into an OAuth origin, and `<slug>.localhost` (:80) has no port to remap — so with
 * two devcontainers up, both silently belong to whichever started first. Nothing fails; the deliverable is
 * that the loser is TOLD instead of debugging a mystery.
 */
export async function foreignOwner(root, env, port) {
  const claim = tool(root, 'port-claim', 'port-claim.mjs');
  if (!existsSync(claim)) return null;
  try {
    const { stdout } = await pexec(
      process.execPath,
      [claim, 'advise', `--registry=${process.env.SB_REGISTRY ?? '/var/opt/bespunky/ports'}`, `--identity=${containerIdentity(root)}`, `--port=${port}`],
      { cwd: root, env },
    );
    const res = JSON.parse(String(stdout));
    return res.mine === false ? res.owner ?? 'another devcontainer' : null;
  } catch {
    return null;
  }
}

/**
 * Bring the shared browser up, register the pretty route, navigate — in that order, each best-effort.
 * Resolves `{ registered }` so the caller can unregister the route on stop.
 */
export async function attachBrowser({ root, env, slug, port, prettyUrl, localUrl, log, warn }) {
  const sb = tool(root, 'shared-browser', 'shared-browser');
  const domains = tool(root, 'worktree-domains', 'worktree-domains');
  const state = { registered: false };

  if (!existsSync(sb)) {
    warn(`shared browser tooling not found (${sb}) — skipping the browser layer. Open the app yourself at ${localUrl}.`);
    return state;
  }

  try {
    await pexec('bash', [sb, 'up'], { cwd: root, env });
  } catch (err) {
    const stderr = stderrOf(err);
    if (/missing dependencies/i.test(stderr)) {
      // NAME the authority; never re-list the packages (a hand-typed copy of the apt list once drifted from
      // the real one). The devcontainer's post-create owns that list.
      warn(
        'shared browser dependencies are missing — skipping the browser layer (the stack is unaffected).\n' +
          '  They are installed by the devcontainer OS-floor step. Re-run it with:\n' +
          '    bash .devcontainer/post-create.sh\n' +
          `  …or rebuild the devcontainer. Meanwhile open the app yourself at ${localUrl}`,
      );
    } else {
      warn(`shared browser could not start — skipping the browser layer. Open the app yourself at ${localUrl}.\n${stderr}`);
    }
    return state;
  }
  log(`Viewer: ${await sharedBrowserUrl(root, env)}  (shared browser — open this to watch)`);

  let viewUrl = localUrl;
  if (existsSync(domains)) {
    try {
      await pexec('bash', [domains, 'register', slug, String(port)], { cwd: root, env });
      state.registered = true;
      viewUrl = prettyUrl;
      log(`Pretty domain: ${prettyUrl}  →  127.0.0.1:${port}`);
    } catch (err) {
      warn(`could not register the ${slug}.localhost route — navigating on ${localUrl} instead.\n${stderrOf(err)}`);
    }
  } else {
    warn(`worktree-domains tooling not found (${domains}) — using ${localUrl} (no pretty domain).`);
  }

  try {
    await pexec('bash', [sb, 'navigate', `--url=${viewUrl}`, '--wait'], { cwd: root, env });
  } catch (err) {
    warn(`shared browser navigate did not complete — open ${viewUrl} manually in the viewer.\n${stderrOf(err)}`);
  }
  return state;
}

/** Best-effort teardown of the pretty route (the shared browser itself stays up — it is shared). */
export function detachRoute(root, env, slug) {
  const domains = tool(root, 'worktree-domains', 'worktree-domains');
  if (!existsSync(domains)) return;
  try {
    execFileSync('bash', [domains, 'unregister', slug], { cwd: root, env, stdio: 'ignore' });
  } catch {
    /* best-effort */
  }
}
