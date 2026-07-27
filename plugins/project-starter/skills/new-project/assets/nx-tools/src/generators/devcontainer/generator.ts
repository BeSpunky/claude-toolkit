// House generator: write the BeSpunky-standard .devcontainer/devcontainer.json.
// Reads its own bundled template (not a workspace file) and writes through the Nx Tree.
//
// Template supports two kinds of placeholders:
//   - simple substitution:   {{name}}, {{nodeMajor}}, {{forwardPorts}}, {{portsAttributes}}
//   - conditional blocks:    {{#flag}}...{{/flag}}  -> included iff the flag option is truthy
//
// The flags are the LAYERS this devcontainer serves (`web`, `angular`, `firebase`) plus the one host axis
// (`voice`). They are passed in by the caller, which detects them — this generator never guesses.
//
// TWO properties earn the extra machinery here:
//
// 1. COMMAS ARE THE GENERATOR'S PROBLEM, NOT THE TEMPLATE AUTHOR'S. Wrapping JSON members in conditional
//    blocks means every block boundary is a potential `[, 4200]` or `{"a":1,}`. Hand-placing commas so that
//    every combination of four flags stays valid is 16 cases a template author has to hold in their head,
//    and the failure mode is a container that won't build. So the template writes members naively and the
//    generator NORMALIZES dangling commas afterwards, then PARSES the result and throws if it isn't valid —
//    a template mistake fails here, loudly, at generation time, instead of at someone's next rebuild.
//
// 2. MERGE INTO A FOREIGN DEVCONTAINER, never clobber it (the claude-settings lesson, applied to the file
//    with the most to lose). A sync run on an EXISTING repo — the whole point of layering — will usually
//    find a .devcontainer/devcontainer.json somebody wrote by hand, with their image, their features, their
//    extensions. Overwriting it is the single most destructive thing this tool could do. So: a file we
//    wrote is regenerated (we own it), and a file we did NOT write is treated as the user's, and we only
//    ADD what's missing.
import { type Tree, logger, parseJson } from '@nx/devkit';
import { applyEdits, modify } from 'jsonc-parser';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { NOVNC_BAND_LABEL, novncPortsAttributesJson } from '../shared-browser/novnc-band';

type Json = Record<string, unknown>;

interface DevcontainerSchema {
  name: string;
  nodeMajor?: string | number;
  /** Layer: a project with something to serve — :80 worktree domains, the shared browser, Playwright. */
  web?: boolean;
  /** Layer: Angular — the editor extensions and the 4200 dev-server port label. */
  angular?: boolean;
  /** Layer: Firebase — CLI features, emulator ports, the JDK note. */
  firebase?: boolean;
  /** Host axis (WSL only), not a layer: the WSLg PulseAudio bridge. */
  voice?: boolean;
}

const DEVCONTAINER = '.devcontainer/devcontainer.json';
const MARKER = '.devcontainer/.bespunky-devcontainer.json';

export default async function devcontainerGenerator(
  tree: Tree,
  options: DevcontainerSchema
): Promise<void> {
  if (!options.name) {
    throw new Error('devcontainer generator requires --name (the devcontainer / project name).');
  }
  // Default the image tag to the Node major we are running under (the base image), if not given.
  const nodeMajor = String(options.nodeMajor ?? process.versions.node.split('.')[0]);
  const flags: Record<string, boolean> = {
    web: options.web ?? true,
    angular: options.angular ?? false,
    firebase: !!options.firebase,
    voice: !!options.voice,
  };

  const rendered = render(
    readFileSync(join(__dirname, 'devcontainer.json.tpl'), 'utf8'),
    options.name,
    nodeMajor,
    flags
  );

  // OWNERSHIP. The marker separates "regenerate the file we maintain" from "adopt somebody else's" — and it
  // records that as an EXPLICIT `owned` flag, not as its own existence.
  //
  // Deriving ownership from the marker merely EXISTING is a trap this fell into: the marker was written on
  // both paths, so the run after an adoption saw a marker, concluded it owned the file, and overwrote the
  // devcontainer it had carefully merged into the run before. The guarantee held for exactly one run — the
  // worst kind of bug, because a single-run test passes and the damage lands on somebody's second sync.
  //
  // A missing `owned` on an existing marker reads as NOT owned. That is the safe direction: the cost of
  // being wrong is an additive merge where a regeneration would have done (recoverable, visible in the
  // report below), against overwriting a file we don't own (not recoverable without the backup tag).
  const marker = readMarker(tree);
  const ours = marker?.owned === true;
  const exists = tree.exists(DEVCONTAINER);
  const owning = !exists || ours;

  let skipped: string[] = [];
  if (owning) {
    tree.write(DEVCONTAINER, rendered);
  } else {
    skipped = mergeIntoForeign(tree, rendered);
  }

  writePostCreate(tree, owning);

  // The ADOPTION REPORT. An adopted devcontainer diverges from the house spec on every key it already
  // declared, permanently and by design — the merge is additive and never argues with the project's own
  // choices. Until now the only trace of that was a log line that scrolled past, so the divergence grew
  // with nothing to see it. Recording the skipped keys makes it a fact a human (or the SessionStart hook)
  // can look at and decide about. It is a RECORD, never an input: the next run re-reads the files and
  // recomputes the whole thing, exactly as with the layer stamp.
  const record: Json = {
    generator: '@bespunky/nx-tools:devcontainer',
    owned: owning,
    flags,
  };
  if (!owning) {
    record.adopted = {
      note:
        'This devcontainer.json was written by the project, not by this generator, so house settings are ' +
        'only ADDED, never changed. The keys below already had project values and were left alone — apply ' +
        'any of them by hand if you want the house behaviour.',
      skipped,
    };
  }
  tree.write(MARKER, `${JSON.stringify(record, null, 2)}\n`);
}

interface Marker {
  owned?: boolean;
}

/** The ownership marker, or `null` when absent/unparseable (both of which mean "we don't own this"). */
function readMarker(tree: Tree): Marker | null {
  if (!tree.exists(MARKER)) return null;
  const parsed = tryParse(tree.read(MARKER, 'utf8') ?? '');
  return parsed ? (parsed as Marker) : null;
}

/**
 * The companion script — `.devcontainer/post-create.sh` — owns all multi-step setup so
 * devcontainer.json's postCreateCommand stays a one-liner. It is self-adapting (its Firebase, Playwright,
 * Angular and voice steps each detect their own trigger at run time), so it ships verbatim, untemplated.
 *
 * `owned` decides where it lands. Overwriting a post-create script somebody else wrote would delete their
 * provisioning with no warning and no undo — strictly worse than the devcontainer.json case, because a
 * shell script's contents can't be merged meaningfully. So a foreign entry point is left ALONE and the
 * house script is written BESIDE it, with the one line needed to chain them printed for a human to place.
 * That is the same "detect, don't execute" line the SessionStart hook holds: report the fact, let the
 * person who owns the file make the edit.
 */
function writePostCreate(tree: Tree, owned: boolean): void {
  const house = readFileSync(join(__dirname, 'post-create.sh.tpl'), 'utf8');
  const HOUSE_PATH = '.devcontainer/post-create.sh';
  const BESIDE_PATH = '.devcontainer/post-create.bespunky.sh';

  if (owned || !tree.exists(HOUSE_PATH)) {
    tree.write(HOUSE_PATH, house);
    // The extension point's other half: create it ONCE so it is discoverable, and never touch it again.
    // An empty seam nobody knows about is not a seam.
    if (!tree.exists(LOCAL_PATH)) tree.write(LOCAL_PATH, LOCAL_STUB);
    return;
  }

  tree.write(BESIDE_PATH, house);
  logger.info(
    `[devcontainer] \`${HOUSE_PATH}\` already exists and was not written by this generator, so it was left ` +
      `untouched. The house setup is in \`${BESIDE_PATH}\` — chain it by adding this line to your own script:\n` +
      `    bash .devcontainer/post-create.bespunky.sh`
  );
}

const LOCAL_PATH = '.devcontainer/post-create.local.sh';

const LOCAL_STUB = `#!/usr/bin/env bash
# Project-specific devcontainer setup. THIS FILE IS YOURS.
#
# .devcontainer/post-create.sh is generated by @bespunky/nx-tools and is overwritten on every
# \`scaffold.sh --sync\`. This file is created once and never regenerated, so anything you put here
# survives. It runs LAST, after workspace deps, Claude plugins and every house prerequisite — so you can
# assume a working environment.
#
# Runs in a subshell; a non-zero exit warns rather than failing the container build.
set -euo pipefail

# Example — install a project-specific tool:
# sudo apt-get update -qq && sudo apt-get install -y --no-install-recommends postgresql-client
`;

/**
 * Template -> final JSONC text: expand conditional blocks, substitute placeholders, sync the commas the
 * blocks left behind, and PROVE the result parses.
 */
function render(template: string, name: string, nodeMajor: string, flags: Record<string, boolean>): string {
  // 1) Conditional blocks: {{#flag}}body{{/flag}} -> body if flag truthy, else removed.
  const expanded = template.replace(
    /\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
    (_, flag: string, body: string) => (flags[flag] ? body : '')
  );

  // 2) Simple placeholders. forwardPorts and portsAttributes are COMPUTED rather than written as
  //    conditional template text: they are pure data with no interleaved comments, and computing them is
  //    what keeps the port list and its labels from drifting apart across four flag combinations.
  //    The noVNC band in particular comes from the SHARED band constants, never hand-written here — an
  //    entry missing for a port the allocator can pick is precisely a port that fails silently.
  const content = expanded
    .split('{{name}}')
    .join(name)
    .split('{{nodeMajor}}')
    .join(nodeMajor)
    .split('{{forwardPorts}}')
    .join(forwardPortsJson(flags))
    .split('{{portsAttributes}}')
    .join(portsAttributesJson(flags))
    .split('{{novncBand}}')
    .join(NOVNC_BAND_LABEL);

  const normalized = normalizeCommas(content);

  // 3) PROVE it. Every flag combination has to produce parseable JSONC, and the only moment we can cheaply
  //    find out is now. Without this check a bad block boundary ships a devcontainer.json that fails at
  //    `Rebuild Container`, with an error pointing at a line the author never wrote.
  try {
    parseJson(normalized);
  } catch (error) {
    throw new Error(
      `[devcontainer] The rendered devcontainer.json is not valid JSONC for flags ` +
        `(${Object.entries(flags).filter(([, on]) => on).map(([f]) => f).join(', ') || 'none'}): ` +
        `${(error as Error).message}\n` +
        `This is a bug in devcontainer.json.tpl's conditional blocks, not in the workspace.`
    );
  }

  return normalized;
}

/**
 * Remove the commas conditional blocks orphan: before a closing bracket, after an opening one, and doubled
 * between two removed members. String-aware, so a comma inside a value (a mount spec, a label) is never
 * touched — the reason this is a small parser rather than three regexes.
 */
function normalizeCommas(source: string): string {
  const out: string[] = [];
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    const next = source[i + 1];

    if (inLineComment) {
      out.push(char);
      if (char === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      out.push(char);
      if (char === '*' && next === '/') {
        out.push(next);
        i++;
        inBlockComment = false;
      }
      continue;
    }
    if (inString) {
      out.push(char);
      if (char === '\\') {
        // Escape: consume the next character verbatim so a \" can't end the string.
        if (next !== undefined) {
          out.push(next);
          i++;
        }
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      out.push(char);
      continue;
    }
    if (char === '/' && next === '/') {
      inLineComment = true;
      out.push(char);
      continue;
    }
    if (char === '/' && next === '*') {
      inBlockComment = true;
      out.push(char);
      continue;
    }

    if (char === ',') {
      // Drop this comma when the next meaningful character closes the container (dangling), or when the
      // previous meaningful character opened it / was itself a comma (leading or doubled).
      const nextMeaningful = peekMeaningful(source, i + 1);
      const prevMeaningful = lastMeaningful(out);
      if (
        nextMeaningful === ']' ||
        nextMeaningful === '}' ||
        nextMeaningful === ',' ||
        prevMeaningful === '[' ||
        prevMeaningful === '{' ||
        prevMeaningful === ',' ||
        prevMeaningful === undefined
      ) {
        continue;
      }
    }

    out.push(char);
  }

  // Collapse the blank-line runs a removed block leaves behind, so the output reads as if it were written
  // for these flags rather than edited down to them.
  return out.join('').replace(/\n[ \t]*\n[ \t]*\n+/g, '\n\n');
}

/**
 * The next non-whitespace, non-comment character from `start`, or undefined at end of input.
 *
 * Skipping COMMENTS is the part that matters: this file is dense with them, and a member removed by a
 * conditional block routinely leaves its comma separated from the closing bracket by a paragraph of prose.
 * A scan that stopped at the first `/` would call that comma load-bearing and leave `{,}` behind.
 */
function peekMeaningful(source: string, start: number): string | undefined {
  let i = start;
  while (i < source.length) {
    const char = source[i];
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      i++;
      continue;
    }
    if (char === '/' && source[i + 1] === '/') {
      const end = source.indexOf('\n', i);
      if (end === -1) return undefined;
      i = end + 1;
      continue;
    }
    if (char === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i);
      if (end === -1) return undefined;
      i = end + 2;
      continue;
    }
    return char;
  }
  return undefined;
}

/**
 * The last emitted non-whitespace character.
 *
 * Unlike the forward scan this does NOT skip backwards over comments — and doesn't need to. It exists only
 * to catch a LEADING or DOUBLED comma, where the preceding character is `[`, `{` or `,` directly. If a
 * comment happens to precede the comma, the scan returns some prose character, which matches none of those
 * and so keeps the comma — the safe direction: this pass only ever deletes a comma it is sure about, and
 * anything it wrongly keeps is caught by the parse check.
 */
function lastMeaningful(out: string[]): string | undefined {
  for (let i = out.length - 1; i >= 0; i--) {
    const char = out[i];
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') continue;
    return char;
  }
  return undefined;
}

interface Port {
  port: number;
  label: string;
  onAutoForward: 'silent' | 'notify' | 'openPreview';
  /**
   * Forward at the SAME host number? Only for ports something OUTSIDE the container dials by a hardcoded
   * address (the Firebase SDK in a host-loaded page). Everything else is left to auto-forward, which is
   * free to remap — and a port that is labelled but not forwarded still gets its `onAutoForward` behaviour.
   */
  forward: boolean;
}

/**
 * The ports this devcontainer cares about — ONE list, from which both `forwardPorts` and `portsAttributes`
 * are derived. They were two hand-maintained lists gated on different flags, which is why `firebase` without
 * `angular` used to forward 4200 and then not label it. One list makes that class of drift unrepresentable.
 */
function ports(flags: Record<string, boolean>): Port[] {
  const list: Port[] = [];

  if (flags.web) {
    list.push({
      port: 80,
      label: 'Worktree domains (pretty <slug>.localhost URLs)',
      onAutoForward: 'silent',
      forward: true,
    });
  }

  // The dev server is labelled whenever there IS one — but only Firebase needs it pinned to the same host
  // port (the SDK inside a host-loaded page dials hardcoded localhost addresses; see the template).
  if (flags.angular || flags.firebase) {
    list.push({
      port: 4200,
      label: flags.angular ? 'Angular Dev Server' : 'Dev Server',
      onAutoForward: 'openPreview',
      forward: !!flags.firebase,
    });
  }

  if (flags.firebase) {
    list.push(
      { port: 4000, label: 'Firebase Emulator UI', onAutoForward: 'notify', forward: true },
      { port: 9099, label: 'Auth Emulator', onAutoForward: 'silent', forward: true },
      { port: 8080, label: 'Firestore Emulator', onAutoForward: 'silent', forward: true },
      { port: 9150, label: 'Firestore WebSocket', onAutoForward: 'silent', forward: true },
      { port: 9199, label: 'Storage Emulator', onAutoForward: 'silent', forward: true },
      { port: 5001, label: 'Functions Emulator', onAutoForward: 'silent', forward: true }
    );
  }

  return list;
}

function forwardPortsJson(flags: Record<string, boolean>): string {
  return `[${ports(flags)
    .filter((entry) => entry.forward)
    .map((entry) => entry.port)
    .join(', ')}]`;
}

function portsAttributesJson(flags: Record<string, boolean>): string {
  const lines = ports(flags).map(
    ({ port, label, onAutoForward }) => `    "${port}": { "label": "${label}", "onAutoForward": "${onAutoForward}" }`
  );

  // The noVNC band is emitted as ONE EXACT KEY PER PORT by the shared band module — never hand-written
  // here, and never as a range (see the template for why a range silently loses `requireLocalPort`).
  if (flags.web) lines.splice(1, 0, novncPortsAttributesJson());

  return `{\n${lines.join(',\n')}\n  }`;
}

/**
 * ADDITIVE merge into a devcontainer.json this generator did not write.
 *
 * The rule is deliberately one-way: add what is missing, never change or remove what is there. A repo that
 * already has a devcontainer has already made choices — its base image, its Node version, its own
 * postCreateCommand — and those choices are almost always load-bearing for a project this generator knows
 * nothing about. Adding an extension it lacks is a courtesy; changing its image is a breakage.
 *
 * The cost is honest and worth naming: an adopted devcontainer does NOT get house updates to keys it
 * already defines. So the skipped keys are REPORTED rather than silently dropped — and returned, so the
 * caller can persist them. The reader can then apply any of them by hand, which is a decision they are
 * equipped to make and this generator is not.
 *
 * Returns the dotted paths that were left as the project had them.
 */
function mergeIntoForeign(tree: Tree, rendered: string): string[] {
  const existingText = tree.read(DEVCONTAINER, 'utf8') ?? '{}';
  const existing = tryParse(existingText);
  const house = tryParse(rendered);

  if (!existing || !house) {
    logger.warn(
      `[devcontainer] \`${DEVCONTAINER}\` exists but could not be parsed as JSONC, so it was left exactly ` +
        `as-is. Fix or remove it and re-run to get the house devcontainer.`
    );
    return [];
  }

  const added: string[] = [];
  const skipped: string[] = [];
  let text = existingText;

  const edit = (path: (string | number)[], value: unknown) => {
    // An EMPTY container is not an addition, it's noise — `"forwardPorts": []` in a repo that forwards
    // nothing tells the reader less than the absent key did.
    if (isEmptyContainer(value)) return;
    text = applyEdits(text, modify(text, path, value, { formattingOptions: JSONC_FORMAT }));
    added.push(path.join('.'));
  };

  /**
   * Append missing array members ONE AT A TIME, in place.
   *
   * Replacing the whole array would re-serialize it — and take out every comment written BETWEEN its
   * members, which in a devcontainer.json is where people explain why a mount exists. jsonc-parser's
   * array insertion splices a single element at an index and leaves the rest of the text untouched.
   */
  const appendMissing = (path: (string | number)[], house: unknown[], current: unknown[]) => {
    const missing = house.filter((item) => !current.some((have) => sameMember(have, item)));
    let at = current.length;
    for (const item of missing) {
      text = applyEdits(
        text,
        modify(text, [...path, at], item, { formattingOptions: JSONC_FORMAT, isArrayInsertion: true })
      );
      added.push(`${path.join('.')}[+${JSON.stringify(item).slice(0, 40)}]`);
      at++;
    }
  };

  for (const [key, value] of Object.entries(house)) {
    if (!(key in existing)) {
      edit([key], value);
      continue;
    }
    // Present already — recurse one useful level into the containers where "missing sub-key" is the
    // common, safe case, and leave scalars strictly alone.
    if (isPlainObject(value) && isPlainObject(existing[key])) {
      mergeObject(key, value, existing[key] as Json, edit, appendMissing, skipped);
    } else if (Array.isArray(value) && Array.isArray(existing[key])) {
      appendMissing([key], value, existing[key] as unknown[]);
    } else if (!sameValue(value, existing[key])) {
      skipped.push(key);
    }
  }

  tree.write(DEVCONTAINER, text);

  logger.info(
    `[devcontainer] Adopted the existing \`${DEVCONTAINER}\` (not generator-written) — merged additively.\n` +
      `  added:      ${added.length ? added.join(', ') : '(nothing — already complete)'}\n` +
      `  left as-is: ${skipped.length ? skipped.join(', ') : '(nothing)'}\n` +
      `  (recorded in \`${MARKER}\` — this project keeps its own values for those keys)`
  );

  return skipped;
}

/** Merge one nested object level: add absent keys, recurse into objects, union arrays, keep scalars. */
function mergeObject(
  prefix: string,
  house: Json,
  existing: Json,
  edit: (path: (string | number)[], value: unknown) => void,
  appendMissing: (path: (string | number)[], house: unknown[], current: unknown[]) => void,
  skipped: string[]
): void {
  for (const [key, value] of Object.entries(house)) {
    const path = [prefix, key];
    if (!(key in existing)) {
      edit(path, value);
      continue;
    }
    if (isPlainObject(value) && isPlainObject(existing[key])) {
      // One more level covers customizations.vscode.{extensions,settings}, which is where the depth is.
      for (const [inner, innerValue] of Object.entries(value)) {
        const innerPath = [...path, inner];
        const have = (existing[key] as Json)[inner];
        if (have === undefined) edit(innerPath, innerValue);
        else if (Array.isArray(innerValue) && Array.isArray(have)) appendMissing(innerPath, innerValue, have);
        else if (isPlainObject(innerValue) && isPlainObject(have)) {
          for (const [leaf, leafValue] of Object.entries(innerValue)) {
            if (!(leaf in (have as Json))) edit([...innerPath, leaf], leafValue);
            else if (!sameValue(leafValue, (have as Json)[leaf])) skipped.push([...innerPath, leaf].join('.'));
          }
        } else if (!sameValue(innerValue, have)) skipped.push(innerPath.join('.'));
      }
      continue;
    }
    if (Array.isArray(value) && Array.isArray(existing[key])) {
      appendMissing(path, value, existing[key] as unknown[]);
      continue;
    }
    if (!sameValue(value, existing[key])) skipped.push(path.join('.'));
  }
}

/**
 * Do the project's value and the house value already AGREE?
 *
 * This is what makes the adoption report mean "where this project DIVERGES from the house" rather than the
 * far less useful "which keys happened to exist". Without it the report grew on the second run: keys the
 * FIRST run added were then present, so they were re-reported as left-as-is — listing settings that had in
 * fact been applied, which is precisely the confusion the report exists to remove. Structural equality,
 * since these are config values (scalars, small arrays and objects), not identities.
 */
function sameValue(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/** An empty array or empty object — something whose addition would carry no information. */
function isEmptyContainer(value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0;
  return isPlainObject(value) && Object.keys(value).length === 0;
}

/**
 * Are two array members "the same thing"? Exact equality for scalars; for a MOUNT string, equality of its
 * `target=` — because a mount that targets the same path is the same mount however its source is spelled,
 * and adding a second one for the same target is what breaks a container rather than enriching it.
 */
function sameMember(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'string' && typeof b === 'string') {
    const target = (s: string) => /(?:^|,)target=([^,]+)/.exec(s)?.[1];
    const ta = target(a);
    const tb = target(b);
    if (ta && tb) return ta === tb;
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

const JSONC_FORMAT = { tabSize: 2, insertSpaces: true, eol: '\n' };

function tryParse(source: string): Json | undefined {
  try {
    const parsed: unknown = parseJson(source);
    return isPlainObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isPlainObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
