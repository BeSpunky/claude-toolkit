#!/usr/bin/env node
// bespunky-voice — extract-spoken.mjs
//
// Reads a PreToolUse hook JSON on stdin and prints EAR-READY text on stdout for
// speak.sh. Parsing lives in Node (not grep/sed) because the tool_input for
// AskUserQuestion is genuinely nested — { questions: [ { question, options:
// [ { label, description } ] } ] } — and mangling that with a regex is how a
// hook silently speaks garbage. Defensive throughout: any unexpected shape ⇒
// print nothing ⇒ speak.sh says nothing.

const ORD = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { raw += d; });
process.stdin.on('end', () => {
  let j;
  try { j = JSON.parse(raw); } catch { process.exit(0); }
  // JSON.parse('null')/'42'/'"x"' are valid but not objects — guard so a stray
  // payload prints nothing instead of throwing a TypeError on j.tool_name.
  if (!j || typeof j !== 'object') process.exit(0);

  const tool = j.tool_name || '';
  const ti = j.tool_input || {};
  const out = [];

  if (tool === 'AskUserQuestion') {
    const qs = Array.isArray(ti.questions) ? ti.questions : [];
    for (const q of qs) {
      if (q && q.question) out.push(`Claude asks: ${q.question}.`);
      const opts = Array.isArray(q && q.options) ? q.options : [];
      if (opts.length) {
        out.push('Your options are:');
        opts.forEach((o, i) => {
          const label = o && typeof o === 'object' ? (o.label || '') : String(o || '');
          if (label) out.push(`Option ${ORD[i] || i + 1}: ${label}.`);
        });
      }
    }
  } else if (tool === 'ExitPlanMode') {
    out.push('Claude has finished a plan and is waiting for your approval.');
    const plan = (ti.plan || '').toString().replace(/\s+/g, ' ').trim();
    if (plan) {
      out.push('Here is the gist:');
      // The plan can be long; speak only an opening gist. speak.sh strips markup.
      out.push(plan.length > 600 ? plan.slice(0, 600) + '…' : plan);
    }
  }

  let text = out.join(' ').trim();
  // Cap the spoken length: a wall of options is unpleasant to hear AND a very
  // long argv to speak.sh could hit ARG_MAX. Trim on a word boundary.
  const CAP = 1000;
  if (text.length > CAP) {
    const cut = text.slice(0, CAP);
    const onWord = cut.replace(/\s+\S*$/, '');
    // Prefer a word boundary, but don't let an unbroken token collapse the text.
    text = (onWord.length > CAP * 0.6 ? onWord : cut) + '…';
  }
  if (text) process.stdout.write(text);
});
