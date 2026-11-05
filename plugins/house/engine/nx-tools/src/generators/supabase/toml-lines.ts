// Line-level edits of `supabase/config.toml`, which is the project's: its comments, order and every key this file does not name stay
// byte for byte. Nothing here parses TOML, deliberately: no comment-preserving merger exists. So it edits only the shape it knows, a plain
// key under one `[section]`, and `configFacts` names any other spelling of a key this layer owns, which the layer refuses.
// PURE AND IMPORT-FREE: `engine/house-probe.mts` loads it by type stripping.

const HEADER = /^\s*\[{1,2}([^\]]+)\]{1,2}\s*(#.*)?$/;

interface Located {
  lines: string[];
  /** The section's header line, -1 if absent. */
  header: number;
  /** The line after the section's last. */
  end: number;
}

function locate(text: string, section: string): Located {
  const lines = text.split('\n');
  const header = lines.findIndex((line) => HEADER.exec(line.replace(/\r$/, ''))?.[1]?.trim() === section);
  if (header < 0) return { lines, header, end: lines.length };
  let end = header + 1;
  while (end < lines.length && !HEADER.test(lines[end].replace(/\r$/, ''))) end++;
  return { lines, header, end };
}

/** A line up to its comment, if it has one. A `#` inside a string is not one. */
function withoutComment(line: string): string {
  let quote = '';
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quote) {
      if (char === '\\' && quote === '"') i += 1;
      else if (char === quote) quote = '';
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '#') return line.slice(0, i);
  }
  return line;
}

/** The first and last line of an assignment, which an array may spread over several. Undefined: not assigned in this section (a comment is not an assignment). */
function assignment(lines: string[], header: number, end: number, key: string): [number, number] | undefined {
  const pattern = new RegExp(`^\\s*${key}\\s*=`);
  for (let i = header + 1; i < end; i++) {
    if (!pattern.test(lines[i])) continue;
    const opening = lines[i].slice(lines[i].indexOf('=') + 1).trimStart();
    if (!opening.startsWith('[')) return [i, i];
    let depth = 0;
    for (let j = i; j < end; j++) {
      for (const char of lines[j].replace(/"(?:[^"\\]|\\.)*"|'[^']*'|#.*$/g, '')) {
        if (char === '[') depth += 1;
        if (char === ']') depth -= 1;
      }
      if (depth <= 0) return [i, j];
    }
    return [i, i];
  }
  return undefined;
}

/** The raw right-hand side of `key` in `[section]`, without its comment, or undefined. */
export function tomlValue(text: string, section: string, key: string): string | undefined {
  const { lines, header, end } = locate(text, section);
  if (header < 0) return undefined;
  const found = assignment(lines, header, end, key);
  if (!found) return undefined;
  const raw = lines.slice(found[0], found[1] + 1).map((line) => withoutComment(line.replace(/\r$/, ''))).join('\n');
  return raw.slice(raw.indexOf('=') + 1).trim();
}

/** Is there such a section, whatever it holds? */
export const hasTomlSection = (text: string, section: string): boolean => locate(text, section).header >= 0;

/** What this layer reads or writes in the file, by its full name. */
const OWNED_KEYS = ['db.major_version', 'db.seed.sql_paths', 'experimental.stack'];
const OWNED_TABLES = ['db', 'db.seed', 'experimental'];

/** Each owned key or table spelled so that a line edit would miss it or break the file: dotted, quoted, inline, or in a section written twice. */
function uneditedShapes(text: string): string[] {
  const found = new Set<string>();
  const seen = new Set<string>();
  let section = '';
  for (const raw of text.split('\n')) {
    const line = withoutComment(raw.replace(/\r$/, ''));
    const header = HEADER.exec(line)?.[1]?.trim();
    if (header !== undefined) {
      section = header.replace(/["'\s]/g, '');
      if (OWNED_TABLES.includes(section) && seen.has(section)) found.add(`[${section}] twice`);
      seen.add(section);
      continue;
    }
    const assigned = /^\s*([\w."'-]+)\s*=\s*(.*)$/.exec(line);
    if (!assigned) continue;
    const key = assigned[1].replace(/["']/g, '');
    const full = section ? `${section}.${key}` : key;
    const plain = !assigned[1].includes('.') && !/["']/.test(assigned[1]);
    if (OWNED_KEYS.includes(full) && !plain) found.add(full);
    if (OWNED_TABLES.includes(full) && assigned[2].startsWith('{')) found.add(full);
  }
  return [...found];
}

/** What the layer's refusals ask of a config.toml. */
export const configFacts = (text: string): { major?: string; inbucket: boolean; unedited: string[] } => ({ major: tomlValue(text, 'db', 'major_version'), inbucket: hasTomlSection(text, 'inbucket'), unedited: uneditedShapes(text) });

/** `text` with `key = value` in `[section]`: replaced where it is, keeping a comment on its line; else first in the section; else in a new section at the end. */
export function setTomlValue(text: string, section: string, key: string, value: string): string {
  const eol = text.includes('\r\n') ? '\r' : '';
  const { lines, header, end } = locate(text, section);
  const line = `${key} = ${value}${eol}`;
  if (header < 0) {
    const body = text.endsWith('\n') || text === '' ? text : `${text}${eol}\n`;
    return `${body}${body === '' ? '' : `${eol}\n`}[${section}]${eol}\n${line}\n`;
  }
  const found = assignment(lines, header, end, key);
  if (!found) {
    lines.splice(header + 1, 0, line);
    return lines.join('\n');
  }
  const single = lines[found[0]].replace(/\r$/, '');
  const comment = found[0] === found[1] ? single.slice(withoutComment(single).trimEnd().length) : '';
  lines.splice(found[0], found[1] - found[0] + 1, `${key} = ${value}${comment}${eol}`);
  return lines.join('\n');
}
