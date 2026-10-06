// Remove one object member from JSONC TEXT — the member, its comma, and the `//` lines that explain it — while
// touching nothing else in the file. Shared by the migrations that retire a devcontainer.json member.
import { type Node, SyntaxKind, createScanner } from 'jsonc-parser';

/**
 * Remove an object member, plus the `//` comment lines directly above it — on an owned devcontainer those are the
 * house's own explanation of the member, and left behind they would explain something that is gone. Cut as TEXT,
 * not through jsonc-parser's `modify`: removing a member that way re-serializes its neighbour (a one-line
 * `{ "version": "22" }` comes back spread over three), and this rung must touch nothing but what it removes.
 */
export function removeMemberWithLeadingComment(text: string, valueNode: Node): string {
  const property = valueNode.parent!;
  const siblings = property.parent!.children!;
  const index = siblings.indexOf(property);
  const end = property.offset + property.length;
  const lineStart = text.lastIndexOf('\n', property.offset - 1) + 1;
  const lineEndAt = (from: number) => {
    const at = text.indexOf('\n', from);
    return at === -1 ? text.length : at;
  };
  // ON ITS OWN LINE (the shape every house write produces): cut whole lines, with the `//` lines above it. A member
  // that SHARES its line — a hand-reformatted or minified file — is cut by offsets instead: a line cut there took its
  // neighbours with it, and a one-line file came back empty.
  const alone =
    /^\s*$/.test(text.slice(lineStart, property.offset)) && /^\s*,?\s*(\/\/.*)?$/.test(text.slice(end, lineEndAt(end)));
  if (!alone) return cutInline(text, property, siblings, index);

  let cutStart = lineStart;
  for (;;) {
    if (cutStart <= 1) break;
    const previousStart = text.lastIndexOf('\n', cutStart - 2) + 1;
    if (!/^\s*\/\//.test(text.slice(previousStart, cutStart - 1))) break;
    cutStart = previousStart;
  }
  if (index < siblings.length - 1) {
    // Not the last member: take its trailing comma and the rest of its line.
    const lineEnd = text.indexOf('\n', end);
    return text.slice(0, cutStart) + text.slice(lineEnd === -1 ? text.length : lineEnd + 1);
  }
  // The last member: its line goes, and so does the comma that now trails the previous member (if any).
  const lineEnd = text.indexOf('\n', end);
  let head = text.slice(0, cutStart);
  if (index > 0) {
    const comma = separatorBefore(text, siblings[index - 1], cutStart);
    if (comma !== -1) head = head.slice(0, comma) + head.slice(comma + 1);
  }
  return head + text.slice(lineEnd === -1 ? text.length : lineEnd + 1);
}

/**
 * Remove a member that shares its line with others, by offsets: the member and the separator that tied it to a
 * neighbour — its own trailing comma when one follows, else the comma before it. Comments around it stay.
 */
function cutInline(text: string, property: Node, siblings: Node[], index: number): string {
  const end = property.offset + property.length;
  if (index < siblings.length - 1) {
    const next = siblings[index + 1];
    const comma = separatorBefore(text, property, next.offset);
    const resume = comma === -1 ? end : skipSpaces(text, comma + 1);
    // Last on its line: the space that separated it from the member before goes too, so no trailing blank is left.
    const head = text[resume] === '\n' || resume === text.length ? text.slice(0, property.offset).replace(/[ \t]+$/, '') : text.slice(0, property.offset);
    return head + text.slice(resume);
  }
  if (index > 0) {
    const previous = siblings[index - 1];
    const comma = separatorBefore(text, previous, property.offset);
    if (comma !== -1) return text.slice(0, comma) + text.slice(comma + 1, property.offset).replace(/\s+$/, '') + text.slice(end);
  }
  return text.slice(0, property.offset) + text.slice(end);
}

/** The offset of the comma token after `node` and before `limit` (comments skipped, so a comma inside one never counts), or -1. */
function separatorBefore(text: string, node: Node, limit: number): number {
  const scanner = createScanner(text.slice(0, limit), false);
  scanner.setPosition(node.offset + node.length);
  for (let token = scanner.scan(); token !== SyntaxKind.EOF; token = scanner.scan()) {
    if (token === SyntaxKind.CommaToken) return scanner.getTokenOffset();
  }
  return -1;
}

function skipSpaces(text: string, from: number): number {
  let at = from;
  while (at < text.length && (text[at] === ' ' || text[at] === '\t')) at += 1;
  return at;
}
