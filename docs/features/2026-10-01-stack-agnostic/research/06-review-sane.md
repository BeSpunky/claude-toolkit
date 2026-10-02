# 06 — Review: independent sanity check from a clean clone (reviewer `sane`)

Clean clone `git clone --branch feat/stack-agnostic` at `2ac0c3e` into scratch `review-sane/clone`; `yarn install --frozen-lockfile` ok.

## Suites (clone) — all PASS
check-release-invariants ok (11 plugins, payload 0.36.1) · check-script-modes ok · test-tips 10/10 · test-scaffold 10 files ·
test-layers 55/55 · test-migrations 46/46 · `publish.sh --dry-run` → `PUBLISH_DRYRUN_OK 0.36.1` · CI extras: migration
reachability snippet `{unreachable:[],unorderable:[]}`; `claude plugin validate --strict` on all 11 plugins + marketplace ok.
Marketplace in isolated `CLAUDE_CONFIG_DIR`: `marketplace add <clone>` ok, `plugin install bespunky-angular@claude-toolkit` ok (0.1.0, enabled).

## Findings
**R1 · blocker · `nx-tools/src/migrations/0.35.0/relocate-port-claim.ts:62-90`** — the repo-wide rewrite walk runs unconditionally,
even when nothing moved (no house copy at the old path). Syncing this toolkit repo itself (copy of clone, `--sync --local --yes .`)
committed `chore: [nx migration] relocate-port-claim` rewriting the rung's OWN source (REWRITES now maps a string to itself), its
fixture case, and a research doc. Re-running `node tools/test-migrations/run.mjs` on that tree: 2 FAILs in the 0.35.0 case. Any repo
whose text merely mentions `tools/shared-browser/port-claim.mjs` is edited the same way. Fix: gate the walk on house evidence
(`moved.length`, or a stamped house CLI carrying the old string); add a fixture "mentions only, nothing to move → untouched".

**R2 · major · `nx-tools/src/generators/dev/files/lib/worktrees.mjs.tpl:63`** (+ `dev.mjs` :119-121, :240) — the dev engine takes the git
toplevel as the tree root. Monorepo `mono/services/web` (git root `mono/`), synced to `layers=nx,agent,node,web`: `tools/dev/dev serve
site --dry-run` shows `cwd: …/mono`, slug `mono.localhost`; live serve dies `Cannot find module '…/mono/server.js'`. Fix: carry
`git rev-parse --show-prefix` onto each worktree path.

**R3 · major (logic pre-existing on development, in scope for "any project") · `scaffold.sh` `_sync_next` (`git diff --name-only`)** —
paths are repo-root-relative while `ls-files --others` is cwd-relative, so in a subdir project a re-sync that modified
`.devcontainer/devcontainer.json` (+mounts, runArgs) and `.claude/settings.json` reported `SYNC_NEXT: none` and no `SYNC_RELOAD`.
Fix: `git diff --relative --name-only`.

**R4 · major · `nx-tools/src/generators/house-doc/generator.ts:277`** — pointer inserted before the first `## `, which in a
create-nx-workspace@23 CLAUDE.md is INSIDE Nx's `<!-- nx configuration start/end -->` block. `nx configure-ai-agents --agents claude
--no-interactive` (which `--check` tells users to run) then deletes it: `@HOUSE.rules.md` import gone until the next sync. Fix: insert
outside any foreign managed-marker region (after its end marker).

**R5 · minor · `scaffold.sh:556-582`** (fork) — `--sync --ensure=web` refused on a repo whose dev.json already makes `web` present;
message "can only refresh a layer that is already there" is false there; hint says `nx g` on a yarn host.

**R6 · minor · `SYNC_OK … voice=0`** printed on the toolkit sync while the devcontainer generator ran `--voice=true` (detected).

## Scenarios
(1) monorepo subdir — FAIL (R2, R3); nothing written outside the subdir. (2) create-nx-workspace ts + @nx/js lib, `--ensure=agent` —
PASS except R4: nx.json, extensions.json, Nx CLAUDE.md content and Nx `.claude/settings.json` entries preserved; no Angular
(`@nx/angular` peer is optional); `nx build util` ok; re-sync no-op. (3) pnpm — PASS: `pnpm nx` docs, pnpm-aware post-create, no
Angular, re-sync differs only by the documented `--local` tarball path in pnpm-lock. (4) node preset + dev.json, two worktrees
concurrently — PASS (fork; R5). (5) angular preset then `--ensure=firebase` — PASS (fork): client wired, 3 builds ok, re-sync no-op.
(6) toolkit repo self-sync — FAIL (R1); otherwise stamp `nx,agent,node`, second sync no-op.

## Suspicions (unverified)
- Monorepo subdir devcontainer opens without the parent `.git` (no Docker here).
- `firebase`/`@angular/fire` added at `latest` (`adapters/angular/firebase-client.ts:104`; same on development).

Agents spent: 1.
