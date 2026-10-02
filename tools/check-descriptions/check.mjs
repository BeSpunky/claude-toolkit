#!/usr/bin/env node
/**
 * Guard the limits the PLATFORM puts on the text that decides whether a plugin or skill is ever used.
 *
 * WHY THIS EXISTS. A skill's frontmatter `description` is its trigger, and a plugin's description is its
 * pitch in every catalog. Claude Code reads both in full from the file, so an over-long description works
 * here and fails nowhere we look. But claude.ai (Claude Desktop) enforces limits and STORES the text
 * truncated — and strips angle brackets — so the trigger it actually sees is the first 1024 characters with
 * the rest silently gone. Every plugin and 25 skills had drifted past those limits before anyone saw a
 * warning, because nothing here measured them. A limit nobody measures is a limit that gets exceeded.
 *
 * The limits (as Claude Desktop reports them):
 *   - plugin description (plugin.json, and the marketplace entry that advertises it): at most 500 characters;
 *   - skill `description` in SKILL.md frontmatter: at most 1024 characters, with no `<` or `>`.
 *
 * Uses only node builtins and `git`, like the other checkers, so a dependency that failed to resolve cannot
 * break it. The frontmatter reader understands what this repo writes (a plain scalar or a folded `>-` block)
 * and refuses anything else loudly rather than measuring it wrong.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const PLUGIN_MAX = 500;
const SKILL_MAX = 1024;
const FORBIDDEN = /[<>]/;

const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  .split('\n')
  .filter(Boolean);

/** The folded (`>-`) or plain `description` of a SKILL.md frontmatter block. Throws on a shape it can't read. */
function skillDescription(path) {
  const lines = readFileSync(path, 'utf8').split('\n');
  if (lines[0].trim() !== '---') throw new Error('no frontmatter');
  const end = lines.indexOf('---', 1);
  if (end < 0) throw new Error('unterminated frontmatter');
  const front = lines.slice(1, end);
  const at = front.findIndex((l) => /^description:/.test(l));
  if (at < 0) throw new Error('no description field');
  const head = front[at].replace(/^description:\s*/, '');
  if (head === '>-' || head === '>') {
    const body = [];
    for (const l of front.slice(at + 1)) {
      if (l !== '' && !/^\s/.test(l)) break;
      body.push(l.trim());
    }
    // Folded scalar: single newlines become spaces, blank lines become newlines.
    return body.join('\n').replace(/([^\n])\n(?!\n)/g, '$1 ').replace(/\n\n/g, '\n').trim();
  }
  if (/^[|>]/.test(head)) throw new Error(`unsupported block scalar "${head}" — measure it by hand or teach this reader`);
  return head.replace(/^(['"])(.*)\1$/, '$2');
}

const failures = [];
const check = (where, text, max, forbidBrackets) => {
  if (text.length > max) failures.push(`${where}: ${text.length} characters (max ${max})`);
  if (forbidBrackets && FORBIDDEN.test(text)) failures.push(`${where}: contains < or > (claude.ai strips them)`);
};

let plugins = 0;
let skills = 0;
for (const path of tracked) {
  if (/^plugins\/[^/]+\/\.claude-plugin\/plugin\.json$/.test(path)) {
    plugins++;
    check(path, JSON.parse(readFileSync(path, 'utf8')).description ?? '', PLUGIN_MAX, false);
  } else if (/^plugins\/[^/]+\/skills\/[^/]+\/SKILL\.md$/.test(path)) {
    skills++;
    try {
      check(path, skillDescription(path), SKILL_MAX, true);
    } catch (error) {
      failures.push(`${path}: ${error.message}`);
    }
  }
}
for (const entry of JSON.parse(readFileSync('.claude-plugin/marketplace.json', 'utf8')).plugins) {
  check(`.claude-plugin/marketplace.json → ${entry.name}`, entry.description ?? '', PLUGIN_MAX, false);
}

if (failures.length) {
  console.error(`✗ ${failures.length} description(s) exceed what claude.ai stores:\n`);
  for (const f of failures) console.error(`  ${f}`);
  console.error(
    '\nShorten the description — it is the trigger, so keep the words that decide WHEN it fires and move the' +
      '\nrest into the body. Limits: plugin ≤ 500, skill ≤ 1024 and no < or >.',
  );
  process.exit(1);
}
console.log(`ok: ${plugins} plugin and ${skills} skill descriptions fit claude.ai's limits.`);
