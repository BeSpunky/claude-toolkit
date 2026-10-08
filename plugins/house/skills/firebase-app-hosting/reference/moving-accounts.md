# Moving an App Hosting project between Google or GitHub accounts

Use when the repo moves to another GitHub account or organisation, the Firebase project moves to another Google
account, or a "connect GitHub" attempt keeps failing or attaching the wrong account. Read-only steps first; every
delete and every OAuth/app-install is the user's call — show them the list and ask before deleting.

## Where the link actually lives

A GitHub-mode backend points at a **git repository link** inside a **Developer Connect connection** in the
backend's region — a Google Cloud resource, not a Firebase setting. Each connection carries one GitHub OAuth
grant and one GitHub app installation. Every abandoned "connect GitHub" attempt leaves a connection behind in a
pending state, so a project that has been fought with often has many.

```bash
gcloud auth list                     # which Google account gcloud acts as
firebase login:list                  # which one the Firebase CLI acts as
gcloud developer-connect connections list --project <projectId> --location <region> \
  --format='table(name.basename(), installationState.stage)'
```

The state is each connection's `installationState.stage` (the `--format` above puts it beside the name):
`COMPLETE` (usable), `PENDING_USER_OAUTH` (the GitHub sign-in never finished), `PENDING_INSTALL_APP` (signed in,
but the Firebase GitHub app was never installed on the repo's owner), `PENDING_CREATE_APP`.

**Which connection the backend uses** is in its `codebase.repository` — a path of the form
`projects/<p>/locations/<region>/connections/<connectionName>/gitRepositoryLinks/<linkId>`:

```bash
firebase apphosting:backends:get <backendId> --project <projectId> --json   # → result.codebase.repository
```

The *Repository* column of the plain table is only that path's last segment — the git repository link id, never
the connection name — so don't read the connection from it. (The console shows it too: **Settings → Deployment**.)

## The recipe

1. **Sign the browser into the TARGET GitHub account first** — or use a private window. The OAuth step silently
   reuses whichever GitHub account the browser is already signed into; that is how a link ends up on the old
   account.
2. **Clear orphans.** Delete the pending connections nothing uses, by name, keeping the one the backend uses until
   step 4 replaces it:
   ```bash
   gcloud developer-connect connections delete <connectionName> --project <projectId> --location <region>
   ```
3. **Move the repo** (GitHub: Settings → Transfer) if it is changing owner, and update the local remote
   (`git remote set-url origin <new-url>`).
4. **Reconnect** from the console: App Hosting → the backend → **Settings → Deployment** → connect / change the
   repository. When GitHub asks where to install the **Firebase App Hosting GitHub app**, choose the account or
   **organisation that owns the repo** — not your personal account when the repo lives in an org (an org owner may
   need to approve it).
5. **Re-check the backend's settings** — reconnecting is where they get reset: **Root directory** = `<appsDir>/<app>`
   (never `/` for an Nx app), the **live branch**, and **Settings → Environment** for a staging backend.
6. **Delete the old connection** once nothing points at it (the `connections list` again, then step 2's command).

Moving the **Firebase project** to another Google account is an IAM change, not a re-creation: add the new
account as Owner in the Google Cloud console (IAM), have it accept, then remove the old one. Backends, the
Developer Connect link and secrets stay where they are. Locally: `firebase login --reauth` (or
`firebase login:add` + `firebase login:use <email>`) and `gcloud auth login` as the new account.

## Verify

`backends:get` shows the new repository; `connections list` shows only `COMPLETE` connections that something uses;
one rollout — `firebase apphosting:rollouts:create <backendId> --git-branch <liveBranch> --project <projectId>` —
builds green.
