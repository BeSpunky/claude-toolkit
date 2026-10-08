// 0.50.0 — the committed `.secret.local.example` stops claiming the emulator reads `.secret.local`.
//
// The shapes it meets: the stock 0.49 example (kept verbatim in `0.50.0-stock-0.49/`), the same with the project's
// own keys below the header, a header the project rewrote that still carries the retired claim (left, reported),
// one that doesn't (silent), a functions project outside apps/, and no functions project at all.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAYLOAD, requireFromRepo } from '../../test-support/payload.mjs';

const { addProjectConfiguration } = requireFromRepo('@nx/devkit');
const HERE = dirname(fileURLToPath(import.meta.url));
const stock = readFileSync(join(HERE, '0.50.0-stock-0.49', 'secret.local.example.tpl'), 'utf8').replaceAll('{{functionsProject}}', 'functions');
const current = readFileSync(join(PAYLOAD, 'src/generators/firebase-emulators/functions-secret.local.example.tpl'), 'utf8').replaceAll('{{functionsProject}}', 'functions');
const EXAMPLE = 'apps/functions/.secret.local.example';

const functionsApp = (tree, root = 'apps/functions') =>
  addProjectConfiguration(tree, 'functions', { root, projectType: 'application', tags: ['platform:server'] });

const warnings = [];
function recordWarnings() {
  warnings.splice(0);
  const logger = requireFromRepo('@nx/devkit').logger;
  const previous = logger.warn;
  logger.warn = (...args) => (warnings.push(args.join(' ')), previous(...args));
}

export default {
  name: '0.50.0 · retell-secrets-example',
  ladder: ['0.50.0/retell-secrets-example'],
  cases: [
    {
      name: 'stock 0.49 example: becomes exactly the 0.50 seeded one',
      setup: (tree) => {
        functionsApp(tree);
        tree.write(EXAMPLE, stock);
      },
      expect: (tree, t) => t.ok(t.read(EXAMPLE) === current, `got:\n${t.read(EXAMPLE)}`),
    },
    {
      name: "the project's keys below the stock header stay byte-for-byte",
      setup: (tree) => {
        functionsApp(tree);
        tree.write(EXAMPLE, `${stock}TELEGRAM_BOT_TOKEN=PASTE_TELEGRAM_BOT_TOKEN_HERE\nSTRIPE_KEY=PASTE_STRIPE_KEY_HERE\n`);
      },
      expect: (tree, t) => {
        t.ok(t.read(EXAMPLE) === `${current}TELEGRAM_BOT_TOKEN=PASTE_TELEGRAM_BOT_TOKEN_HERE\nSTRIPE_KEY=PASTE_STRIPE_KEY_HERE\n`, `got:\n${t.read(EXAMPLE)}`);
        t.hasNot(EXAMPLE, 'places `.secret.local` beside the built bundle');
      },
    },
    {
      name: 'a rewritten header that still makes the retired claim: left, reported',
      setup: (tree) => {
        recordWarnings();
        functionsApp(tree);
        tree.write(EXAMPLE, `# Our secrets.\n# tools/emulators.sh places \`.secret.local\` beside the built bundle.\nKEY=PASTE_KEY\n`);
      },
      expect: (tree, t) => {
        t.has(EXAMPLE, '# Our secrets.');
        t.ok(warnings.some((w) => w.includes('no longer true')), `no report: ${warnings.join(' | ')}`);
      },
    },
    {
      name: "a header of the project's own, without the claim: untouched, silent",
      setup: (tree) => {
        recordWarnings();
        functionsApp(tree);
        tree.write(EXAMPLE, '# Ours.\nKEY=PASTE_KEY\n');
      },
      expect: (tree, t) => {
        t.ok(t.read(EXAMPLE) === '# Ours.\nKEY=PASTE_KEY\n', 'changed');
        t.ok(warnings.length === 0, `warned: ${warnings.join(' | ')}`);
      },
    },
    {
      name: 'functions project outside apps/ (packages/backend): found by name',
      setup: (tree) => {
        functionsApp(tree, 'packages/backend');
        tree.write('packages/backend/.secret.local.example', stock);
      },
      expect: (tree, t) => t.ok(t.read('packages/backend/.secret.local.example') === current, 'not updated'),
    },
    {
      name: 'no functions project: nothing to do',
      setup: () => {},
      expect: (tree, t) => t.missing(EXAMPLE),
    },
  ],
};
