# Changing the branch model — verify, risk, confirm, apply

> A declared model may change **at any time** — add, remove or rename a line, adopt or drop release/hotfix lines, change how a stage advances, switch fix flow or landing, collapse to trunk. The user's condition: *"Claude will verify, do risk management, and confirm with the user."* The first declaration of an undeclared repo goes through here too. `<base>` below is this skill's base directory.

**Nothing in the first three steps changes the repo.** The proposed declaration lives in a scratch file until the user says yes.

## 1. Verify — would the repo satisfy the new model today?

```bash
node "<base>/scripts/branches.mjs" verify                                  # the current model (skip when undeclared)
node "<base>/scripts/branches.mjs" validate "<scratch>/branches.proposed.json"
node "<base>/scripts/branches.mjs" verify --proposed "<scratch>/branches.proposed.json"
```

`--proposed` evaluates the invariants as if the new model were declared, with baselines at today's tips (so history from before it can't fail it) — except **no regression**, which runs over full history to surface un-carried fixes. **A violation is the first thing to fix, not a footnote**: moving to gitflow on a repo whose production line has commits integration lacks fails here, and those commits are carried *before* the model changes. Report every `advisory` with its reason (e.g. squash landings make direct commits undetectable).

## 2. Risk — what the change touches

Work it out per **affected line or pattern** (renamed, removed, re-roled, newly added) and name every item:

- **Bindings** — CI triggers (`on.push.branches` / `tags`), deploy backends (App Hosting, `apphosting.<env>.yaml`), environment files, GitHub environments, branch protection, required checks. For each: what goes dark, what starts firing, what must be retargeted. Run `evidence` (with `--app-hosting` when the repo has Firebase) if you haven't; an `unobservable` binding is a question to the user. **A `ci` binding is not documentation — it drives the house project's deploy workflow and the cloud identity behind it:** adding, moving or removing one changes which pushes deploy where, and a renamed line is a production deploy that silently stops (or starts) firing. Name each one.
- **In flight** — open release lines and in-flight hotfixes (**a model change mid-release is the riskiest case — say so**), worktrees and open PRs based on or targeting an affected line, a stage holding un-promoted work that a removal would strand.
- **Irreversible steps** — deleting a remote branch, rewriting protection, retiring a tag series. Say which steps can be undone and which cannot.
- **Rollback** — how to return to the current model if the new one misbehaves (usually: restore the previous declaration from history, recreate any deleted branch from its recorded tip — note the tips now).

## 3. Confirm

Present the plan (the new model in `describe` form, every branch to create or delete, every carry owed) and the risks from step 2. **Act only on an explicit yes** — to the whole plan, or to the parts the user approves. A yes to the model is not a yes to deleting a remote branch; confirm irreversible steps by name.

## 4. Apply

1. **Write the declaration** — `node "<base>/scripts/branches.mjs" write "<scratch>/branches.proposed.json"`. It validates, records each line's baseline (its current tip; a line that doesn't exist yet gets `null` and a note) and computes the projection. It does not commit.
2. **Land it on the integration line** — **the order is fixed: if the integration line is new (it doesn't exist yet, or integration changes to a line not yet created), create it FIRST**, from the confirmed tip, and push it when there is a remote; **then** land the declaration on it; **only then** create the other lines (step 3). Land it as an ordinary change: from a work branch, through the gate of **the model being replaced** — this one landing is the last move made under the old rules. The integration tip's copy is authoritative, so until it lands there, the change has not happened.
3. **Create or delete branches** — only the ones confirmed in step 3, after the declaration has landed (the integration line, if new, was already created in step 2 — the declaration needs it to land on). Create new lines from the tips the plan named; delete only lines that `verify` shows hold nothing un-carried. Re-run `write` afterwards if a line that got a `null` baseline now exists, and land that too.
4. **Carry anything owed** — `plan carry …` for every un-carried fix the verify surfaced.
5. **Report external bindings — never change them on your own authority.** CI triggers, branch protection, App Hosting backends, GitHub environments: list each one that now points at a line that changed, and what it should become. The toolkit verifies and reports; the user (or a deliberate, separately confirmed change) retargets them.
6. **Regenerate the house tooling** in a house project (it has a `HOUSE.md`): run `/bespunky-house:upgrade`, so `HOUSE.rules.md` and `HOUSE.md` render the new names and roles — and, with the `ci` layer, the deploy workflow follows the new `ci` bindings. They read only the projection. **When a `ci` binding's lines or environment changed, the cloud side cannot be regenerated:** the upgrade prints a `HUMAN_STEP:` naming `tools/setup-gcp.sh` — hand that line to the user to run (`! bash tools/setup-gcp.sh …`); an agent is refused IAM grants by design.
7. **After connecting or disconnecting a repository on an App Hosting backend** (or changing its live branch), re-run `evidence --app-hosting` and bring `deploys` up to date through this same procedure — that is exactly the change nothing else notices.
8. **`verify` again** — on the declared model now. It should be clean; anything it reports is the next thing to fix, not to explain away.
