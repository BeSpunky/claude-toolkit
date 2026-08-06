#!/usr/bin/env node
// bespunky-voice — extract-turn-question.mjs
//
// Stop-hook helper. Reads the Stop hook JSON on stdin, opens the transcript, and
// — ONLY if the assistant's turn ended with a PLAIN-TEXT question — prints an
// ear-ready version of that trailing question. A turn that ended on a tool call
// (AskUserQuestion / ExitPlanMode, or any tool) prints nothing, so the PreToolUse
// hook stays the sole speaker for structured questions (no double-speak). Any
// unexpected shape ⇒ prints nothing.
import { readFileSync } from 'node:fs';

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => {
  let j;
  try { j = JSON.parse(raw); } catch { process.exit(0); }
  if (!j || typeof j !== 'object' || !j.transcript_path) process.exit(0);

  let lines;
  try { lines = readFileSync(j.transcript_path, 'utf8').split('\n'); } catch { process.exit(0); }

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

  if (lastBlockWasTool || !lastText) process.exit(0);

  // The turn must actually END with a question.
  const trimmed = lastText.replace(/\s+$/, '');
  if (!/\?["')\]]*$/.test(trimmed)) process.exit(0);

  // Strip markup and isolate the trailing question sentence(s).
  const text = trimmed
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_#>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const parts = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  let q = parts.length ? parts[parts.length - 1] : text;
  if (parts.length >= 2 && q.length < 60) q = parts[parts.length - 2] + ' ' + q; // add context if terse
  const CAP = 400;
  if (q.length > CAP) q = '…' + q.slice(q.length - CAP);

  q = q.trim();
  if (q) process.stdout.write('Claude asks: ' + q);
});
