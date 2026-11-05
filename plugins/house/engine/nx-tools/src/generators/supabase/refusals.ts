// What stops a project taking the Supabase layer, as one set of sentences for its two readers: `engine/house-probe.mts`, before
// anything is written, and the generators, for a run that skipped it or a project that changed in between. Two copies had already
// disagreed: a declaration of `{}` or broken JSON passed the probe and threw in a generator, after the postgres step had run.
// PURE AND IMPORT-FREE: the probe loads it by type stripping.

/** A config.toml, as far as it matters here (`configFacts` in toml-lines.ts). */
export interface ConfigFacts {
  major?: string;
  inbucket: boolean;
  unedited: string[];
}

export interface MoveFacts {
  /** `.bespunky/postgres.json`: absent, or not JSON, or what it says. */
  declaration: { state: 'absent' | 'broken' } | { state: 'read'; major: unknown };
  config?: ConfigFacts;
  /** The file names in each folder. */
  native: string[];
  supabase: string[];
  majors: readonly string[];
  cliVersion: string;
}

export interface Refusal {
  code: 'supabase-major-mismatch' | 'supabase-config-outdated' | 'supabase-config-shape' | 'supabase-migrations-twice';
  text: string;
}

const versionOf = (name: string): string => name.split('_')[0];

export function whatCannotMove({ declaration, config, native, supabase, majors, cliVersion }: MoveFacts): Refusal[] {
  const refusals: Refusal[] = [];
  const stackMajor = majors[majors.length - 1];
  if (declaration.state === 'broken') {
    refusals.push({ code: 'supabase-major-mismatch', text: `.bespunky/postgres.json is not valid JSON, so nothing can say which major your migrations were written for. Fix it, then re-run.` });
  } else if (declaration.state === 'read' && declaration.major !== undefined && String(declaration.major) !== stackMajor) {
    refusals.push({
      code: 'supabase-major-mismatch',
      text:
        `.bespunky/postgres.json declares Postgres ${declaration.major}, and the Supabase stack runs ${stackMajor}. uuidv7() and virtual generated columns, for two, do not exist there.\n` +
        `  If your migrations use nothing newer: set { "major": ${stackMajor} } there, check them against it (house.sh upgrade, rebuild, postgres:reset), then add the layer again.`,
    });
  }
  if (config) {
    if (config.major !== undefined && !majors.includes(config.major)) refusals.push({ code: 'supabase-major-mismatch', text: `supabase/config.toml says major_version = ${config.major}, and this layer runs ${majors.join(' or ')}: the CLI may offer others, and this is the one it has been run on. Set it, then re-run.` });
    if (config.inbucket) refusals.push({ code: 'supabase-config-outdated', text: `supabase/config.toml has an [inbucket] section, which CLI ${cliVersion} cannot load. Rename it to [local_smtp], then re-run.` });
    if (config.unedited.length) refusals.push({ code: 'supabase-config-shape', text: `supabase/config.toml spells ${config.unedited.join(', ')} in a form this layer cannot edit by the line. Write each as a plain key under one [section], then re-run.` });
  }
  const sql = (names: string[]): string[] => names.filter((name) => name.endsWith('.sql'));
  const taken = new Set(sql(supabase).map(versionOf));
  const twins = sql(native).filter((name) => taken.has(versionOf(name)));
  if (twins.length) refusals.push({ code: 'supabase-migrations-twice', text: `${twins.join(', ')} in postgres/migrations share a version with what is in supabase/migrations, and a project has one folder and one ledger. Keep one of each, then re-run.` });
  return refusals;
}
