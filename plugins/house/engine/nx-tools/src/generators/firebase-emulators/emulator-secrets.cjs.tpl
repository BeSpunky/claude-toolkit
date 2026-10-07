// WHAT THE FUNCTIONS EMULATOR IS GIVEN AS SECRETS. GENERATOR-OWNED (rewritten on every upgrade); never edit it.
//
// The Functions emulator reads `.secret.local` from the loaded bundle, and for every declared secret that file does
// not give a non-empty value, it asks Secret Manager for the real one (firebase-tools `resolveSecretEnvs`). So "no
// file" is not "no secrets". The structural guarantee is the suite's OFFLINE project id (tools/emulator-project.mjs):
// under it, that Secret Manager call names a project that cannot exist. This file is the defence in depth around it,
// and the whole defence for secrets used against services that are not Google's (a bot token, a payment key):
//
//   1. INERT PLACEHOLDERS, AS A BUILD OUTPUT. The functions build (its esbuild config, `inertSecretsPlugin`) writes
//      `.secret.local` into the bundle: `EMULATOR_INERT_<KEY>` for every declared key. Declared = the keys of the
//      committed `.secret.local.example` ∪ every secret the built code names — `defineSecret("KEY")` and the string
//      form `secrets: ["KEY"]`. Being part of the build, it survives every rebuild and reaches a raw
//      `firebase emulators:start` / `emulators:exec` too; it holds nothing secret, so it is safe in the Nx cache
//      (and `functions.ignore` keeps `*.local` out of a deploy).
//   2. THE LAUNCH OVERLAY. tools/emulators.sh rewrites the file at launch (`place`): the same placeholders, plus the
//      key NAMES of the production `.secret.local` (names only — never a value), plus, when the developer opted in,
//      SANDBOX values from `.secret.sandbox.local`. A sandbox value equal to ANY production value — of any key, in
//      this tree's `.secret.local` or the main worktree's — is refused (the check catches exact copies only).
//   3. A SINK. tools/emulators.sh points Secret Manager at an address that cannot resolve (CLOUD_SECRET_MANAGER_URL,
//      firebase-tools' own origin override, undocumented — so `place` checks the INSTALLED firebase-tools honours it).
//
// FIREBASE'S RULES, NOT OURS. Every file is read with firebase-tools' own dotenv semantics (a port of
// lib/functions/env.js, checked against the real one by tools/test-firebase-tools on every firebase-tools bump):
// quotes and inline comments are stripped, escapes decoded, and a key firebase refuses (lowercase, FIREBASE_…,
// X_GOOGLE_…, EXT_…, KIT_…, reserved names) is never written — the emulator rejects the WHOLE file over one such key
// and silently loads no placeholder at all. Values are written back re-quoted, and the placed file is re-read with
// the installed firebase-tools' strict parser before launch: anything but an exact round-trip is exit 2.
//
// ONE PARSER FOR BOTH SIDES. tools/push-secrets.sh reads production's `.secret.local` through this file too
// (`push-entries`), so what is pushed to Secret Manager and what the emulator is refused are decided by the same
// rules — the ones Firebase itself applies.
//
//   node tools/emulator-secrets.cjs place --mode=inert|sandbox --source=<functions root> --dist=<bundle dir>
//        [--main-source=<the main worktree's functions root>] [--project-mode=offline|real] [--show]
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const INERT = (key) => `EMULATOR_INERT_${key}`;
/** The first firebase-tools whose emulator reads firebase.json `functions.configDir` (checked by version, 2026-10). */
const CONFIG_DIR_SINCE = '{{configDirSince}}';
const versionBelow = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split(/[.-]/).slice(0, 3).map(Number));
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i];
  return false;
};
const SINK = 'https://secret-manager.disabled-for-emulators.invalid';

// ── firebase-tools' dotenv, ported (lib/functions/env.js) ────────────────────────────────────────────────────────
const RESERVED_PREFIXES = ['X_GOOGLE_', 'FIREBASE_', 'EXT_', 'KIT_'];
const RESERVED_PREFIX_ALLOWLIST = ['FIREBASE_SECRET_REF_', 'EXT_MIGRATED_SYSTEM_', 'EXT_SELECTED_EVENTS'];
const RESERVED_KEYS = [
  'FIREBASE_CONFIG', 'CLOUD_RUNTIME_CONFIG', 'EVENTARC_CLOUD_EVENT_SOURCE', 'ENTRY_POINT', 'GCP_PROJECT', 'GCLOUD_PROJECT',
  'GOOGLE_CLOUD_PROJECT', 'FUNCTION_TRIGGER_TYPE', 'FUNCTION_NAME', 'FUNCTION_MEMORY_MB', 'FUNCTION_TIMEOUT_SEC',
  'FUNCTION_IDENTITY', 'FUNCTION_REGION', 'FUNCTION_TARGET', 'FUNCTION_SIGNATURE_TYPE', 'K_SERVICE', 'K_REVISION', 'PORT',
  'K_CONFIGURATION',
];
const LINE_SOURCE =
  '^\\s*(?:export)?\\s*([\\w./]+)\\s*=[\\f\\t\\v]*(' +
  "\\s*'(?:\\\\'|[^'])*'|" +
  '\\s*"(?:\\\\"|[^"])*"|' +
  '[^#\\r\\n]*' +
  ')?\\s*(?:#[^\\n]*)?$';
const UNESCAPE = { '\\n': '\n', '\\r': '\r', '\\t': '\t', '\\v': '\v', '\\\\': '\\', "\\'": "'", '\\"': '"' };
const ESCAPE = { '\n': '\\n', '\r': '\\r', '\t': '\\t', '\v': '\\v', '\\': '\\\\', "'": "\\'", '"': '\\"' };

/** firebase-tools `parse`: { envs, errors } — errors are the lines that are neither KEY=VALUE nor comments. */
function parse(data) {
  const re = new RegExp(LINE_SOURCE, 'gms');
  const envs = {};
  const errors = [];
  data = data.replace(/\r\n?/, '\n'); // sic: firebase-tools replaces the FIRST line break only
  let match;
  while ((match = re.exec(data))) {
    let [, k, v] = match;
    v = (v || '').trim();
    const quoted = /^(["'])(.*)\1$/ms.exec(v);
    if (quoted) {
      v = quoted[2];
      if (quoted[1] === '"') v = v.replace(/\\[nrtv\\'"]/g, (s) => UNESCAPE[s]);
    }
    envs[k] = v;
  }
  for (let line of data.replace(new RegExp(LINE_SOURCE, 'gms'), '').split(/[\r\n]+/)) {
    line = line.trim();
    if (line.startsWith('#')) continue;
    if (line.length) errors.push(line);
  }
  return { envs, errors };
}

/** firebase-tools `validateKey`: the reason a key is refused, or '' when firebase accepts it. */
function keyProblem(key) {
  if (RESERVED_KEYS.includes(key)) return 'reserved for internal use';
  if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) return 'not UPPER_SNAKE_CASE';
  if (!RESERVED_PREFIXES.some((p) => key.startsWith(p))) return '';
  for (const allowed of RESERVED_PREFIX_ALLOWLIST) {
    if (!key.startsWith(allowed)) continue;
    if (allowed.endsWith('_') && key === allowed) return 'a known prefix that requires a suffix';
    if (!allowed.endsWith('_') && key !== allowed) return `conflicts with ${allowed}`;
    return '';
  }
  return `reserved prefix (${RESERVED_PREFIXES.join(' ')})`;
}

/** firebase-tools `parseStrict`: the envs, or a thrown Error naming what firebase would reject. */
function parseStrict(data) {
  const { envs, errors } = parse(data);
  if (errors.length) throw new Error(`Invalid dotenv file, error on lines: ${errors.join(',')}`);
  const bad = Object.keys(envs).filter((k) => keyProblem(k));
  if (bad.length) throw new Error(`Validation failed: ${bad.join(', ')}`);
  return envs;
}

/** One KEY="value" line — always double-quoted and escaped, so any value round-trips through `parse`. */
const formatLine = (key, value) => `${key}="${value.replace(/[\n\r\t\v\\'"]/g, (c) => ESCAPE[c])}"`;

// ── what is declared ─────────────────────────────────────────────────────────────────────────────────────────────
const readEnvs = (file) => {
  try {
    return parse(fs.readFileSync(file, 'utf8')).envs;
  } catch {
    return {};
  }
};
/** Raw `KEY=rest` text, trimmed — push-secrets pushes values as written, so a copy may match either form. */
const readRaw = (file) => {
  const out = {};
  try {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?([\w./]+)\s*=(.*)$/.exec(line);
      if (m && !/^\s*#/.test(line)) out[m[1]] = m[2].trim();
    }
  } catch {
    // absent
  }
  return out;
};
const filled = (v) => typeof v === 'string' && v !== '' && !v.startsWith('PASTE_') && !v.startsWith('EMULATOR_INERT_');

/** Every secret the built code names: `defineSecret("KEY")` (esbuild: `(0, x.defineSecret)("KEY")`) and `secrets: ["KEY", …]`. */
function bundledSecrets(dir) {
  const found = new Set();
  const walk = (d) => {
    let entries = [];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === 'node_modules') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(c|m)?js$/.test(e.name)) {
        const code = fs.readFileSync(p, 'utf8');
        for (const m of code.matchAll(/defineSecret\)?\s*\(\s*(["'`])([A-Za-z_][\w]*)\1/g)) found.add(m[2]);
        for (const list of code.matchAll(/\bsecrets\s*:\s*\[([^\]]*)\]/g)) {
          for (const m of list[1].matchAll(/(["'`])([A-Za-z_][\w]*)\1/g)) found.add(m[2]);
        }
      }
    }
  };
  walk(dir);
  return found;
}

/** The inert file's lines for a set of keys — keys firebase would refuse are left out (and returned as `rejected`). */
function inertFile(keys, header) {
  const lines = [header];
  const rejected = [];
  for (const key of [...keys].sort()) {
    if (keyProblem(key)) rejected.push(key);
    else lines.push(formatLine(key, INERT(key)));
  }
  return { text: lines.join('\n') + '\n', rejected };
}

// ── 1. the build output ──────────────────────────────────────────────────────────────────────────────────────────
/**
 * esbuild plugin for the functions build: after every successful build, write the inert `.secret.local` beside the
 * bundle. Only committed inputs feed it (the example and the code), so a cached build is a correct build.
 */
function inertSecretsPlugin({ source }) {
  return {
    name: 'bespunky-inert-emulator-secrets',
    setup(build) {
      build.onEnd((result) => {
        if (result.errors.length) return;
        const o = build.initialOptions;
        const dir = o.outdir ?? (o.outfile ? path.dirname(o.outfile) : undefined);
        if (!dir) return;
        const keys = new Set([...Object.keys(readEnvs(path.join(source, '.secret.local.example'))), ...bundledSecrets(dir)]);
        const { text, rejected } = inertFile(
          keys,
          '# Written by the functions build — inert placeholders for the Functions emulator (tools/emulator-secrets.cjs). Never edit.',
        );
        fs.writeFileSync(path.join(dir, '.secret.local'), text, { mode: 0o600 });
        if (rejected.length) {
          console.warn(
            `[emulator-secrets] ${rejected.join(', ')}: Firebase refuses these secret names, so the emulator cannot be ` +
              `given a placeholder for them — rename them (UPPER_SNAKE_CASE, no FIREBASE_/X_GOOGLE_/EXT_/KIT_ prefix).`,
          );
        }
      });
    },
  };
}

// ── 2. the launch overlay ────────────────────────────────────────────────────────────────────────────────────────
/** The installed firebase-tools module at `rel`, or undefined (resolved from the workspace, like the CLI itself). */
function firebaseTools(rel) {
  try {
    return require(require.resolve(`firebase-tools/${rel}`, { paths: [process.cwd()] }));
  } catch {
    return undefined;
  }
}

/** `show`: the functions emulator is part of this run — the banner is printed and the sink checked only then. */
function place({ mode, source, dist, mainSource, projectMode, show }) {
  const say = (line) => show && console.error(`[emulators] ${line}`);
  const fail = (line) => {
    console.error(`[emulators] ${line}`);
    process.exit(2);
  };

  const example = readEnvs(path.join(source, '.secret.local.example'));
  const prodFiles = [path.join(source, '.secret.local'), ...(mainSource ? [path.join(mainSource, '.secret.local')] : [])];
  const prodKeys = Object.keys(readEnvs(prodFiles[0])); // this tree's declaration, names only
  const prodValues = new Set();
  for (const file of prodFiles) {
    for (const v of [...Object.values(readEnvs(file)), ...Object.values(readRaw(file))]) if (filled(v)) prodValues.add(v);
  }
  const sandboxFile = readEnvs(path.join(source, '.secret.sandbox.local'));
  const sandbox = mode === 'sandbox' ? sandboxFile : {};
  const bundled = bundledSecrets(dist);

  const declared = [...new Set([...Object.keys(example), ...prodKeys, ...Object.keys(sandboxFile), ...bundled])].sort();
  const live = [];
  const inert = [];
  const refused = [];
  const rejected = [];
  const intended = {};
  for (const key of declared) {
    if (keyProblem(key)) {
      rejected.push(key);
      continue;
    }
    const value = sandbox[key];
    if (filled(value) && prodValues.has(value)) refused.push(key);
    else if (filled(value)) {
      live.push(key);
      intended[key] = value;
      continue;
    } else inert.push(key);
    intended[key] = INERT(key);
  }
  const text =
    [`# Written by tools/emulators.sh at launch — mode: ${mode}. Regenerated every run; never edit.`]
      .concat(Object.keys(intended).map((k) => formatLine(k, intended[k])))
      .join('\n') + '\n';
  const file = path.join(dist, '.secret.local');
  fs.writeFileSync(file, text, { mode: 0o600 });

  // The placed file, read back the way the emulator will read it: the installed firebase-tools' strict parser when it
  // is there (it is the emulator's own), else the port. Anything but an exact round-trip is a refusal to launch.
  const strict = firebaseTools('lib/functions/env')?.parseStrict ?? parseStrict;
  let back;
  try {
    back = strict(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    fail(`the emulator secrets file failed Firebase's own check (${e.message}) — refusing to launch: ${file}`);
  }
  const want = JSON.stringify(Object.entries(intended).sort());
  if (JSON.stringify(Object.entries(back).sort()) !== want) {
    fail(`the emulator secrets file does not read back as written — refusing to launch: ${file}`);
  }

  // firebase.json → functions.configDir is how the emulator reads .env / .env.<projectId> / .env.local from the
  // functions SOURCE (the bundle carries no params file). The emulator honours it from firebase-tools 15.25.1 (deploy
  // from 14.1x); an older, project-pinned firebase-tools would ignore it and run every function without its params.
  const installed = show ? firebaseTools('package.json')?.version : undefined;
  if (installed && versionBelow(installed, CONFIG_DIR_SINCE)) {
    fail(
      `firebase-tools ${installed} is installed, but the Functions emulator reads its params (.env, .env.local) through ` +
        `firebase.json functions.configDir, which firebase-tools honours from ${CONFIG_DIR_SINCE}. Refusing to launch ` +
        `functions without their params: raise "firebase-tools" in package.json to ${CONFIG_DIR_SINCE} or later.`,
    );
  }

  // The sink is an undocumented firebase-tools knob: check the INSTALLED one honours it. Offline, the project id is
  // the guarantee and the sink only depth; under the real id the sink is what stands between a missing value and
  // production, so a firebase-tools that ignores it is a refusal.
  const api = show ? firebaseTools('lib/api') : undefined;
  const origin = typeof api?.secretManagerOrigin === 'function' ? api.secretManagerOrigin() : undefined;
  if (show && origin !== SINK) {
    const why =
      origin === undefined
        ? 'could not load the installed firebase-tools to check it'
        : `the installed firebase-tools ignores CLOUD_SECRET_MANAGER_URL (Secret Manager origin: ${origin})`;
    if (projectMode === 'real') {
      fail(
        `${why} — so under the REAL project id a secret missing from the placeholders would be fetched from production. ` +
          `Refusing to launch. Use the house's firebase-tools (package.json devDependencies), or commit every service ` +
          `back to emulated in environment.ts (the suite then runs offline).`,
      );
    }
    say(`  WARNING: ${why}; the offline project id still keeps Secret Manager out of reach.`);
  }

  const list = (keys) => keys.join(', ');
  if (mode === 'inert') {
    say(
      declared.length
        ? `secrets: INERT — ${inert.length} declared (${list(inert)}) get placeholder values; no real credential is loaded.`
        : 'secrets: INERT — no declared secrets (none in .secret.local.example or the bundle).',
    );
    say('  To exercise a real integration, put SANDBOX credentials in .secret.sandbox.local beside the functions source and restart.');
  } else {
    say(`secrets: SANDBOX — LIVE from .secret.sandbox.local: ${live.length ? list(live) : '(none filled)'}. Calls using them WILL reach real services.`);
    if (inert.length) say(`  inert (not in the sandbox file): ${list(inert)}`);
    if (refused.length) {
      say(`  REFUSED — equal to a production value in .secret.local: ${list(refused)}. Load a sandbox credential instead.`);
      say('  (Only exact copies are caught: a production credential in any other form is not recognisable as one.)');
    }
    say('  Disarm: EMULATOR_SECRETS=inert for one run, or delete the sandbox file.');
  }
  if (rejected.length) {
    say(
      `  NOT GIVEN to the emulator — Firebase refuses these names: ${list(rejected)}. Rename them (UPPER_SNAKE_CASE, no ` +
        `FIREBASE_/X_GOOGLE_/EXT_/KIT_ prefix, not a reserved name); until then they reach only the Secret Manager sink.`,
    );
  }
  const undocumented = [...bundled].filter((k) => !(k in example)).sort();
  if (undocumented.length) say(`  The bundle declares ${list(undocumented)}, missing from .secret.local.example — document them there.`);
  say('  Secret Manager is unreachable from the emulator: a secret it cannot find locally fails loudly, never fetched from production.');

  // Params: Firebase reads .env, .env.<projectId>, then (emulator only) .env.local — firebase.json functions.configDir
  // points all of them at the functions source, so .env.local is where local runs aim params at TEST targets.
  const env = readEnvs(path.join(source, '.env'));
  const envLocal = readEnvs(path.join(source, '.env.local'));
  if (Object.keys(envLocal).length) say(`params: .env.local overrides for the emulator: ${list(Object.keys(envLocal).sort())}`);
  else if (Object.keys(env).length) say('params: .env as-is (production values) — aim any at a test target in .env.local (emulator-only).');
}

module.exports = { parse, parseStrict, keyProblem, formatLine, bundledSecrets, inertSecretsPlugin, place, SINK, CONFIG_DIR_SINCE };

// ── 3. the production push (tools/push-secrets.sh) ───────────────────────────────────────────────────────────────
/**
 * The values tools/push-secrets.sh sets in Secret Manager — read from `.secret.local` with the SAME rules as everything
 * above (firebase-tools' dotenv semantics), so `KEY="v" # note` pushes `v`, never `"v" # note`, and `export KEY=v`
 * pushes KEY. Refuses the whole file (exit 2) on a line that is not KEY=VALUE or a key Firebase refuses — a push is
 * production, so nothing is half-pushed on a guess. Unfilled values (empty, `PASTE_…`) are skipped, by name.
 * Writes NUL-separated `key, value` pairs to stdout for the shell to pipe into the CLI; never prints a value.
 */
function pushEntries(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    console.error(`[push-secrets] cannot read ${file}: ${e.message}`);
    process.exit(2);
  }
  const { envs, errors } = parse(text);
  if (errors.length) {
    console.error(
      `[push-secrets] ${file} has ${errors.length} line(s) that are not KEY=VALUE (or a # comment) — refusing to push ` +
        `anything. (Line contents are not printed: they may hold a value.)`,
    );
    process.exit(2);
  }
  const bad = Object.keys(envs).filter((k) => keyProblem(k));
  if (bad.length) {
    console.error(
      `[push-secrets] Firebase refuses these secret names: ${bad.map((k) => `${k} (${keyProblem(k)})`).join(', ')} — ` +
        `rename them (and their defineSecret) before pushing; nothing was pushed.`,
    );
    process.exit(2);
  }
  const out = [];
  for (const [key, value] of Object.entries(envs)) {
    if (value === '' || value.startsWith('PASTE_')) {
      console.error(`[push-secrets] skipping ${key} — value not filled in.`);
      continue;
    }
    out.push(key, value);
  }
  process.stdout.write(out.map((x) => `${x}\0`).join(''));
}

/** What a dry run shows for one value: its length, a fingerprint, and its edges — enough to spot a stray quote or comment. */
function describeValue(value) {
  const hash = require('node:crypto').createHash('sha256').update(value).digest('hex').slice(0, 12);
  const edge = value.length > 8 ? `${JSON.stringify(value.slice(0, 3))}…${JSON.stringify(value.slice(-2))}` : '(short: edges hidden)';
  return `${value.length} chars, sha256 ${hash}, ${edge}`;
}

module.exports.pushEntries = pushEntries;
module.exports.describeValue = describeValue;

if (require.main === module) {
  const [command, ...rest] = process.argv.slice(2);
  const opt = Object.fromEntries(rest.map((a) => /^--([^=]+)(?:=(.*))?$/.exec(a)).filter(Boolean).map((m) => [m[1], m[2] ?? '1']));
  if (command === 'push-entries' && opt.file) {
    pushEntries(opt.file);
  } else if (command === 'describe') {
    // The value on stdin (never argv: it would show in `ps`).
    let value = '';
    process.stdin.on('data', (c) => (value += c)).on('end', () => process.stdout.write(describeValue(value)));
  } else if (command === 'place' && ['inert', 'sandbox'].includes(opt.mode) && opt.source && opt.dist) {
    place({
      mode: opt.mode,
      source: opt.source,
      dist: opt.dist,
      mainSource: opt['main-source'] || undefined,
      projectMode: opt['project-mode'] || 'offline',
      show: opt.show === '1',
    });
  } else {
    console.error(
      'usage: emulator-secrets.cjs place --mode=inert|sandbox --source=<dir> --dist=<dir> [--main-source=<dir>] [--project-mode=offline|real] [--show]\n' +
        '       emulator-secrets.cjs push-entries --file=<.secret.local>   |   describe < value',
    );
    process.exit(2);
  }
}
