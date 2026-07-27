import type { PromiseExecutor } from '@nx/devkit';
import { logger } from '@nx/devkit';
import { execFile, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { hostname } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';

import type { ServeExecutorSchema } from './schema';
import { runServeStack, type ServeChild } from './serve-process';
import { resolvePortOffset, BASE_APP_PORT } from './port-offset';
import {
  collectWorktrees,
  matchWorktree,
  worktreeLabel,
  worktreeSlug,
  type Worktree,
} from './worktrees';

const pexec = promisify(execFile);

/**
 * The house dev loop, as ONE composing executor.
 *
 * `serve` used to be an nx:run-commands orchestrator (Firebase emulators + a dev-server) with two
 * SEPARATE targets bolted on for the other axes — `serve-worktree` (serve a different git worktree)
 * and `serve-with-shared-browser` (also drive the shared browser). Three overlapping targets, each
 * re-deriving ports and re-launching the same pieces, is the shape this replaces: here ONE executor
 * composes every layer of a serve and owns a single graceful teardown across all of them.
 *
 * A serve is: pick a tree → resolve its isolated port block → run the app dev-server, plus (when the
 * tree is a Firebase workspace) the emulator suite, plus (by default) the shared co-driven browser
 * navigated to the app on a pretty `<slug>.localhost` domain. The app dev-server is the project's own
 * `dev-server` leaf (@angular/build:dev-server); the emulators are the workspace `firebase:emulators`
 * target; the browser + domain routing are the workspace `tools/` CLIs. Each is a black box this
 * executor drives — never re-implemented here.
 *
 * The single knob shared by every isolated layer is PORT_OFFSET: the app dev-server serves at
 * BASE_APP_PORT + offset, tools/emulators.sh shifts the whole emulator suite by the same offset, and
 * the Firebase app reads `?portOffset=` to reach the shifted emulator ports. The MAIN tree is always
 * offset 0 — the base/forwarded ports the developer's own session (and real Google OAuth on
 * localhost:4200) belong to.
 */
const runExecutor: PromiseExecutor<ServeExecutorSchema> = async (options, context) => {
  const project = options.project ?? context.projectName;
  if (!project) {
    logger.error('[serve] No project to serve — attach this target to a project or pass --project.');
    return { success: false };
  }

  const worktrees = collectWorktrees(context.root);
  if (worktrees.length === 0) {
    logger.error('[serve] No git worktrees found.');
    return { success: false };
  }
  // The workspace identity is the MAIN tree's directory name — stable regardless of which tree the
  // executor is invoked from (git always lists the primary worktree first). It names the base host and
  // distinguishes "this is the main tree" from a worktree in the tab label.
  const mainTree = worktrees.find((w) => w.isMain) ?? worktrees[0];
  const workspaceName = basename(mainTree.path);

  const chosen = await selectWorktree(worktrees, options);
  if (!chosen) return { success: false };

  if (!ensureInstalled(chosen, options.install !== false, Boolean(options.dryRun))) {
    return { success: false };
  }

  // Resolve the isolated port block. auto → main tree 0, worktree a stable verified-free block.
  const offset = await resolvePortOffset(options.portOffset ?? 'auto', worktreeKey(chosen), chosen.isMain);
  const appPort = BASE_APP_PORT + offset;
  const slug = worktreeSlug(chosen, workspaceName);

  const isFirebase = existsSync(join(chosen.path, 'firebase.json'));
  const emulatorsOn = options.emulators !== false && isFirebase;
  const sharedBrowserOn = options.sharedBrowser !== false;

  // NX_WORKSPACE_ROOT_PATH pins Nx to the chosen tree (otherwise the Nx daemon, which caches a single
  // workspace root across trees, resolves back to the main tree and serves the wrong source);
  // NX_DAEMON=false stops that daemon from cross-talking between trees. PORT_OFFSET is the single knob
  // both the app dev-server (via --port below) and tools/emulators.sh read — set it only when non-zero
  // so a base serve is untouched.
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NX_DAEMON: 'false',
    NX_WORKSPACE_ROOT_PATH: chosen.path,
  };
  if (offset > 0) env.PORT_OFFSET = String(offset);

  const nxBin = join(
    chosen.path,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'nx.cmd' : 'nx',
  );

  // The composed long-running children. The app dev-server always; the emulator suite when this is a
  // Firebase tree and emulators aren't disabled. Both run through the tree's own nx binary with the
  // tree-pinning env, so an isolated worktree serve never leaks into the main tree.
  //
  // The app layer DELEGATES to the project's `dev-server` leaf (@angular/build:dev-server), forwarding
  // serve's dev-server options. `buildTarget` is set by serve's development/production configurations
  // (→ <app>:build:<config>), so `nx serve <app> --configuration=production` compiles the prod build; the
  // port is offset-managed. Only options the developer actually set are forwarded — the leaf's own
  // defaults win otherwise.
  const appArgs = ['run', `${project}:dev-server`, `--port=${appPort}`];
  if (options.buildTarget) appArgs.push(`--buildTarget=${options.buildTarget}`);
  if (options.host) appArgs.push(`--host=${options.host}`);
  if (options.proxyConfig) appArgs.push(`--proxyConfig=${options.proxyConfig}`);
  // A Firebase serve routes Cloud Functions callables through the dev-server's OWN origin (see the app's
  // generated proxy.conf.mjs): a squatted/forwarded :5001 on the host can't stall callables, and a
  // worktree's callables reach ITS emulator because the proxy shifts by PORT_OFFSET (set in `env` below).
  // Auto-wire that proxy when this is a Firebase tree and the developer didn't pass their own --proxyConfig.
  if (!options.proxyConfig && isFirebase) {
    const appRoot = context.projectsConfigurations?.projects?.[project]?.root;
    const proxyConf = appRoot ? join(chosen.path, appRoot, 'proxy.conf.mjs') : undefined;
    if (proxyConf && existsSync(proxyConf)) appArgs.push(`--proxyConfig=${proxyConf}`);
  }
  if (options.ssl) appArgs.push('--ssl');
  if (options.sslCert) appArgs.push(`--sslCert=${options.sslCert}`);
  if (options.sslKey) appArgs.push(`--sslKey=${options.sslKey}`);
  if (options.open) appArgs.push('--open');
  if (options.liveReload === false) appArgs.push('--liveReload=false');
  if (options.hmr) appArgs.push('--hmr');
  if (options.poll !== undefined) appArgs.push(`--poll=${options.poll}`);

  const children: ServeChild[] = [{ label: 'app', command: nxBin, args: appArgs }];
  if (emulatorsOn) {
    children.push({ label: 'emulators', command: nxBin, args: ['run', 'firebase:emulators'] });
  }

  // The URL the app is reached at. A pretty `<slug>.localhost` domain when the worktree-domains proxy
  // is up (decided at register time, below); otherwise the raw shifted port. `?emulate=none` forces the
  // real backend when emulators are off; `?portOffset=` lets a Firebase app reach the shifted emulator
  // ports.
  const params = new URLSearchParams();
  if (isFirebase && offset > 0) params.set('portOffset', String(offset));
  if (!emulatorsOn && isFirebase) params.set('emulate', 'none');
  const query = params.toString() ? `?${params.toString()}` : '';
  const prettyUrl = `http://${slug}.localhost/${query}`;
  const localUrl = `http://localhost:${appPort}/${query}`;

  if (options.dryRun) {
    logger.info('[serve] DRY RUN — would serve:');
    logger.info(`  tree       : ${worktreeLabel(chosen)}`);
    logger.info(`  slug       : ${slug}.localhost`);
    logger.info(`  offset     : ${offset}${offset === 0 ? '  (base/forwarded stack)' : ''}`);
    logger.info(`  app port   : ${appPort}`);
    logger.info(`  cwd        : ${chosen.path}`);
    logger.info(`  env        : NX_DAEMON=false NX_WORKSPACE_ROOT_PATH=${chosen.path}` + (offset > 0 ? ` PORT_OFFSET=${offset}` : ''));
    for (const child of children) logger.info(`  layer      : ${child.label} → ${nxBin} ${child.args.join(' ')}`);
    logger.info(`  shared browser : ${sharedBrowserOn ? 'up + register + navigate' : 'skipped (--no-shared-browser)'}`);
    if (sharedBrowserOn) logger.info(`  route      : ${slug} → 127.0.0.1:${appPort}`);
    logger.info(`  app URL    : ${localUrl}` + (sharedBrowserOn ? `  (pretty: ${prettyUrl})` : ''));
    if (sharedBrowserOn) {
      // --dry-run is the "tell me what would happen" mode, so ask the CLI: if a stack is already up this
      // prints the real viewer URL, and if not it prints the instruction rather than a made-up port.
      const sbScript = join(chosen.path, 'tools', 'shared-browser', 'shared-browser');
      logger.info(`  viewer     : ${await sharedBrowserUrl(sbScript, chosen.path, env)}  (shared browser)`);
    }
    return { success: true };
  }

  logger.info(`[serve] Serving ${project}:dev-server from ${worktreeLabel(chosen)}`);
  logger.info(`[serve] App:    ${localUrl}`);
  if (offset > 0) logger.info(`[serve] Isolated on port offset ${offset} (shifted ports are not forwarded — view it in the shared browser).`);

  // Bring up the shared browser + pretty domain CONCURRENTLY with the dev-server (its own navigate
  // --wait polls until the app answers). Kicked off without awaiting so it never delays the serve;
  // every step is best-effort and can only WARN — the dev-server must come up regardless.
  const domainState = { registered: false };
  if (sharedBrowserOn) {
    setupSharedBrowser({
      treeRoot: chosen.path,
      offset,
      env,
      slug,
      appPort,
      prettyUrl,
      localUrl,
      domainState,
    }).catch((err) => logger.warn(`[serve] Shared browser setup errored (ignored): ${(err as Error).message}`));
  }

  // Hand off to the stack lifecycle: N children, one shared foreground group, one graceful Ctrl+C.
  // On stop, best-effort unregister the pretty domain route (the browser itself stays up — it's shared).
  return await runServeStack({
    children,
    cwd: chosen.path,
    env,
    onStop: () => {
      if (sharedBrowserOn && domainState.registered) unregisterDomain(chosen.path, env, slug);
    },
  });
};

/** The stable identity of a worktree for deriving its port block — its branch, else its path. */
function worktreeKey(w: Worktree): string {
  return w.branch ?? w.path;
}

interface SharedBrowserSetup {
  treeRoot: string;
  offset: number;
  env: NodeJS.ProcessEnv;
  slug: string;
  appPort: number;
  prettyUrl: string;
  localUrl: string;
  domainState: { registered: boolean };
}

/**
 * Bring the shared co-driven browser up, register the pretty `<slug>.localhost` route, and navigate the
 * browser to the app — in that order, each layer best-effort:
 *   - `shared-browser up` failing on MISSING DEPS warns with the apt/rebuild fix and SKIPS the whole
 *     browser layer (the dev-server still comes up) — deps-missing must never fail a serve.
 *   - the domain proxy being unavailable falls back to the raw `localhost:<port>` URL.
 *   - `shared-browser navigate` is itself non-fatal by design (it warns + leaves the browser up).
 */
async function setupSharedBrowser(s: SharedBrowserSetup): Promise<void> {
  const sbScript = join(s.treeRoot, 'tools', 'shared-browser', 'shared-browser');
  const domainsScript = join(s.treeRoot, 'tools', 'worktree-domains', 'worktree-domains');

  if (!existsSync(sbScript)) {
    logger.warn(`[serve] Shared browser tooling not found (${sbScript}) — skipping the browser layer. Open the app yourself at ${s.localUrl}.`);
    return;
  }

  // 1) Ensure the browser is up (idempotent). Missing deps → warn + skip, never fail the serve.
  try {
    await pexec('bash', [sbScript, 'up'], { cwd: s.treeRoot, env: s.env });
  } catch (err) {
    const stderr = String((err as { stderr?: string }).stderr ?? (err as Error).message ?? '');
    if (/missing dependencies/i.test(stderr)) {
      logger.warn(
        '[serve] Shared browser dependencies are missing — skipping the browser layer (the dev-server is unaffected).\n' +
        '  Install them (apt, via the devcontainer post-create): xvfb x11vnc novnc websockify fluxbox iproute2 curl util-linux\n' +
        '  …or rebuild the devcontainer. Meanwhile open the app yourself at ' + s.localUrl,
      );
    } else {
      logger.warn(`[serve] Shared browser could not start — skipping the browser layer. Open the app yourself at ${s.localUrl}.\n${stderr.trim()}`);
    }
    return;
  }
  // ASK the tooling for the viewer URL — never compose it. The noVNC port is allocated per container
  // (parallel devcontainers each get their own), so a hardcoded number here would hand the human a link
  // to a DIFFERENT container's browser without anything erroring.
  const viewerUrl = await sharedBrowserUrl(sbScript, s.treeRoot, s.env);
  logger.info(`[serve] Viewer: ${viewerUrl}  (shared browser — open this to watch)`);

  // 2a) Say who owns the fixed HOST ports this tree depends on. The base stack's :4200 is the only
  //     origin registered for real Google OAuth, and `<slug>.localhost` (:80) has no port to remap — so
  //     with two devcontainers up, both silently belong to whichever started first. Nothing fails; the
  //     deliverable is that the loser is TOLD instead of debugging a mystery.
  if (s.offset === 0) await adviseHostPort(s, BASE_APP_PORT, 'the dev server on host :4200 (the only origin registered for real Google OAuth)');

  // 2) Register the pretty domain route (best-effort). Success means the proxy is up → the app is
  //    reachable at http://<slug>.localhost; failure falls back to the raw port URL.
  let viewUrl = s.localUrl;
  if (existsSync(domainsScript)) {
    try {
      await pexec('bash', [domainsScript, 'register', s.slug, String(s.appPort)], { cwd: s.treeRoot, env: s.env });
      s.domainState.registered = true;
      viewUrl = s.prettyUrl;
      logger.info(`[serve] Pretty domain: ${s.prettyUrl}  →  127.0.0.1:${s.appPort}`);
    } catch (err) {
      const stderr = String((err as { stderr?: string }).stderr ?? (err as Error).message ?? '');
      logger.warn(`[serve] Could not register the ${s.slug}.localhost route — navigating on ${s.localUrl} instead.\n${stderr.trim()}`);
    }
  } else {
    logger.warn(`[serve] worktree-domains tooling not found (${domainsScript}) — using ${s.localUrl} (no pretty domain).`);
  }

  // 3) Navigate the shared browser to the app (waits for the dev-server to answer). Non-fatal by design.
  try {
    await pexec('bash', [sbScript, 'navigate', `--url=${viewUrl}`, '--wait'], { cwd: s.treeRoot, env: s.env });
  } catch (err) {
    const stderr = String((err as { stderr?: string }).stderr ?? (err as Error).message ?? '');
    logger.warn(`[serve] Shared browser navigate did not complete — open ${viewUrl} manually in the viewer.\n${stderr.trim()}`);
  }
}

/**
 * Report whether THIS container owns a fixed host port, via the same registry the shared browser uses.
 *
 * These ports cannot be arbitrated away — the number is baked into an OAuth origin or a `.localhost`
 * domain — so this never fails or changes behaviour. It converts a silent, unattributable wrong-target
 * into a named owner, which is the only fix available for a resource that genuinely has one slot.
 */
async function adviseHostPort(s: SharedBrowserSetup, port: number, what: string): Promise<void> {
  const claim = join(s.treeRoot, 'tools', 'shared-browser', 'port-claim.mjs');
  if (!existsSync(claim)) return;
  try {
    const { stdout } = await pexec(
      process.execPath,
      [claim, 'advise', `--registry=${process.env.SB_REGISTRY ?? '/var/opt/bespunky/ports'}`,
       `--identity=${containerIdentity()}`, `--port=${port}`],
      { cwd: s.treeRoot, env: s.env },
    );
    const res = JSON.parse(String(stdout)) as { mine?: boolean; owner?: string };
    if (res.mine === false) {
      logger.warn(
        `[serve] Host port ${port} belongs to another devcontainer (${res.owner}) — ${what} is THEIRS, not this one.\n` +
        `  Nothing here is broken: view this tree in the shared browser instead (its URL is above).`,
      );
    }
  } catch {
    /* attribution is advisory — never let it affect a serve */
  }
}

/** The same identity the shared-browser CLI claims with, so one container is one claimant. */
function containerIdentity(): string {
  const id = process.env.BESPUNKY_DEVCONTAINER_ID;
  return id ? `dc:${id}` : `${process.cwd()}@${hostname()}`;
}

/**
 * The shared browser's viewer URL, straight from the tooling that owns it (`shared-browser url`).
 *
 * The noVNC port is ALLOCATED per container out of a band, so it is knowable only by asking. Falling
 * back to a composed guess would reintroduce the exact bug this replaced — a plausible-looking URL
 * pointing at another container's browser — so the fallback is an honest instruction instead.
 */
async function sharedBrowserUrl(sbScript: string, treeRoot: string, env: NodeJS.ProcessEnv): Promise<string> {
  try {
    const { stdout } = await pexec('bash', [sbScript, 'url'], { cwd: treeRoot, env });
    const url = String(stdout).trim();
    if (url) return url;
  } catch {
    /* fall through to the instruction below */
  }
  return `(run \`${sbScript} url\` for the viewer URL)`;
}

/** Best-effort teardown of the pretty domain route (the shared browser itself stays up — it's shared). */
function unregisterDomain(treeRoot: string, env: NodeJS.ProcessEnv, slug: string): void {
  const domainsScript = join(treeRoot, 'tools', 'worktree-domains', 'worktree-domains');
  if (!existsSync(domainsScript)) return;
  try {
    execFileSync('bash', [domainsScript, 'unregister', slug], { cwd: treeRoot, env, stdio: 'ignore' });
  } catch {
    /* teardown is best-effort */
  }
}

/**
 * Resolve which worktree to serve:
 *   - `--worktree` OMITTED    → the current cwd's tree (the tree the executor is invoked from).
 *   - `--worktree=<value>`    → matched by branch | DNS slug | path.
 *   - `--worktree=` (empty)   → an interactive arrow-key picker (requires a TTY).
 */
async function selectWorktree(
  worktrees: Worktree[],
  options: ServeExecutorSchema,
): Promise<Worktree | null> {
  const spec = options.worktree;

  if (spec === undefined) {
    const current = worktrees.find((w) => w.isCurrent) ?? worktrees.find((w) => w.isMain) ?? worktrees[0];
    logger.info(`[serve] Serving the current tree: ${worktreeLabel(current)}`);
    return current;
  }

  if (spec.trim() === '') {
    if (!process.stdin.isTTY) {
      logger.error('[serve] --worktree given empty but no interactive terminal. Pass --worktree=<branch|slug|path>. Available:');
      worktrees.forEach((w) => logger.error(`  - ${worktreeLabel(w)}`));
      return null;
    }
    return await promptForWorktree(worktrees);
  }

  const matches = matchWorktree(worktrees, spec);
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) {
    logger.error(`[serve] No worktree matches "${spec}". Available:`);
  } else {
    logger.error(`[serve] "${spec}" is ambiguous — matches ${matches.length} worktrees:`);
  }
  (matches.length ? matches : worktrees).forEach((w) => logger.error(`  - ${worktreeLabel(w)}`));
  return null;
}

/** Minimal shape of enquirer's `Select` prompt — arrow-key navigation + Enter. */
interface SelectPrompt {
  run(): Promise<string>;
}
type SelectCtor = new (opts: {
  name: string;
  message: string;
  initial?: number;
  choices: { name: string; message: string }[];
}) => SelectPrompt;

/**
 * Interactive picker. enquirer ships with Nx; its `Select` prompt gives the arrow-key + Enter
 * selection the workflow calls for. Loaded lazily so the module imports cleanly in non-interactive
 * contexts (and in unit tests).
 */
async function promptForWorktree(worktrees: Worktree[]): Promise<Worktree | null> {
  const mod = (await import('enquirer')) as unknown as {
    Select?: SelectCtor;
    default?: { Select?: SelectCtor };
  };
  const Select = mod.Select ?? mod.default?.Select;
  if (!Select) {
    logger.error('[serve] enquirer Select prompt unavailable.');
    return null;
  }

  const initial = Math.max(0, worktrees.findIndex((w) => w.isCurrent));
  const prompt = new Select({
    name: 'worktree',
    message: 'Which worktree do you want to serve?',
    initial,
    choices: worktrees.map((w) => ({ name: w.path, message: worktreeLabel(w) })),
  });

  try {
    const answer = await prompt.run();
    return worktrees.find((w) => w.path === answer) ?? null;
  } catch {
    // enquirer rejects with '' on Ctrl+C / Esc — a deliberate cancel, not an error.
    logger.info('[serve] Cancelled.');
    return null;
  }
}

/**
 * Guarantee the chosen worktree has its own `node_modules`. Fresh worktrees start empty; installing on
 * first serve removes the "why is my feature not showing" foot-gun. Returns false only on a real,
 * blocking failure.
 */
function ensureInstalled(worktree: Worktree, install: boolean, dryRun: boolean): boolean {
  if (existsSync(join(worktree.path, 'node_modules'))) return true;

  if (dryRun) {
    logger.info(`[serve] (dry run) ${worktree.path} has no node_modules — would run 'yarn install'.`);
    return true;
  }
  if (!install) {
    logger.error(`[serve] ${worktree.path} has no node_modules and --install=false. Run 'yarn install' there first.`);
    return false;
  }

  logger.info(`[serve] Installing dependencies in ${worktree.path} (first serve of this worktree)…`);
  try {
    execFileSync('yarn', ['install'], { cwd: worktree.path, stdio: 'inherit' });
    return true;
  } catch (err) {
    logger.error(`[serve] 'yarn install' failed in ${worktree.path}: ${(err as Error).message}`);
    return false;
  }
}

export default runExecutor;
