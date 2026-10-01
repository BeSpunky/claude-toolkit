// tools/dev/dev — the house dev loop, stack-free. GENERATOR-OWNED (@bespunky/nx-tools:dev); rewritten every
// sync — the project's own knowledge lives in .bespunky/dev.json, never here.
//
//   tools/dev/dev serve [app] [--worktree[=<branch|slug|path>]] [--port-offset=<n|auto>] [--skip=<id,…>]
//                             [--no-shared-browser] [--no-install] [--dry-run] [-- <args for the primary>]
//   tools/dev/dev list
//
// A serve: pick a tree → install it if its declaration says how and it needs it → resolve ONE port offset
// for every declared port (sized from the declaration) → run every declared process under one graceful
// Ctrl+C → register `<slug>.localhost` and drive the shared co-driven browser to the app.
//
// Node built-ins only, and no project node_modules: this must serve a Python or Go repo exactly as it serves
// an Nx one. `nx serve <app>` (the @bespunky/nx-tools:serve executor) is a thin wrapper over this file.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { get } from 'node:http';
import { basename, dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import { attachBrowser, detachRoute, foreignOwner, sharedBrowserUrl } from './lib/browser.mjs';
import { DECLARATION_PATH, DeclarationError, declaredPorts, loadDeclaration, pickApp, planApp, primaryOf } from './lib/declaration.mjs';
import { portBlock, resolvePortOffset } from './lib/ports.mjs';
import { runStack } from './lib/stack.mjs';
import { collectWorktrees, matchWorktree, worktreeKey, worktreeLabel, worktreeSlug } from './lib/worktrees.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const log = (m) => console.log(`[serve] ${m}`);
const warn = (m) => console.error(`[serve] WARNING: ${m}`);

class UsageError extends Error {}

const USAGE = `Usage:
  tools/dev/dev serve [app] [--worktree[=<branch|slug|path>]] [--port-offset=<n|auto>] [--skip=<id,...>]
                      [--no-shared-browser] [--no-install] [--dry-run] [-- <args for the primary process>]
  tools/dev/dev list

Serves an app declared in ${DECLARATION_PATH}. --worktree with no value picks one interactively.`;

/** Parse argv into `{ command, app, flags, passthrough }`. Unknown flags are refused, never ignored. */
export function parseArgs(argv) {
  const out = { command: argv[0], app: undefined, passthrough: [], worktree: undefined, portOffset: 'auto', skip: [], sharedBrowser: true, install: true, dryRun: false };
  const rest = argv.slice(1);
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--') {
      out.passthrough = rest.slice(i + 1);
      break;
    }
    const [flag, ...v] = arg.split('=');
    const value = v.length ? v.join('=') : undefined;
    const takeValue = () => (value !== undefined ? value : rest[++i]);
    switch (flag) {
      case '--worktree':
        out.worktree = value ?? '';
        break;
      case '--port-offset':
        out.portOffset = takeValue();
        break;
      case '--skip':
        out.skip.push(...String(takeValue() ?? '').split(',').map((s) => s.trim()).filter(Boolean));
        break;
      case '--no-shared-browser':
        out.sharedBrowser = false;
        break;
      case '--no-install':
        out.install = false;
        break;
      case '--dry-run':
        out.dryRun = true;
        break;
      case '-h':
      case '--help':
        out.command = 'help';
        break;
      default:
        if (arg.startsWith('-')) throw new UsageError(`unknown flag ${arg}`);
        if (out.app !== undefined) throw new UsageError(`unexpected argument ${arg} (app is already ${out.app})`);
        out.app = arg;
    }
  }
  return out;
}

async function promptForWorktree(worktrees) {
  worktrees.forEach((w, i) => console.log(`  ${i + 1}) ${worktreeLabel(w)}`));
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const current = Math.max(0, worktrees.findIndex((w) => w.isCurrent)) + 1;
  const answer = await new Promise((res) => rl.question(`Which worktree do you want to serve? [${current}] `, res));
  rl.close();
  const n = answer.trim() === '' ? current : Number(answer.trim());
  return worktrees[n - 1] ?? null;
}

/** Omitted → the current tree; a value → matched by branch | slug | path; empty in a TTY → a prompt. */
async function selectWorktree(worktrees, spec) {
  if (spec === undefined) {
    const current = worktrees.find((w) => w.isCurrent) ?? worktrees.find((w) => w.isMain) ?? worktrees[0];
    log(`Serving the current tree: ${worktreeLabel(current)}`);
    return current;
  }
  if (spec.trim() === '') {
    if (!process.stdin.isTTY) {
      throw new UsageError(`--worktree given empty but no interactive terminal. Pass --worktree=<branch|slug|path>. Available:\n${worktrees.map((w) => `  - ${worktreeLabel(w)}`).join('\n')}`);
    }
    const picked = await promptForWorktree(worktrees);
    if (!picked) throw new UsageError('no worktree chosen');
    return picked;
  }
  const matches = matchWorktree(worktrees, spec);
  if (matches.length === 1) return matches[0];
  const head = matches.length === 0 ? `No worktree matches "${spec}". Available:` : `"${spec}" is ambiguous — matches ${matches.length} worktrees:`;
  throw new UsageError(`${head}\n${(matches.length ? matches : worktrees).map((w) => `  - ${worktreeLabel(w)}`).join('\n')}`);
}

/** The served tree's own declaration — or, for a tree branched before it had one, this tree's (said so). */
function declarationFor(tree) {
  const own = loadDeclaration(tree.path);
  if (own) return own;
  const here = resolve(tree.path) === ROOT ? null : loadDeclaration(ROOT);
  if (here) {
    warn(`${tree.path} has no ${DECLARATION_PATH} — serving it with this tree's declaration.`);
    return here;
  }
  throw new UsageError(
    `no ${DECLARATION_PATH} in ${tree.path}. Declare what this project serves — e.g.\n` +
      `  { "apps": { "site": { "processes": [ { "id": "app", "cmd": "python3 -m http.server \${PORT:app}", "ports": { "app": 8000 } } ] } } }\n` +
      `(a house sync seeds it for the stacks it knows).`,
  );
}

/** Run the declaration's install step when the tree lacks what it `creates` (fresh worktrees start empty). */
function ensureInstalled(decl, tree, { install, dryRun }) {
  const step = decl.install;
  if (!step) return;
  if (step.creates && existsSync(join(tree, step.creates))) return;
  const shown = typeof step.cmd === 'string' ? step.cmd : step.cmd.join(' ');
  const why = step.creates ? `has no ${step.creates}` : 'declares an install step';
  if (dryRun) {
    log(`(dry run) ${tree} ${why} — would run '${shown}'.`);
    return;
  }
  if (!install) throw new UsageError(`${tree} ${why} and --no-install was given. Run '${shown}' there first.`);
  log(`Installing in ${tree} (${why})…`);
  if (typeof step.cmd === 'string') execFileSync('sh', ['-c', step.cmd], { cwd: tree, stdio: 'inherit' });
  else execFileSync(step.cmd[0], step.cmd.slice(1), { cwd: tree, stdio: 'inherit' });
}

/** Log once when the primary process answers HTTP (any status — even a 404 means the server is up). */
function announceReady(url, appUrl, until) {
  const attempt = () => {
    if (until.done) return;
    const req = get(url, (res) => {
      res.resume();
      if (!until.done) log(`Up: ${appUrl}`);
    });
    req.setTimeout(2000, () => req.destroy());
    req.on('error', () => setTimeout(attempt, 500).unref());
  };
  attempt();
}

async function serve(opts) {
  const worktrees = collectWorktrees(ROOT);
  const mainTree = worktrees.find((w) => w.isMain) ?? worktrees[0];
  const workspaceName = basename(mainTree.path);
  const tree = await selectWorktree(worktrees, opts.worktree);

  const decl = declarationFor(tree);
  const appName = pickApp(decl, opts.app);
  const app = decl.apps[appName];
  ensureInstalled(decl, tree.path, opts);

  const block = portBlock(declaredPorts(app));
  const offset = await resolvePortOffset(opts.portOffset, {
    key: worktreeKey(tree),
    isMain: tree.isMain,
    probed: Object.values(primaryOf(app).ports),
    block,
  });
  const plan = planApp(decl, appName, { offset, tree: tree.path, skip: opts.skip, passthrough: opts.passthrough, baseEnv: process.env });
  for (const id of plan.ignoredSkips) warn(`--skip=${id}: app "${appName}" declares no such process — nothing to skip.`);
  const slug = worktreeSlug(tree, workspaceName);
  const prettyUrl = `http://${slug}.localhost/${plan.query}`;
  const browserOn = opts.sharedBrowser;

  if (opts.dryRun) {
    log('DRY RUN — would serve:');
    console.log(`  app        : ${appName}`);
    console.log(`  tree       : ${worktreeLabel(tree)}`);
    console.log(`  slug       : ${slug}.localhost`);
    console.log(`  offset     : ${offset}${offset === 0 ? '  (base/forwarded stack)' : ''}`);
    console.log(`  block      : step ${block.step} × ${block.blocks}  (sized from declared ports ${block.min}..${block.max})`);
    console.log(`  app port   : ${plan.primaryPort}`);
    console.log(`  cwd        : ${tree.path}`);
    for (const p of plan.processes) {
      console.log(`  process    : ${p.id}${p.primary ? ' (primary)' : ''} → ${p.skipped ? 'skipped (--skip)' : p.display}`);
      if (!p.skipped) {
        console.log(`               ports ${Object.entries(p.ports).map(([n, v]) => `${n}=${v}`).join(' ') || '(none)'}`);
        console.log(`               env   ${Object.entries(p.added).map(([k, v]) => `${k}=${v}`).join(' ')}`);
      }
    }
    console.log(`  shared browser : ${browserOn ? 'up + register + navigate' : 'skipped (--no-shared-browser)'}`);
    if (browserOn) console.log(`  route      : ${slug} → 127.0.0.1:${plan.primaryPort}`);
    console.log(`  app URL    : ${plan.localUrl}${browserOn ? `  (pretty: ${prettyUrl})` : ''}`);
    for (const a of plan.advice) console.log(`  advice (${a.when}) : ${a.text}`);
    if (browserOn) console.log(`  viewer     : ${await sharedBrowserUrl(tree.path, process.env)}  (shared browser)`);
    return true;
  }

  log(`Serving ${appName} from ${worktreeLabel(tree)}`);
  log(`App:    ${plan.localUrl}`);
  if (offset > 0) log(`Isolated on port offset ${offset} (shifted ports are not forwarded — view it in the shared browser).`);
  for (const a of plan.advice) if (a.when !== 'contended') log(a.text);

  if (offset === 0) {
    foreignOwner(tree.path, process.env, plan.primaryPort).then((owner) => {
      if (!owner) return;
      warn(
        `host port ${plan.primaryPort} belongs to another devcontainer (${owner}) — the server on host :${plan.primaryPort} is THEIRS, not this one.\n` +
          '  Nothing here is broken: view this tree in the shared browser instead.' +
          plan.advice.filter((a) => a.when === 'contended').map((a) => `\n  ${a.text}`).join(''),
      );
    });
  }

  const until = { done: false };
  announceReady(plan.readyUrl, plan.localUrl, until);

  let route = { registered: false };
  if (browserOn) {
    attachBrowser({ root: tree.path, env: process.env, slug, port: plan.primaryPort, prettyUrl, localUrl: plan.localUrl, log, warn })
      .then((state) => (route = state))
      .catch((err) => warn(`shared browser setup errored (ignored): ${err.message}`));
  }

  const result = await runStack({
    children: plan.running,
    cwd: tree.path,
    log,
    onStop: () => {
      until.done = true;
      if (route.registered) detachRoute(tree.path, process.env, slug);
    },
  });
  return result.success;
}

function list() {
  const decl = loadDeclaration(ROOT);
  if (!decl) throw new UsageError(`no ${DECLARATION_PATH} in ${ROOT}`);
  for (const [name, app] of Object.entries(decl.apps)) {
    const block = portBlock(declaredPorts(app));
    console.log(`${name}  (offset step ${block.step}, ${block.blocks} blocks)`);
    for (const p of app.processes) {
      const ports = Object.entries(p.ports ?? {}).map(([n, v]) => `${n}=${v}`).join(' ');
      console.log(`  ${p.id}${p === primaryOf(app) ? ' (primary)' : ''}  ${ports}  ${typeof p.cmd === 'string' ? p.cmd : p.cmd.join(' ')}`);
    }
  }
  return true;
}

async function main(argv) {
  const opts = parseArgs(argv);
  switch (opts.command) {
    case 'serve':
      return serve(opts);
    case 'list':
      return list();
    case undefined:
    case 'help':
      console.log(USAGE);
      return opts.command === 'help';
    default:
      throw new UsageError(`unknown command ${opts.command}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (ok) => process.exit(ok ? 0 : 1),
    (err) => {
      if (err instanceof UsageError || err instanceof DeclarationError) {
        console.error(`[serve] ${err.message}`);
        if (err instanceof UsageError && /unknown|unexpected/.test(err.message)) console.error(USAGE);
      } else {
        console.error(`[serve] ${err?.stack ?? err}`);
      }
      process.exit(1);
    },
  );
}
