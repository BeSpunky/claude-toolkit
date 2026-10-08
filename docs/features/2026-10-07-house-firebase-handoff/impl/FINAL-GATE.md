# FINAL GATE: the release-gate dogfood after both review rounds

Worktree `hfh-final`, branch `chore/hfh-final-gate`, identical to `feat/house-firebase-handoff` at `9e34af3`. Written
as it happened, 2026-10-07. Nothing was pushed, published or bumped, and no toolkit source was touched.

**Verdict: PASS for the toolkit under test**, with one failure that the gate's default run reports. The failure is in
the **released** baseline (nx-tools 0.49.2), and its cause is outside this branch (details in section 1). It is the
strongest argument yet for shipping this release.

## 1. Scripted consumer dogfood (`tools/dogfood-consumer/run.mjs`)

### Default run (full coverage): `FAIL — 30 passed, 1 failed, 2 skipped in 5m33s`

```
released  worktree of development @ 4f01d00                            PASS
released  new --preset=angular --firebase --staging (nx-tools 0.49.2)  FAIL  exit 1: error @firebase/ai@3.0.0: The engine "node" is incompatible with this module. Expected version ">=24.12.0". Got "22.23.2"
seed      seeds    SKIP — no released consumer
upgrade   upgrade  SKIP — the seeded consumer is not ready
new-agent / new-node / new-angular / new-angular-firebase              all PASS (stamp 0.50.0, layers, clean tree, host shape; build + lint where there is an app)
run       no process left under the workdir / nothing written to ~/projects   PASS
```

**Cause of the failure.** `firebase@13.0.0` was published at **2026-10-07T19:36Z**, a few hours before this run, and
its `@firebase/ai@3.0.0` declares `engines.node >=24.12.0`. The released toolkit (0.49.2) writes `"firebase": "latest"`
and `"@angular/fire": "latest"`, so a new house Firebase project today resolves firebase 13, and yarn refuses the
install on the container's Node 22. **Every `new --preset=angular --firebase` made with the released toolkit now
fails**, on any Node-22 house container. This is BRIEF idea 1 ("generators never write a floating version") arriving
in the wild. The toolkit under test is not affected: its `new-angular-firebase` pinned Angular 20 with a coherent
`@angular/fire` and `firebase` pair, then built and linted.

### Upgrade road, re-run so it is not left uncovered

`YARN_IGNORE_ENGINES=true node tools/dogfood-consumer/run.mjs --only=consumer --keep`: **`PASS — 29 passed, 0 failed,
0 skipped, 1 failing in the RELEASED baseline only (reference, not this run's) in 2m13s`.**

- The released consumer: Angular 22.1, `firebase` 13.0.0 installed, `latest` declared on both.
- All nine seeds survived the upgrade: branch-model, functions-deploy-inputs, firebase-deploy-target, root-rules,
  secret-trigger, secret-local (byte-identical), apphosting-runconfig, brand-lib and web-e2e-compact.
- The upgrade reported `UPGRADE_OK` with `UPGRADE_NEXT: rebuild-container` and the stamp `0.50.0`. The second upgrade
  was a **no-op** (`UPGRADE_NEXT: none`, no commit, clean tree). The upgraded workspace builds (3 projects) and lints
  (4 projects).
- Baseline lint failed in the **released** shape (`design-system:lint`, `@nx/dependency-checks`: `@angular/common`
  unused). The upgrade fixes it, which is reference data only.
- **`pin-floating-dependencies` / `firebase-client` on Angular 22** behaved as designed: no stable `@angular/fire` exists
  for Angular 22, so the upgrade leaves `latest` in place and reports three choices. Two observations, neither of
  them blocking:
  - Choice 1 reads "Pin what is installed and runs today: `@angular/fire` 20.1.0, `firebase` ^11.8.0". The installed
    root firebase is **13.0.0**, so "what is installed" is only true of `@angular/fire`. The pair itself is right,
    because it is the range `@angular/fire` declares. The wording is wrong.
  - Because `latest` stays, such a project still floats into firebase 13, and a plain `yarn install` refuses it on
    Node 22. The report does not mention that. Taking choice 1 fixes it.

## 2. Self-upgrade: `house.sh upgrade --local --yes .`

I ran it on the side branch `chore/hfh-final-gate-selfupgrade-REVIEW-ONLY`, in commit `c6cb5b1` ("REVIEW ONLY, DON'T
LAND"), together with Nx's commits `dc1856d` (checkpoint), `7bb5d7c` (`.nvmrc`) and `521aaa4` (`branches.json`). None
of it is on this branch.

Run 1 exited 0. `[migrate] house tooling 0.49.0 -> 0.50.0` collected **21 migrations** from the working tree and ran all
of them. Two wrote changes and 19 said "No changes were made", which is correct for a repo with no Firebase, Angular,
design system or apps. Then `UPDATE house.packages.sh / HOUSE.md / HOUSE.rules.md`, `UPGRADE_OK`,
`UPGRADE_NEXT: rebuild-container`.

| File | Change | Verdict |
| --- | --- | --- |
| `.bespunky/branches.json` | `stages[0].deploys` string → `{ "note": <same text> }` | intended (W9 / deploys decision). `branches.mjs validate`: valid; `verify --proposed`: no violations |
| `.nvmrc` | created, `22` (from `house.Dockerfile FROM typescript-node:22`) | intended (W1) |
| `.devcontainer/house.packages.sh` | the apt install moves into `install_packages()`; a `pending` (archive tools) term joins the "all present" check; `exit $status` | intended (FF-G, the `archives` fragment; this repo has none, so `pending` is always empty and behaviour is unchanged). **Cosmetic:** `# The archive tools to install (below); none without them.` points "below" at code that is not rendered when a project has no archives |
| `HOUSE.md` | stamp `nx-tools=0.50.0 plugin=0.47.2`; "(the Playwright browsers among them)" removed (FX3: gated on `web`); the *Node is ONE project fact* paragraph (W1); the *Deploy bindings* paragraph (W9); the *Moving Nx is this project's job* bullet (W7) | intended |
| `HOUSE.rules.md` | *Generator-first* → `yarn nx list @bespunky/nx-tools` (FX3); *Local servers* → teardown by handle, confirm ports free, subagents stop what they started (W3 / G1) | intended |
| `package.json` | `@bespunky/nx-tools` `0.49.0` → `0.50.0` | intended |
| `yarn.lock` | the `0.49.0` entry removed, nothing added | the expected `--local` artefact. The checkpoint commit pins a `file:/tmp/…tgz`, so this branch must never be landed |

**Surprising changes: none.** (Unrelated: this repo's own pin was `0.49.0`, not the published `0.49.2`.)

**Idempotency:** run 2 printed `house tooling already at 0.50.0 — no migrations to run` and `UPGRADE_NEXT: none`. No
UPDATE or CREATE line, no commit, clean tree, **empty diff**.

### Sweep (`git grep`, `docs/` excluded)

| Identifier | Hits | Verdict |
| --- | --- | --- |
| `proxied` | `worktree-domains/{proxy.mjs.tpl:8, worktree-domains.tpl:380}`, `generators.json:77` | legitimate ("reverse-proxied") |
| `proxied` | `migrations.json:198`, `migrations/0.24.3/*`, `migrations/0.50.0/route-emulators-through-origin.ts`, `tools/test-migrations/**` | frozen history / the rung that retires it, plus its fixtures |
| `follow-stack` | none | clean |
| `serve-preflight` | `test-generators/cases/stack-identity.mjs:62`, `test-migrations/cases/0.50.0-serve-runs-its-own-stack.mjs:70` | assertions of absence |
| `reap-emulators` | `migrations.json` + `0.50.0/retire-reap-emulators.ts` + its case; `0.50.0-recompose-pre-0.3-serve-leftovers.mjs:58` | the retiring rung and its fixtures |
| `FIREBASE_EMULATOR_PROJECT` | `emulator-project.mjs.tpl:129-141` (the refusal), `HOUSE.md.tpl:249` (docs), `test-scaffold/emulators-only.test.sh:146-157` (the refusal's test) | allowed |
| `--environment staging` | `migrations.json:192`, `0.50.0/correct-app-hosting-guidance.ts`, its case; `firebase-app-hosting/SKILL.md:37` ("that flag never existed") | legitimate |
| `nodeMajor` | `_utils/node-version.ts`, `devcontainer/{compose,generator}.ts`, `layers/{agent,node,descriptor}.ts`, `test-layers/run.mjs`, a `0.50.0-declare-node-version` fixture comment | legitimate: the internal `{{nodeMajor}}` token fed from `.nvmrc`, not an option |
| `portOffset=` | `_utils/inline-house-sections.ts:165`, `migrations/0.25.0`, `0.35.0`, `0.50.0/route-emulators-through-origin.ts`, migration cases | frozen matching text / the retiring rung |
| `portOffset=` | `test-scaffold/dev-engine.checks.mjs:158` | legitimate: asserts `--portOffset=1` is refused. DF1b's stale `:102/114/117` illustration is **gone** |
| `platform/enforce-module-boundaries` | `test-generators/cases/platform.mjs:80`, `test-migrations/cases/0.50.0-close-the-platform-firewall.mjs:136` | assertions of absence |

**No unexplained hit.**

## 3. Container rebuild from this branch, for this repo

The container-inputs CLI against `9e34af3` reports `changed: .devcontainer/house.packages.sh` and nothing else.
`devcontainer.json`, `devcontainer-lock.json`, `house.Dockerfile`, `post-create.sh`, features and `os-packages.txt` are
all unchanged.

- **Image:** still `FROM mcr.microsoft.com/devcontainers/typescript-node:22`. `.nvmrc` = `22`, so Node stays on 22.
- **Package layer:** `house.Dockerfile` COPYs `house.packages.sh`, so the cache is busted and the same set reinstalls
  once: tmux, curl, pulseaudio-utils, espeak-ng, plus `os-packages.txt` (alsa-utils, sox). This repo has no apt
  repositories and no archive tools, so nothing new arrives.
- **Features, mounts, env, PATH:** unchanged.
- **What disappears:** `/usr/bin/gcloud` and `/etc/apt/sources.list.d/google-cloud-sdk.list`. They exist in this
  container today only because of a hand install during W1. This repo has no firebase layer.

Checklist after the rebuild:
1. `node -v` → `v22.x`; `which -a node` → only `/usr/local/bin/node`.
2. `cat .nvmrc` → `22`.
3. `which -a gcloud firebase` → **empty**; `ls /etc/apt/sources.list.d/` → no `google-cloud-sdk.list`; `/opt/bespunky`
   absent.
4. `tmux -V`, `espeak-ng --version`, `sox --version`, `paplay --version` all work.
5. The post-create log shows `[os-packages] all present — nothing to install`, with no `FAILED`.
6. Persisted state: `ls ~/.config ~/.local ~/.cache` still populated; `gh auth status` logged in; `claude` logged in
   with no re-login.
7. `claude plugin marketplace list` shows the local `claude-toolkit` (post-create's declared-source pre-install).

The firebase half (the gcloud archive under `/opt/bespunky`, `firebase` from `node_modules/.bin`) cannot be observed
from this repo's rebuild. It needs a rebuilt Firebase fixture project.

## 4. Release invariants: `node tools/check-release-invariants/check.mjs` → exit 1, 3 violations

1. **`bespunky-house`**, `0.47.2` (192 files): the checker says `nx release version --projects=bespunky-house --specifier=patch`.
   The change is a new `ci` layer plus new behaviour throughout, so **`minor` → 0.48.0** is the honest specifier.
2. **`bespunky-workflow`**, `0.11.0` (14 files: `branches.mjs` now accepts only the object form of `deploys`, plus
   skill text): the checker says `patch`. The schema change is breaking for declared models, so **`minor` → 0.12.0**.
3. **`@bespunky/nx-tools`**, "changed since 0.50.0 was released at 53cb79d": **a false positive.** `53cb79d` is this
   branch's own version-setting commit, and 0.50.0 is **not on npm** (latest is 0.49.2). The checker treats any commit
   that sets a version as a release. The highest migration is 0.50.0, equal to the payload version, so the payload
   can ship as **0.50.0 with no further bump**. However, this check will stay red, in CI and in the pre-push hook,
   until either the version moves again or the checker learns that an unpublished version is not a release. That is
   a decision for the orchestrator. One option is to re-assert the bump in the release commit itself, so that commit
   becomes the "last release".

## Cleanup

The dogfood's released worktrees were removed, and its consumers were deleted (the `--keep` copy by hand). The tool
reported "no process left under the workdir" on both runs. The `pgrep` I ran against the scratch paths afterwards
matched nothing, and the listening ports are identical before and after.
