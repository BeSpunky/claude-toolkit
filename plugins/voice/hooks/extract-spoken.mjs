#!/usr/bin/env node
// bespunky-voice — extract-spoken.mjs
//
// Reads a PreToolUse hook JSON on stdin and prints EAR-READY text on stdout for
// the speaker. Parsing lives in Node (not grep/sed) because the tool_input for
// AskUserQuestion is genuinely nested — { questions: [ { question, options:
// [ { label, description } ] } ] } — and mangling that with a regex is how a
// hook silently speaks garbage. Defensive throughout: any unexpected shape ⇒
// print nothing ⇒ nothing is said.
//
// How the question is SAID lives in phrasing.mjs, shared with the Stop hook.
import { fileURLToPath } from 'node:url';
import { capSpoken, phraseQuestion } from './phrasing.mjs';

export { phraseQuestion };

export function spokenFor(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const tool = payload.tool_name || '';
  const ti = payload.tool_input || {};
  const out = [];

  if (tool === 'AskUserQuestion') {
    const qs = (Array.isArray(ti.questions) ? ti.questions : []).filter((q) => q && q.question);
    qs.forEach((q, i) => {
      const s = phraseQuestion(q.question, q.options, { multiSelect: q.multiSelect === true });
      if (s) out.push(i === 0 ? s : `And ${s}`);
    });
  } else if (tool === 'ExitPlanMode') {
    out.push("I've finished the plan and need your go-ahead.");
    const plan = (ti.plan || '').toString().replace(/\s+/g, ' ').trim();
    // The plan can be long; say only an opening gist. speak.sh strips markup.
    if (plan) out.push('The gist: ' + (plan.length > 600 ? plan.slice(0, 600) + '…' : plan));
  }

  return capSpoken(out.join(' ').trim());
}

const IS_MAIN = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (IS_MAIN) {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => { raw += d; });
  process.stdin.on('end', () => {
    let j;
    try { j = JSON.parse(raw); } catch { process.exit(0); }
    const text = spokenFor(j);
    if (text) process.stdout.write(text);
  });
}
