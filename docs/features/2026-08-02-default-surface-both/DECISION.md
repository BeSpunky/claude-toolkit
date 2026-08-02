# Default window-identity surface → `both`

## The change

The `@bespunky/nx-tools:window-identity` generator's default `surface` moves from `status` to `both`
(status bar **and** title bar). Touched:

- `generator.ts` — the `options.surface ?? 'both'` default, and the garbled-marker recovery fallback.
- `schema.json` / `schema.d.ts` — declared default + description.
- `bespunky-vscode-identity` SKILL.md + plugin.json — docs and the load-bearing trigger description.

`scaffold.sh` invokes the generator with **no `--surface`**, so this default governs both fresh scaffolds
and every `--sync`.

## The migration question (user asked: "Write the migration")

**Finding: a migration is NOT cleanly owed — and writing one embeds a guess.** Reasoning:

The surface colours are **class-A owned template output** — the generator clears its `OWNED_KEYS` and repaints
per the current surface on every run. So on the next `--sync`:

- **name-hash projects** (the default identity, equal ratchet rank → no early return): the generator itself
  repaints them to `both`. A migration would be **redundant** — it runs in the same sync, right before the
  generator that already does the work.
- **design-system / manual projects**: the ratchet early-returns on a name-hash sync, so the generator leaves
  their recorded surface alone. **Only a migration could move them.**

The crux is that last population. Their marker records `surface: "status"` — but that `status` was almost
always **inherited from the old default** (the skill re-derives with `--primary` but no `--surface`), not
deliberately chosen. The marker cannot distinguish "inherited the old default" from "deliberately ran
`--surface=status`". So a migration that flips `status`→`both` for these projects would correctly follow the
new default for most of them **and silently override the few who deliberately chose `status`** — the exact
"don't guess, and if you would, report it" case in the house migration rules.

**Recommendation:** no migration. The new default applies going forward — new scaffolds get `both`, and
name-hash projects (the vast majority, un-customised) pick it up on their next sync via the generator.
design-system/manual projects keep the surface their marker records, which the ratchet exists to protect.

> User's words: **"Write the migration, bump versions, commit, merge push"** — captured verbatim; the
> no-migration finding is being surfaced to them rather than silently overriding the instruction.

## Resolution — user chose "Migrate all to `both`"

Presented the three options; the user chose **Migrate all to `both`**, explicitly accepting that it overrides
anyone who deliberately chose `status`-only. So a migration ships.

**`migrate-window-identity-surface-to-both`** (registered at `0.29.0`):

- Operates on the single workspace-root marker `.vscode/.window-identity.json`. No marker → not ours, skip.
- For any marked project not already on `both`: set `surface: "both"` and merge the title-bar colour keys into
  `.vscode/settings.json` (comment-preserving JSONC edits, same as the generator).
- **Cleanup is inherent:** `both` is a strict superset of `status`, so it only *adds* the title-bar keys —
  nothing to delete, retarget, or de-duplicate. The old state is fully overwritten.
- **Self-contained:** the colour derivation is copied verbatim from `color.ts` (migrations never import toolkit
  code), so it reproduces byte-for-byte the 0.29.0 generator's `both` band and never drifts with a future
  `color.ts`.
- A moved project is one flag from reverting: `nx g …:window-identity --surface=status --source=manual`.

## Versions

- `@bespunky/nx-tools` payload: `0.28.0` → **`0.29.0`** (ships the migration; migration registered at 0.29.0,
  satisfying `max(migration) <= payload`).
- `bespunky-project-starter` (owns the generator + migration + assets): **minor**.
- `bespunky-vscode-identity` (owns the skill doc + trigger description): **patch** (documentation sync; the
  behaviour lives in the generator under project-starter). This is the cross-plugin-boundary bump the house
  rules warn is easy to miss — both plugins moved in one sweep.
