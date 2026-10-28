// THE PROJECT'S CLAUDE CODE SETTINGS — `.claude/settings.json`, read in one place.
//
// The `claude-settings` generator (the agent layer's step) writes it; every generator that writes a pointer to a toolkit
// skill or command reads it, because it is the one fact about which plugins this project actually ENABLES. A layer's
// `claudePlugins` is only a declaration — nothing enables it unless the agent layer wrote the settings, or the
// project enabled a plugin itself — so a doc gated on the declaration would still tell a project without the agent
// layer to invoke a skill it does not have.
import { type Tree } from '@nx/devkit';

export const CLAUDE_SETTINGS = '.claude/settings.json';

type Json = Record<string, unknown>;

/**
 * The settings as a plain object. A file that doesn't exist — or that a human has left unparseable — yields
 * `undefined`: the writer treats it as "nothing to preserve", a reader as "nothing enabled".
 */
export function readClaudeSettings(tree: Tree): Json | undefined {
  if (!tree.exists(CLAUDE_SETTINGS)) return undefined;
  try {
    const parsed: unknown = JSON.parse(tree.read(CLAUDE_SETTINGS, 'utf8') ?? '');
    return isPlainObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** The names of the plugins this project enables (`enabledPlugins` keys set to `true`, `@marketplace` dropped). */
export function enabledPlugins(tree: Tree): Set<string> {
  const enabled = readClaudeSettings(tree)?.enabledPlugins;
  if (!isPlainObject(enabled)) return new Set();
  return new Set(Object.entries(enabled).filter(([, on]) => on === true).map(([id]) => id.split('@')[0]));
}

export function isPlainObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
