#!/usr/bin/env node
// Toolkit tips — a few BeSpunky tips riding in Claude Code's own "working…" spinner.
//
// WHY THE SPINNER. The ask was a tip the user can read or ignore, never abrupt and never part of the
// conversation. The spinner is the one surface that is all three: it already rotates hints while Claude works,
// the model never sees it, and nobody has to dismiss anything. Every other surface fails one test — plain
// SessionStart stdout lands in the model's context, a `systemMessage` is a line in the transcript, and the
// status line is a single slot the user may already own.
//
// WHY A HOOK WRITES USER SETTINGS. A plugin's own settings.json honours only `agent` and `subagentStatusLine`;
// `spinnerTipsOverride` is dropped. So the only way in is the user's settings file, and that makes this script
// a guest in a file it does not own. The rules that follow from that:
//   - It touches ONE array (`spinnerTipsOverride.tips`) and, inside it, ONLY the strings it wrote last time
//     (remembered in the plugin's data dir). The user's own tips and every other key are left as they were.
//   - A settings file it cannot parse is never rewritten. A broken file is the user's to fix, and "fixing" it by
//     writing a fresh one would erase their configuration.
//   - It writes through a symlink, not over it (dotfile repos), atomically, and only when something changed.
//   - `spinnerTipsEnabled: false` is the user saying no: it withdraws its tips and adds nothing.
// There is no uninstall event, so whatever is in the file when the plugin goes stays there — `off` (the
// `/bespunky:tips` skill) is how a user takes them out by hand.
//
// WHERE TIPS COME FROM. Each plugin owns its tips in a `tips.txt` at its root (one per line, `#` comments), so
// a tip ships, changes and retires with the capability it describes. This engine only collects the files of
// the toolkit plugins actually installed and enabled for this project — a tip for a plugin you don't have is a
// command that doesn't work.
//
// OCCASIONAL, NOT CONSTANT. Each session start contributes a small rotating handful, mixed in with Claude
// Code's built-in tips, so a toolkit tip turns up now and then rather than every time the spinner turns.
//
// Usage: tips.mjs [rotate|off|on|list]   (rotate is the hook's default; the others back the /bespunky:tips skill)
// It never writes to stdout from the hook path: SessionStart stdout would be added to the model's context.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TIPS_PER_SESSION = 3;
const TOOLKIT_PLUGIN = /^bespunky(-[a-z0-9-]+)?$/;
const TIPS_FILE = 'tips.txt';

const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dataDir = process.env.CLAUDE_PLUGIN_DATA || '';
const userSettingsPath = path.join(configDir, 'settings.json');
const statePath = dataDir ? path.join(dataDir, 'tips-state.json') : '';

/** JSON at `file`: the parsed value, `undefined` when absent, `null` when present but unreadable/unparsable. */
function readJson(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (error) {
    return error.code === 'ENOENT' ? undefined : null;
  }
  try {
    return raw.trim() === '' ? {} : JSON.parse(raw);
  } catch {
    return null;
  }
}

function readState() {
  const state = statePath ? readJson(statePath) : undefined;
  return { written: [], cursor: 0, off: false, ...(state && typeof state === 'object' ? state : {}) };
}

function writeState(state) {
  if (!statePath) return;
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');
}

/** Tips from one plugin's `tips.txt`: one per line, blank lines and `#` comments skipped. */
function readTips(root) {
  let raw;
  try {
    raw = fs.readFileSync(path.join(root, TIPS_FILE), 'utf8');
  } catch {
    return [];
  }
  return raw.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
}

function isWithin(dir, root) {
  const rel = path.relative(path.resolve(root), path.resolve(dir));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** `enabledPlugins` as Claude Code layers it for this project: user, then project, then local — later wins. */
function enabledPlugins() {
  const layers = [
    userSettingsPath,
    path.join(projectDir, '.claude', 'settings.json'),
    path.join(projectDir, '.claude', 'settings.local.json'),
  ];
  return Object.assign({}, ...layers.map((file) => readJson(file)?.enabledPlugins ?? {}));
}

/**
 * The toolkit plugins installed and enabled for this project, as `{name, root}`. Read from Claude Code's install
 * registry; if that cannot be read, fall back to this plugin alone rather than guessing at the rest.
 */
function installedToolkitPlugins() {
  const registry = readJson(path.join(configDir, 'plugins', 'installed_plugins.json'));
  if (!registry?.plugins) return [{ name: 'bespunky', root: pluginRoot }];

  const enabled = enabledPlugins();
  const found = new Map();
  for (const [key, installs] of Object.entries(registry.plugins)) {
    const name = key.split('@')[0];
    if (!TOOLKIT_PLUGIN.test(name) || enabled[key] === false || found.has(name)) continue;
    const install = (Array.isArray(installs) ? installs : []).find(
      (entry) => entry?.installPath && (entry.scope === 'user' || (entry.projectPath && isWithin(projectDir, entry.projectPath))),
    );
    if (install) found.set(name, { name, root: install.installPath });
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Every tip on offer, grouped by plugin. */
function tipsByPlugin() {
  return installedToolkitPlugins().map(({ name, root }) => ({ plugin: name, tips: readTips(root) }));
}

/** The rotation order: round-robin across plugins, so each session's handful spans the toolkit, not one plugin. */
function tipPool() {
  const groups = tipsByPlugin();
  const longest = Math.max(0, ...groups.map((group) => group.tips.length));
  return Array.from({ length: longest }, (_, i) => groups.filter((group) => i < group.tips.length).map((group) => ({ plugin: group.plugin, tip: group.tips[i] }))).flat();
}

/** The next `TIPS_PER_SESSION` tips of the pool, starting at the cursor and wrapping round. */
function nextTips(pool, cursor) {
  const count = Math.min(TIPS_PER_SESSION, pool.length);
  return Array.from({ length: count }, (_, i) => pool[(cursor + i) % pool.length].tip);
}

/**
 * Replace this engine's tips in the user's settings with `tips`. Returns false when the settings file could not
 * be read safely, in which case nothing was written.
 */
function applyTips(state, tips) {
  const settings = readJson(userSettingsPath);
  if (settings === null || (settings !== undefined && (typeof settings !== 'object' || Array.isArray(settings)))) return false;
  const current = settings ?? {};

  const override = current.spinnerTipsOverride && typeof current.spinnerTipsOverride === 'object' ? current.spinnerTipsOverride : undefined;
  const existing = Array.isArray(override?.tips) ? override.tips : [];
  const ours = new Set(state.written);
  const theirs = existing.filter((tip) => !ours.has(tip));
  const merged = [...theirs, ...tips.filter((tip) => !theirs.includes(tip))];

  const next = { ...current };
  if (merged.length > 0) {
    next.spinnerTipsOverride = { ...(override ?? {}), tips: merged };
  } else if (override) {
    const { tips: _dropped, ...rest } = override;
    if (Object.keys(rest).length > 0) next.spinnerTipsOverride = rest;
    else delete next.spinnerTipsOverride;
  }

  state.written = tips.filter((tip) => !theirs.includes(tip));
  if (JSON.stringify(next) === JSON.stringify(current)) return true;
  if (settings === undefined && merged.length === 0) return true;

  writeAtomically(userSettingsPath, JSON.stringify(next, null, 2) + '\n');
  return true;
}

/** Write `content` to `file` — through a symlink to its target, via a temp file + rename, keeping the mode. */
function writeAtomically(file, content) {
  let target = file;
  try {
    target = fs.realpathSync(file);
  } catch {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  const temp = `${target}.bespunky-tips-${process.pid}.tmp`;
  let mode;
  try {
    mode = fs.statSync(target).mode;
  } catch {}
  fs.writeFileSync(temp, content, mode === undefined ? undefined : { mode });
  fs.renameSync(temp, target);
}

const commands = {
  rotate() {
    const state = readState();
    const settings = readJson(userSettingsPath);
    const silenced = state.off || settings?.spinnerTipsEnabled === false;
    const pool = silenced ? [] : tipPool();
    const cursor = pool.length ? state.cursor % pool.length : 0;
    const tips = nextTips(pool, cursor);
    if (!applyTips(state, tips)) return;
    state.cursor = pool.length ? (cursor + tips.length) % pool.length : 0;
    writeState(state);
  },
  off() {
    const state = readState();
    state.off = true;
    if (applyTips(state, [])) {
      writeState(state);
      console.log('Toolkit tips are off and have been removed from the spinner.');
    } else {
      console.log(`Could not safely read ${userSettingsPath}; nothing was changed.`);
    }
  },
  on() {
    const state = readState();
    state.off = false;
    writeState(state);
    commands.rotate();
    console.log('Toolkit tips are on; a few now ride in the spinner and rotate each session.');
  },
  list() {
    const state = readState();
    console.log(`Toolkit tips are ${state.off ? 'off' : 'on'}.\n`);
    for (const { plugin, tips } of tipsByPlugin().filter((group) => group.tips.length)) {
      console.log(`## ${plugin}\n${tips.map((tip) => `- ${tip}`).join('\n')}\n`);
    }
  },
};

const command = commands[process.argv[2] ?? 'rotate'];
if (!command) {
  console.error(`Unknown command "${process.argv[2]}". Use one of: ${Object.keys(commands).join(', ')}.`);
  process.exit(2);
}
try {
  command();
} catch (error) {
  // A tip is never worth a failed session start: report on stderr (visible in verbose mode) and exit cleanly.
  console.error(`[bespunky tips] ${error.message}`);
}
