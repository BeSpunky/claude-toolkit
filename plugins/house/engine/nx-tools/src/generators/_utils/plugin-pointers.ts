// POINTERS TO TOOLKIT SKILLS AND COMMANDS, rendered only where the project ENABLES them.
//
// A file the house writes into a project is read by Claude (and the human) as instructions. A sentence that sends
// the reader to `bespunky-<plugin>:<skill>` — or to a `/bespunky-<plugin>:<command>` — in a project that does not
// enable that plugin points at nothing: the skill never loads, the command does not exist, and the reader has no way
// to tell. So each such pointer is a TOKEN in its template, filled from the one enablement fact (`.claude/settings.json`
// `enabledPlugins`, read by claude-settings-file) — the pointer when the plugin is on; when it is off, nothing, or
// the plain wording a pointer-less sentence needs (house-doc's `{{^…}}` alternative). The sentence around the token
// is written to read whole either way: the token only ever carries the POINTER, never the instruction it is
// attached to, so a project without the plugin keeps every instruction and loses only the dead reference.
//
// house-doc gates whole sections with its own `{{#plugin-<name>}}` blocks; the generators here keep the
// substitution mechanism they already had and are handed values from this table instead.
import { type Tree } from '@nx/devkit';
import { enabledPlugins } from './claude-settings-file';

/**
 * token → the plugin that must be enabled, the text the token renders to when it is, and (optionally) the plain
 * wording it renders to when it is not — `''` when the sentence reads whole without the pointer.
 */
export type PluginPointers = Readonly<Record<string, readonly [plugin: string, text: string, otherwise?: string]>>;

/** Each pointer's text when its plugin is enabled in this project, its plain alternative when it is not. */
export function pluginPointerValues(tree: Tree, pointers: PluginPointers): Record<string, string> {
  const enabled = enabledPlugins(tree);
  return Object.fromEntries(
    Object.entries(pointers).map(([token, [plugin, text, otherwise = '']]) => [token, enabled.has(plugin) ? text : otherwise]),
  );
}

/** A renderer that fills every `{{token}}` of `pointers` in a template (other text untouched). */
export function pluginPointerRenderer(tree: Tree, pointers: PluginPointers): (template: string) => string {
  const values = Object.entries(pluginPointerValues(tree, pointers));
  return (template) => values.reduce((out, [token, value]) => out.split(`{{${token}}}`).join(value), template);
}
