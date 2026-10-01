#!/usr/bin/env node
// Behaviour tests for the toolkit tips engine (plugins/bespunky/hooks/tips.mjs).
//
// That engine runs at every session start, on every machine with the toolkit installed, and writes into a file
// it does not own: the user's ~/.claude/settings.json. Its promises are all of the "never" kind — never touch a
// tip it didn't write, never rewrite a file it couldn't parse, never replace a symlink, never speak on stdout
// (SessionStart stdout lands in the model's context). A broken "never" is silent: the session starts fine and
// the damage is in someone's settings. So each promise is a case here, run against a throwaway config dir.
//
// Needs only node. Run: node tools/test-tips/run.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ENGINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../plugins/bespunky/hooks/tips.mjs');

/** A throwaway Claude config dir, project dir and set of installed plugins with known tips. */
function fixture({ plugins = { bespunky: ['b1', 'b2'], 'bespunky-workflow': ['w1', 'w2', 'w3'] }, registry = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tips-test-'));
  const config = path.join(root, 'config');
  const project = path.join(root, 'project');
  const data = path.join(root, 'data');
  fs.mkdirSync(path.join(config, 'plugins'), { recursive: true });
  fs.mkdirSync(project);

  const installs = {};
  for (const [name, tips] of Object.entries(plugins)) {
    const installPath = path.join(root, 'cache', name);
    fs.mkdirSync(installPath, { recursive: true });
    fs.writeFileSync(path.join(installPath, 'tips.txt'), `# header comment\n\n${tips.join('\n')}\n`);
    installs[`${name}@claude-toolkit`] = [{ scope: 'user', installPath }];
  }
  if (registry) fs.writeFileSync(path.join(config, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: installs }));

  const settingsPath = path.join(config, 'settings.json');
  return {
    root,
    project,
    settingsPath,
    installs,
    run(command = 'rotate') {
      const result = spawnSync(process.execPath, [ENGINE, command], {
        encoding: 'utf8',
        env: { ...process.env, CLAUDE_CONFIG_DIR: config, CLAUDE_PROJECT_DIR: project, CLAUDE_PLUGIN_DATA: data, CLAUDE_PLUGIN_ROOT: path.join(root, 'cache', 'bespunky') },
      });
      assert.equal(result.status, 0, `engine exited ${result.status}: ${result.stderr}`);
      return result;
    },
    settings: () => JSON.parse(fs.readFileSync(settingsPath, 'utf8')),
    writeSettings: (value) => fs.writeFileSync(settingsPath, typeof value === 'string' ? value : JSON.stringify(value, null, 2)),
    writeRegistry: (plugins) => fs.writeFileSync(path.join(config, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins })),
  };
}

const cases = {
  'creates settings with a rotating handful, silently'() {
    const f = fixture();
    const { stdout } = f.run();
    assert.equal(stdout, '', 'the hook path must never write to stdout');
    assert.deepEqual(f.settings(), { spinnerTipsOverride: { tips: ['b1', 'b2', 'w1'] } });
    f.run();
    assert.deepEqual(f.settings().spinnerTipsOverride.tips, ['w2', 'w3', 'b1'], 'the next session rotates on, wrapping round');
  },

  'leaves the user’s own tips and every other key alone'() {
    const f = fixture();
    f.writeSettings({ model: 'opus', spinnerTipsOverride: { tips: ['mine'], replaceBuiltInTips: true } });
    f.run();
    f.run();
    assert.deepEqual(f.settings(), { model: 'opus', spinnerTipsOverride: { tips: ['mine', 'w2', 'w3', 'b1'], replaceBuiltInTips: true } });
  },

  'never rewrites a settings file it cannot parse'() {
    const f = fixture();
    f.writeSettings('{ "model": "opus", // a comment JSON does not allow\n}');
    const before = fs.readFileSync(f.settingsPath, 'utf8');
    f.run();
    assert.equal(fs.readFileSync(f.settingsPath, 'utf8'), before);
  },

  'writes through a symlinked settings file without replacing the link'() {
    const f = fixture();
    const target = path.join(f.root, 'dotfiles-settings.json');
    fs.writeFileSync(target, JSON.stringify({ model: 'opus' }));
    fs.symlinkSync(target, f.settingsPath);
    f.run();
    assert.ok(fs.lstatSync(f.settingsPath).isSymbolicLink(), 'the symlink survives');
    assert.deepEqual(JSON.parse(fs.readFileSync(target, 'utf8')).spinnerTipsOverride.tips, ['b1', 'b2', 'w1']);
  },

  'only tips from toolkit plugins installed and enabled for this project'() {
    const f = fixture({ plugins: { bespunky: ['b1'], 'bespunky-workflow': ['w1'], 'bespunky-voice': ['v1'], other: ['o1'] } });
    f.writeRegistry({
      ...f.installs,
      'bespunky-voice@claude-toolkit': [{ scope: 'project', projectPath: path.join(f.root, 'elsewhere'), installPath: f.installs['bespunky-voice@claude-toolkit'][0].installPath }],
    });
    fs.mkdirSync(path.join(f.project, '.claude'));
    fs.writeFileSync(path.join(f.project, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'bespunky-workflow@claude-toolkit': false } }));
    f.run();
    assert.deepEqual(f.settings().spinnerTipsOverride.tips, ['b1'], 'not another project’s, not disabled, not non-toolkit');
  },

  'falls back to its own tips when the install registry is unreadable'() {
    const f = fixture({ registry: false });
    f.run();
    assert.deepEqual(f.settings().spinnerTipsOverride.tips, ['b1', 'b2']);
  },

  '`off` withdraws its tips, cleans up what it created, and stays off'() {
    const f = fixture();
    f.writeSettings({ model: 'opus' });
    f.run();
    f.run('off');
    assert.deepEqual(f.settings(), { model: 'opus' });
    f.run();
    assert.deepEqual(f.settings(), { model: 'opus' }, 'a later session start adds nothing back');
    f.run('on');
    assert.equal(f.settings().spinnerTipsOverride.tips.length, 3);
  },

  '`off` keeps the user’s own tips'() {
    const f = fixture();
    f.writeSettings({ spinnerTipsOverride: { tips: ['mine'] } });
    f.run();
    f.run('off');
    assert.deepEqual(f.settings(), { spinnerTipsOverride: { tips: ['mine'] } });
  },

  'respects spinnerTipsEnabled: false by withdrawing'() {
    const f = fixture();
    f.run();
    f.writeSettings({ ...f.settings(), spinnerTipsEnabled: false });
    f.run();
    assert.deepEqual(f.settings(), { spinnerTipsEnabled: false });
  },

  'does not touch the file when nothing would change'() {
    const f = fixture({ plugins: { bespunky: ['b1'] } });
    f.run();
    const mtime = fs.statSync(f.settingsPath).mtimeMs;
    const before = fs.readFileSync(f.settingsPath, 'utf8');
    fs.utimesSync(f.settingsPath, new Date(0), new Date(0));
    f.run();
    assert.equal(fs.readFileSync(f.settingsPath, 'utf8'), before);
    assert.equal(fs.statSync(f.settingsPath).mtimeMs, 0, `rewrote an unchanged file (was ${mtime})`);
  },
};

let failed = 0;
for (const [name, test] of Object.entries(cases)) {
  try {
    test();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failed++;
    console.log(`  FAIL ${name}\n       ${error.message.split('\n').join('\n       ')}`);
  }
}
console.log(failed ? `${failed} of ${Object.keys(cases).length} tips tests failed` : `all ${Object.keys(cases).length} tips tests passed`);
process.exit(failed ? 1 : 0);
