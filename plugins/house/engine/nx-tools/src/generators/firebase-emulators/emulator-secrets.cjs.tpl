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
//      firebase-tools' own origin override, undocumented — so `place` checks the INSTALLED firebase-tools honours it,
//      by making the emulator's own Secret Manager call against a local listener: `sinkHonoured`).
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

// ── no reinterpretation: a value means what it says ─────────────────────────────────────────────────────────────
// Firebase's dotenv REINTERPRETS text: it cuts a value at an unquoted `#`, strips quotes, decodes escapes in double
// quotes, drops `export`. Where that changes what a line says, a reader (a developer, a reviewer, the push that used
// to send the raw text) can take the line to mean something Firebase does not — and a production secret is then set
// to a prefix of itself, or to a value with its quotes stripped, with no error anywhere. So a value is accepted only
// when Firebase's reading of it IS its text: bare when it can be (no `#`, no edge quote, no edge whitespace, one
// line), quoted only when it must be, and then literally (no escape Firebase would decode, nothing after the closing
// quote). Anything else is refused by key, with the shape to write instead — never reinterpreted. Values are never
// printed: a shape shows where the value goes, not the value.

/** A value may be written bare only when Firebase reads exactly that text back, and nothing about it looks quoted. */
const bareable = (value) => value !== '' && value === value.trim() && !/[#\r\n]/.test(value) && !/^["'`]|["'`]$/.test(value);

/** How `value` can be written so Firebase reads back exactly its text: 'bare', 'single', 'double', or '' (cannot). */
function spellingOf(value) {
  if (value === '' || bareable(value)) return 'bare';
  if (!value.includes("'") && parse(`K='${value}'\n`).envs.K === value) return 'single';
  if (!/["\\]/.test(value) && parse(`K="${value}"\n`).envs.K === value) return 'double';
  return '';
}

/** The line to write for a value, with the value itself elided — or how to set it when no line can carry it. */
function shapeFor(key, value) {
  const how = spellingOf(value);
  if (how === 'bare') return `${key}=<value>`;
  if (how === 'single') return `${key}='<value>'  (single quotes, nothing after them)`;
  if (how === 'double') return `${key}="<value>"  (double quotes, nothing after them)`;
  return `no line can carry this value unambiguously — set it directly: firebase functions:secrets:set ${key}`;
}

/**
 * Every entry of a dotenv text whose value Firebase would read as something other than what is written — each with
 * why, and the shape to write for each thing it may have meant. Empty when the file says exactly what it means.
 */
function ambiguities(data) {
  const re = new RegExp(LINE_SOURCE, 'gms');
  data = data.replace(/\r\n?/, '\n'); // as parse() does
  const out = [];
  let match;
  while ((match = re.exec(data))) {
    const [whole, key, raw = ''] = match;
    const value = parse(whole).envs[key] ?? '';
    const rawEnd = whole.indexOf(raw, whole.indexOf('=') + 1) + raw.length;
    const comment = whole.slice(rawEnd).trim(); // what the regex took as a `# …` comment
    const written = raw.trim();
    const quoted = /^(["'])([\s\S]*)\1$/.exec(written);
    const meant = [];
    let why = '';
    if (comment.startsWith('#')) {
      if (!quoted && raw !== '' && !/\s$/.test(raw)) {
        why = 'an unquoted # — Firebase cuts the value there, and would push only what precedes it';
        meant.push(['if the # and what follows are part of the value', `${raw}${whole.slice(rawEnd)}`.trim()]);
      } else {
        why = 'a # comment on the value line — Firebase drops it, but it reads as part of the value';
        if (!quoted) meant.push(['if the # and what follows are part of the value', `${raw}${whole.slice(rawEnd)}`.trim()]);
      }
      meant.push(['if it is a note, put the note on a line of its own and write', value]);
    } else if (quoted && quoted[2] !== value) {
      why = 'escape sequences Firebase decodes (\\n, \\", \\\\ …) — the pushed value would differ from the text';
      meant.push(['for the decoded value', value], ['if the backslashes are part of the value', quoted[2]]);
    } else if (quoted && value.includes(quoted[1])) {
      why = `an escaped ${quoted[1]} inside ${quoted[1]}-quotes — Firebase keeps the backslash`;
      meant.push(['for the value as Firebase reads it', value], ['without the backslash', value.split(`\\${quoted[1]}`).join(quoted[1])]);
    } else if (quoted && spellingOf(value) === 'bare') {
      why = 'quotes Firebase strips — they are not part of the value it pushes';
      meant.push(['for the value without the quotes', value], ['if the quotes are part of the value', written]);
    } else if (!quoted && written !== value) {
      why = 'quoting Firebase does not read as written';
      meant.push(['for what Firebase reads', value]);
    } else if (!quoted && /^["'`]|["'`]$/.test(written)) {
      why = 'a stray or unbalanced quote — it reads as an unfinished quoted value';
      meant.push(['if the quote is part of the value', value]);
    }
    if (/^\s*export\b/.test(whole)) {
      if (why) why += '; and the line starts with `export`, which Firebase drops';
      else {
        why = '`export` — Firebase drops it, and pushes the key without it';
        meant.push(['without export', value]);
      }
    }
    if (why) out.push({ key, why, write: meant.map(([when, v]) => `${when}: ${shapeFor(key, v)}`) });
  }
  return out;
}

/** The refusal for a set of ambiguities, one block per key — keys and shapes only, never a value. */
const describeAmbiguities = (found) =>
  found.map(({ key, why, write }) => `  ${key}: ${why}.\n${write.map((w) => `      ${w}`).join('\n')}`).join('\n');

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

/**
 * Does the INSTALLED firebase-tools send the emulator's Secret Manager fetch where CLOUD_SECRET_MANAGER_URL says?
 * Asked the way the emulator meets it: in a fresh process, the variable set BEFORE firebase-tools loads (its Secret
 * Manager client captures the origin at module load — lib/gcp/secretManager.js), then the emulator's own call
 * (`accessSecretVersion`) against a local listener. Isolated so it can dial nothing else: a throwaway access token,
 * an empty config home (no `firebase login` is read), no proxy, no ADC. Returns { ok } or { ok: false, why }.
 */
function sinkHonoured(cwd) {
  const { spawnSync } = require('node:child_process');
  const os = require('node:os');
  const probe = `
    const http = require('node:http');
    let hit = '';
    const srv = http.createServer((req, res) => { hit = req.method + ' ' + req.url; res.writeHead(404, { 'content-type': 'application/json' }); res.end('{}'); });
    srv.listen(0, '127.0.0.1', async () => {
      process.env.CLOUD_SECRET_MANAGER_URL = 'http://127.0.0.1:' + srv.address().port;
      const ft = (rel) => require(require.resolve('firebase-tools/' + rel, { paths: [process.argv[1]] }));
      try {
        ft('lib/apiv2').setAccessToken('bespunky-sink-probe');
        await ft('lib/gcp/secretManager').accessSecretVersion('demo-sink-probe', 'PROBE', 'latest').catch(() => {});
      } catch (e) {
        process.stdout.write('LOAD ' + (e && e.message));
        process.exit(0);
      }
      srv.close();
      process.stdout.write('HIT ' + hit);
      process.exit(0);
    });`;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sink-probe-'));
  const env = { ...process.env, XDG_CONFIG_HOME: home };
  for (const k of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'GOOGLE_APPLICATION_CREDENTIALS', 'FIREBASE_TOKEN', 'CLOUD_SECRET_MANAGER_URL']) delete env[k];
  try {
    const r = spawnSync(process.execPath, ['-e', probe, cwd], { env, encoding: 'utf8', timeout: 20000 });
    const out = r.stdout ?? '';
    if (out === 'HIT GET /v1/projects/demo-sink-probe/secrets/PROBE/versions/latest:access') return { ok: true };
    if (out.startsWith('LOAD ')) return { ok: false, why: `could not load the installed firebase-tools to check it (${out.slice(5)})` };
    return {
      ok: false,
      why: `the installed firebase-tools does not send the emulator's Secret Manager fetch to CLOUD_SECRET_MANAGER_URL (${out ? `probe: ${out}` : r.error ? r.error.message : 'nothing reached it'})`,
    };
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
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
  const sandboxPath = path.join(source, '.secret.sandbox.local');
  const sandboxFile = readEnvs(sandboxPath);
  const sandbox = mode === 'sandbox' ? sandboxFile : {};
  if (mode === 'sandbox') {
    // The same rule push-secrets applies to production: a live value means exactly what its line says, or nothing
    // is launched with it.
    let found = [];
    try {
      found = ambiguities(fs.readFileSync(sandboxPath, 'utf8'));
    } catch {
      // absent — the mode check in tools/emulators.sh already refused a sandbox run without the file
    }
    if (found.length) {
      fail(
        `.secret.sandbox.local: ${found.length} value(s) Firebase would read as something other than what is written — ` +
          `refusing to launch with them live:\n${describeAmbiguities(found)}\n[emulators]   Or disarm the sandbox for this run: EMULATOR_SECRETS=inert.`,
      );
    }
  }
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

  // The sink is an undocumented firebase-tools knob: check the INSTALLED one honours it — where it matters, not
  // through a getter: `sinkHonoured` makes the very call the emulator makes for a missing secret and sees where it
  // dials. Offline, the project id is the guarantee and the sink only depth; under the real id the sink is what
  // stands between a missing value and production, so a firebase-tools that ignores it is a refusal.
  const sink = show ? sinkHonoured(process.cwd()) : { ok: true };
  if (show && !sink.ok) {
    const why = sink.why;
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

module.exports = { parse, parseStrict, keyProblem, formatLine, ambiguities, spellingOf, bundledSecrets, inertSecretsPlugin, place, sinkHonoured, SINK, CONFIG_DIR_SINCE };

// ── 3. the production push (tools/push-secrets.sh) ───────────────────────────────────────────────────────────────
/**
 * The values tools/push-secrets.sh sets in Secret Manager — read from `.secret.local` with the SAME rules as everything
 * above (firebase-tools' dotenv semantics) — and refused wherever those semantics would change what a line says (see
 * `ambiguities`: an unquoted `#`, quotes or escapes Firebase strips, `export`). Refuses the whole file (exit 2) on such
 * a value, on a line that is not KEY=VALUE, or on a key Firebase refuses — a push is production, so nothing is pushed
 * with a meaning the developer did not write, and nothing half-pushed. Unfilled values (empty, `PASTE_…`) are skipped.
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
  const found = ambiguities(text);
  if (found.length) {
    console.error(
      `[push-secrets] ${found.length} value(s) in ${file} would be pushed as something other than what is written — ` +
        `refusing to push anything. Rewrite each as shown (values are not printed):\n${describeAmbiguities(found)}`,
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

/**
 * What a dry run shows for one value: its LENGTH CLASS, nothing else. A dry run lands in transcripts and CI logs, so no
 * part of a value (edges) and nothing derived from it alone (a hash — an offline oracle for a short secret) is shown;
 * a stray quote or comment no longer needs eyeballing, because `ambiguities` refuses it before anything is shown.
 */
function describeValue(value) {
  const n = [...value].length;
  const cls = n < 8 ? 'under 8' : n < 16 ? '8–15' : n < 32 ? '16–31' : n < 64 ? '32–63' : '64 or more';
  return `${cls} characters`;
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
