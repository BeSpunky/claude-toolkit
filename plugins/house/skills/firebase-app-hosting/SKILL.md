---
name: firebase-app-hosting
description: >-
  Deploy a house project's web app to Firebase App Hosting and keep the deploy healthy: creating a backend for an Nx app (its Root Directory must be the app - the Nx build fails at the default /), the two deploy modes and which one is live (GitHub rollouts via a Developer Connect link vs firebase deploy from local source), where apphosting.yaml and apphosting.ENV.yaml are read from (the nearest up from the Root Directory wins), binding a staging backend to its Environment name (a console setting), and moving the GitHub link to another Google or GitHub account or org. Use when the user asks to deploy the WEB APP or put it online, create or fix an App Hosting backend, or set up a staging backend; when a rollout does not trigger, a build cannot find the Nx project, staging ships production config, or an apphosting.yaml change has no effect; or when the repo or Firebase project moves accounts. Not for Cloud Functions or rules deploys (the deploy Nx targets) or CI deploys (the ci layer).
---

# Firebase App Hosting — deploy a house project, and keep it deploying

A house project with a client app deploys it through **Firebase App Hosting** (framework-aware: it runs the
build, then serves it on Cloud Run). Cloud Functions deploy separately (`nx run <functions>:deploy`, see
`HOUSE.md`). This skill is the operational truth for App Hosting; `HOUSE.md`'s *Deploying* section is the short
version and points here.

**Ground rules.** Never fabricate cloud state — `.firebaserc`, backend ids, the web config and the
Developer Connect link all come from the Firebase CLI / console. Run commands from the workspace root inside the
devcontainer: `firebase` there is the project's own pinned `firebase-tools` (on PATH through `node_modules/.bin`; outside the container the same commands run as `npx firebase …`), and `gcloud` is in the image. Before anything account-shaped, check *who* is signed
in: `firebase login:list`, `gcloud auth list` — the wrong active account is the root of most App Hosting
confusion. Every step that links an outside account (GitHub, OAuth) is the user's to perform; walk them through
it, then verify.

## 1. Create the backend — Root Directory = the app

```bash
firebase apphosting:backends:create --project <projectId> \
  --backend <backendId> --primary-region <region> --root-dir <appsDir>/<app>
```

- **`--root-dir` is not optional for Nx.** Firebase's own monorepo guide: without it "the build will fail and
  display a message that App Hosting can't find a project to target inside the Nx monorepo". The interactive
  prompt defaults to `/` — that default is wrong for every house app. The path is relative to the repo root
  (`apps/web`, not `/workspaces/<repo>/apps/web`); `HOUSE.md` names this project's apps directory.
- **Interactive `backends:create` always links a GitHub repo** (and asks for the **live branch**) — it creates the
  backend in GitHub mode (§2). Pass `--app <webAppId>` to attach an existing Firebase web app instead of creating
  one named after the backend.
- **There is no `--environment` flag.** A backend's *Environment name* (which `apphosting.<env>.yaml` it reads,
  §3) is set in the console: App Hosting → the backend → **Settings → Environment**. The house once told users to
  pass `--environment staging`; that flag never existed.
- Console equivalents, for checking or fixing an existing backend: **Settings → Deployment** holds the repository,
  the **Root directory** and the **live branch**; **Settings → Environment** holds the Environment name.

Then fetch the web config — `firebase apps:sdkconfig WEB <appId> --project <projectId>` — and paste it into the
app's production environment file (`HOUSE.md` names it).

## 2. Two deploy modes — know which one is live

| | **GitHub (automatic rollouts)** | **Local source (`firebase deploy`)** |
| --- | --- | --- |
| Set up by | interactive `backends:create`, or connecting a repo later in **Settings → Deployment** | `firebase init apphosting` (writes `firebase.json` → `apphosting: [{ backendId, rootDir, ignore }]`, can create the backend) |
| A deploy is | a push to the backend's **live branch** (or `firebase apphosting:rollouts:create <backendId> --git-branch <b>` / `--git-commit <sha>`) | `firebase deploy --only apphosting:<backendId>` from your tree, committed or not |
| Builds from | the repo at that commit | a zip of the directory holding `firebase.json` — the whole workspace, minus `ignore` and every `.gitignore` |
| Needs GitHub | yes | no — the way to deploy before a remote exists |

**Which is live:** `firebase apphosting:backends:list --project <projectId>` (or `backends:get <backendId>`) — the
**Repository** column shows the linked repo in GitHub mode and is empty for a source-only backend. A backend can
be both: `firebase deploy` on a GitHub-linked backend asks before overriding it and records the answer as
`alwaysDeployFromSource` in that `firebase.json` entry.

**Monorepo specifics, both modes:**
- An Nx app's build reads far more than its own directory — `libs/`, `tools/`, the root `package.json` and
  lockfile, `nx.json`. So in GitHub mode never restrict which changed paths trigger a rollout to the app directory;
  in source mode `rootDir` is the app but the upload is the workspace (that is correct — keep it).
- Source mode: make `ignore` cover what is big or machine-local —
  `["node_modules", ".git", ".nx", "dist", "tmp", "firebase-debug.log", "firebase-debug.*.log"]`. Emulator data and
  `.secret.local` are already out through `.gitignore`, which firebase-tools honours.
- The house generator owns only `firebase.json`'s `emulators` and `functions` keys; an `apphosting` key you add is
  preserved by every upgrade.

## 3. Where `apphosting*.yaml` is read from

App Hosting's builder starts at the backend's **Root Directory** and walks **up** to the first directory holding
**any** `apphosting.yaml` / `apphosting.<env>.yaml`. That directory is the backend's config home:
- `apphosting.yaml` there is the base; `apphosting.<env>.yaml` **beside it** is merged over it when the backend's
  Environment name is `<env>`. An override anywhere else is never read.
- The house seeds both at the **workspace root** (`--staging` adds `apphosting.staging.yaml`), which the walk
  reaches from `<appsDir>/<app>` — one home, shared by every backend. That is deliberate: one place to look, next
  to `firebase.json`.
- **Shadowing.** Any `apphosting*.yaml` nearer to the app — e.g. `<appsDir>/<app>/apphosting.yaml` — wins, and the
  root files (the staging override included) stop applying to that backend, silently. The house upgrade warns
  when it finds this. Choose one home per backend: when two backends genuinely need different config, give each
  app its own `apphosting.yaml` + overrides in its directory and remove the root ones (the house never re-seeds a
  root file once the app has its own).
- **Staging ships production config** when the staging backend's Environment name is not `staging` (it then reads
  `apphosting.yaml` only) or when `apphosting.staging.yaml` is not beside the base file that backend reads. Check
  both before anything else.

## 4. Moving accounts or orgs

The GitHub link does not live in Firebase — it lives in **Developer Connect**, and abandoned connect attempts pile
up there. Moving the repo to another GitHub account/org, or the Firebase project to another Google account, is a
recipe: read [`reference/moving-accounts.md`](reference/moving-accounts.md).

## Verify, every time

`backends:get` shows the Repository and URL you expect; one rollout (a push to the live branch, `rollouts:create`,
or `firebase deploy --only apphosting:<backendId>`) builds green; the served app talks to the right project (its
production environment file) — and, for staging, to staging's database.
