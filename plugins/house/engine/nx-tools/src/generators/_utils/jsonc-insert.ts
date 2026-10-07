// Add one member to a JSONC container IN THE CONTAINER'S OWN STYLE — the counterpart of ./jsonc-remove-member.ts.
//
// jsonc-parser's `modify` with formattingOptions treats an insertion by re-formatting every line it touches with
// `keepLines: false`: a one-line `"forwardPorts": [3000, 4000, 9099]` gains one member and comes back as nine
// lines. Without formattingOptions it splices raw, compact JSON (`,4500`). Neither is what a person would write. So
// the member is placed as TEXT, matching its siblings:
//   - a container written on ONE line gains `, <member>` inline;
//   - a multi-line one gains the member on its own line, at the last member's indentation — after that member's
//     trailing `//` comment, never between a member and the comment that explains it;
//   - the value is one line when the last sibling's value is one line, else pretty-printed at that indentation.
// Nothing else in the file moves. An absent or EMPTY container has no style to match: `insertJsoncMember` returns
// null and the caller uses `modify` (there is nothing there to churn).
//
// WHERE in an object: last by default; `after` names the sibling key it follows (null = first), so a member whose
// place MEANS something — a dependency in a sorted block — lands there, not at the end.
import { type Node, findNodeAtLocation, parseTree } from 'jsonc-parser';

/**
 * `text` with `value` added at `path` — a new key of an existing object, or an append to an existing array (the
 * index equal to its length) — or null when that is not what `path` names (the caller falls back to `modify`).
 * For an object member, `after` places it after that sibling key (null = before every member); omitted, or naming
 * no member, it goes last.
 */
export function insertJsoncMember(text: string, path: (string | number)[], value: unknown, after?: string | null): string | null {
  if (!path.length) return null;
  const root = parseTree(text);
  if (!root) return null;
  const parentPath = path.slice(0, -1);
  const key = path[path.length - 1];
  const container = parentPath.length ? findNodeAtLocation(root, parentPath) : root;
  if (!container?.children?.length) return null;
  if (container.type === 'object') {
    if (typeof key !== 'string' || container.children.some((property) => property.children?.[0]?.value === key)) return null;
  } else if (container.type !== 'array' || key !== container.children.length) {
    return null;
  }

  if (container.type === 'object' && after !== undefined) {
    const at = after === null ? 0 : container.children.findIndex((property) => property.children?.[0]?.value === after) + 1;
    if ((at > 0 || after === null) && at < container.children.length) return insertBefore(text, container.children[at], key, value);
  }

  const last = container.children[container.children.length - 1];
  const lastValue: Node = container.type === 'object' ? last.children?.[1] ?? last : last;
  const lastEnd = last.offset + last.length;
  const member = (rendered: string) => (container.type === 'object' ? `${JSON.stringify(key)}: ${rendered}` : rendered);
  const oneLine = (from: number, length: number) => !text.slice(from, from + length).includes('\n');

  if (oneLine(container.offset, container.length)) {
    return `${text.slice(0, lastEnd)}, ${member(inline(value))}${text.slice(lastEnd)}`;
  }

  const lineStart = text.lastIndexOf('\n', last.offset - 1) + 1;
  const indent = /^[ \t]*/.exec(text.slice(lineStart))![0];
  const unit = indentUnit(text, container, indent);
  const rendered = oneLine(lastValue.offset, lastValue.length)
    ? inline(value)
    : JSON.stringify(value, null, unit).split('\n').join(`\n${indent}`);
  const lineEndAt = text.indexOf('\n', lastEnd);
  const lineEnd = lineEndAt === -1 ? text.length : lineEndAt;
  const tail = text.slice(lastEnd, lineEnd);
  if (/^\s*,/.test(tail)) {
    // A trailing comma is already there (JSONC allows it): the new member goes on the next line.
    return `${text.slice(0, lineEnd)}\n${indent}${member(rendered)}${text.slice(lineEnd)}`;
  }
  if (/^\s*(?:\/\/.*)?$/.test(tail)) {
    // The member ends its line (perhaps with its own comment): a comma after it, the new member on a line of its own.
    return `${text.slice(0, lastEnd)},${tail}\n${indent}${member(rendered)}${text.slice(lineEnd)}`;
  }
  // Something follows on the same line (the closing bracket): the new member on its own line, before it.
  return `${text.slice(0, lastEnd)},\n${indent}${member(rendered)}${text.slice(lastEnd)}`;
}

/**
 * Insert a member BEFORE object member `next`: on `next`'s line in a one-line container, else on a line of its own
 * above `next` — above the `//` lines that explain `next` (they stay with it). Null when `next` shares its line
 * with the member before it in a multi-line container (a hand-packed layout there is no style to read from).
 */
function insertBefore(text: string, next: Node, key: string, value: unknown): string | null {
  const container = next.parent!;
  const oneLine = (node: Node) => !text.slice(node.offset, node.offset + node.length).includes('\n');
  if (oneLine(container)) return `${text.slice(0, next.offset)}${JSON.stringify(key)}: ${inline(value)}, ${text.slice(next.offset)}`;
  const lineStart = text.lastIndexOf('\n', next.offset - 1) + 1;
  const lead = text.slice(lineStart, next.offset);
  if (!/^[ \t]*$/.test(lead)) return null;
  let at = lineStart;
  for (;;) {
    if (at <= 1) break;
    const previousStart = text.lastIndexOf('\n', at - 2) + 1;
    if (!/^\s*\/\//.test(text.slice(previousStart, at - 1))) break;
    at = previousStart;
  }
  const nextValue: Node = next.children?.[1] ?? next;
  const rendered = oneLine(nextValue) ? inline(value) : JSON.stringify(value, null, indentUnit(text, container, lead)).split('\n').join(`\n${lead}`);
  return `${text.slice(0, at)}${lead}${JSON.stringify(key)}: ${rendered},\n${text.slice(at)}`;
}

/** One-line JSON the way a person writes it: `{ "label": "Dev" }`, `[1, 2]`. */
export function inline(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(inline).join(', ')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    return entries.length ? `{ ${entries.map(([k, v]) => `${JSON.stringify(k)}: ${inline(v)}`).join(', ')} }` : '{}';
  }
  return JSON.stringify(value);
}

/** The file's indentation step: the member's indentation beyond its container's line, else two spaces. */
function indentUnit(text: string, container: Node, memberIndent: string): string {
  const containerLine = text.slice(text.lastIndexOf('\n', container.offset - 1) + 1);
  const base = /^[ \t]*/.exec(containerLine)![0];
  return memberIndent.length > base.length ? memberIndent.slice(base.length) : '  ';
}
