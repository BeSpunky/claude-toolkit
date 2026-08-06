# BRIEF — house capabilities as locally-consumed DevContainer features

**Slug:** `devcontainer-features` · **Opened:** 2026-08-06

## The ask, in the user's words

> "OK, implement our features for local consumption. I don't want another deploy procedure."

Two constraints, both load-bearing:

- **Local consumption** — features are referenced by *relative path* from `devcontainer.json`, so they
  live inside the project that uses them. Nothing is packaged, pushed, or downloaded.
- **No second deploy procedure** — explicitly no ghcr publish, no OCI artifact, no GitHub Action, no
  second version surface beside the npm payload. The features ship *inside* the payload, as generator
  template artifacts, and are versioned by the payload's own version.

## The design problem

Three always-on house capabilities are provisioned by `.devcontainer/post-create.sh`, which runs
**after** the container starts. In a project that already had its own devcontainer, the generator
writes the house script as `post-create.bespunky.sh` and does **not** chain it — so those capabilities
silently never install, with no error anywhere. (Named and left open in
`docs/features/2026-08-06-devcontainer-tmux/DECISION.md` §"Accepted, not acted on".)

Separately, the **voice** capability is split across two generated files: `devcontainer.json.tpl`
declares the `/mnt/wslg` mount and `PULSE_SERVER`, while `post-create.sh` installs the packages — and,
unable to see the flag, *infers* it by testing whether the mount exists (`[ -d /mnt/wslg ]`).

## Scope

**In:** two features — `os-floor` (the always-on apt floor) and `voice` (packages + mount + env as one
unit). Both authored as generator templates, written into every scaffolded project, and mirrored into
this repo's own `.devcontainer/` (dogfooding).

**Out, deliberately:**

- **The Claude plugin pre-install** and **the Playwright Chromium download** — both write into paths
  that a mount replaces at container start (`/home/node/.claude` bind; the `ms-playwright` volume). A
  build-time install of either is discarded the moment the container starts. They stay in post-create.
- **The shared-browser capability as a whole** — its `runArgs` (`--sysctl`, `--add-host`) have no
  feature equivalent, its port-registry chown targets a volume mount point, and its noVNC band is
  single-sourced from `novnc-band.ts` for `portsAttributes`. Its *apt packages* move with the OS floor;
  the capability does not. Flagged to the user as a separate decision and left alone.
- **The JDK** (`--firebase`) — one apt line, already settled, no adoption exposure worth the churn.

## The constraint that shapes `install.sh`

A feature's `install.sh` runs during the **build**. A non-zero exit fails the whole build. The house
stance everywhere in `post-create.sh` is the opposite: retry, then **warn and continue**, because a
half-provisioned container beats no container. That stance is preserved — each `install.sh` retries
three times with backoff and then exits 0 with a loud warning naming the hand-recovery command.
