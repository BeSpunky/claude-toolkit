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

**Next design step:** model line kinds and their flow rules, then re-check the declaration, the skill's
method, and the change procedure against them. — Done below (*Model v2*), on the user's "go ahead with the
next design step".

## Model v2 — line kinds and flows (supersedes *The concept* above)

The first concept ("one ordered pipeline") is the special case. The general model: **a branch model is a small
graph of *lines*, each of a fixed KIND whose flow rules are built in.** The declaration composes kinds; it
never spells out rules. Same discipline as the layer registry — a closed vocabulary with semantics, not a
configuration language where every repo invents its own verbs.

### The five kinds

| Kind | How many | Forks from | Advances by | Notes |
| --- | --- | --- | --- | --- |
| **integration** | exactly 1 | — | `--no-ff` merge of a rebased work branch | where work lands; `development`, `develop`, or `main` on trunk |
| **stage** | 0..N, ordered | its predecessor | `--ff-only` from its predecessor | environment chain (`staging`, `qa`); last one may be production |
| **release** | pattern, 0..many | integration (or a declared stage) | `--no-ff` merge of stabilisation work branches | `release/{version}`; **ships into** a stage, or is **maintained** (is itself the production line for its version) |
| **hotfix** | pattern, ephemeral | a production line | — (it *is* a work branch with a different base) | lands back on the line it forked from, then is carried |
| **work** | pattern, ephemeral | integration (default) or a release line | commits | `feat/` · `fix/` — today's worktree branches |

**Production** is a *role*, not a kind: the stage the chain ends on, plus every maintained release line. A
stage named as a release target is fed by release merges instead of by fast-forward (gitflow's `main`); stages
after it fast-forward from it as usual.

### The one new rule: carry

Today's model never needs back-flow — everything enters at integration and only moves forward. Release and
hotfix lines add the one place work lands **downstream** of integration, so one rule covers it:

> **A change that lands anywhere but integration is not done until it is carried** — to integration and to
> every open line that would otherwise regress.

How it is carried is the model's **fix flow**, a real fork in practice, declared once:

- **merge-forward** (gitflow): land at the source (hotfix → production, stabilisation fix → release), then
  merge that line into integration and every newer open release line. Keeps *ancestry* — checkable with
  `git merge-base --is-ancestor`.
- **upstream-first** (maintained-versions projects, Linux/Node style): land on integration first, then
  `cherry-pick -x` back to each maintained line that needs it. Ancestry does not hold; equivalence is checked
  by `git cherry` / the `-x` trailer.

### A second axis the first draft missed: how work lands

`landing: merge | pull-request`. Today's skill merges locally and pushes; a repo whose branch protection
requires PRs cannot land that way at all. Same gates, different mechanics (`gh pr create` → merge via the PR,
the merge style matching the kind's rule). The investigation detects it (protection rules, merge-commit
messages like "Merge pull request #…").

### The declaration, revised

```jsonc
// .bespunky/branches.json
{
  "version": 1,
  "preset": "gitflow",                 // optional: a named composition, expanded then validated
  "integration": "develop",
  "stages": [ { "branch": "main", "production": true, "deploys": "npm publish (CI)" } ],
  "releases": { "pattern": "release/{version}", "cutFrom": "develop", "shipsTo": "main", "maintained": false },
  "hotfixes": { "pattern": "hotfix/{slug}", "from": "production" },
  "fixFlow": "merge-forward",
  "landing": "merge"
}
```

**Presets are data** (as with layer presets): `trunk` · `two-line` · `three-line` (today's) · `gitflow` ·
`maintained-releases`. They are a starting point the investigation proposes; the expanded declaration is what
is committed and what everything reads, so a preset can later change without silently changing a project.

**Validated at load, as the layer registry is:** exactly one integration line; stages are a simple chain; a
release `shipsTo` names a stage; `fixFlow` is set whenever releases or hotfixes exist; patterns don't overlap
each other or a named line.

### Invariants — what "verify" checks

1. **No direct commits** on any declared line or line pattern (first-parent history is only merges and
   fast-forwards). Generalises today's "never commit onto development/staging/main".
2. **Chain ancestry:** each fast-forward-fed stage is an ancestor of its predecessor.
3. **No regression:** every production line's content is in integration — by ancestry under merge-forward, by
   patch equivalence under upstream-first. *This* is the invariant gitflow repos break silently when a hotfix
   is never merged back.
4. **Nothing stranded:** no merged-and-shipped release/hotfix branch left undeleted, no open one forked from a
   line that no longer exists.

The same checks power three things: verify before/after a model change, the investigation's evidence, and a
pre-promotion guard (replacing today's `--ff-only`-as-a-guard trick, which only covered rule 2).

### Gates — still human, now named by the model

Unchanged: only the relevance check and opening a work worktree run unasked. Every move between lines waits
for an explicit signal — *land*, *promote to `<stage>`*, *cut release `<v>`*, *ship release `<v>`*, *hotfix*.
Two judgments the skill now has to make:

- **"Release" is ambiguous** under a model with release lines (cut one, or ship one?) — the skill asks rather
  than picks.
- **Hotfix or fix?** A bug reported against production while integration carries unreleased work: fixing on
  integration ships it with everything else; a hotfix ships it alone. That changes what reaches users, so the
  skill **asks** (only in models that declare hotfixes; otherwise there is nothing to choose).

### Where the semantics live

**One engine, everything else reads the data contract.** A Node built-ins-only script in the workflow plugin
(`branch-and-release/scripts/branches.mjs`, beside the skill that owns the method — the skill is used in
non-house repos too, so it cannot live in `nx-tools`). It answers: `describe` (the model in words and a
table), `plan <gate> …` (the exact commands for a move, never executed by the script), `verify [--proposed
<file>]` (the invariants, against the current or a proposed model), `evidence` (the investigation's raw
facts). Claude runs it; it decides nothing.

The other readers take **names only**, from the JSON schema, never semantics: `house-doc` renders the rules in
role words with the real names filled in (and the "not yet declared — investigate and ask" text when the file
is absent); `scaffold.sh`'s preflight reads the set of protected names/patterns; `--staging` refuses when the
model has no stage to bind it to.

### Re-check: the investigation

Beyond the branch list and per-rung usage history (above), it now also recognises **shapes**:
`release/*` / `hotfix/*` branches, live or only in merge-commit messages; tag series and which line carries
them (two tag series on two lines → maintained versions); cherry-pick trailers (upstream-first); CI triggers
on branch *patterns*; required-PR protection (→ `landing`). And it runs invariant 3 against history: a repo
that has hotfixes that never reached integration has a real, current bug, and the user is told so whatever
model they pick.

### Re-check: changing the model

The four steps stand, sharpened by the engine:

1. **Verify** — `verify` now, and `verify --proposed` against the new model: would this repo satisfy it
   today? (Moving to gitflow on a repo whose `main` is not in `develop` fails rule 3 — that is the first
   thing to fix, not a footnote.)
2. **Risk** — every binding on every affected line *or pattern*; open release lines and in-flight hotfixes
   (a model change mid-release is the riskiest case — say so); what is irreversible (deleting a remote
   branch, rewriting protection).
3. **Confirm.**
4. **Apply** — write the expanded declaration, regenerate house docs, create/delete branches, carry anything
   owed; report external bindings; `verify` again.

### Out of scope, still

Non-git VCS; monorepos with **different** branch models per project (one model per repo); enforcing anything
server-side — the toolkit verifies and reports, it does not configure GitHub protection on its own authority.
