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

## Not decided yet

- Scope: linear pipeline only, or release/hotfix lines too.
