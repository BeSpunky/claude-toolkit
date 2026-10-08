// 0.50.0 — the committed `.secret.local.example` stops telling the emulator story that is no longer true.
//
// WHY. Until 0.50.0, tools/emulators.sh copied the production `.secret.local` beside the functions bundle, and the
// seeded example said so ("LOCAL (emulator): tools/emulators.sh places `.secret.local` beside the built bundle").
// From 0.50.0 the emulator never reads that file — every declared secret gets an inert placeholder, real values
// only from an opt-in `.secret.sandbox.local` of sandbox credentials. The example is seeded once and then the
// project's (it grows a line per `defineSecret`), so the regenerated scripts cannot correct it, and a comment that
// tells a developer their production values reach the emulator is the instruction most likely to be followed.
//
// WHAT IT DOES. Replaces ONLY the stock header comment — recognised line for line, the functions project's name
// being the one variable — with the 0.50 one. Every key the project added, and anything else below the header,
// stays byte-for-byte. A header that is not the stock one is the project's own words: left, and reported only
// when it still carries the retired claim.
import { type Tree, logger } from '@nx/devkit';
import { houseProjectHome } from '../../generators/_utils/project-files';
import { resolveAppsDir } from '../../generators/_utils/workspace-layout';

const TAG = '[0.50.0 retell-secrets-example]';

/** The 0.49 header, line for line, with the functions project's name as `{{functionsProject}}`. */
const STOCK_HEADER = `# Local secret values for Cloud Functions params (firebase-functions/params \`defineSecret\`).
# Copy this file to \`.secret.local\` (gitignored) and fill in real values — one KEY=VALUE per line.
#
#   • LOCAL (emulator): tools/emulators.sh places \`.secret.local\` beside the built bundle at
#     start-up, where the Functions emulator reads it. Deliberately NOT a build asset, so the
#     secret never enters build outputs or the Nx cache.
#   • PRODUCTION: never deploy secrets from a file — push them to Google Secret Manager with
#     \`yarn nx run {{functionsProject}}:push-secrets\` (tools/push-secrets.sh), which sets each KEY below as
#     a \`firebase functions:secrets:set KEY\` on the deploy project.
#
`;

const NEW_HEADER = `# The Cloud Functions secrets this project declares (firebase-functions/params \`defineSecret\`) —
# committed, so every tree and teammate knows WHICH secrets exist. One KEY=VALUE per line.
#
#   • PRODUCTION: copy this file to \`.secret.local\` (gitignored) and fill in the real values. Push
#     them to Google Secret Manager with \`yarn nx run {{functionsProject}}:push-secrets\`
#     (tools/push-secrets.sh) — never deploy secrets from a file.
#   • LOCAL (emulator): nothing to do. tools/emulators.sh gives every key declared here an INERT
#     placeholder, so local runs can never act with production's credentials. \`.secret.local\` is
#     never fed to the emulator.
#   • SANDBOX (opt-in): to exercise a real integration locally (a test bot, a sandbox account), put
#     THOSE credentials in \`.secret.sandbox.local\` (gitignored) — never production's. The emulator
#     loads them and says so on every launch; delete the file to disarm.
#
`;

const RETIRED_CLAIM = 'places `.secret.local` beside the built bundle';

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export default async function retellSecretsExample(tree: Tree): Promise<void> {
  const functions = houseProjectHome(tree, 'functions', `${resolveAppsDir(tree)}/functions`);
  const path = `${functions.root}/.secret.local.example`;
  if (!tree.exists(path)) return;
  const original = tree.read(path, 'utf8') ?? '';
  const crlf = original.includes('\r\n');
  const text = crlf ? original.replace(/\r\n/g, '\n') : original;

  const stock = new RegExp(`^${escape(STOCK_HEADER).replace(escape('{{functionsProject}}'), '([A-Za-z0-9@/._-]+)')}`);
  const match = stock.exec(text);
  if (!match) {
    if (text.includes(RETIRED_CLAIM)) {
      logger.warn(
        `${TAG} ${path} still says tools/emulators.sh places \`.secret.local\` beside the bundle — no longer true: the ` +
          `emulator gets inert placeholders for every declared key, and sandbox values only from .secret.sandbox.local. ` +
          `Its header is not the stock one, so it was left for you to correct.`,
      );
    }
    return;
  }
  const next = NEW_HEADER.replace('{{functionsProject}}', match[1]) + text.slice(match[0].length);
  tree.write(path, crlf ? next.replace(/\n/g, '\r\n') : next);
  logger.info(`${TAG} ${path}: header updated — the emulator no longer reads .secret.local; your keys are unchanged.`);
}
