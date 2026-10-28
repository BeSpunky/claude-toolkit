// POINTERS TO TOOLKIT SKILLS AND COMMANDS, rendered only where the project ENABLES them.
//
// A file the house writes into a project is read by Claude (and the human) as instructions. A sentence that sends
// the reader to `bespunky-<plugin>:<skill>` — or to a `/bespunky-<plugin>:<command>` — in a project that does not
// enable that plugin points at nothing: the skill never loads, the command does not exist, and the reader has no way
// to tell. So each such pointer is a TOKEN in its template, filled from the one enablement fact (`.claude/settings.json`
// `enabledPlugins`, read by claude-settings-file) — the pointer when the plugin is on; when it is off, nothing, or
// the plain wording the sentence needs (house-doc's `{{^…}}` alternative). Each value is a fragment that begins with
// its own punctuation and attaches straight after the word before it. The rule for the off value: the sentence must
// still be ACTIONABLE — `''` where the pointer was only a reference, and the same means without the plugin (the
// `house.sh` command a layer's own hint names) where the pointer WAS the means.
//
// Enablement is read when the file is written, so a write-once file rendered before the agent layer's
// `claude-settings` step has run (a migration, or a per-app step on a project gaining the agent layer in the same
// run) keeps the plugin-off text: it errs towards naming nothing, never towards naming what is absent.
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
  return pointerValues(pointers, (plugin) => enabled.has(plugin));
}

/** A renderer that fills every `{{token}}` of `pointers` in a template (other text untouched). */
export function pluginPointerRenderer(tree: Tree, pointers: PluginPointers): (template: string) => string {
  return fill(pluginPointerValues(tree, pointers));
}

/**
 * The same renderer for a stated enablement instead of the project's — for a migration that must recognise a file
 * as it was seeded under ANOTHER enablement (e.g. before pointers were gated, every one was on).
 */
export function pointerRendererFor(pointers: PluginPointers, isEnabled: (plugin: string) => boolean): (template: string) => string {
  return fill(pointerValues(pointers, isEnabled));
}

function pointerValues(pointers: PluginPointers, isEnabled: (plugin: string) => boolean): Record<string, string> {
  return Object.fromEntries(
    Object.entries(pointers).map(([token, [plugin, text, otherwise = '']]) => [token, isEnabled(plugin) ? text : otherwise]),
  );
}

function fill(values: Record<string, string>): (template: string) => string {
  const entries = Object.entries(values);
  return (template) => entries.reduce((out, [token, value]) => out.split(`{{${token}}}`).join(value), template);
}
