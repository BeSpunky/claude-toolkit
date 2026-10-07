# U6 — D3: agents leak servers and kill by name

> Item D3 of the inbound handoff: in a fan-out, subagents said they had torn their servers down but left 6 `server.mjs` processes running. One cleaned up with `pkill --newest`, which can kill *any* matching process, the developer's included. Elsewhere `pgrep -f <worktree-name>` matched the agent's own shell. The consumer asked for PID-based teardown, a ban on name kills, and a final "no listeners left" check, in `local-server-isolation` and `delegate-and-parallelize`.
> Analysis is read-only, 2026-10-07. Consumer evidence is quoted from their report, not reproduced here.

## Verdict

**The gap is real, and the consumer only proposed half of the fix.** The agent-facing skills tell the agent to tear down, but never say *how*, and they never ask anyone to check that teardown happened. The toolkit already learned this exact lesson **twice** in its own generated scripts. `shared-browser` gotcha #5 says `pkill -f` killed its own shell, and the fix was "PID-file lifecycle, never pattern-kill". `worktree-domains` says the same: "NEVER killed — never `pkill -f`". That lesson never reached the guidance that tells the *agent* how to behave. More prose rules alone would be the patch answer. The architecture-first answer is to give agents a **handle**, so they never have to write a kill by hand.

## What the text says today

| Where | What it says | Gap |
|---|---|---|
| `plugins/workflow/skills/local-server-isolation/SKILL.md:19` | "**Tear down** the server you started when the check is done (don't leave orphans holding a port)." | One line. It doesn't say how (no PID, no handle) and doesn't ask for a check that it worked. |
| same file, `:18` | "Never kill or restart a server you didn't start" | It states what to protect but gives no method. `pkill <name>` / `--newest` break this rule without the agent noticing, because the agent believes it is killing its own server. |
| same file, `:4` (description) | The trigger covers *launching*. It doesn't mention stopping, cleanup or "kill the server". | The skill doesn't fire at teardown time, which is exactly when the agent reaches for `pkill`. |
| `plugins/house/engine/nx-tools/src/generators/house-doc/HOUSE.rules.md.tpl:108` (the always-on half) | "tear the server down when done, and **never kill a server you didn't start**" | Same gap, and this is the text that is actually in context every session. |
| `plugins/workflow/skills/delegate-and-parallelize/SKILL.md:195` | "Same port, same server → not fine. See [[local-server-isolation]]" | It covers the collision only. It says nothing about the fact that a child's **processes** outlive the child. |
| same file, `:212-232` (Supervision) | The "zombie agents" rule and the roster at close | Covers zombie **agents** only. Zombie **processes** that an agent spawned get no mention. The roster never asks "what is still listening?" |
| `delegate-and-parallelize/SKILL.md:153-159` and `reference/writing-a-delegated-task.md:28-52` (the delegated-task contract and return shape) | goal / constraints / return shape / recursion / traces | Has no clause for **processes started**. A child's return can't say "I left PID X on :Y", and the parent has no way to verify. |
| `reference/resuming-a-fanout.md:80` | "Mutations announce themselves" (files) | Started processes are mutations too, and they are just as invisible. |

## Why agents end up hand-rolling kills

1. They often launch with `cmd &` or `nohup … &` inside a *foreground* Bash call. The launch returns, the PID is never captured, and the only handle left is the command line.
2. Pattern kills match too much. `pgrep -f <worktree-name>` matches the agent's own `bash -c '…<worktree-name>…'` (the same symptom as shared-browser #5). `pkill --newest <name>` picks the newest match **container-wide**, and with N agents plus the developer, that could be anyone's process.
3. A subagent returns (and its context ends) while the process it started keeps running. Nothing in the contract makes the child report that, or makes the parent sweep for it.

## The native handle: `Bash run_in_background` + `TaskStop`

Observed in this container on 2026-10-07. A `run_in_background` Bash ran `sh -c 'node -e "<http listen(0)>" & …; wait'`, so the server was a backgrounded **grandchild**. `TaskStop <id>` removed both the `sh` and the `node` listener (`ps -p` showed nothing afterwards). So a server launched as the background task's **foreground** command, with no `&`, `nohup` or `setsid` of its own, gets an exact, PID-safe teardown for free, and the agent never names a process.

The handle has limits, and the skill must state them:
- A process the agent detached itself (`nohup … &` in a foreground call, `setsid`, `disown`) is **not** in a task, so `TaskStop` can't reach it.
- **Not verified:** whether a subagent's background tasks die when that subagent returns. If they outlive it, that alone could explain the 6 leaked `server.mjs`. Either way the child must stop its own tasks before returning. Never rely on the harness to do it.

## The mechanical seam: the house dev runner

`tools/dev/dev serve` (source: `plugins/house/engine/nx-tools/src/generators/dev/files/dev.mjs.tpl`, stack in `lib/stack.mjs.tpl`) already does correct teardown. A **SIGTERM aimed at the `dev` process** (stack.mjs.tpl:49-52, 96-122) sends exactly one SIGTERM to each child tree (it walks the `sh -c` wrappers' descendants via /proc) and waits for all of them. Ctrl+C/SIGINT to the group also works. So for a house project wearing `web`, *one PID* stops the whole stack. What it lacks is a way for an agent (or anyone else) to **find** that PID and **ask about** it:

- **Record what each serve owns.** On start, `dev serve` writes `<tree>/.bespunky/run/<app>@<offset>.json` (gitignored, or under `$XDG_RUNTIME_DIR`): `{ pid, pgid, tree, app, offset, ports:{…}, startedAt, cmdline }`. The JSON key is the owner, so this is not a bare pidfile. It removes the file in `onStop`/exit. A stale file (pid dead, or the pid's cmdline/cwd doesn't match) is detected and cleared, never trusted.
- **`tools/dev/dev stop [app] [--worktree=…] [--offset=N|--all-mine]`** reads those records. It verifies identity (`/proc/<pid>/cwd` is the tree **and** cmdline is `dev serve`) **before** signalling, sends SIGTERM to that one PID (the runner's own graceful path), waits, and then **verifies the declared ports are free** (reusing `ports.mjs`'s `isFree`). It reports any leftover by name and **never** escalates to name or port kills on something it can't prove it owns. This follows the same "classify before killing" doctrine as `reap-emulators.sh.tpl:148`.
- **`tools/dev/dev ps`** (or `list --running`) prints running serves: tree, app, offset, pid, ports, and whether each is listening. This gives the parent's closing roster a single command to run.
- A `--json` output on `serve` / `ps`, or a single `[serve] PID … ports …` line printed at start, so an agent reads its handle from startup output (the same pattern the skill already uses for the bound URL).

This answers the request at its source. An agent serving a house app runs `dev serve` (in background) → `dev stop` → `dev ps`, and never needs `kill`. It also serves humans: today a second serve that holds a port has no stop verb (see also D2).

For servers **outside** the dev runner (`node dist/…/server.mjs` directly, `python -m http.server`, etc.), the skill rule applies: launch as a `run_in_background` task and stop it with `TaskStop`. Failing that, record `$!` at launch and kill **only that PID** after checking its cwd and cmdline. If all you have is the port, the PID that owns the bound port (`fuser`/`ss -ltnp`) is acceptable only when its `/proc/<pid>/cwd` is your tree and it started after your launch.

## Recommended skill edits

**`local-server-isolation/SKILL.md`**: replace the line-19 rule with a "Teardown — by handle, never by name" section:
- Launch so you hold a handle. Prefer, in this order: the house runner (`dev serve` → `dev stop`); a `run_in_background` task (→ `TaskStop`); otherwise capture `$!` at launch. Never `nohup`/`setsid`/`disown` a test server.
- **Banned:** `pkill`/`killall` by name, `pkill --newest/--oldest`, `pgrep -f <pattern> | xargs kill`, `fuser -k <port>` without checking the owner. They match your own shell and other people's processes.
- Before signalling a PID, verify `/proc/<pid>/cwd` and the cmdline.
- **Verify the stop**: after teardown, confirm none of *your* ports are still listening (`ss -ltn` / `dev ps`). "I stopped it" is a claim; the empty port is the proof.
- Widen the `description` so the skill fires at stop time too ("…and when stopping/cleaning up a server you started — kill by handle, never by name").

**`HOUSE.rules.md.tpl:108`** (the always-on half): extend the sentence: "…tear down **by the handle you launched with** (`dev stop`, `TaskStop`, the PID you recorded), never by name (`pkill`, `pgrep -f`), and confirm your ports are free before you report done." It is generator-owned, so it ships through nx-tools. It's an owned template (class A) that every upgrade regenerates, so there is nothing to migrate.

**`delegate-and-parallelize`**:
- `SKILL.md:195` "rest of the shared world": add "**Processes outlive the agent.** A child that started a server stops it before returning, and its return lists every process it started with its PID/port and status (stopped or left running on purpose)."
- Supervision roster (`:229+`): add a closing **process roster**. Run `dev ps` / `ss -ltn` against the ports children reported, and treat any leftover as an unaccounted child.
- `SKILL.md:153-159` irreducible minimum, plus `reference/writing-a-delegated-task.md` (a new numbered part after 7, plus a new failure mode, "the litterbug"): a **processes clause** in every prompt that may start one, and a return-shape line "processes started / still listening: none | list".
- `reference/resuming-a-fanout.md:80`: started processes are mutations, so put them in the ledger (pid, port, tree) so that a resume can reap *exactly* them.

**Cross-link** `bespunky-browser-automation:shared-browser` gotcha #5 as the precedent.

## Bumps

- **bespunky-workflow**: the skill edits, plus a tip ("stop a test server by its handle — `TaskStop` / `dev stop` — never `pkill`").
- **@bespunky/nx-tools**: `HOUSE.rules.md.tpl`, plus `dev stop` / `dev ps` / the run record in the `dev` generator (owned template artifacts, so nothing to migrate; the `.bespunky/run/` gitignore entry must be checked, since a gitignore line in a project file is project state). Needs generator test cases for stop identity checks, stale record and port verification.
- **bespunky-house**: carries the engine, so it gets bumped with the payload. HOUSE.md's dev-loop section should document `dev stop` / `dev ps`.
- Optionally **bespunky-browser-automation**, if its skill gains the cross-link.
