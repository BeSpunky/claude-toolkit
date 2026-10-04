// Remove one object member from JSONC TEXT — the member, its comma, and the `//` lines that explain it — while
// touching nothing else in the file. Shared by the migrations that retire a devcontainer.json member.
import type { Node } from 'jsonc-parser';

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
  const lineStart = text.lastIndexOf('\n', property.offset - 1) + 1;
  let cutStart = lineStart;
  for (;;) {
    if (cutStart <= 1) break;
    const previousStart = text.lastIndexOf('\n', cutStart - 2) + 1;
    if (!/^\s*\/\//.test(text.slice(previousStart, cutStart - 1))) break;
    cutStart = previousStart;
  }
  const end = property.offset + property.length;
  if (index < siblings.length - 1) {
    // Not the last member: take its trailing comma and the rest of its line.
    const lineEnd = text.indexOf('\n', end);
    return text.slice(0, cutStart) + text.slice(lineEnd === -1 ? text.length : lineEnd + 1);
  }
  // The last member: its line goes, and so does the comma that now trails the previous member (if any).
  const lineEnd = text.indexOf('\n', end);
  let head = text.slice(0, cutStart);
  if (index > 0) {
    const previous = siblings[index - 1];
    const previousEnd = previous.offset + previous.length;
    const comma = head.indexOf(',', previousEnd);
    if (comma !== -1) head = head.slice(0, comma) + head.slice(comma + 1);
  }
  return head + text.slice(lineEnd === -1 ? text.length : lineEnd + 1);
}
