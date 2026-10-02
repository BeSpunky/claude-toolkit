# 06 — Review: runtime robustness of the executable parts (reviewer `shell`)

Scope: scaffold.sh, layers.sh, the SessionStart hook, the dev engine (tools/dev/*), the serve executor, port-claim, shared-browser, worktree-domains, and the devcontainer pieces. Every finding below was reproduced in scratch (`review-shell/`) or traced to an exact line. **pre** means the defect is also present on `development`.

## Findings

| id | sev | where | defect | evidence | fix direction |
|---|---|---|---|---|---|
| S1 | major | scaffold.sh ~1835-1880 vs the inner PREFLIGHT (pre) | A sync that preflight **refuses** has already written by then. The outer shell creates the `sync-backup-*` tag and commit, and **deletes a tracked stray `yarn.lock`**. Preflight then prints "NOTHING HAS BEEN WRITTEN". It also lists the script's own yarn.lock deletion as the user's dirty change. | Dirty repo, `packageManager: npm`, yarn.lock + package-lock: `--sync --yes` gives SYNC_REFUSED dirty-tree, `git status` shows ` D yarn.lock`, and a new tag exists. | Run preflight and the probe in the outer shell (or a read-only inner pass) before the backup and before the lockfile cleanup. |
| S2 | major | scaffold.sh ~2006 (pre) | Every SYNC_FAILED, refusals included, advises `git reset --hard <backup-tag>`. That tag is a synthetic child commit of HEAD that contains the WIP. Following the advice puts "chore: pre-sync backup" on the user's branch with their WIP committed, which is the very thing preflight exists to prevent. | Ran the advice on the S1 fixture: `git log` shows the backup commit at HEAD carrying wip.txt. | Advise `git restore --source=<tag> --worktree -- .` (or `checkout <tag> -- .`), and print no restore line at all for preflight or probe stages. |
| S3 | major | scaffold.sh 1915 vs 1835-1880 (pre) | `--print-inner` ("running nothing") writes. It deletes the stray yarn.lock, creates the backup tag on a dirty tree, and takes the sync lock. CI's render and local-reinstall tests use this path. | Clean npm repo with a stray yarn.lock: after `--print-inner`, `git status` shows ` D yarn.lock`. | Exit for print-inner before the lock, backup and lockfile blocks. |
| S4 | major | layers.sh 163 `house_layers_evident` / hook 197-204 | The bash evidence walk ignores `.gitignore`. It descends into `.claude/worktrees/*` (gitignored, and the house worktree home). The TS detector (`getProjects`) does not. So the hook reports a drifted layer that the sync never detects and never stamps, and the notice repeats every session. | Fixture: `.claude/worktrees/feat/apps/site/project.json` with a `serve` target. The hook prints "present in the workspace but not in the stamp: web". Run on the same dir, `getProjects` returns `[]`. | Prune `.claude/worktrees` and any nested `.git`-file trees, or walk `git ls-files '*project.json'`. Make the projection's semantics match evidence.ts. |
| S5 | major | dev.mjs.tpl:280 | The main-module guard `resolve(argv[1]) === fileURLToPath(import.meta.url)` fails when the path has a symlink in it, because import.meta is the realpath. `dev serve` then prints **nothing and exits 0**, and the serve executor reports success. Plausible triggers: macOS `/tmp`, symlinked homes, and the house-mandated `NX_WORKSPACE_ROOT_PATH="$(pwd)"`, which is a logical path. | `ln -s eng eng-link; eng-link/tools/dev/dev serve --dry-run` prints no output, rc=0. | Compare `realpathSync` of both, or split into a bin entry that calls `main()` unconditionally. |
| S6 | major | lib/worktrees.mjs.tpl:153-161 | The engine equates the tree with the **git toplevel**, not the workspace root. With an Nx workspace in a subdirectory of the repo, processes and the install step run in the git root, the cwd is wrong, and a bogus "has no dev.json" warning appears. Worktrees resolve to `<wt>` instead of `<wt>/<subdir>`. | `repo/web/{tools,.bespunky}`, run from web/: the dry run shows `cwd: …/sub` (the git root) plus the warning. | Carry `relative(gitTop, ROOT)` and join it onto every worktree path. |
| S7 | major | lib/ports.mjs.tpl:39-45 | `isPortFree` probes only `127.0.0.1`. A server bound to `::1` reads as free. In this container `localhost` resolves to ::1 first, which covers Vite and Node servers on `localhost`. The result: auto-offset hands out an occupied port, and the main tree takes offset 0 while its stack is up, breaking the "never collide" promise for hand-declared stacks. | A `::1` listener on port P gives `isPortFree(P) === true`, and a second `localhost` bind then fails with EADDRINUSE. | Probe `127.0.0.1`, `::1` and the wildcard (or connect-probe). |
| S8 | minor | lib/stack.mjs.tpl:134 | A child killed by a signal (SIGKILL/OOM, segfault) or exiting ≥128 while not stopping counts as a clean stop. The engine exits 0, so `nx serve` reports success for a crashed stack. | `kill -9` on the web child gives "web exited (signal) — stopping the rest", engine rc=0. | Treat a signal or ≥128 as clean only when `stopping` was already set. |
| S9 | minor | scaffold.sh INNER `cd '$WORK_ROOT/$PROJECT'` (pre) | `_check_name` validates the names, but the parent path is never validated or escaped. A parent dir containing `'` (O'Brien) renders a program whose `cd` argument swallows the following lines. A crafted parent dir could inject commands. | `o'brien/app`: shlex shows the cd argument running on into `ENSURED=nx …`. | Pass the roots as env or positional args to `bash -c`, never interpolated. |
| S10 | minor | lib/ports.mjs.tpl:21-27 | `portBlock` throws even for `--port-offset=0`. An app declaring a port ≥ ~64536 cannot be served at all, and the error is raw rather than a DeclarationError. A bare `--port-offset` (no value) silently means 0. | Port 65000 with `--port-offset=0` gives "Error: …leave no room", rc=1. | Size blocks lazily, only when shifting is needed, and refuse a missing value. |
| S11 | minor | dev.mjs.tpl:55 | `--worktree <x>` (space form) leaves the value empty and turns `<x>` into the app name. Without a TTY that gives "given empty"; with a TTY it prompts and then fails with "no app <x>". `--port-offset` and `--skip` accept the space form. | Repro with stdin=/dev/null. | Accept the space form when the next argv item is not a flag, or reject it explicitly. |

From the sub-agent (verified by repro):

| id | sev | where | defect | evidence |
|---|---|---|---|---|
| F1 | major | shared-browser.tpl:497-498 | `cmd_up`'s `flock` on fd 9 is never released, so `navigate --wait` holds `up.lock` for up to 300s. A second worktree's `dev serve` then calls `up`, times out after 60s, and dies. | After `cmd_up` returned, a concurrent `flock -w 2` timed out. |
| F2 | major | worktree-domains.tpl:199-221, 271-316 | `route_set`, `route_del` and `reconcile` do an unlocked read-modify-write through a shared `routes.json.tmp`. | 12 parallel `route_set` calls left 9 of 12 routes plus `ENOENT rename`, and register still reported success. |
| F3 | major | worktree-domains.tpl:280-281 vs `toDnsLabel` | Reconcile's slugify does not match the engine's. It does not collapse `--`, trim edge hyphens, or cap at 63 characters. | Branches `fix/Foo--bar`, `release/1.0.` and names over 63 characters get live routes dropped as "worktree gone". |
| F4 | major | port-claim.mjs.tpl:127-128 | Stale-claim takeover is an unlink followed by a write, which is not atomic. | With an injected delay, A and B both printed `mine:true`: a double-booking. |
| F5 | minor | port-claim.mjs.tpl:152-157 | No port range check. | Out-of-range input gives an uncaught `ERR_SOCKET_BAD_PORT` or writes `99999.claim`. |
| F6 | minor | shared-browser.tpl:575, recorder.mjs.tpl:26, attach.mjs.tpl:19 | CDP port 9223 is hard-coded, so `SB_CDP` is ignored by the recorder and attach. | Traced: the recorder is spawned without `--cdp`. |
| F7 | minor | firebase-banner.sh.tpl:7 | `$WS` is unquoted and `source` is not POSIX. | dash fails with `source: not found`. A path with a space breaks both dash and bash. |
| F8 | minor | worktree-domains.tpl:335 | The post-stop check is dead code, because `kill_proxy` already removed the PID file. | Traced. |

## Checked and holding

- **Hook output discipline.** The hook is silent with no HOUSE.md, with no plugin root, and when the plugin root sits inside the project. A malformed or prerelease stamp produces a truthful "cannot be ordered" notice. A project ahead of this machine gets an update-the-plugin notice, never a sync offer. The evidence walk takes ~0.2s on this repo.
- **Dev engine basics.**
  - dev.json validation gives clear messages for bad JSON, missing ports and unknown `${PORT:x}`.
  - Offset math stays ≤ 65535.
  - Worktree resolution works by branch, slug, path and basename.
  - SIGTERM to the engine delivers exactly one SIGTERM per child tree, leaves no orphans, and exits rc 0.
  - A child crash stops its siblings.
- **Quoting and argument handling.** scaffold.sh handles paths with spaces and dots, refuses flags after the path, and validates `--ensure`/`--preset` before the consent gate.

## Suspicions (unverified)

- **Docker fallback with `--local`:** `-u $(id -u)` with `HOME=/home/node` probably gives EACCES on the npm cache when the host uid ≠ 1000. Docker is unavailable here, so this was not run.
- **Wrapper host:** the hook's "ahead" check reads only package.json and node_modules, so a hand-bumped `nx.json installation.plugins` pin is never noticed.
- **Slug collisions:** `feat/my.thing` and `feat/my-thing` map to the same `<slug>.localhost`, so the second route registration would clobber the first.
- **From the sub-agent:**
  - `ss -p` cannot see root-owned listeners.
  - The sticky 1777 claim directory blocks cross-uid stale cleanup.
  - Parallel first-run `runtime.mjs` races `npm install`.
  - The proxy does not abort upstream requests when the client disconnects.

Agents spent: 1 (the shared-browser / worktree-domains / port-claim / devcontainer sub-review).
