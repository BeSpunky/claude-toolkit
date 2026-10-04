// A JSONC file's syntax tree, or `undefined` when it does not parse cleanly.
//
// `jsonc-parser`'s `parseTree` is LENIENT: for broken input it returns a partial tree rather than nothing, so the
// `if (!parseTree(...))` guard every rung wrote to "leave an unparseable file alone" never fired — and an edit
// computed on a partial tree lands in the wrong place. Every reader that must refuse a broken file uses this.
import { type Node, type ParseError, parseTree } from 'jsonc-parser';

const PARSE_OPTIONS = { allowTrailingComma: true, disallowComments: false };

export function parseJsoncStrict(text: string): Node | undefined {
  const errors: ParseError[] = [];
  const root = parseTree(text, errors, PARSE_OPTIONS);
  return errors.length ? undefined : root;
}
