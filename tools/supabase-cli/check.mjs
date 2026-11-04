#!/usr/bin/env node
// The STALENESS ALARM for the Supabase CLI the `supabase` layer pins. Nothing is projected from it, so there is no --write.
//
//   node tools/supabase-cli/check.mjs     (the network; weekly, and before every payload publish)
//
// ONE FINDING CAN FAIL: the pin no longer downloads, or no longer matches its sha256, each file fetched whole. Consumers' cache-miss
// image builds fail on that, and only a payload release repairs it.
//
// TWO ONLY INFORM, and never fail, since neither is wrong with anything shipped. A newer release: moving the pin is a release decision,
// with `tools/test-supabase/run.mjs` to run first. The native runtime's stage: the layer rests on an alpha, and this says when that
// changes or can no longer be read. Moving off alpha is news for the docs; it changes no code.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pinnedDownloads } from '../postgres-debs/closure.mjs';
import { brokenDownloads } from '../postgres-debs/downloads.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { isGreater } = createRequire(import.meta.url)('../check-release-invariants/rules.cjs');

// npm, not GitHub: its `latest` is what Supabase calls released, and a GitHub release may be a beta (3.1.0-beta.16 beside latest 3.0.0).
export const REGISTRY = 'https://registry.npmjs.org/supabase';
export const FEATURE_PAGE = 'https://supabase.com/features/native-local-runtime';

/** The stage the feature page states, or undefined when it no longer says one where this looks. */
export function nativeStage(page) {
  const found =
    /"slug"\s*:\s*"native-local-runtime"\s*,\s*"status"\s*:\s*\{\s*"stage"\s*:\s*"([^"]+)"/.exec(page.replaceAll('\\"', '"')) ??
    /\bStage:?\s+([A-Za-z][A-Za-z ]*?)\s{2,}/.exec(page.replace(/<[^>]*>/g, '  '));
  return found?.[1];
}

/** What to say about what upstream shows: lines only, since neither of these can fail a run. */
export function notices({ pin, latest, stage }) {
  const said = [];
  if (latest === undefined) said.push(`Could not read the CLI's latest release from ${REGISTRY}.`);
  else if (isGreater(latest, pin)) said.push(`The Supabase CLI ${latest} is out, and the layer pins ${pin}. Moving the pin is a release decision: run node tools/test-supabase/run.mjs on the new one first.`);
  if (stage === undefined) said.push(`Could not read the native runtime's stage from ${FEATURE_PAGE}. Read it by hand: the docs say alpha.`);
  else if (!/alpha/i.test(stage)) said.push(`The native runtime's stage is now "${stage}", and the docs say alpha (CLAUDE.md, README.md, HOUSE.md's supabase section). Read ${FEATURE_PAGE}, then say what it means for the layer.`);
  return said;
}

const text = async (url) => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    return response.ok ? await response.text() : undefined;
  } catch {
    return undefined;
  }
};

async function main() {
  const { version: pin, pins } = pinnedDownloads(readFileSync(join(ROOT, 'plugins/house/engine/nx-tools/src/generators/_utils/versions.ts'), 'utf8'), 'SUPABASE_CLI');
  const faults = await brokenDownloads(pins);
  const registry = await text(REGISTRY);
  const page = await text(FEATURE_PAGE);
  let latest;
  try {
    latest = JSON.parse(registry)['dist-tags'].latest;
  } catch {
    latest = undefined;
  }
  const stage = page === undefined ? undefined : nativeStage(page);
  for (const line of notices({ pin, latest, stage })) console.log(process.env.GITHUB_ACTIONS ? `::notice::${line}` : `NOTICE: ${line}`);
  if (faults.length) {
    console.error(`SUPABASE CLI ${pin}: consumers' cache-miss image builds fail on these, and a payload release is the only repair. Move SUPABASE_CLI_VERSION and SUPABASE_CLI_DOWNLOADS (versions.ts), then run node tools/test-supabase/run.mjs:\n  ${faults.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`ok: the Supabase CLI ${pin}'s ${pins.length} downloads match their sha256 (latest ${latest ?? 'unread'}; the native runtime is ${stage ?? 'unread'})`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
