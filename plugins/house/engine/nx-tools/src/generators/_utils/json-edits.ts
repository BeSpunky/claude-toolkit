// CHANGE WHAT CHANGED, AND NOTHING ELSE — the in-place writer for JSON(C) files the project also edits.
//
// devkit's `updateJson` / `updateProjectConfiguration` re-serialize the whole file: a prettier-formatted one-line
// array is spread over lines, comments vanish, and `updateProjectConfiguration` even rebuilds the object (it moved
// `options` below `dependsOn` in every firebase target a 0.50.0 rung touched). An upgrade's diff should be its
// MEANING — so the old and new values are compared structurally and only the members that differ are edited, as
// text, in place:
//   - a member that is new is placed in its container's own style (./jsonc-insert.ts), at its place in the new
//     value — after the key it follows there (a dependency placed in a sorted block lands in sorted position);
//   - a member that is gone is cut with its line (./jsonc-remove-member.ts);
//   - an object present on both sides is recursed into; an array that only GAINED members at its end gains them;
//     any other changed value is replaced where it stands (on one line when it was on one line).
// Two values equal but for key order are equal: a reorder alone never writes.
import { type Tree } from '@nx/devkit';
import { applyEdits, findNodeAtLocation, getNodeValue, modify, parseTree } from 'jsonc-parser';
import { inline, insertJsoncMember } from './jsonc-insert';
import { removeMemberWithLeadingComment } from './jsonc-remove-member';

type Json = unknown;
type Path = (string | number)[];

const FORMAT = { tabSize: 2, insertSpaces: true, eol: '\n' };

/** `text` with the members where `before` and `after` differ (below `prefix`) edited in place. */
export function applyJsonChanges(text: string, before: Json, after: Json, prefix: Path = []): string {
  if (sameJson(before, after)) return text;
  if (isObject(before) && isObject(after)) {
    let next = text;
    for (const key of Object.keys(before)) if (!(key in after)) next = remove(next, [...prefix, key]);
    let previous: string | null = null;
    for (const [key, value] of Object.entries(after)) {
      next = key in before ? applyJsonChanges(next, before[key], value, [...prefix, key]) : set(next, [...prefix, key], value, previous);
      previous = key;
    }
    return next;
  }
  if (Array.isArray(before) && Array.isArray(after) && after.length > before.length && before.every((item, i) => sameJson(item, after[i]))) {
    let next = text;
    for (let i = before.length; i < after.length; i += 1) next = set(next, [...prefix, i], after[i]);
    return next;
  }
  return replace(text, prefix, after);
}

/**
 * Read JSON(C) at `path`, let `update` change a copy, write back only what changed. Returns whether it wrote. The
 * in-place counterpart of devkit's `updateJson` (same callback, same `any` default for an untyped file).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function updateJsonInPlace<T = any>(tree: Tree, path: string, update: (json: T) => T | void, prefix: Path = []): boolean {
  const text = tree.read(path, 'utf8') ?? '';
  const root = parseTree(text);
  if (!root) throw new Error(`${path} is not valid JSON — not edited.`);
  const all = getNodeValue(root) as Json;
  const before = prefix.length ? valueAt(all, prefix) : all;
  const draft = JSON.parse(JSON.stringify(before ?? {})) as T;
  const after = (update(draft) ?? draft) as Json;
  const next = before === undefined ? set(text, prefix, after) : applyJsonChanges(text, before, after, prefix);
  if (next === text) return false;
  tree.write(path, next);
  return true;
}

/** Structural equality, insensitive to object key order. */
export function sameJson(a: Json, b: Json): boolean {
  return canonical(a) === canonical(b);
}

function canonical(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

function isObject(value: Json): value is Record<string, Json> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function set(text: string, path: Path, value: Json, after?: string | null): string {
  return insertJsoncMember(text, path, value, after) ?? applyEdits(text, modify(text, path, value, { formattingOptions: FORMAT }));
}

/** Replace the value at `path` where it stands — one line when the value it replaces was one line. */
function replace(text: string, path: Path, value: Json): string {
  const node = findNodeAtLocation(parseTree(text)!, path);
  if (node && !text.slice(node.offset, node.offset + node.length).includes('\n') && !inline(value).includes('\n')) {
    return `${text.slice(0, node.offset)}${inline(value)}${text.slice(node.offset + node.length)}`;
  }
  return applyEdits(text, modify(text, path, value, { formattingOptions: FORMAT }));
}

function remove(text: string, path: Path): string {
  const node = findNodeAtLocation(parseTree(text)!, path);
  return node ? removeMemberWithLeadingComment(text, node) : text;
}

function valueAt(json: Json, path: Path): Json {
  return path.reduce<Json>((at, key) => (at as Record<string | number, Json> | undefined)?.[key], json);
}
