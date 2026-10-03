#!/usr/bin/env node
// bespunky-voice — extract-turn-question.mjs
//
// Stop-hook helper. Reads the Stop hook JSON on stdin, opens the transcript, and
// — ONLY if the assistant's turn ended with a PLAIN-TEXT question — prints an
// ear-ready version of that trailing question. A turn that ended on a tool call
// (AskUserQuestion / ExitPlanMode, or any tool) prints nothing, so the PreToolUse
// hook stays the sole speaker for structured questions (no double-speak). Any
// unexpected shape ⇒ prints nothing.
//
// The question is read from the STRUCTURE of the prose, not from flattened text:
// "…here are the routes:\n- A — …\n- B — …\n\nWhich one?" is a choice whose
// options are the list, so it is said as one ("Which one: A or B?", phrased by
// phrasing.mjs like every other auto-spoken question) — never as the last bullet
// glued onto "Which one?".
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { capSpoken, phraseQuestion } from './phrasing.mjs';

// Inline markup → plain words (speak.sh strips again; this keeps list heads clean).
const plainInline = (s) => s
  .replace(/`([^`]*)`/g, '$1')
  .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/[*_#>|]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;
const MAX_HEADS = 6;

// The name of a list item, as you'd say it: its bold lead if it has one
// ("**Rebase** — rewrites…" → "Rebase"), else the text before a dash or colon,
// else its first sentence.
function headOf(item) {
  const bold = /^\s*(?:\*\*|__)(.+?)(?:\*\*|__)/.exec(item);
  const head = bold ? bold[1] : item.split(/\s+[—–-]\s+|:\s|(?<=[.!?])\s/)[0];
  return plainInline(head);
}

export function questionFromText(lastText) {
  const trimmed = String(lastText || '').replace(/\s+$/, '');
  if (!/\?["')\]]*$/.test(trimmed)) return ''; // the turn must actually END with a question

  const noCode = trimmed.replace(/```[\s\S]*?```/g, ' ');
  const lines = noCode.split('\n');

  // The question: the last paragraph's final sentence(s).
  let end = lines.length;
  let start = end - 1;
  while (start > 0 && lines[start - 1].trim() && !LIST_ITEM.test(lines[start - 1])) start--;
  const para = plainInline(lines.slice(start, end).join(' '));
  const sentences = para.split(/(?<=[.!?])\s+/).filter(Boolean);
  let q = sentences.length ? sentences[sentences.length - 1] : para;
  if (sentences.length >= 2 && q.length < 60) q = sentences[sentences.length - 2] + ' ' + q; // context if terse

  // A list directly above it (blank lines allowed) is its set of choices.
  let i = start - 1;
  while (i >= 0 && !lines[i].trim()) i--;
  const items = [];
  while (i >= 0 && LIST_ITEM.test(lines[i])) items.unshift(LIST_ITEM.exec(lines[i])[1]), i--;
  if (items.length >= 2 && items.length <= MAX_HEADS) return capSpoken(phraseQuestion(q, items.map(headOf).filter(Boolean)), 400);

  return capSpoken(q, 400);
}

function main(raw) {
  let j;
  try { j = JSON.parse(raw); } catch { return; }
  if (!j || typeof j !== 'object' || !j.transcript_path) return;

  let lines;
  try { lines = readFileSync(j.transcript_path, 'utf8').split('\n'); } catch { return; }

  // Walk the whole transcript; remember the last assistant TEXT and whether the
  // final assistant content block was a tool_use.
  let lastText = null;
  let lastBlockWasTool = false;
  for (const line of lines) {
    if (!line.trim()) continue;
    let m;
    try { m = JSON.parse(line); } catch { continue; }
    if (m.type !== 'assistant' || !m.message || !Array.isArray(m.message.content)) continue;
    for (const c of m.message.content) {
      if (c && c.type === 'text' && typeof c.text === 'string') { lastText = c.text; lastBlockWasTool = false; }
      else if (c && c.type === 'tool_use') { lastBlockWasTool = true; }
    }
  }
  if (lastBlockWasTool || !lastText) return;

  const q = questionFromText(lastText);
  if (q) process.stdout.write(q);
}

const IS_MAIN = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (IS_MAIN) {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => { raw += c; });
  process.stdin.on('end', () => main(raw));
}
