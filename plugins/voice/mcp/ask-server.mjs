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
// Claude BLOCKS; this server must NOT. Everything it runs is asynchronous so that,
// while a question is being spoken or an answer heard, the server can still:
//   - relay what it hears AS IT HEARS IT (MCP progress notifications, which
//     Claude Code shows under the running tool call),
//   - honour a cancel (`notifications/cancelled`) by silencing the speaker and
//     killing the recording at once.
//
// Reuses the plugin's own boundaries, located relative to THIS file so it never
// depends on env or the publish step: scripts/speaker.sh (the utterance — say /
// stop) and scripts/listen.sh (STT, in its --stream mode). Understanding the reply
// lives in answer.mjs. Transport: newline-delimited JSON-RPC 2.0 over stdio.

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyIntent, matchOption } from './answer.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SPEAKER = join(HERE, '..', 'scripts', 'speaker.sh');
const LISTEN = join(HERE, '..', 'scripts', 'listen.sh');
const VOICE = join(HERE, '..', 'scripts', 'voice.sh');
// The one exit code speaker.sh and listen.sh use for "cut short by a stop" — the
// user pressed Stop in the band, hit Esc, or typed; not a failure to report.
const STOPPED = 143;
// Reported to the client as serverInfo.version — the plugin's own release, read
// rather than restated so the two can never drift.
const VERSION = (() => { try { return JSON.parse(readFileSync(join(HERE, '..', '.claude-plugin', 'plugin.json'), 'utf8')).version; } catch { return '0.0.0'; } })();
const MAX_REPEATS = 2; // "say that again" is honoured this many times per question

const send = (m) => process.stdout.write(JSON.stringify(m) + '\n');
const ok = (id, result) => send({ jsonrpc: '2.0', id, result });
const err = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

const TOOL = {
  name: 'ask_by_voice',
  description:
    'Ask the user a question OUT LOUD and get their SPOKEN answer back. Use this INSTEAD of ' +
    'AskUserQuestion when the user is conversing hands-free by voice (away from the keyboard). ' +
    'The `question` is spoken EXACTLY as written, so write it the way a person would ask it ' +
    'aloud, naming the choices in the sentence itself ("Should I commit now, or keep going ' +
    'first?") — no markup, no "option one", no "say your choice". `options` are NEVER read ' +
    'aloud; they only let the tool recognise which choice the reply means. While the user ' +
    'speaks, what is heard is shown live. Blocks until they answer. The user can say "repeat ' +
    'that" (handled inside the tool) or "stop"/"never mind" (returns cancelled: true — drop ' +
    'the question). If "matched" is null, interpret the transcript yourself, or call again ' +
    'with the question rephrased.',
  inputSchema: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: 'The exact words to say — a natural spoken question that names its choices. Plain words, no markup.',
      },
      options: {
        type: 'array',
        description: 'The choices, for recognising the reply (omit for an open question). Not spoken.',
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

// ---- an ask in flight: its child processes, its progress, its cancellation --
// One microphone, one speaker: a new ask supersedes any still running.
const inflight = new Map(); // JSON-RPC request id → Ask

// A cancel silences the voice through `voice.sh stop`. That stop must LAND
// before the next question is spoken — run concurrently, it can read the pidfile
// after the new question wrote it and silence a question nobody then hears.
// Every `say` waits for the stop in flight, if any.
let silencing = Promise.resolve();
function silenceSpeaker() {
  silencing = new Promise((resolve) => {
    const c = spawn('bash', [VOICE, 'stop'], { stdio: 'ignore' });
    c.on('error', resolve);
    c.on('close', resolve);
  });
}

class Ask {
  constructor(id, progressToken) {
    this.id = id;
    this.progressToken = progressToken;
    this.children = new Set();
    this.cancelled = null; // null | 'client' | 'superseded'
    this.tick = 0;
  }

  progress(message) {
    if (this.progressToken === undefined || this.cancelled) return;
    send({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: this.progressToken, progress: ++this.tick, message } });
  }

  // Run a script in its OWN process group (so cancel takes the whole tree down),
  // handing each stdout line to onLine. Resolves with { code, stderr }.
  run(args, onLine = () => {}) {
    return new Promise((resolve) => {
      const child = spawn('bash', args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
      this.children.add(child);
      let out = '';
      let stderr = '';
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (d) => {
        out += d;
        let nl;
        while ((nl = out.indexOf('\n')) >= 0) {
          const line = out.slice(0, nl);
          out = out.slice(nl + 1);
          if (line.trim()) onLine(line);
        }
      });
      child.stderr.on('data', (d) => { stderr += d; });
      let settled = false;
      const done = (code) => { if (settled) return; settled = true; this.children.delete(child); if (out.trim()) onLine(out); out = ''; resolve({ code, stderr: stderr.trim() }); };
      child.on('error', (e) => { stderr += String(e?.message || e); done(127); });
      child.on('close', (code) => done(code ?? 1));
    });
  }

  cancel(why) {
    if (this.cancelled) return;
    this.cancelled = why;
    for (const c of this.children) { try { process.kill(-c.pid, 'SIGTERM'); } catch { /* already gone */ } }
    // The utterance belongs to the speaker, not to us — ask it to stop.
    silenceSpeaker();
  }
}

// Stopped from outside this call (the band's Stop, Esc, a typed prompt): the user
// dropped the question as surely as saying "never mind".
const stoppedResult = { cancelled: true, note: 'The user stopped the voice. Drop this question; do not re-ask unless they bring it up.' };

const cancelledResult = (why) => ({
  cancelled: true,
  note: why === 'superseded' ? 'Superseded by a newer ask_by_voice call.' : 'Cancelled.',
});

export async function askByVoice({ question, options }, ask) {
  if (!question || typeof question !== 'string') throw new Error('question is required');
  const opts = Array.isArray(options) ? options.filter((o) => o && o.label) : [];

  for (let round = 0; ; round++) {
    // Speak — the question exactly as Claude phrased it.
    ask.progress('🔊 Asking…');
    await silencing;
    if (ask.cancelled) return cancelledResult(ask.cancelled);
    const spoke = await ask.run([SPEAKER, 'say', '--wait', question]);
    if (ask.cancelled) return cancelledResult(ask.cancelled);
    if (spoke.code === STOPPED) return stoppedResult;
    if (spoke.code !== 0) {
      // Nobody heard the question, so listening for an answer would be a lie.
      return { transcript: '', matched: null, error: spoke.stderr || 'could not speak the question', note: 'The question was not spoken. Relay `error` to the user and fall back to a typed question.' };
    }

    // Listen — relaying the transcript as it forms.
    ask.progress('🎙 Listening…');
    let transcript = '';
    const heard = await ask.run([LISTEN, '--stream'], (line) => {
      const m = /^(partial|final):\s?(.*)$/.exec(line);
      if (!m) return;
      if (m[1] === 'final') transcript = m[2].trim();
      if (m[2].trim()) ask.progress(`🎙 “${m[2].trim()}”`);
    });
    if (ask.cancelled) return cancelledResult(ask.cancelled);

    if (!transcript && heard.code === STOPPED) return stoppedResult;
    if (!transcript) {
      // listen.sh explains its own failures on stderr (no audio connection,
      // STT not installed, nothing recognized) — pass that through verbatim.
      return {
        transcript: '',
        matched: null,
        ...(heard.stderr && { error: heard.stderr }),
        note: 'No speech recognized. Call ask_by_voice again to re-ask, or fall back to a typed question. If `error` is set, relay it to the user.',
      };
    }

    // Is the reply about the conversation itself?
    const intent = classifyIntent(transcript);
    if (intent === 'repeat' && round < MAX_REPEATS) continue;
    if (intent === 'cancel') {
      return { transcript, cancelled: true, note: 'The user cancelled this question by voice. Drop it — do not re-ask unless they bring it up.' };
    }

    const matched = matchOption(transcript, opts);
    return {
      transcript,
      matched, // { index, label, by } or null
      options: opts.map((o, i) => ({ index: i, label: o.label })),
      note: matched ? 'Proceed with matched.label.' : 'No confident option match — interpret the transcript yourself, or re-ask.',
    };
  }
}

function handle(line) {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  switch (method) {
    case 'initialize':
      return ok(id, {
        protocolVersion: params?.protocolVersion || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'bespunky-voice', version: VERSION },
      });
    case 'notifications/initialized':
      return; // notifications take no response
    case 'notifications/cancelled':
      // The client gave up on the request: stop the sound now, and send nothing
      // back for it (the protocol says a cancelled request gets no response).
      return inflight.get(params?.requestId)?.cancel('client');
    case 'ping':
      return ok(id, {});
    case 'tools/list':
      return ok(id, { tools: [TOOL] });
    case 'tools/call': {
      if (params?.name !== 'ask_by_voice') return err(id, -32602, `unknown tool: ${params?.name}`);
      for (const other of inflight.values()) other.cancel('superseded');
      const ask = new Ask(id, params?._meta?.progressToken);
      inflight.set(id, ask);
      askByVoice(params.arguments || {}, ask)
        .then((result) => ({ content: [{ type: 'text', text: JSON.stringify(result) }], isError: false }))
        .catch((e) => ({ content: [{ type: 'text', text: `voice ask failed: ${e?.message || e}` }], isError: true }))
        .then((result) => {
          inflight.delete(id);
          if (ask.cancelled !== 'client') ok(id, result);
        });
      return;
    }
    default:
      if (id !== undefined) return err(id, -32601, `method not found: ${method}`);
  }
}

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
  // The client went away (session ended, server restarted): never leave a voice
  // talking or a microphone open behind us.
  process.stdin.on('end', () => {
    for (const ask of inflight.values()) ask.cancel('client');
    setTimeout(() => process.exit(0), 200);
  });
}
