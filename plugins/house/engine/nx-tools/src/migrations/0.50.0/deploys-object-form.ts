// 0.50.0 — a branch model's `deploys` is an OBJECT only: each bare-string note becomes `{ "note": <the string> }`.
//
// WHY. `deploys` (on a line, a line pattern or a tag series in `.bespunky/branches.json`) used to be free text. It
// grew a structured form — `{ note?, ci?, appHosting? }`, which the `ci` layer reads — and the user decided the
// string form goes: "object-only, no compat. Migration should take care of shifting to the new format". The
// branch-and-release engine (workflow plugin, auto-updating) now reports a bare string as an OUTDATED format: the
// model stays in force for `status` and `plan`, but `describe`, `verify`, `validate` and `write` refuse it until it
// is rewritten. This rung is that rewrite, so an upgraded project never meets the refusal.
//
// NOT A MODEL CHANGE. The house rule is that nothing writes the model without a human decision. This is a FORMAT
// shift the user explicitly decided on, and it preserves meaning exactly: the note keeps its text, and a note binds
// nothing, so no binding appears, moves or disappears. The PROJECTION (the only part other readers parse) is
// therefore unchanged — the engine's `deployBindings` ignores a note-only `deploys` in both forms — so it is left
// byte-for-byte, and `verify`'s projection-drift check (invariant 5) still holds after the rewrite.
//
// WHAT IT DOES. Rewrites, in place, every string `deploys` the declaration's vocabulary allows — `integration`,
// each `stages[i]`, `releases`, `hotfixes`, each `tags[i]` — and nothing else: jsonc-parser edits at those paths
// only, so every other byte is kept, and the result is byte-identical to what `branches.mjs write` would write for
// the rewritten model. Each rewrite is reported. A file that is not JSON is the engine's to refuse (it reads it as
// UNREADABLE); it is left and reported, never guessed at.
//
// WHICH COPY. A migration edits the working tree it runs in — the branch the upgrade runs on (the house upgrade
// opens its own worktree off the current branch). The copy IN FORCE is the integration line's; this rewrite
// reaches it the way every change does, when the upgrade's branch lands there. Until then the engine keeps reading
// the in-force copy and names the same rewrite in `status`'s notes. A branch whose tree carries no declaration
// (cut before the model was declared) has nothing here to rewrite — an Nx Tree has no git to reach the integration
// line's copy with — and `status` keeps naming the fix until an upgrade runs from a tree that carries it.
import { type Tree, logger } from '@nx/devkit';
import { applyEdits, modify, parse, type ParseError } from 'jsonc-parser';

const TAG = '[0.50.0 deploys-object-form]';
const FILE = '.bespunky/branches.json';

type Json = Record<string, unknown>;
type Path = (string | number)[];
const isObj = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Every place the declaration allows a `deploys`, with the path that reaches it. */
function deploysPaths(model: Json): Path[] {
  const out: Path[] = [];
  const at = (holder: unknown, path: Path) => {
    if (isObj(holder) && 'deploys' in holder) out.push([...path, 'deploys']);
  };
  at(model['integration'], ['integration']);
  if (Array.isArray(model['stages'])) model['stages'].forEach((s, i) => at(s, ['stages', i]));
  at(model['releases'], ['releases']);
  at(model['hotfixes'], ['hotfixes']);
  if (Array.isArray(model['tags'])) model['tags'].forEach((t, i) => at(t, ['tags', i]));
  return out;
}

const valueAt = (model: Json, path: Path): unknown =>
  path.reduce<unknown>((v, k) => (v === null || typeof v !== 'object' ? undefined : (v as Record<string | number, unknown>)[k]), model);

const field = (path: Path) => path.map((k, i) => (typeof k === 'number' ? `[${k}]` : `${i ? '.' : ''}${k}`)).join('');

export default async function deploysObjectForm(tree: Tree): Promise<void> {
  if (!tree.exists(FILE)) return;
  let text = tree.read(FILE, 'utf8') ?? '';
  const errors: ParseError[] = [];
  const model = parse(text, errors, { allowTrailingComma: false, disallowComments: true });
  if (errors.length || !isObj(model)) {
    logger.warn(`${TAG} ${FILE} is not a JSON object, so its \`deploys\` were not checked — the branch-and-release engine reads it as unreadable; fix it through that skill.`);
    return;
  }

  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const tabs = /\n\t/.test(text);
  const rewritten: string[] = [];
  for (const path of deploysPaths(model)) {
    const note = valueAt(model, path);
    if (typeof note !== 'string') continue;
    text = applyEdits(text, modify(text, path, { note }, { formattingOptions: { insertSpaces: !tabs, tabSize: 2, eol } }));
    rewritten.push(field(path));
  }
  if (!rewritten.length) return;

  tree.write(FILE, text);
  logger.info(
    `${TAG} ${FILE}: ${rewritten.join(', ')} — the bare-string note is now { "note": … } (the same text; a note binds ` +
      'nothing, so the projection is unchanged). Format only, as decided for 0.50.0 — it lands with the rest of this upgrade.',
  );
}
