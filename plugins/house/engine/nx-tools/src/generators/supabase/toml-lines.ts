// Line-level edits of `supabase/config.toml`, which is the project's: its comments, order and every key this file does not name stay
// byte for byte. Nothing here parses TOML, deliberately: no comment-preserving merger exists, and a few owned keys do not need one.
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
  const raw = lines.slice(found[0], found[1] + 1).join('\n').replace(/\r/g, '');
  return raw.slice(raw.indexOf('=') + 1).replace(/\s+#[^"'\]]*$/, '').trim();
}

/** Is there such a section, whatever it holds? */
export const hasTomlSection = (text: string, section: string): boolean => locate(text, section).header >= 0;

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
  const comment = found[0] === found[1] ? /\s+#[^"'\]]*$/.exec(lines[found[0]].replace(/\r$/, ''))?.[0] ?? '' : '';
  lines.splice(found[0], found[1] - found[0] + 1, `${key} = ${value}${comment}${eol}`);
  return lines.join('\n');
}
