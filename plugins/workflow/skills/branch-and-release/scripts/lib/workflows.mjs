// Reading CI workflow files — crudely, without a YAML parser, which is why every fact built on them is `inferred`.
import fs from 'node:fs';
import path from 'node:path';

export const WORKFLOW = /^\.github\/workflows\/[^/]+\.ya?ml$/;

/** Every tracked workflow under `top`: [{ file, text }]. */
export function workflows(git, top) {
  return git.lines(['ls-files']).filter((f) => WORKFLOW.test(f)).map((file) => ({ file, text: fs.readFileSync(path.join(top, file), 'utf8') }));
}

/** The literal (glob-free) branch names a workflow's `push` trigger targets. */
export const pushTargets = (text) => workflowTriggers(text).filter((t) => t.event === 'push' && t.filter === 'branches').flatMap((t) => t.values).filter((v) => !/[*?[!]/.test(v));

/** Crude `on:` read: [{ event, filter, values }]. Not a YAML parser — hence `inferred`. */
export function workflowTriggers(text) {
  const out = [];
  const lines = text.split('\n');
  let event = null;
  let eventIndent = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\s+#.*$/, '');
    const indent = line.search(/\S/);
    if (indent < 0) continue;
    const ev = /^\s*(push|pull_request|pull_request_target|release|workflow_run)\s*:/.exec(line);
    if (ev) {
      event = ev[1];
      eventIndent = indent;
      continue;
    }
    if (event && indent <= eventIndent) event = null;
    const f = /^\s*(branches|branches-ignore|tags|tags-ignore)\s*:\s*(.*)$/.exec(line);
    if (!f || !event) continue;
    let values = [];
    if (f[2].startsWith('[')) values = f[2].replace(/[[\]]/g, '').split(',');
    else if (f[2]) values = [f[2]];
    else
      for (let j = i + 1; j < lines.length; j++) {
        const item = /^\s*-\s*(.+)$/.exec(lines[j]);
        if (!item) break;
        values.push(item[1]);
      }
    out.push({ event, filter: f[1], values: values.map((v) => v.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) });
  }
  return out;
}

/** Which long-lived lines a trigger's branch filter selects, and whether that makes it line-specific. A test
 *  workflow that fires on every long-lived line binds none of them; one that fires on a single line does. */
export function triggerScope(trigger, longLived) {
  if (trigger.filter !== 'branches') return { lines: [], scope: trigger.filter.startsWith('tags') ? 'tags' : 'ignore-filter' };
  const lines = longLived.filter((n) => trigger.values.some((v) => globRe(v).test(n)));
  const scope = !lines.length ? 'no long-lived line' : lines.length === 1 ? 'exclusive' : lines.length === longLived.length ? 'shared: every long-lived line' : 'shared';
  return { lines, scope };
}

const globRe = (g) => new RegExp(`^${g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*').replace(/\?/g, '.')}$`);

const DEPLOY = [/\b(npm|yarn|pnpm) publish\b/i, /\bfirebase deploy\b/i, /\bgh release create\b/i, /\bdocker push\b/i, /\bkubectl (apply|rollout)\b/i, /\bterraform apply\b/i, /\bnetlify deploy\b/i, /\bvercel\b.*--prod\b/i, /\bsemantic-release\b/i, /\bdeploy/i, /\bpublish/i];
/** Crude "does this workflow ship something?": deploy/publish words in the jobs (comments stripped). */
export function deploySignals(text) {
  const jobs = text.split(/^jobs\s*:/m)[1] ?? '';
  const found = new Set();
  for (const line of jobs.split('\n')) {
    const code = line.replace(/(^|\s)#.*$/, '');
    for (const re of DEPLOY) {
      const m = re.exec(code);
      if (m) found.add(m[0].toLowerCase());
    }
  }
  return [...found];
}

