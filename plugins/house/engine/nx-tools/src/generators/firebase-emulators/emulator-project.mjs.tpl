// WHICH PROJECT THE EMULATOR SUITE RUNS UNDER — and so what a local run can reach. GENERATOR-OWNED (rewritten on
// every upgrade); never edit it. Read by tools/emulators.sh; the browser half of the same rule is
// `emulatorProjectId()` in the app's firebase.config.ts, which must stay in step with this file.
//
// THE GUARANTEE IS STRUCTURAL. By default the suite runs under an OFFLINE `demo-` project id, derived from the app's
// own: `my-app` → `demo-my-app` (an id that is already `demo-…` is kept). Google refuses to create a project whose id
// starts with `demo-`, so under it every Google API call the emulated code makes is addressed to a project that
// cannot exist — firebase-tools says so at start ("attempts to access non-emulated services for this project will
// fail"), skips its Admin-SDK-config lookup, and Secret Manager, FCM, Remote Config, Cloud Tasks, a non-emulated
// bucket (`demo-….appspot.com`, unclaimable) all answer "no such project" instead of serving production. That holds
// whatever the code does, as long as it names the project the way Firebase hands it over (FIREBASE_CONFIG,
// GCLOUD_PROJECT, the default app). What it does NOT cover, said plainly:
//   • code that names the REAL project or a real resource itself (a hard-coded id, `projects/<real>/secrets/…`, an
//     explicit `initializeApp({ projectId })`, a real bucket name) — firebase-tools still hands the function your
//     `firebase login` / ADC credentials, so such a call is made as you;
//   • services that are not Google's: a webhook URL or API key in `.env`, or a placeholder secret sent to a real API
//     (it is refused there, but the request — chat id and body — still leaves). `.env.local` and the inert secrets
//     (tools/emulator-secrets.cjs) are the defence for those.
//
// THE REAL ID ONLY WHEN THE PROJECT SAYS SO, IN THE ONE PLACE THE BROWSER CAN SEE TOO: environment.ts commits a
// service to the real backend (`auth: false` in its EMULATE map, or `default: false` on an `emulators` entry). A
// real service and emulated ones must share one project id (singleProjectMode: the Auth emulator keeps accounts
// per project, the Functions emulator serves /<project>/…), so the suite then runs under the real id — with every
// consequence that has, which the launch banner states. A launch-time override would split the browser (which
// cannot see it) from the suite, so there is none: the choice is committed, or it is not made.
//
//   node tools/emulator-project.mjs resolve <environment.ts> <fallback id>   → shell assignments (eval them)
//   node tools/emulator-project.mjs align-storage <data dir> <from bucket> <to bucket>
import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** The offline twin of a project id: Firebase's `demo-` convention (an id already `demo-…` is its own twin). */
export const offlineIdOf = (id) => (id.startsWith('demo-') ? id : `demo-${id}`);

/** The bucket Firebase gives a project by default — what the emulated Functions' Admin SDK uses unasked. */
export const defaultBucketOf = (id) => `${id}.appspot.com`;

const SERVICES = ['auth', 'firestore', 'storage', 'functions'];

/** A string field of the environment's `firebase` block, by name — the first `<name>: '<value>'` at a line start. */
const field = (source, name) =>
  source.match(new RegExp(`^[ \\t]*${name}:[ \\t]*["'\`]([^"'\`]+)["'\`]`, 'm'))?.[1] ?? '';

/**
 * The services environment.ts COMMITS to the real backend, as the browser resolves its committed defaults:
 * `environment.emulators.<service>.default`, which the house template reads from the EMULATE map. A service with no
 * `emulators` entry is not a choice (the app may not use it) and counts as nothing. A default that is neither a
 * literal nor an EMULATE entry cannot be read here — reported as `unread`, and treated as emulated (the offline id).
 */
export function committedRealServices(source) {
  const map = {};
  const emulate = source.match(/\bconst\s+EMULATE\s*=\s*\{([^}]*)\}/);
  for (const [, key, value] of (emulate?.[1] ?? '').matchAll(/(\w+)\s*:\s*(true|false)\b/g)) map[key] = value === 'true';
  const real = [];
  const unread = [];
  for (const service of SERVICES) {
    const entry = source.match(new RegExp(`^[ \\t]*${service}:[ \\t]*\\{([^}]*)\\}`, 'm'))?.[1];
    if (entry === undefined) continue;
    const value = entry.match(/\bdefault\s*:\s*([\w.]+)/)?.[1];
    const resolved =
      value === 'true' ? true : value === 'false' ? false : value === `EMULATE.${service}` && service in map ? map[service] : undefined;
    if (resolved === false) real.push(service);
    else if (resolved === undefined) unread.push(service);
  }
  return { real, unread };
}

/** Where this run's suite stands: its project id, why, and the ids/buckets on either side of the choice. */
export function resolveEmulatorProject(envFile, fallback) {
  let source = '';
  try {
    source = readFileSync(envFile, 'utf8');
  } catch {
    // no client app env file — the workspace's own offline id
  }
  const appId = field(source, 'projectId') || fallback;
  const offlineId = offlineIdOf(appId);
  const { real, unread } = committedRealServices(source);
  const isReal = real.length > 0 && !appId.startsWith('demo-');
  const id = isReal ? appId : offlineId;
  return {
    id,
    mode: isReal ? 'real' : 'offline',
    appId,
    realServices: real,
    unreadServices: unread,
    // The bucket the browser uses in each mode: the app's configured one when real, the offline id's default when
    // offline (firebase.config.ts → emulatorProjectId). Emulator Storage data is keyed by bucket name.
    bucket: isReal ? field(source, 'storageBucket') : defaultBucketOf(offlineId),
    otherBucket: isReal ? defaultBucketOf(offlineId) : field(source, 'storageBucket'),
  };
}

/**
 * Move emulator Storage data from one bucket name to another, in an export directory (`--import` / `--export-on-exit`
 * shape: storage_export/buckets.json + metadata/*.json). The suite's default bucket follows its project id, so data a
 * suite saved under the other mode's bucket would otherwise sit there unseen. Moves only when the target bucket holds
 * nothing (never merges two worlds); returns what it did, as one sentence, or '' when there was nothing to do.
 */
export function alignStorage(dataDir, from, to) {
  const dir = join(dataDir, 'storage_export');
  const bucketsFile = join(dir, 'buckets.json');
  if (!from || !to || from === to || !existsSync(bucketsFile)) return '';
  const buckets = JSON.parse(readFileSync(bucketsFile, 'utf8'));
  const ids = (buckets.buckets ?? []).map((b) => b.id);
  if (!ids.includes(from)) return '';
  const metaDir = join(dir, 'metadata');
  const metas = existsSync(metaDir) ? readdirSync(metaDir).filter((f) => f.endsWith('.json')) : [];
  const inBucket = (bucket) => metas.filter((f) => JSON.parse(readFileSync(join(metaDir, f), 'utf8')).bucket === bucket);
  if (ids.includes(to) && inBucket(to).length) {
    return `emulator Storage holds files in both ${from} and ${to} — left as is; this run's app uses ${to}.`;
  }
  const moving = inBucket(from);
  for (const f of moving) {
    const meta = JSON.parse(readFileSync(join(metaDir, f), 'utf8'));
    meta.bucket = to;
    writeFileSync(join(metaDir, `${f}.tmp`), JSON.stringify(meta, null, 2));
    renameSync(join(metaDir, `${f}.tmp`), join(metaDir, f));
  }
  buckets.buckets = [...(buckets.buckets ?? []).filter((b) => b.id !== from && b.id !== to), { id: to }];
  writeFileSync(`${bucketsFile}.tmp`, JSON.stringify(buckets, null, 2));
  renameSync(`${bucketsFile}.tmp`, bucketsFile);
  return `emulator Storage data moved from bucket ${from} to ${to} (${moving.length} file${moving.length === 1 ? '' : 's'}) — the bucket this run's app and functions use.`;
}

const sh = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'resolve') {
    const p = resolveEmulatorProject(args[0], args[1]);
    process.stdout.write(
      [
        `EMU_PROJECT=${sh(p.id)}`,
        `EMU_MODE=${sh(p.mode)}`,
        `EMU_APP_PROJECT=${sh(p.appId)}`,
        `EMU_REAL_SERVICES=${sh(p.realServices.join(','))}`,
        `EMU_UNREAD_SERVICES=${sh(p.unreadServices.join(','))}`,
        `EMU_BUCKET=${sh(p.bucket)}`,
        `EMU_OTHER_BUCKET=${sh(p.otherBucket)}`,
      ].join('\n') + '\n',
    );
  } else if (command === 'align-storage') {
    const said = alignStorage(args[0], args[1], args[2]);
    if (said) process.stdout.write(`${said}\n`);
  } else {
    process.stderr.write('usage: emulator-project.mjs resolve <environment.ts> <fallback> | align-storage <dir> <from> <to>\n');
    process.exit(2);
  }
}
