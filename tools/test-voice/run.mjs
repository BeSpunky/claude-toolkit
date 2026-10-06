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
const { phraseQuestion } = await import(path.join(PLUGIN, 'hooks/phrasing.mjs'));
const { spokenFor } = await import(path.join(PLUGIN, 'hooks/extract-spoken.mjs'));
const { questionFromText } = await import(path.join(PLUGIN, 'hooks/extract-turn-question.mjs'));

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
test('sentence-long choices lose their own punctuation and get a breath before "or"', () => {
  assert.equal(
    phraseQuestion('What should happen when the token expires?', [{ label: 'Silently refresh it and retry the request.' }, { label: 'Log the user out and redirect.' }]),
    'What should happen when the token expires: Silently refresh it and retry the request, or Log the user out and redirect?');
  assert.equal(phraseQuestion('Which file?', [{ label: 'Use `nx.json`' }, { label: 'Use `package.json`' }]), 'Which file: Use nx.json or Use package.json?');
});
test('a pick-any question says so; a recommended yes is a suggestion', () => {
  assert.equal(phraseQuestion('Which features?', [{ label: 'Routing' }, { label: 'State' }, { label: 'Testing' }], { multiSelect: true }), 'Which features: Routing, State, and Testing? Pick any.');
  assert.equal(phraseQuestion('Update the README?', [{ label: 'Yes (Recommended)' }, { label: 'No' }]), "Update the README? I'd say yes.");
});
test('a prose question after a list is asked with the list as its choices — never the last bullet glued on', () => {
  assert.equal(questionFromText('Routes:\n\n- **Rebase** — rewrites history.\n- **Merge** — keeps it.\n- Migrate to the new API — most work.\n\nWhich one?'),
    'Which one: Rebase, Merge, or Migrate to the new API?');
  assert.equal(questionFromText('Options:\n1. commit\n2. stash\n\nWhich would you prefer?'), 'Which would you prefer: commit or stash?');
  assert.equal(questionFromText('I looked. The cache is stale. Should I clear it?'), 'The cache is stale. Should I clear it?');
  assert.equal(questionFromText('Done, no question.'), '');
});
test('the Stop hook stays silent when the turn ended on a tool call', () => {
  const dir = tmp('turn');
  const transcript = path.join(dir, 't.jsonl');
  const line = (content) => JSON.stringify({ type: 'assistant', message: { content } });
  const run = () => spawnSync('node', [path.join(PLUGIN, 'hooks/extract-turn-question.mjs')], { input: JSON.stringify({ transcript_path: transcript }), encoding: 'utf8' }).stdout;
  fs.writeFileSync(transcript, line([{ type: 'text', text: 'Shall I go on?' }]) + '\n');
  assert.equal(run(), 'Shall I go on?');
  fs.writeFileSync(transcript, line([{ type: 'text', text: 'Shall I go on?' }, { type: 'tool_use', name: 'AskUserQuestion' }]) + '\n');
  assert.equal(run(), '');
});
test('a malformed payload says nothing', () => {
  for (const p of [null, 42, {}, { tool_name: 'AskUserQuestion', tool_input: { questions: 'x' } }]) assert.equal(spokenFor(p), '');
});

// ---- understanding a reply -------------------------------------------------------
test('"repeat that" and friends are a repeat, only as the whole reply', () => {
  for (const t of ['Repeat that.', 'say that again please', 'What?', 'Sorry, can you repeat the question?', 'come again']) assert.equal(classifyIntent(t), 'repeat', t);
  assert.equal(classifyIntent('I want what you said first'), null);
});
test('"stop" and friends are a cancel — padded or repeated — but only as the whole reply', () => {
  for (const t of ['Stop.', 'never mind', 'Nevermind', 'okay cancel that', 'forget it', 'Please stop.', 'Stop, stop.', 'No, stop.', 'Never mind, stop.']) assert.equal(classifyIntent(t), 'cancel', t);
  for (const t of ['no, stop doing the migration first', 'Stop the migration.', 'no']) assert.equal(classifyIntent(t), null, t);
});
test('options match by label, ordinal and yes/no; unsure stays unmatched', () => {
  const opts = [{ label: 'Commit now' }, { label: 'Keep going' }];
  assert.equal(matchOption('let us commit now', opts).index, 0);
  assert.equal(matchOption('the second one', opts).index, 1);
  assert.equal(matchOption('yeah', opts).index, 0);
  assert.equal(matchOption('no idea', opts), null);
  assert.equal(matchOption("I can't decide", opts), null);
});
test('negation is understood: rejections are not picks, mixed yes/no is unsure', () => {
  const opts = [{ label: 'Commit now' }, { label: 'Keep going' }];
  assert.equal(matchOption('Not the first one, the second.', opts).index, 1);
  assert.equal(matchOption('not commit now, keep going', opts).index, 1);
  assert.equal(matchOption("Don't.", opts).index, 1);
  for (const t of ["Don't do it.", "No, I'm sure.", 'Not okay.']) assert.equal(matchOption(t, opts), null, t);
});

// ---- the ask tool, against fake audio -------------------------------------------
// The server finds its scripts at ../scripts relative to itself, so the fixture IS that layout: the real server
// files under mcp/, fakes under scripts/. Fake listen.sh replays scripted transcripts, one per call.
function serverFixture({ transcripts = [], listenSeconds = 0, saySeconds = 0, sayCode = 0, stopDelay = 0 } = {}) {
  const root = tmp('server');
  fs.mkdirSync(path.join(root, 'mcp'));
  fs.mkdirSync(path.join(root, 'scripts'));
  for (const f of ['ask-server.mjs', 'answer.mjs']) fs.copyFileSync(path.join(PLUGIN, 'mcp', f), path.join(root, 'mcp', f));
  const log = path.join(root, 'log');
  fs.writeFileSync(path.join(root, 'transcripts'), transcripts.join('\n') + '\n');
  fs.writeFileSync(path.join(root, 'scripts', 'speaker.sh'), `#!/usr/bin/env bash
printf 'speaker %s\\n' "$*" >> '${log}'
[ "$1" = say ] && { trap 'echo say-killed >> "${log}"; exit 143' TERM; sleep ${saySeconds} & wait $!; }
exit ${sayCode}
`);
  fs.writeFileSync(path.join(root, 'scripts', 'voice.sh'), `#!/usr/bin/env bash
[ "$1" = stop ] && sleep ${stopDelay}
printf 'voice %s\\n' "$*" >> '${log}'
`);
  fs.writeFileSync(path.join(root, 'scripts', 'listen.sh'), `#!/usr/bin/env bash
printf 'listen %s\\n' "$*" >> '${log}'
trap 'echo listen-killed >> "${log}"; exit 143' TERM
n=$(cat '${root}/n' 2>/dev/null || echo 0); echo $((n+1)) > '${root}/n'
t=$(sed -n "$((n+1))p" '${root}/transcripts')
[ "$t" = '<stopped>' ] && exit 143
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
    assert.ok(s.logLines().includes('voice stop'));
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

test('a cancel while the question is still being spoken never opens the mic', async () => {
  const s = serverFixture({ transcripts: ['yes'], saySeconds: 30 });
  try {
    s.ask(1, { question: 'Commit now?' });
    await sleep(300);
    s.rpc({ method: 'notifications/cancelled', params: { requestId: 1 } });
    await sleep(500);
    assert.ok(s.logLines().includes('say-killed'), s.logLines().join(' | '));
    assert.ok(!s.logLines().some((l) => l.startsWith('listen')), s.logLines().join(' | '));
  } finally { s.close(); }
});
test("a cancel's stop lands before the next question is spoken", async () => {
  const s = serverFixture({ transcripts: ['commit now', 'b'], listenSeconds: 2, stopDelay: 0.4 });
  try {
    s.ask(1, { question: 'First?' });
    await sleep(300);
    s.ask(2, { question: 'Second?', options: [{ label: 'A' }, { label: 'B' }] });
    assert.equal((await s.response(2)).matched.label, 'B');
    const log = s.logLines();
    assert.ok(log.indexOf('voice stop') < log.indexOf('speaker say --wait Second?'), log.join(' | '));
  } finally { s.close(); }
});

test('a Stop from outside (band, Esc, typing) while asking or listening returns cancelled', async () => {
  for (const [opts, what] of [[{ sayCode: 143 }, 'while asking'], [{ transcripts: ['<stopped>'] }, 'while listening']]) {
    const s = serverFixture(opts);
    try {
      s.ask(1, { question: 'Commit now?' });
      const r = await s.response(1);
      assert.equal(r.cancelled, true, what);
      assert.equal(r.error, undefined, what);
      if (opts.sayCode) assert.ok(!s.logLines().some((l) => l.startsWith('listen')), what);
    } finally { s.close(); }
  }
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
test('.speaking.pid exists exactly while something is being said', async () => {
  const f = speakerFixture();
  f.run(['say', 'short'], { FAKE_SPEAK_SECONDS: '0.5' });
  await sleep(200);
  assert.ok(fs.existsSync(f.pidfile), 'present while speaking');
  await sleep(800);
  assert.ok(!fs.existsSync(f.pidfile), 'gone once the utterance ended on its own');
});
test('say --wait reports a stopped utterance as 143, a finished one as 0', async () => {
  const f = speakerFixture();
  assert.equal(f.run(['say', '--wait', 'done']).status, 0);
  const env = { ...process.env, HOME: f.root, FAKE_SPEAK_SECONDS: '30' };
  const waiting = new Promise((r) => spawn('bash', [path.join(f.root, 'scripts', 'speaker.sh'), 'say', '--wait', 'long'], { env, stdio: 'ignore' }).on('close', r));
  await sleep(300);
  f.run(['stop']);
  assert.equal(await waiting, 143);
});
test('replay says the last utterance again', () => {
  const f = speakerFixture();
  assert.equal(f.run(['replay', '--wait']).status, 1); // nothing said yet
  f.run(['say', '--wait', 'hello there']);
  f.run(['replay', '--wait']);
  assert.deepEqual(f.said(), ['hello there', 'hello there']);
});
test('concurrent says leave exactly one voice, and stop silences it', async () => {
  const f = speakerFixture();
  const env = { ...process.env, HOME: f.root, FAKE_SPEAK_SECONDS: '30' };
  await Promise.all([1, 2, 3, 4, 5, 6].map((u) => new Promise((r) => spawn('bash', [path.join(f.root, 'scripts', 'speaker.sh'), 'say', `u${u}`], { env, stdio: 'ignore' }).on('close', r))));
  await sleep(300);
  const speaking = () => spawnSync('pgrep', ['-fc', `^bash ${path.join(f.root, 'scripts', 'speak.sh')}`], { encoding: 'utf8' }).stdout.trim();
  assert.equal(speaking(), '1');
  f.run(['stop']);
  await sleep(300);
  assert.equal(speaking(), '0');
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

// ---- hooks ---------------------------------------------------------------------
test('voice.sh stop silences speech AND ends the open recording; a stale announcement is cleared', async () => {
  const root = tmp('voice');
  const scripts = path.join(root, 'scripts');
  const home = path.join(root, '.claude', 'bespunky-voice');
  fs.mkdirSync(scripts); fs.mkdirSync(home, { recursive: true });
  fs.copyFileSync(path.join(PLUGIN, 'scripts', 'voice.sh'), path.join(scripts, 'voice.sh'));
  fs.writeFileSync(path.join(scripts, 'speaker.sh'), `#!/usr/bin/env bash\necho "speaker $*" >> '${root}/log'\n`);
  fs.writeFileSync(path.join(scripts, 'listen.sh'), `#!/usr/bin/env bash\ntrap 'rm -f "${home}/.listening.pid"; exit 143' TERM\necho $$ > '${home}/.listening.pid'\nsleep 30 & wait $!\n`);
  const listener = spawn('bash', [path.join(scripts, 'listen.sh')], { stdio: 'ignore' });
  await sleep(300);
  const run = () => spawnSync('bash', [path.join(scripts, 'voice.sh'), 'stop'], { env: { ...process.env, HOME: root } });
  run();
  await sleep(300);
  assert.ok(!alive(listener.pid), 'recording ended');
  assert.equal(fs.readFileSync(path.join(root, 'log'), 'utf8').trim(), 'speaker stop');
  fs.writeFileSync(path.join(home, '.listening.pid'), '999999'); fs.writeFileSync(path.join(home, '.hearing'), 'x');
  run();
  assert.ok(!fs.existsSync(path.join(home, '.listening.pid')) && !fs.existsSync(path.join(home, '.hearing')), 'stale announcement cleared');
});
test('silence.sh stops the voice and prints nothing (its stdout would reach the model)', () => {
  const root = tmp('silence');
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.writeFileSync(path.join(root, 'scripts', 'voice.sh'), `#!/usr/bin/env bash\necho "$*" > '${root}/called'\necho noise\n`);
  const r = spawnSync('bash', [path.join(PLUGIN, 'hooks', 'silence.sh')], { encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_ROOT: root } });
  assert.equal(r.stdout, '');
  assert.equal(fs.readFileSync(path.join(root, 'called'), 'utf8').trim(), 'stop');
});
test('install-runtime publishes scripts, prunes retired ones, and never prunes after a failed publish', () => {
  const home = tmp('runtime');
  const dest = path.join(home, '.claude', 'bespunky-voice');
  const run = (root) => spawnSync('bash', [path.join(PLUGIN, 'hooks', 'install-runtime.sh')], { env: { ...process.env, HOME: home, CLAUDE_PLUGIN_ROOT: root } });
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(dest, 'speak-detached.sh'), '');
  run(PLUGIN);
  assert.ok(fs.existsSync(path.join(dest, 'speaker.sh')));
  assert.ok(!fs.existsSync(path.join(dest, 'speak-detached.sh')));
  run(path.join(home, 'gone'));
  assert.ok(fs.existsSync(path.join(dest, 'speaker.sh')));
});

// ---- install.sh: installs exactly what isn't working -----------------------------
// The plugin's scripts, with the two real installers replaced by stubs that record
// being called and lay down a working fake engine — so no network, no build.
// `audio`: 'reachable' — PULSE_SERVER names a server the stub pactl answers for;
// 'off' — no server answers anywhere, inside a house devcontainer whose committed
// marker says voice is off (the case that used to read as "no speech engine").
function installRig({ audio = 'reachable' } = {}) {
  const root = tmp('install');
  const scripts = path.join(root, 'scripts');
  const home = path.join(root, 'home');
  const bin = path.join(root, 'bin');
  const voice = path.join(home, '.claude', 'bespunky-voice');
  fs.cpSync(path.join(PLUGIN, 'scripts'), scripts, { recursive: true });
  fs.mkdirSync(bin, { recursive: true });
  const exe = (p, body) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 }); };
  for (const c of ['paplay', 'parecord', 'sox']) exe(path.join(bin, c), 'exit 0');
  exe(path.join(bin, 'pactl'), audio === 'reachable' ? 'exit 0' : 'exit 1');
  const project = path.join(root, 'project');
  fs.mkdirSync(path.join(project, '.devcontainer'), { recursive: true });
  fs.writeFileSync(path.join(project, '.devcontainer', '.bespunky-devcontainer.json'), JSON.stringify({ voice: audio === 'reachable' }));
  const env = {
    ...process.env, HOME: home, PATH: `${bin}:/usr/bin:/bin`, CLAUDE_PROJECT_DIR: project, REMOTE_CONTAINERS: 'true',
    ...(audio === 'reachable' ? { PULSE_SERVER: 'tcp:127.0.0.1:4713' } : {}),
  };
  if (audio !== 'reachable') delete env.PULSE_SERVER;
  const fakePiper = () => {
    exe(path.join(voice, 'piper', 'piper'), 'while [ $# -gt 0 ]; do [ "$1" = --output_file ] && echo wav > "$2"; shift; done; exit 0');
    fs.mkdirSync(path.join(voice, 'voices'), { recursive: true });
    fs.writeFileSync(path.join(voice, 'voices', 'default.onnx'), '');
  };
  const fakeWhisper = () => {
    for (const b of ['whisper-cli', 'whisper-vad-speech-segments']) exe(path.join(voice, 'whisper', 'src', 'build', 'bin', b), 'exit 0');
    fs.mkdirSync(path.join(voice, 'whisper', 'models'), { recursive: true });
    for (const m of ['base.en', 'silero-v6.2.0']) fs.writeFileSync(path.join(voice, 'whisper', 'models', `ggml-${m}.bin`), '');
  };
  exe(path.join(scripts, 'install-piper.sh'), `echo piper >> "${root}/called"`);
  exe(path.join(scripts, 'install-whisper.sh'), `echo whisper >> "${root}/called"`);
  const script = (name, ...args) => spawnSync('bash', [path.join(scripts, name), ...args], { encoding: 'utf8', env });
  const run = (...args) => {
    const r = script('install.sh', ...args);
    const called = fs.existsSync(path.join(root, 'called')) ? fs.readFileSync(path.join(root, 'called'), 'utf8').trim().split('\n') : [];
    fs.rmSync(path.join(root, 'called'), { force: true });
    return { ...r, called };
  };
  return { run, script, fakePiper, fakeWhisper };
}
test('install.sh leaves a working voice alone', () => {
  const rig = installRig();
  rig.fakePiper(); rig.fakeWhisper();
  const r = rig.run();
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.called, []);
  assert.match(r.stdout, /^tts\tnatural/m);
  assert.match(r.stdout, /^stt\tok/m);
});
test('install.sh installs only the missing half, and fails when it still does not work', () => {
  const rig = installRig();
  rig.fakePiper();
  let r = rig.run();
  assert.deepEqual(r.called, ['whisper']);
  assert.equal(r.status, 1);                               // the stub installed nothing
  assert.match(r.stderr, /speech recognition still missing/);
  rig.fakeWhisper();
  r = rig.run('speak');
  assert.deepEqual(r.called, []);
  assert.equal(r.status, 0, r.stderr);
});

// ---- the audio connection: judged first, never mistaken for an engine ------------
const VOICE_OFF = /^bespunky-voice: no audio connection — voice is turned off for this project's devcontainer.*\/bespunky-house:upgrade --voice/m;
test('with voice off for the project, speaking names the missing audio connection — not a missing engine', () => {
  const rig = installRig({ audio: 'off' });              // and no engine installed either
  const r = rig.script('speak.sh', 'hello');
  assert.equal(r.status, 1);
  assert.match(r.stderr, VOICE_OFF);
  assert.doesNotMatch(r.stderr, /TTS engine|install\.sh/);
});
test('with voice off for the project, listening names the missing audio connection — not a missing engine', () => {
  const rig = installRig({ audio: 'off' });
  const r = rig.script('listen.sh', '--stream');
  assert.equal(r.status, 1);
  assert.match(r.stderr, VOICE_OFF);
  assert.doesNotMatch(r.stderr, /speech recognition|install\.sh/);
});
test('health reports the audio connection beside the engines', () => {
  const rig = installRig({ audio: 'off' });
  rig.fakePiper(); rig.fakeWhisper();
  const r = rig.script('voice-health.sh');
  assert.match(r.stdout, /^audio\tunreachable\tno audio connection — voice is turned off/m);
  assert.match(r.stdout, /^tts\tnatural/m);
  assert.match(rig.script('voice-health.sh').stdout, /^stt\tok/m);
  assert.match(installRig().script('voice-health.sh').stdout, /^audio\tok\t$/m);
});
test('install.sh never calls working engines with no audio connection "ready"', () => {
  const rig = installRig({ audio: 'off' });
  rig.fakePiper(); rig.fakeWhisper();
  const r = rig.run();
  assert.equal(r.status, 3, r.stderr);
  assert.match(r.stderr, /^bespunky-voice: the speech engines are installed, but voice is not ready — no audio connection — voice is turned off/m);
});

// ---- run ------------------------------------------------------------------------
let failed = 0;
for (const c of cases) {
  try { await c.fn(); console.log(`ok   ${c.name}`); }
  catch (e) { failed++; console.log(`FAIL ${c.name}\n     ${String(e?.message || e).split('\n').join('\n     ')}`); }
}
console.log(`\n${cases.length - failed}/${cases.length} passed`);
process.exit(failed ? 1 : 0);
