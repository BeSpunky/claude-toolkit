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
// THE FILE IS EVALUATED, NEVER READ AS TEXT. The browser decides from the VALUES environment.ts exports
// (firebase.config.ts → emulatorProjectId: `environment.emulators.<service>.default === false`), so this decides from
// the same values: environment.ts is imported, with Node's own TypeScript type stripping (22.18+), and asked the
// same question. Reading it as text was two bugs in one: a comment (`// auth: false`) moved the suite onto the real
// id while the browser stayed offline, and a typed `const EMULATE: Record<…>` or an earlier `auth: {…}` block hid a
// real service, so the suite ran offline under a browser on the real id. A file that cannot be evaluated here (a
// TypeScript-only construct such as an `enum`, an import Node cannot resolve) is a refusal — exit 2, with the
// reason — never a guess. Its imports resolve as the app's build resolves relative ones (`./x` → `./x.ts`).
//
//   node tools/emulator-project.mjs resolve <environment.ts> <fallback id>   → shell assignments (eval them)
//   node tools/emulator-project.mjs align-storage <data dir> <from bucket[,candidate…]> <to bucket>
import { existsSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import * as nodeModule from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** The offline twin of a project id: Firebase's `demo-` convention (an id already `demo-…` is its own twin). */
export const offlineIdOf = (id) => (id.startsWith('demo-') ? id : `demo-${id}`);

/** The bucket Firebase gives a project by default — what the emulated Functions' Admin SDK uses unasked. */
export const defaultBucketOf = (id) => `${id}.appspot.com`;

/**
 * The buckets a REAL project may have by default, when environment.ts names none: Firebase gave `<id>.appspot.com`
 * until late 2024 and `<id>.firebasestorage.app` since. Which one a project has cannot be told from here.
 */
export const realDefaultBucketsOf = (id) => [`${id}.appspot.com`, `${id}.firebasestorage.app`];

const SERVICES = ['auth', 'firestore', 'storage', 'functions'];

/** Why environment.ts cannot be evaluated — the message a refusal carries. */
export class EnvironmentError extends Error {}

let hooked = false;
/** Resolve a TypeScript-style relative import (`./x` → `./x.ts`, `./x/index.ts`) and load `.ts` as TypeScript ESM. */
function hookTypeScript() {
  if (hooked) return;
  hooked = true;
  nodeModule.registerHooks({
    resolve(specifier, context, next) {
      try {
        return next(specifier, context);
      } catch (e) {
        if (e?.code !== 'ERR_MODULE_NOT_FOUND' || !/^\.{1,2}\//.test(specifier) || !context.parentURL) throw e;
        for (const suffix of ['.ts', '/index.ts']) {
          const url = new URL(specifier + suffix, context.parentURL);
          if (existsSync(fileURLToPath(url))) return { url: url.href, shortCircuit: true };
        }
        throw e;
      }
    },
    load(url, context, next) {
      // An Angular workspace's package.json rarely says "type": "module"; environment.ts is ESM all the same.
      if (url.startsWith('file:') && /\.m?ts$/.test(new URL(url).pathname)) {
        return { ...next(url, { ...context, format: 'module-typescript' }), format: 'module-typescript' };
      }
      return next(url, context);
    },
  });
}

/**
 * EVALUATE environment.ts and return what the browser decides from: its `firebase.projectId` and the services whose
 * committed `emulators.<service>.default` is `false` (a service with no `emulators` entry is not a choice — the app
 * may not use it). Throws EnvironmentError when the file cannot be evaluated or does not export that shape.
 */
export async function evaluateEnvironment(envFile) {
  if (!process.features?.typescript || typeof nodeModule.registerHooks !== 'function') {
    throw new EnvironmentError(
      `Node ${process.version} cannot evaluate TypeScript (type stripping and module hooks need Node 22.18 or later) — ` +
        'the project id must come from the values environment.ts exports, so upgrade Node.',
    );
  }
  hookTypeScript();
  let mod;
  try {
    mod = await import(pathToFileURL(resolve(envFile)).href);
  } catch (e) {
    throw new EnvironmentError(
      `could not evaluate ${envFile}: ${e?.code ? `${e.code}: ` : ''}${e?.message ?? e}\n` +
        "[emulators]   The suite's project id is the browser's decision, read from environment.ts's values — refusing to guess.",
    );
  }
  const environment = mod.environment;
  const appId = environment?.firebase?.projectId;
  if (typeof appId !== 'string' || !appId) {
    throw new EnvironmentError(`${envFile} does not export \`environment\` with a string \`firebase.projectId\`.`);
  }
  const real = SERVICES.filter((service) => environment.emulators?.[service]?.default === false);
  const storageBucket = typeof environment.firebase.storageBucket === 'string' ? environment.firebase.storageBucket : '';
  return { appId, real, storageBucket };
}

const isFile = (path) => {
  try {
    return Boolean(path) && statSync(path).isFile();
  } catch {
    return false;
  }
};

/**
 * FIREBASE_EMULATOR_PROJECT WAS REMOVED, and a removed knob that is silently ignored is worse than one that still
 * works: whoever set it believes the suite runs under their id. It overrode the suite's id at launch only — which the
 * browser cannot see — so the two could run under different projects. Set, it is a refusal that says so.
 */
export function refuseRemovedOverride(env = process.env) {
  if (env.FIREBASE_EMULATOR_PROJECT === undefined) return;
  throw new EnvironmentError(
    `FIREBASE_EMULATOR_PROJECT is set (${JSON.stringify(env.FIREBASE_EMULATOR_PROJECT)}), but it was REMOVED — refusing to start ` +
      'rather than ignore it. Why: the emulator suite and the app in the browser must share ONE project id, and both now ' +
      "derive it from environment.ts (its `demo-` twin, or the real id when a service is committed to the real backend); a " +
      'launch-time override would move the suite and leave the browser behind. Instead: commit the service to the real ' +
      "backend in environment.ts (`false` in its EMULATE map) to run under the real id — or unset the variable " +
      '(unset FIREBASE_EMULATOR_PROJECT) to run offline.',
  );
}

/** Where this run's suite stands: its project id, why, and the ids/buckets on either side of the choice. */
export async function resolveEmulatorProject(envFile, fallback) {
  refuseRemovedOverride();
  // No client app env file (a workspace without one): the workspace's own offline id, nothing committed real.
  const env = isFile(envFile) ? await evaluateEnvironment(envFile) : { appId: fallback, real: [], storageBucket: '' };
  const { appId, storageBucket } = env;
  const offlineId = offlineIdOf(appId);
  // The browser's rule exactly (firebase.config.ts → emulatorProjectId): an id already `demo-…` stays offline.
  const isReal = env.real.length > 0 && !appId.startsWith('demo-');
  const id = isReal ? appId : offlineId;
  // Emulator Storage data is keyed by bucket name. The bucket the browser uses in each mode: offline, the offline id's
  // default (firebase.config.ts → firebaseOptions); real, environment.ts's storageBucket — and when it names none,
  // the browser has NO default bucket and which default the real project has cannot be known here (both reported).
  const realBuckets = storageBucket ? [storageBucket] : realDefaultBucketsOf(appId);
  return {
    id,
    mode: isReal ? 'real' : 'offline',
    appId,
    realServices: isReal ? env.real : [],
    bucket: isReal ? storageBucket : defaultBucketOf(offlineId),
    // Where data a run in the OTHER mode saved may sit: candidates, in order — align-storage moves from the one that
    // holds files.
    otherBuckets: isReal ? [defaultBucketOf(offlineId)] : appId === offlineId ? [] : realBuckets,
    storageBucketUnset: !storageBucket,
  };
}

/**
 * Move emulator Storage data from one bucket name to another, in an export directory (`--import` / `--export-on-exit`
 * shape: storage_export/buckets.json + metadata/*.json). The suite's default bucket follows its project id, so data a
 * suite saved under the other mode's bucket would otherwise sit there unseen. `from` is a list of candidates (the
 * other mode's bucket may be one of several defaults): the data moves from the one candidate that holds files, and
 * when more than one does, nothing moves and that is said. Moves only when the target bucket holds nothing (never
 * merges two worlds); returns what it did, as one sentence, or '' when there was nothing to do. A file it cannot read
 * throws — the caller reports it; data is never silently left out of sight.
 */
export function alignStorage(dataDir, from, to) {
  const dir = join(dataDir, 'storage_export');
  const bucketsFile = join(dir, 'buckets.json');
  const candidates = (Array.isArray(from) ? from : [from]).filter((b) => b && b !== to);
  if (!to || !candidates.length || !existsSync(bucketsFile)) return '';
  const buckets = JSON.parse(readFileSync(bucketsFile, 'utf8'));
  const ids = (buckets.buckets ?? []).map((b) => b.id);
  const metaDir = join(dir, 'metadata');
  const metas = existsSync(metaDir) ? readdirSync(metaDir).filter((f) => f.endsWith('.json')) : [];
  const inBucket = (bucket) => metas.filter((f) => JSON.parse(readFileSync(join(metaDir, f), 'utf8')).bucket === bucket);
  const holding = candidates.filter((b) => ids.includes(b) && inBucket(b).length);
  if (!holding.length) return '';
  if (holding.length > 1) {
    return `emulator Storage holds files in ${holding.join(' and ')} — left as is (which one to move cannot be told); this run's app uses ${to}.`;
  }
  const [source] = holding;
  if (ids.includes(to) && inBucket(to).length) {
    return `emulator Storage holds files in both ${source} and ${to} — left as is; this run's app uses ${to}.`;
  }
  const moving = inBucket(source);
  for (const f of moving) {
    const meta = JSON.parse(readFileSync(join(metaDir, f), 'utf8'));
    meta.bucket = to;
    writeFileSync(join(metaDir, `${f}.tmp`), JSON.stringify(meta, null, 2));
    renameSync(join(metaDir, `${f}.tmp`), join(metaDir, f));
  }
  buckets.buckets = [...(buckets.buckets ?? []).filter((b) => b.id !== source && b.id !== to), { id: to }];
  writeFileSync(`${bucketsFile}.tmp`, JSON.stringify(buckets, null, 2));
  renameSync(`${bucketsFile}.tmp`, bucketsFile);
  return `emulator Storage data moved from bucket ${source} to ${to} (${moving.length} file${moving.length === 1 ? '' : 's'}) — the bucket this run's app and functions use.`;
}

const sh = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'resolve') {
    let p;
    try {
      p = await resolveEmulatorProject(args[0], args[1]);
    } catch (e) {
      if (!(e instanceof EnvironmentError)) throw e;
      process.stderr.write(`[emulators] ${e.message}\n`);
      process.exit(2);
    }
    process.stdout.write(
      [
        `EMU_PROJECT=${sh(p.id)}`,
        `EMU_MODE=${sh(p.mode)}`,
        `EMU_APP_PROJECT=${sh(p.appId)}`,
        `EMU_REAL_SERVICES=${sh(p.realServices.join(','))}`,
        `EMU_BUCKET=${sh(p.bucket)}`,
        `EMU_OTHER_BUCKETS=${sh(p.otherBuckets.join(','))}`,
        `EMU_STORAGE_BUCKET_UNSET=${sh(p.storageBucketUnset ? 1 : 0)}`,
      ].join('\n') + '\n',
    );
  } else if (command === 'align-storage') {
    try {
      const said = alignStorage(args[0], (args[1] ?? '').split(','), args[2]);
      if (said) process.stdout.write(`${said}\n`);
    } catch (e) {
      process.stderr.write(`[emulators] WARNING: could not align emulator Storage data in ${args[0]} (${e?.message ?? e}) — nothing was moved.\n`);
      process.exit(1);
    }
  } else {
    process.stderr.write('usage: emulator-project.mjs resolve <environment.ts> <fallback> | align-storage <dir> <from[,…]> <to>\n');
    process.exit(2);
  }
}
