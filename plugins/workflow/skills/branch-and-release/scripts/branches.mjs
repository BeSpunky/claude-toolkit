#!/usr/bin/env node
// branches.mjs — the branch-model engine (bespunky-workflow:branch-and-release).
//
// The ONE thing that interprets `.bespunky/branches.json`. It reads, plans, verifies and — on `write` only —
// writes that file. It never runs a git command that changes state (lib/git.mjs enforces it): every move is
// printed for a human-gated execution. Contract: docs/features/2026-10-03-branch-model/CONTRACT.md.
//
// Exit codes: 0 ok · 1 invariant/validation failure · 2 usage error · 3 undeclared.
import fs from 'node:fs';
import path from 'node:path';
import { Git } from './lib/git.mjs';
import { PRESETS, FILE, UsageError, expand, validate, project, releaseLines } from './lib/model.mjs';
import { resolveModel } from './lib/resolve.mjs';
import { verify, NAMES } from './lib/verify.mjs';
import { plan, format, GATES } from './lib/plan.mjs';
import { evidence } from './lib/evidence.mjs';
import { describe } from './lib/describe.mjs';

const USAGE = `usage: branches.mjs <command>
  status [--json]                 the model in force (exit 3 when undeclared)
  describe                        the model in words + a table of lines
  presets                         the named starting points
  expand --preset <id> [--integration <b>] [--stages a,b] [--release-pattern p] [--maintained]
         [--fix-flow merge-forward|upstream-first] [--landing merge|pr] [--pr-style merge|squash|rebase]
  validate <file>                 every error in a declaration
  write <file>                    validate, record baselines, compute the projection, write ${FILE}
  plan <gate> [args]              the exact commands for a move — printed, never executed. Gates:
${Object.entries(GATES).map(([g, a]) => `                                    ${g} ${a}`).join('\n')}
  verify [--proposed <file>] [--json]   the invariants, against the model in force or a proposed one
  evidence [--json]               the investigation's raw facts, each observed | inferred | unobservable`;

const EXIT = { ok: 0, fail: 1, usage: 2, undeclared: 3 };
const BOOLEAN = new Set(['json', 'maintained', 'help']);

function parseArgs(argv) {
  const pos = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      pos.push(a);
      continue;
    }
    const [k, v] = a.slice(2).split(/=(.*)/s, 2);
    const key = k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (BOOLEAN.has(k)) opts[key] = true;
    else if (v !== undefined) opts[key] = v;
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) opts[key] = argv[++i];
    else throw new UsageError(`--${k} needs a value`);
  }
  return { pos, opts };
}

const out = (s) => process.stdout.write(`${s}\n`);
const err = (s) => process.stderr.write(`${s}\n`);

function readDeclaration(file) {
  if (!file) throw new UsageError('a declaration file is required');
  if (!fs.existsSync(file)) throw new UsageError(`${file}: no such file`);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new UsageError(`${file}: not valid JSON (${e.message})`);
  }
}

function reportErrors(errors, where) {
  err(`${where}: ${errors.length} error(s)`);
  for (const e of errors) err(`  - ${e}`);
  return EXIT.fail;
}

/** What status --json emits (CONTRACT, Amendment 2) — a hook consumes it, so the shape is frozen here. */
const statusShape = (r) => ({
  state: r.state,
  source: r.source,
  projection: r.projection,
  protected: r.protected,
  protectedPatterns: r.protectedPatterns,
  notes: r.notes,
  reason: r.reason,
});
const STATE_EXIT = { declared: EXIT.ok, undeclared: EXIT.undeclared, unreadable: EXIT.fail };

/** The model in force — or the exit code of a state no command may act under (undeclared, unreadable). */
function inForce(git, top) {
  const r = resolveModel(git, top);
  for (const n of r.notes) err(`note: ${n}`);
  if (r.state === 'declared') return { model: r.model, source: r.source, resolved: r };
  if (r.state === 'unreadable') {
    err(`unreadable: ${r.reason}`);
    err(`Refusing to act. Protected meanwhile: ${r.protected.join(', ')}.`);
  } else {
    err(`undeclared: ${r.reason}.`);
    err(`Protected meanwhile (protect, never promote): ${[...r.protected, ...r.protectedPatterns].join(', ') || '(none of the known names exist)'}.`);
    err('Investigate and ask before the first branch or promotion action (reference/choosing-a-branch-model.md).');
  }
  return { code: STATE_EXIT[r.state], resolved: r };
}

const commands = {
  status(git, top, { opts }) {
    const r = resolveModel(git, top);
    if (opts.json) {
      out(JSON.stringify(statusShape(r), null, 2));
      return STATE_EXIT[r.state];
    }
    for (const n of r.notes) err(`note: ${n}`);
    const prot = [...r.protected, ...r.protectedPatterns].join(', ');
    if (r.state === 'declared') out(`${r.projection.summary}    (${r.source})`);
    else if (r.state === 'unreadable') {
      out(`unreadable: ${r.reason}`);
      out(`Refusing to act until it is fixed. Protected meanwhile: ${prot}.`);
    } else {
      out(`undeclared: ${r.reason}.`);
      out(`Protected meanwhile (protect, never promote): ${prot || '(none of the known names exist)'}.`);
      out('Investigate and ask before the first branch or promotion action (reference/choosing-a-branch-model.md).');
    }
    return STATE_EXIT[r.state];
  },

  describe(git, top) {
    const r = inForce(git, top);
    if (r.code !== undefined) return r.code;
    out(describe(r.model));
    return EXIT.ok;
  },

  presets() {
    const w = Math.max(...Object.keys(PRESETS).map((k) => k.length));
    for (const [id, p] of Object.entries(PRESETS)) out(`${id.padEnd(w)}  ${p.description}`);
    return EXIT.ok;
  },

  expand(git, top, { opts }) {
    if (!opts.preset) throw new UsageError('expand needs --preset <id>');
    const m = expand(opts.preset, opts);
    const errors = validate(m);
    if (errors.length) return reportErrors(errors, `preset ${opts.preset} with these options`);
    out(JSON.stringify(m, null, 2));
    return EXIT.ok;
  },

  validate(git, top, { pos }) {
    const m = readDeclaration(pos[0]);
    const errors = validate(m);
    if (errors.length) return reportErrors(errors, pos[0]);
    out(`${pos[0]}: valid`);
    return EXIT.ok;
  },

  write(git, top, { pos }) {
    const m = readDeclaration(pos[0]);
    const errors = validate(m);
    if (errors.length) return reportErrors(errors, pos[0]);
    const remote = m.remote || 'origin';
    const tipOf = (name) => {
      const ref = git.ref(name, remote);
      return ref ? git.sha(ref) : null;
    };
    // Baselines already recorded are kept (re-writing an unchanged model must not wash away its history);
    // missing ones are filled with today's tip, or stay null with a note when the line doesn't exist yet.
    const fillBaseline = (holder, key, name) => {
      if (holder[key]) return;
      holder[key] = tipOf(name);
      if (!holder[key]) err(`note: ${name} does not exist yet — baseline left null; re-run write once it does`);
    };
    fillBaseline(m.integration, 'baseline', m.integration.branch);
    for (const s of m.stages) fillBaseline(s, 'baseline', s.branch);
    if (m.releases) {
      m.releases.baselines = m.releases.baselines ?? {};
      for (const r of releaseLines(m, git.branchNames(remote))) fillBaseline(m.releases.baselines, r, r);
    }
    m.projection = project(m);
    const target = path.join(top, FILE);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(m, null, 2)}\n`);
    out(`wrote ${FILE}: ${m.projection.summary}`);
    out('not committed — it is in force once it lands on the integration line.');
    return EXIT.ok;
  },

  plan(git, top, { pos, opts }) {
    const [gate, ...args] = pos;
    if (!gate) throw new UsageError(`plan needs a gate (${Object.keys(GATES).join(', ')})`);
    const r = inForce(git, top);
    if (r.code !== undefined) return r.code;
    out(`# plan ${[gate, ...args].join(' ')} — under: ${r.model.projection.summary}`);
    out(format(plan(git, r.model, gate, args, opts)));
    return EXIT.ok;
  },

  verify(git, top, { opts }) {
    let model;
    let source;
    if (opts.proposed) {
      model = readDeclaration(opts.proposed);
      const errors = validate(model);
      if (errors.length) return reportErrors(errors, opts.proposed);
      source = `${opts.proposed} (proposed)`;
    } else {
      const r = inForce(git, top);
      if (r.code !== undefined) return r.code;
      ({ model, source } = r);
    }
    const results = verify(git, model, { proposed: Boolean(opts.proposed) });
    const violations = results.filter((x) => x.status === 'violation').length;
    if (opts.json) out(JSON.stringify({ source, proposed: Boolean(opts.proposed), violations, results }, null, 2));
    else {
      out(`verify ${source}`);
      for (const x of results) {
        out(`  [${x.status}]${' '.repeat(10 - x.status.length)}${x.invariant} ${NAMES[x.invariant]} · ${x.line} — ${x.reason}`);
        for (const c of x.commits ?? []) out(`               ${c}`);
      }
      out(violations ? `${violations} violation(s)` : 'no violations');
    }
    return violations ? EXIT.fail : EXIT.ok;
  },

  evidence(git, top, { opts }) {
    const r = resolveModel(git, top);
    const facts = evidence(git, top, r);
    if (opts.json) out(JSON.stringify({ state: r.state, declared: r.declared, facts }, null, 2));
    else {
      for (const area of [...new Set(facts.map((f) => f.area))]) {
        out(`\n${area}`);
        for (const f of facts.filter((x) => x.area === area)) out(`  [${f.tag}] ${f.subject}: ${typeof f.value === 'string' ? f.value : JSON.stringify(f.value)}`);
      }
    }
    return EXIT.ok;
  },
};

function main(argv) {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (e) {
    err(e.message);
    return EXIT.usage;
  }
  const [command, ...rest] = parsed.pos;
  if (!command || parsed.opts.help || command === 'help') {
    (command ? out : err)(USAGE);
    return command ? EXIT.ok : EXIT.usage;
  }
  if (!commands[command]) {
    err(`unknown command "${command}"\n${USAGE}`);
    return EXIT.usage;
  }
  let git;
  let top;
  try {
    git = new Git(process.cwd());
    top = git.top();
  } catch {
    if (!['presets', 'expand', 'validate'].includes(command)) {
      err('not inside a git repository');
      return EXIT.usage;
    }
  }
  try {
    return commands[command](git, top, { pos: rest, opts: parsed.opts });
  } catch (e) {
    err(e instanceof UsageError ? e.message : `error: ${e.message}`);
    return e instanceof UsageError ? EXIT.usage : EXIT.fail;
  }
}

// A reader that stops early (`| head`) is not an error.
process.stdout.on('error', (e) => {
  if (e.code !== 'EPIPE') throw e;
  process.exit(process.exitCode ?? 0);
});
process.exitCode = main(process.argv.slice(2));
