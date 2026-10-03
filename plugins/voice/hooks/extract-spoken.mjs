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
// PHRASING: the question is said the way a person would ask it — the question,
// then its choices as one natural spoken list ("…: commit now, keep going, or
// stash it?"). Never a form read aloud: no "Claude asks", no "option one", no
// "say your choice". If Claude's question already names the choices, they are
// not said a second time.
import { fileURLToPath } from 'node:url';

const RECOMMENDED = /\s*\((?:recommended|suggested)\)\s*/i;
const YES_NO = /^(yes|no|yeah|nope|sure|ok|okay|not now|cancel)\b/i;
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

// "a", "a or b", "a, b, or c"
const spokenList = (items) =>
  items.length <= 2 ? items.join(' or ') : items.slice(0, -1).join(', ') + ', or ' + items[items.length - 1];

export function phraseQuestion(question, options) {
  const q = String(question || '').trim();
  const labels = (Array.isArray(options) ? options : [])
    .map((o) => (o && typeof o === 'object' ? o.label : o))
    .filter((l) => typeof l === 'string' && l.trim())
    .map((l) => l.trim());
  if (!labels.length) return q;

  const plain = labels.map((l) => l.replace(RECOMMENDED, ' ').trim());
  const pick = labels.findIndex((l) => RECOMMENDED.test(l));
  const qn = ' ' + norm(q) + ' ';
  const alreadyNamed = plain.every((l) => qn.includes(' ' + norm(l) + ' '));
  // A yes/no question is asked as one — "Should I commit?", not "…: yes or no?".
  const yesNo = plain.length <= 2 && plain.every((l) => YES_NO.test(l));

  let said = q;
  if (!alreadyNamed && !(yesNo && q)) {
    const list = spokenList(plain);
    said = q ? `${q.replace(/[?.!:]*$/, '')}: ${list}?` : `${list}?`;
  }
  if (pick >= 0) said += ` I'd go with ${plain[pick]}.`;
  return said;
}

export function spokenFor(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const tool = payload.tool_name || '';
  const ti = payload.tool_input || {};
  const out = [];

  if (tool === 'AskUserQuestion') {
    const qs = (Array.isArray(ti.questions) ? ti.questions : []).filter((q) => q && q.question);
    qs.forEach((q, i) => {
      const s = phraseQuestion(q.question, q.options);
      if (s) out.push(i === 0 ? s : `And ${s}`);
    });
  } else if (tool === 'ExitPlanMode') {
    out.push("I've finished the plan and need your go-ahead.");
    const plan = (ti.plan || '').toString().replace(/\s+/g, ' ').trim();
    // The plan can be long; say only an opening gist. speak.sh strips markup.
    if (plan) out.push('The gist: ' + (plan.length > 600 ? plan.slice(0, 600) + '…' : plan));
  }

  let text = out.join(' ').trim();
  // Cap the spoken length: a wall of choices is unpleasant to hear AND a very
  // long argv could hit ARG_MAX. Trim on a word boundary.
  const CAP = 1000;
  if (text.length > CAP) {
    const cut = text.slice(0, CAP);
    const onWord = cut.replace(/\s+\S*$/, '');
    // Prefer a word boundary, but don't let an unbroken token collapse the text.
    text = (onWord.length > CAP * 0.6 ? onWord : cut) + '…';
  }
  return text;
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
