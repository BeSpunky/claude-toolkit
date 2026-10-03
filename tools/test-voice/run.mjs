#!/usr/bin/env node
// Behaviour tests for the bespunky-voice plugin (plugins/voice/), minus the audio.
//
// The plugin's audio boundaries (speak.sh, listen.sh) need a speaker, a microphone and installed engines, so they
// are exercised by hand. Everything ABOVE them is testable and is where the conversation is actually shaped:
//   - how a question is PHRASED for the ear (no form read aloud, no choices said twice),
//   - how a spoken reply is UNDERSTOOD ("repeat that", "stop", which option),
//   - how the ask tool BEHAVES while it waits — live transcript, repeat, cancel, supersede — run against the real
//     server with fake speaker/listen scripts laid out exactly where it looks for them,
//   - how the speaker owns the utterance (stop, replay), against a fake speak.sh.
//
// Needs only node + bash. Run: node tools/test-voice/run.mjs
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../plugins/voice');
const { classifyIntent, matchOption } = await import(path.join(PLUGIN, 'mcp/answer.mjs'));
const { phraseQuestion, spokenFor } = await import(path.join(PLUGIN, 'hooks/extract-spoken.mjs'));

const cases = [];
const test = (name, fn) => cases.push({ name, fn });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), `voice-test-${p}-`));

// ---- phrasing ------------------------------------------------------------------
test('a choice is asked as one natural sentence, never as a form', () => {
  const s = phraseQuestion('Which approach should we take?', [{ label: 'Commit now' }, { label: 'Keep going' }, { label: 'Stash it' }]);
  assert.equal(s, 'Which approach should we take: Commit now, Keep going, or Stash it?');
  assert.doesNotMatch(s, /option one|your options|say your choice|claude asks/i);
});
test('choices the question already names are not said twice', () => {
  assert.equal(phraseQuestion('Commit now or keep going?', [{ label: 'Commit now' }, { label: 'Keep going' }]), 'Commit now or keep going?');
});
test('a yes/no question is asked as one', () => {
  assert.equal(phraseQuestion('Should I commit now?', [{ label: 'Yes' }, { label: 'No' }]), 'Should I commit now?');
});
test('a recommended choice becomes a suggestion, not a label suffix', () => {
  assert.equal(phraseQuestion('Which?', [{ label: 'A (Recommended)' }, { label: 'B' }]), "Which: A or B? I'd go with A.");
});
test('several questions are joined as speech', () => {
  const s = spokenFor({ tool_name: 'AskUserQuestion', tool_input: { questions: [
    { question: 'Which color?', options: [{ label: 'Red' }, { label: 'Blue' }] },
    { question: 'Which size?', options: [{ label: 'Small' }, { label: 'Large' }] }] } });
  assert.equal(s, 'Which color: Red or Blue? And Which size: Small or Large?');
});
test('a malformed payload says nothing', () => {
  for (const p of [null, 42, {}, { tool_name: 'AskUserQuestion', tool_input: { questions: 'x' } }]) assert.equal(spokenFor(p), '');
});

// ---- understanding a reply -------------------------------------------------------
test('"repeat that" and friends are a repeat, only as the whole reply', () => {
  for (const t of ['Repeat that.', 'say that again please', 'What?', 'Sorry, can you repeat the question?', 'come again']) assert.equal(classifyIntent(t), 'repeat', t);
  assert.equal(classifyIntent('I want what you said first'), null);
});
test('"stop" and friends are a cancel, only as the whole reply', () => {
  for (const t of ['Stop.', 'never mind', 'Nevermind', 'okay cancel that', 'forget it']) assert.equal(classifyIntent(t), 'cancel', t);
  assert.equal(classifyIntent('no, stop doing the migration first'), null);
});
test('options match by label, ordinal and yes/no; unsure stays unmatched', () => {
  const opts = [{ label: 'Commit now' }, { label: 'Keep going' }];
  assert.equal(matchOption('let us commit now', opts).index, 0);
  assert.equal(matchOption('the second one', opts).index, 1);
  assert.equal(matchOption('yeah', opts).index, 0);
  assert.equal(matchOption('no idea', opts), null);
});

// ---- the ask tool, against fake audio -------------------------------------------
// The server finds its scripts at ../scripts relative to itself, so the fixture IS that layout: the real server
// files under mcp/, fakes under scripts/. Fake listen.sh replays scripted transcripts, one per call.
function serverFixture({ transcripts = [], listenSeconds = 0 } = {}) {
  const root = tmp('server');
  fs.mkdirSync(path.join(root, 'mcp'));
  fs.mkdirSync(path.join(root, 'scripts'));
  for (const f of ['ask-server.mjs', 'answer.mjs']) fs.copyFileSync(path.join(PLUGIN, 'mcp', f), path.join(root, 'mcp', f));
  const log = path.join(root, 'log');
  fs.writeFileSync(path.join(root, 'transcripts'), transcripts.join('\n') + '\n');
  fs.writeFileSync(path.join(root, 'scripts', 'speaker.sh'), `#!/usr/bin/env bash\nprintf 'speaker %s\\n' "$*" >> '${log}'\n`);
  fs.writeFileSync(path.join(root, 'scripts', 'listen.sh'), `#!/usr/bin/env bash
printf 'listen %s\\n' "$*" >> '${log}'
trap 'echo listen-killed >> "${log}"; exit 143' TERM
n=$(cat '${root}/n' 2>/dev/null || echo 0); echo $((n+1)) > '${root}/n'
t=$(sed -n "$((n+1))p" '${root}/transcripts')
for w in $t; do acc="\${acc:+$acc }$w"; echo "partial: $acc"; done
sleep ${listenSeconds} & wait $!
[ -n "$t" ] || { echo 'bespunky-voice: no speech recognized' >&2; exit 1; }
echo "final: $t"
`);
  const proc = spawn('node', [path.join(root, 'mcp', 'ask-server.mjs')], { stdio: ['pipe', 'pipe', 'inherit'] });
  const messages = [];
  let buf = '';
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (d) => {
    buf += d;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) { messages.push(JSON.parse(buf.slice(0, nl))); buf = buf.slice(nl + 1); }
  });
  const rpc = (m) => proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
  const ask = (id, args, token = `t${id}`) => rpc({ id, method: 'tools/call', params: { name: 'ask_by_voice', arguments: args, _meta: { progressToken: token } } });
  const response = async (id, ms = 5000) => {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(20)) {
      const r = messages.find((m) => m.id === id);
      if (r) return r.result ? JSON.parse(r.result.content[0].text) : r;
    }
    return undefined;
  };
  const logLines = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : []);
  const progress = (token) => messages.filter((m) => m.method === 'notifications/progress' && m.params.progressToken === token).map((m) => m.params.message);
  return { rpc, ask, response, logLines, progress, close: () => proc.kill() };
}

test('the question is spoken verbatim, and the transcript is shown as it forms', async () => {
  const s = serverFixture({ transcripts: ['keep going please'] });
  try {
    s.ask(1, { question: 'Should I commit now, or keep going?', options: [{ label: 'Commit now' }, { label: 'Keep going' }] });
    const r = await s.response(1);
    assert.equal(r.matched.label, 'Keep going');
    assert.deepEqual(s.logLines().filter((l) => l.startsWith('speaker')), ['speaker say --wait Should I commit now, or keep going?']);
    const p = s.progress('t1');
    assert.ok(p.includes('🎙 “keep”') && p.includes('🎙 “keep going please”'), p.join(' | '));
  } finally { s.close(); }
});
test('"repeat that" re-asks inside the tool, without a round-trip to Claude', async () => {
  const s = serverFixture({ transcripts: ['say that again', 'commit now'] });
  try {
    s.ask(1, { question: 'Commit now?', options: [{ label: 'Commit now' }, { label: 'Wait' }] });
    const r = await s.response(1);
    assert.equal(r.matched.label, 'Commit now');
    assert.equal(s.logLines().filter((l) => l.startsWith('speaker say')).length, 2);
  } finally { s.close(); }
});
test('"never mind" returns cancelled instead of guessing an answer', async () => {
  const s = serverFixture({ transcripts: ['never mind'] });
  try {
    s.ask(1, { question: 'Yes or no?', options: [{ label: 'Yes' }, { label: 'No' }] });
    const r = await s.response(1);
    assert.equal(r.cancelled, true);
    assert.equal(r.matched, undefined);
  } finally { s.close(); }
});
test('a client cancel silences the speaker, kills the recording, and sends no response', async () => {
  const s = serverFixture({ transcripts: ['commit now'], listenSeconds: 30 });
  try {
    s.ask(1, { question: 'Commit now?' });
    await sleep(400);
    s.rpc({ method: 'notifications/cancelled', params: { requestId: 1 } });
    await sleep(400);
    assert.ok(s.logLines().includes('listen-killed'), s.logLines().join(' | '));
    assert.ok(s.logLines().includes('speaker stop'));
    assert.equal(await s.response(1, 500), undefined);
  } finally { s.close(); }
});
test('a new ask supersedes one still listening', async () => {
  const s = serverFixture({ transcripts: ['commit now', 'second'], listenSeconds: 1 });
  try {
    s.ask(1, { question: 'First?' });
    await sleep(300);
    s.ask(2, { question: 'Second?', options: [{ label: 'A' }, { label: 'B' }] });
    assert.equal((await s.response(1)).cancelled, true);
    assert.equal((await s.response(2)).matched.label, 'B');
  } finally { s.close(); }
});
test('a recognition failure is relayed, not guessed', async () => {
  const s = serverFixture({ transcripts: [''] });
  try {
    s.ask(1, { question: 'Anything?' });
    const r = await s.response(1);
    assert.equal(r.transcript, '');
    assert.match(r.error, /no speech recognized/);
  } finally { s.close(); }
});

// ---- the speaker owns the utterance -----------------------------------------------
function speakerFixture() {
  const root = tmp('speaker');
  const scripts = path.join(root, 'scripts');
  fs.mkdirSync(scripts);
  fs.copyFileSync(path.join(PLUGIN, 'scripts', 'speaker.sh'), path.join(scripts, 'speaker.sh'));
  // A fake speak.sh that "speaks" for a while and records what it said.
  fs.writeFileSync(path.join(scripts, 'speak.sh'), `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> '${root}/said'\nsleep "\${FAKE_SPEAK_SECONDS:-0}"\n`);
  const run = (args, env = {}) => spawnSync('bash', [path.join(scripts, 'speaker.sh'), ...args], { encoding: 'utf8', env: { ...process.env, HOME: root, ...env } });
  const said = () => fs.readFileSync(path.join(root, 'said'), 'utf8').trim().split('\n');
  const pidfile = path.join(root, '.claude/bespunky-voice/.speaking.pid');
  return { root, run, said, pidfile };
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

test('stop silences a detached utterance', async () => {
  const f = speakerFixture();
  f.run(['say', 'a long sentence'], { FAKE_SPEAK_SECONDS: '30' });
  await sleep(300);
  const pid = Number(fs.readFileSync(f.pidfile, 'utf8'));
  assert.ok(alive(pid));
  f.run(['stop']);
  await sleep(300);
  assert.ok(!alive(pid));
  assert.ok(!fs.existsSync(f.pidfile));
});
test('replay says the last utterance again', () => {
  const f = speakerFixture();
  assert.equal(f.run(['replay', '--wait']).status, 1); // nothing said yet
  f.run(['say', '--wait', 'hello there']);
  f.run(['replay', '--wait']);
  assert.deepEqual(f.said(), ['hello there', 'hello there']);
});
test('a stale pidfile never kills a stranger', async () => {
  const f = speakerFixture();
  const stranger = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' });
  fs.mkdirSync(path.dirname(f.pidfile), { recursive: true });
  fs.writeFileSync(f.pidfile, String(stranger.pid));
  f.run(['stop']);
  await sleep(200);
  assert.ok(alive(stranger.pid));
  stranger.kill();
});

// ---- run ------------------------------------------------------------------------
let failed = 0;
for (const c of cases) {
  try { await c.fn(); console.log(`ok   ${c.name}`); }
  catch (e) { failed++; console.log(`FAIL ${c.name}\n     ${String(e?.message || e).split('\n').join('\n     ')}`); }
}
console.log(`\n${cases.length - failed}/${cases.length} passed`);
process.exit(failed ? 1 : 0);
