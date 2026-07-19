#!/usr/bin/env node
// bespunky-voice — ask-server.mjs
//
// A tiny, dependency-free MCP stdio server exposing ONE tool: `ask_by_voice`.
// It is the hands-free tier — the reason an MCP tool exists at all: a hook can
// only observe and speak, but an MCP tool is CALLED by Claude and Claude BLOCKS
// on its return value, so the tool can speak the question, listen for the spoken
// answer, and hand that answer straight back into the conversation. No command to
// run, no keyboard — Claude asks aloud and waits.
//
// Reuses the plugin's own boundaries: scripts/speak.sh (TTS) and scripts/listen.sh
// (STT), located relative to THIS file so it never depends on env or the publish
// step. Transport: newline-delimited JSON-RPC 2.0 over stdio.

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SPEAK = join(HERE, '..', 'scripts', 'speak.sh');
const LISTEN = join(HERE, '..', 'scripts', 'listen.sh');
const ORD = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

// ---- JSON-RPC framing: one JSON message per line -----------------------------
// Only attach to stdin when run as the server (not when imported by a test).
const IS_MAIN = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (IS_MAIN) {
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) handle(line);
    }
  });
}
const send = (m) => process.stdout.write(JSON.stringify(m) + '\n');
const ok = (id, result) => send({ jsonrpc: '2.0', id, result });
const err = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

const TOOL = {
  name: 'ask_by_voice',
  description:
    'Ask the user a question OUT LOUD and get their SPOKEN answer back. Speaks an ' +
    'ear-friendly summary and the options through the speaker, records the user\'s ' +
    'voice reply, transcribes it, and returns the transcript plus the best-matching ' +
    'option. Use this INSTEAD of AskUserQuestion when the user is conversing hands-free ' +
    'by voice (away from the keyboard). Blocks until the user answers. If the returned ' +
    '"matched" is null, read the transcript yourself or call again to re-ask.',
  inputSchema: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'The question, phrased for the ear — plain spoken words, no markup.' },
      options: {
        type: 'array',
        description: 'The choices (omit for an open-ended question). Each is spoken as "option one/two/…".',
        items: {
          type: 'object',
          properties: { label: { type: 'string' }, description: { type: 'string' } },
          required: ['label'],
        },
      },
    },
    required: ['question'],
  },
};

function handle(line) {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  switch (method) {
    case 'initialize':
      return ok(id, {
        protocolVersion: params?.protocolVersion || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'bespunky-voice', version: '0.1.0' },
      });
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return; // notifications take no response
    case 'ping':
      return ok(id, {});
    case 'tools/list':
      return ok(id, { tools: [TOOL] });
    case 'tools/call': {
      if (params?.name !== 'ask_by_voice') return err(id, -32602, `unknown tool: ${params?.name}`);
      try {
        const text = askByVoice(params.arguments || {});
        return ok(id, { content: [{ type: 'text', text }], isError: false });
      } catch (e) {
        return ok(id, { content: [{ type: 'text', text: `voice ask failed: ${e?.message || e}` }], isError: true });
      }
    }
    default:
      if (id !== undefined) return err(id, -32601, `method not found: ${method}`);
  }
}

function askByVoice({ question, options }) {
  if (!question || typeof question !== 'string') throw new Error('question is required');
  const opts = Array.isArray(options) ? options.filter((o) => o && o.label) : [];

  let spoken = `Claude asks: ${question}.`;
  if (opts.length) {
    spoken += ' Your options are: ' + opts.map((o, i) => `Option ${ORD[i] || i + 1}: ${o.label}.`).join(' ');
    spoken += ' Say your choice.';
  }

  // Speak (blocking), then listen (blocking) — the whole point is to wait.
  spawnSync('bash', [SPEAK, spoken], { stdio: 'ignore' });
  const rec = spawnSync('bash', [LISTEN], { encoding: 'utf8', maxBuffer: 1 << 20 });
  const transcript = ((rec.stdout || '').trim());

  if (!transcript) {
    return JSON.stringify({ transcript: '', matched: null, note: 'No speech recognized. Call ask_by_voice again to re-ask, or fall back to a typed question.' });
  }
  const matched = matchOption(transcript, opts);
  return JSON.stringify({
    transcript,
    matched, // { index, label, by } or null
    options: opts.map((o, i) => ({ index: i, label: o.label })),
    note: matched ? 'Proceed with matched.label.' : 'No confident option match — interpret the transcript yourself, or re-ask.',
  });
}

// Map a spoken transcript to an option. Order: exact label phrase → ordinal/number
// → yes/no for two-option questions. Returns null when nothing is confident.
const ORDW = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];

export function matchOption(transcript, opts) {
  if (!opts.length) return null;
  const t = ' ' + transcript.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ') + ' ';

  // "unsure" answers must NOT be forced into a choice (e.g. "no idea" is not "no").
  if (/\b(no idea|not sure|dont know|do not know|no clue|unsure|cant decide|cannot decide|neither)\b/.test(t)) return null;

  // 1. an option label appears in the transcript (prefer the longest match)
  let best = null;
  opts.forEach((o, i) => {
    const label = o.label.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    if (label && t.includes(' ' + label + ' ')) {
      if (!best || label.length > best.len) best = { index: i, label: o.label, by: 'label', len: label.length };
    }
  });
  if (best) { delete best.len; return best; }

  // 2. "option/number/choice N", an ordinal word (first/second/…), or a lone digit.
  // Deliberately NOT bare cardinals ("one"/"two") — "one" hides in "second one",
  // "someone", "the one".
  for (let i = 0; i < opts.length; i++) {
    const n = i + 1;
    if (new RegExp(`\\b(option|number|choice)\\s+(${ORD[i]}|${ORDW[i]}|${n})\\b`).test(t)) return { index: i, label: opts[i].label, by: 'ordinal' };
    if (new RegExp(`\\b${ORDW[i]}\\b`).test(t)) return { index: i, label: opts[i].label, by: 'ordinal' };
    if (new RegExp(`\\b${n}\\b`).test(t)) return { index: i, label: opts[i].label, by: 'number' };
  }

  // 3. yes/no for a two-choice question
  if (opts.length === 2) {
    if (/\b(yes|yeah|yep|yup|sure|ok|okay|go ahead|do it|please do|affirmative)\b/.test(t)) return { index: 0, label: opts[0].label, by: 'affirm' };
    if (/\b(no|nope|nah|dont|do not|cancel|stop|skip|negative)\b/.test(t)) return { index: 1, label: opts[1].label, by: 'negate' };
  }
  return null;
}
