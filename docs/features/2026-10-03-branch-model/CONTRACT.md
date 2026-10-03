# branch-model — implementation contract

The seams every unit builds against. `DECISION.md` (Model v2 + Review round 1) is the *why*; this is the
*what*, frozen before the fan-out so parallel units agree. Change it only by editing this file first.

## 1. The declaration — `.bespunky/branches.json`

Committed. Written **only** by `branches.mjs write`, and only after a human decision (never by a generator,
a migration, or a sync on its own). Authoritative copy = the one on the **integration branch tip**.

```jsonc
{
  "schema": 1,
  "derivedFrom": "three-line",            // label only: the preset it started from (or null)
  "remote": "origin",
  "integration": { "branch": "development", "baseline": "<sha>" },
  "stages": [                              // ordered; stage[0]'s predecessor is integration
    { "branch": "staging", "promote": "ff",  "baseline": "<sha>", "deploys": "App Hosting staging backend" },
    { "branch": "main",    "promote": "ff",  "baseline": "<sha>", "deploys": "App Hosting production" }
  ],
  "releases": null,                        // or ReleaseLines (below)
  "hotfixes": null,                        // or { "pattern": "hotfix/{line}/{slug}" }
  "work": { "pattern": "{type}/{slug}", "types": ["feat", "fix"] },
  "fixFlow": null,                         // "merge-forward" | "upstream-first"; REQUIRED when releases or hotfixes are set
  "landing": { "via": "merge", "prStyle": null },   // via: "merge" | "pr"; prStyle: "merge" | "squash" | "rebase" (required when via = "pr")
  "tags": [],                              // [{ "pattern": "v{version}", "on": "<line name>", "deploys": "…" }]
  "projection": { … }                      // DERIVED — see §2; never hand-edited
}
```

`ReleaseLines`:
```jsonc
{ "pattern": "release/{version}", "cutFrom": "development", "shipsTo": "main",   // shipsTo: a stage name, or null when maintained
  "maintained": false, "allowDirect": ["version-bump"], "deploys": null, "baselines": {} }
```

Semantics (validated at load; any violation is a hard error naming the field):
- Exactly one integration line. `stages` may be empty → **trunk**: integration is production.
- `promote`: `"ff"` (`--ff-only` from predecessor) · `"merge"` (`--no-ff` merge of predecessor) · `"pr"` (a PR
  from predecessor, merged with `landing.prStyle`).
- **Production** is DERIVED: the last stage (or integration when no stages), plus every release line when
  `releases.maintained` is true.
- A stage named by `releases.shipsTo` is **release-fed**: it advances by merging a release line, not from its
  predecessor. Stages after it advance from it as usual. `shipsTo` must name a stage; `null` requires
  `maintained: true`.
- `releases.cutFrom` names integration or a stage.
- Hotfix pattern must contain `{line}` (the production line it targets) and `{slug}`.
- Patterns use `{placeholder}` segments; a placeholder matches `[^/]+` except `{slug}` which matches `.+`.
  Patterns must not overlap each other or match a named line.
- `deploys` is documentation only — never verified.
- `baseline`: the line's tip SHA when the model was written; invariant checks start there.

## 2. The projection — the ONLY part other readers may parse

Written by `branches.mjs write` into the same file; `verify` fails if it has drifted from the model.

```json
"projection": {
  "schema": 1,
  "integration": "development",
  "production": ["main"],
  "productionPatterns": [],
  "chain": ["development", "staging", "main"],
  "protected": ["development", "staging", "main"],
  "protectedPatterns": ["release/*"],
  "workBase": "development",
  "summary": "development → staging → main"
}
```

- `protected` = integration + every stage. `protectedPatterns` = release-line pattern (if any) as a shell glob
  (each `{x}` → `*`). Hotfix and work branches are never protected.
- `chain` = integration followed by stages, in order.
- `summary` = one human line (used verbatim by house-doc and status lines).
- Readers (house-doc, `scaffold.sh`, `checkpoint-on-compact.sh`) read **only** `projection`, and **refuse**
  (clear error, no guessing) when `projection.schema` is a major they don't know (anything but `1`).

## 3. The undeclared state

No file (on the integration tip — or, when that can't be resolved, in the working tree) = **undeclared**.
Everything protective, nothing assumed:
- Protected = every existing local/remote branch named `main`, `master`, `development`, `develop`, `staging`
  (the names the toolkit ever forced, plus gitflow's) — protect, never promote.
- Before the **first branch or promotion action of a session**, Claude runs the investigation
  (`reference/choosing-a-branch-model.md`) and asks. Once per session, not per action.
- No reader writes the file to escape this state.

## 4. The engine — `plugins/workflow/skills/branch-and-release/scripts/branches.mjs`

Node ≥ 18, **built-ins only**, ESM, runs from anywhere inside a git repo (resolves the top). Never runs a git
command that changes state — it reads, plans and writes only `.bespunky/branches.json` (`write`). Exit codes:
`0` ok · `1` invariant/validation failure · `2` usage error · `3` undeclared.

| Command | Does |
| --- | --- |
| `status [--json]` | Resolves the authoritative model (integration tip, falling back to the working tree with a warning; warns when the two differ). Prints `projection` (`--json`) or the summary. Exit 3 when undeclared. |
| `describe` | The model in words + a table of lines, roles, how each advances, bindings. |
| `presets` | Lists presets with one-line descriptions. |
| `expand --preset <id> [--integration <b>] [--stages a,b] [--release-pattern p] [--maintained] [--fix-flow f] [--landing merge\|pr] [--pr-style s]` | Prints a full declaration (no baselines/projection) to stdout for Claude to edit. |
| `validate <file>` | Validates a declaration; prints every error. |
| `write <file>` | Validates, fills baselines (current tips; missing branch → `null` + note), computes projection, writes `.bespunky/branches.json`. Does not commit. |
| `plan <gate> [args]` | Prints the exact git/gh commands for a move, numbered, never executed. Gates: `land <work-branch>` · `promote <stage>` · `cut-release <version>` · `ship-release <version>` · `hotfix <line> <slug>` · `carry <commit\|branch>` · `start <type> <slug>` (worktree off the right base). Refuses gates the model doesn't have (e.g. `cut-release` with no release lines). |
| `verify [--proposed <file>] [--json]` | Invariants (§5) against the current or a proposed model. Each result: `ok` · `violation` · `advisory` (+ reason) · `warning`. |
| `evidence [--json]` | The investigation's raw facts (§6), each tagged `observed` · `inferred` · `unobservable`. |

Presets (data in the engine, each expanding to a full declaration): `trunk` (integration `main`, no stages) ·
`two-line` (`development` → `main`) · `three-line` (`development` → `staging` → `main`, today's) · `gitflow`
(`develop`; stages `[main]` release-fed; `release/{version}` cut from `develop`, ships to `main`;
`hotfix/{line}/{slug}`; merge-forward; tags `v{version}` on `main`) · `maintained-releases` (integration
`main`, no stages; `release/{version}` maintained, cut from `main`; `hotfix/{line}/{slug}`; upstream-first).

## 5. Invariants (`verify`)

1. **No direct commits** on protected lines since their baseline: first-parent commits after the baseline must
   be merges or fast-forward arrivals of commits reachable from the predecessor/feeder. Under `landing.via =
   pr` + `squash`, commits are indistinguishable → `advisory`. `allowDirect: ["version-bump"]` exempts release-
   line commits that touch only version files (`package.json` `version`, `*.json` manifests' `version`,
   `CHANGELOG*`).
2. **Chain containment:** each chain-fed stage's content is contained in its predecessor — ancestry for
   `ff`; for `merge`/`pr`, no non-merge commit on the stage (since baseline) that the predecessor lacks
   (ancestry or patch-id via `git cherry`).
3. **No regression:** no non-merge commit on any production line (since baseline) that integration lacks, by
   ancestry or patch equivalence. A commit carrying a `Not-applicable-upstream:` trailer is accepted.
4. **Hygiene (warning, never a violation):** merged hotfix/release branches still present; open lines forked
   from a line no longer declared.
5. **Projection fresh:** recomputed projection equals the stored one.

With `--proposed`, (1)–(3) are evaluated as if that model were declared, with baselines = current tips (so
past history doesn't fail a new model), except (3) which is evaluated over full history to surface un-carried
fixes.

## 6. Evidence (`evidence`)

- Branches (local + remote), tips, ahead/behind matrix between long-lived ones, last activity.
- Per long-lived branch: how it has advanced (ff arrivals vs merge commits vs direct commits), how long it sat
  behind its upstream neighbour (e.g. `staging` ahead of `main` durations → gate in use vs ceremony).
- Release/hotfix shapes: live `release/*` `hotfix/*` branches and names found in merge messages; tag series
  and which branches contain them; `(cherry picked from commit …)` trailers.
- Bindings: `.github/workflows/*.yml` `on.push.branches` / `tags` (crude YAML read, `inferred`); `apphosting*.yaml`;
  `firebase.json`; environment files referring to `staging`/`production`.
- Remote-side (only when `gh auth status` succeeds, else `unobservable`): branch protection, required PRs,
  GitHub environments, PR merge styles used ("Merge pull request #").
- Invariant 3 over full history against the current branch names.

## Amendment 1 (after U2/U4 returned) — resolution and `remote`

**Resolving the copy in force** — one algorithm, used by the engine's `status`, `checkpoint-on-compact.sh` and
`house-branches.sh`:
1. Working-tree copy present and parseable → read its `projection.integration` (+ `projection.remote`); look for
   `<integration>` (local branch first, then `<remote>/<integration>`).
   - branch found and it holds a copy → **that copy is the model** (note when it differs from the working tree);
   - branch found but it holds no copy → the declaration has not landed → **undeclared**, with a note;
   - branch not found anywhere (bootstrap, a clone without it) → the working-tree copy, with a note.
2. No (parseable) working-tree copy → **self-confirming search**: for each name in the §3 list, a copy at that
   branch (local, then `origin/`) is accepted only if its own `projection.integration` names that same branch.
   (Covers a work branch forked before the declaration landed.)
3. Nothing found → undeclared.
(The reference implementation of this is `assets/house-branches.sh`; the engine and the hook must agree with it.)

**`projection.remote`** is added (default `"origin"`), so readers resolve remote tips without parsing the model.
Schema stays `1` (additive; readers treat a missing `remote` as `"origin"`).

## Amendment 2 (after the implementation bug review) — resolution, revised; fewer resolvers

The review reproduced a sync committing onto production: a stale local integration branch without the file
made the resolver say "undeclared" and throw away the working copy's `protected` list. Root cause: resolution
was implemented three times and each copy stopped at the first ref it found. Two changes.

**Fewer resolvers.** The PreCompact hook lives in the same plugin as the engine, so it calls
`branches.mjs status --json` instead of resolving. House-doc never resolves either: the sync program passes it
the projection it already resolved (generator option `branchProjection`, a JSON string; absent → house-doc
reads the Tree, for standalone use). That leaves exactly two resolvers — the engine (`lib/resolve.mjs`) and
`house-branches.sh` (it runs in consumers' repos where the workflow plugin's path is not knowable) — and the test
suites of both run the SAME scenario list below.

**The rule (supersedes Amendment 1's list):**
1. Working-tree copy present but unparseable, without `projection`, or `projection.schema` major ≠ 1 →
   **unreadable**: refuse to act; anything protective protects the §3 list.
2. Parseable working copy → integration `I`, remote `R` (`projection.remote`, default `origin`). Consider BOTH
   `refs/heads/I` and `refs/remotes/R/I`; keep those that exist AND hold the file.
   - neither ref exists → the working copy is in force (bootstrap), with a note;
   - refs exist but none holds the file → **not landed**: undeclared, but protected = the §3 list **∪** the
     working copy's `protected` / `protectedPatterns` (never fewer protections than the copy declares);
   - one holds it → that copy;
   - both hold it → identical → that copy; else the one whose commit descends from the other's; diverged →
     the local one, with a note.
3. No working-tree copy → self-confirming search: for each §3 name, try the local branch AND `origin/<name>`;
   accept a copy only if its `projection.integration` names that same branch.
4. Nothing → undeclared.

**`status --json` shape** (what the hook and Claude consume):
`{ "state": "declared"|"undeclared"|"unreadable", "source": "<ref>|working-tree"|null,
   "projection": {…}|null, "protected": [...], "protectedPatterns": [...], "notes": [...], "reason": "…"|null }`
— `protected`/`protectedPatterns` are ALWAYS the effective set for that state (declared: the projection's;
undeclared: §3 names that exist ∪ any not-landed copy's; unreadable: the §3 list). Exit 0 declared · 3
undeclared · 1 unreadable.

Schema check everywhere: **major** of `projection.schema` must be 1 (`String(schema).split('.')[0] === '1'`).
