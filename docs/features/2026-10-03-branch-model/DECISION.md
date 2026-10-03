# branch-model — decision (draft, awaiting sign-off)

## The concept

**The method is invariant; the pipeline is a declared project fact.** Worktree per effort, rebase at the
single divergence point, fast-forward-only promotions, every promotion human-gated — none of that depends on
how many branches there are. What varies is the ordered pipeline from the *integration* branch (where
features land) to the *production* branch, each rung with its role and its deploy binding. Trunk-only is the
degenerate case: integration == production, a release is a tag.

## The declaration

`.bespunky/branches.json` (beside `dev.json`), committed. Class **(C)**-like in ownership — written only on a
human decision, never by a generator or a migration — and read by everything that today hard-codes names:
house-doc (renders the rules/parameters with the real names), the `branch-and-release` skill (speaks in roles,
resolves names from the file), `scaffold.sh`'s protected-branch preflight, and the `--staging` bundle.

## No declaration → investigate and ASK (never infer silently)

The user: *"At any point - no json means asking the user."* So:

- **No migration writes the file.** Migrations run unattended; this is a decision. (Supersedes my first
  proposal, which had a migration record "three-line" for every existing project.)
- **Any reader that finds no file stops and asks** — the skill before a branch/promotion action, the sync.
  House-doc renders a "branch model not yet declared — investigate and ask before any branch or promotion
  action" rule in its place.
- **`/sync` runs the investigation.** `scaffold.sh` (a mechanism, not a judge) reports the absence as a
  structured verdict; the Claude-driven `/sync` command then runs the investigation procedure and proposes a
  model. One procedure, shared with the skill (a `reference/` file), not two.

### The investigation — evidence beyond the branch list

The user: *"should not rely on current branches alone"* — projects scaffolded under the fixed model all *have*
`development`/`staging`/`main`, whether they need them or not. So the question is whether each rung **justifies
itself**:

- **Bindings:** does anything fire on the rung? CI workflow triggers (`on: push: branches`), deploy configs
  (App Hosting backends, `apphosting.<env>.yaml`, environment files), GitHub environments, branch protection.
- **Usage history:** was it ever a real gate? Times `staging` sat ahead of `main` and for how long; promotions
  that were always immediate back-to-back (ceremony) vs. separated (a gate in use); direct commits on
  protected rungs; tags; who/what pushed.
- **Verdict per rung:** justified / ceremonial / unused, with the evidence — then a proposed model, and the
  user decides.

## Changing a declared model — any time, verified and confirmed

The user: *"allowed to change the model at any give time - but Claude will verify, do risk management, and
confirm with the user"*. One procedure for add / remove / rename a rung:

1. **Verify** — ancestry holds; a rung being removed holds nothing un-promoted; in-flight worktrees/PRs based on
   or targeting it.
2. **Risk** — everything bound to an affected rung (CI triggers, deploy backends, protection rules, env
   bundles), what breaks or goes dark, what's reversible, the rollback.
3. **Confirm** — present plan + risks; act only on a yes.
4. **Apply** — update the file, regenerate house docs, create/delete branches; **report** (never silently
   change) external bindings it can't or shouldn't touch.

## Scope: everything (decided 2026-10-03)

The user, on linear-only vs. release/hotfix lines too: *"Support everything."*

That breaks the invariant the current method rests on — *each branch is a strict ancestor of the next* — so
the concept above must widen before anything is built. The declaration has to describe more than one ordered
list:

- **Rungs** — the long-lived promotion chain (today's whole model; trunk is a one-rung chain).
- **Release lines** — short- or long-lived branches cut from a rung (`release/<version>`), stabilised and
  shipped independently while the chain keeps moving; possibly several maintained at once.
- **Hotfix lines** — branched off a production line, shipped, and then **back-merged** into every line that
  must also carry the fix (the one place work flows *against* the chain).

Each line kind carries its own rules (where it forks, how it advances, what fast-forward guarantees hold,
where a fix must flow back to). The investigation must also recognise these shapes in an existing repo
(`release/*` / `hotfix/*` branches, tag-per-version history, CI triggers on patterns).

**Next design step (on hold at the user's request):** model line kinds and their flow rules, then re-check
the declaration, the skill's method, and the change procedure against them.
