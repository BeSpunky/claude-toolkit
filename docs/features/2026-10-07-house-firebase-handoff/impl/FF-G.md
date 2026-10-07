# FF-G — R1-3: gcloud from Google's versioned archive, not its rolling apt index

2026-10-07 · branch `feat/house-firebase-handoff--ff` · fixes review finding **R1-3** (and W1 "Follow-ups §2"'s mechanism).

## Reproduction (run, not assumed)

- Google's apt index is a rolling window. `packages.cloud.google.com/apt/dists/cloud-sdk/main/binary-{amd64,arm64}/Packages`
  lists **48** `google-cloud-cli` versions for each arch, **543.0.0-0 … 588.0.0-0**, so a release falls out after about a year.
  The `google-cloud-cli=588.0.0-0` pin would have expired, and every cache-miss image build would fail with it.
- The versioned archive keeps old releases. A HEAD request on `dl.google.com/dl/cloudsdk/channels/rapid/downloads/google-cloud-cli-480.0.0-linux-{x86_64,arm}.tar.gz`
  (released 2024-06-11, well outside the apt window) returned **200** for both arches. 588.0.0 is served too.
- The `x86_64` tarball bundles its own Python (`platform/bundledpythonunix`, which `gcloud version` reports as python3 3.14.7),
  so the image needs no Python. Its `bin/gcloud` resolves its install root through symlinks.

## Design

**A new fragment concept: `archives` (`ArchiveTool`, layers/descriptor.ts).** It describes a tool Debian does not ship,
taken from its publisher's versioned archive: `id`, `version`, `bin` (the directory inside the archive) and
`downloads` per Debian architecture (`amd64`/`arm64` → `{ url, sha256 }`). This is the honest shape of the fix, a
general mechanism ("a pinned archive tool") rather than a gcloud special case in the template. The firebase layer is
its first user.

- **Composer** (`compose.ts`): it merges `archives` by id (first wins). An archive is distro-neutral, so a foreign image
  gets it too. `renderOsPackagesScript` now takes the composition. It validates every field (id, version, arch, sha256,
  https `.tar.gz` url, a `bin` with no `..`), because the installer runs as root. It renders one line per arch into
  `HOUSE_ARCHIVES` (`{{#ARCHIVES}}` section, so a project with no archive tools gets no archive code). It also adds the
  mechanism's own needs, `curl ca-certificates`, as the LAST package group, so only what no layer already lists is added.
- **Installer** (`house.packages.sh.tpl`): it is still the one installer and the one cached image layer, and
  post-create runs it too.
  - An archive is **pending** unless `/opt/bespunky/<id>/current` points at the pinned version and that directory exists.
    "All present" now means no packages are missing and nothing is pending.
  - For each pending archive: download it, check it with `sha256sum -c` (a mismatch is refused and nothing is touched),
    and extract it into `.partial`. Then `mv` it to `<version>`, run `ln -sfn` to point `current` at it, and link every
    executable under `<bin>` into `/usr/local/bin` through `current`. `/usr/local/bin` comes ahead of `/usr/bin` on the
    images' PATH.
  - Clean-up: links in `/usr/local/bin` that now dangle (a tool the old release had) are removed, and so is the previous
    release's directory.
  - A moved pin installs beside the old release and switches over, in either direction. There is no downgrade dance.
  - A file at a link name that the installer did not make is **left alone, and the installer says so**.
  - An architecture with no archive line is reported and makes the exit non-zero.
  - The apt half is unchanged (now inside `install_packages()`), and the exit status covers both halves.
  - `HOUSE_PACKAGES_ROOT` re-roots `/opt/bespunky` and `/usr/local/bin`, for the toolkit's own tests only.
- **The sha256 is projected, not typed.** `GCLOUD_CLI_VERSION = '588.0.0'` (versions.ts) stays the human's pin.
  `node tools/firebase-compat/project.mjs --write` downloads both archives, hashes them and writes
  `_utils/gcloud-archive.ts` (GENERATED). The check (no `--write`, run in CI) is cheap: the projection must be for the
  pin and carry the pin's URLs (`STALE:` otherwise), and both URLs must answer a HEAD request (`GONE:` otherwise).
  - Why the check does not re-hash: re-hashing means downloading about 140 MB on every CI run. The hash comes from the
    real file at `--write` time, and every install checks it anyway, so a bad hash fails the first install loudly.
  - `firebase.ts` refuses to compose if the projection's version differs from the pin, and the error names the command
    to run.
- **Firebase fragment**: `default-jdk-headless` stays an osPackage. gcloud is an `archives` entry with a rewritten
  `why`. A new `containerEnv` sets `CLOUDSDK_COMPONENT_MANAGER_DISABLE_UPDATE_CHECK=true`: a tarball install, unlike
  the deb, would otherwise nag users to run `gcloud components update`, which would move the pin, and which would fail
  against the root-owned install anyway. I verified that gcloud honours the variable (`gcloud config get` returns
  `true`).
- **Persistence audit.** The install is an image layer, and its state stays in `~/.config/gcloud`.
  `gcloud info` reports `global_config_dir = /home/node/.config/gcloud`, which is the agent layer's persisted volume.
  Nothing new needs to persist.
- **Removed (unreleased 0.50.0 code, now with no user):** the `AptRepository` type and the `repository` field, the
  `HOUSE_REPOSITORIES` list and its `repositories()` installer, and the `name=version` apt pins (name and version
  validation, versioned `present()`). `wanted()` and the package check are back to their 0.49.2 shape. A `git grep`
  for `AptRepository|HOUSE_REPOSITORIES|google-cloud-cli=|signed-by|apt-key|name=version` finds nothing left outside
  the review docs.
- **0.50.0 rung `gcloud-cli-from-image`**: the behaviour is unchanged (it still retires the jajera feature). Its header,
  its message ("a pinned archive in the image") and its `migrations.json` description are reshaped. The fixture case's
  header comment is updated, and its 4 cases still pass.
- **Docs**: README (the firebase row), `skills/new/SKILL.md` (two mentions). `tips.txt` is still accurate. HOUSE.md.tpl
  had no apt mention.
  - Not touched, because it is in the other agent's paths: CLAUDE.md's "composed devcontainer" list could name
    `archives` beside OS packages.

## Verification

**Run in this container** (Debian, as `node` with sudo, which is the post-create path). The real installer was rendered
by the compiled devcontainer generator for an `nx,agent,node,firebase` workspace.

- I shimmed `dpkg-query` to report only `default-jdk-headless` as installed, so the run did not install a JDK here.
  Everything else ran for real: curl, `sha256sum`, sudo, tar, `/opt`, `/usr/local/bin`.
- **Install:** took about 10 s. Afterwards `which -a gcloud` gave **`/usr/local/bin/gcloud`, then `/usr/bin/gcloud`**
  (this container's apt copy, left by W1), so the archive wins. `gcloud version` reported `Google Cloud SDK 588.0.0`.
  `gcloud info` gave `sdk_root` under `/opt/bespunky/google-cloud-cli/588.0.0`, the bundled Python, and config dir
  `/home/node/.config/gcloud`.
- **Second run:** `[os-packages] all present — nothing to install`.
- **Pin move:** the same rendered script with its amd64 line set to 560.0.0 (sha computed from Google's archive).
  It installed and switched, leaving only `560.0.0/` plus `current`. `gcloud version` reported 560.0.0.
  Running the 588 script again switched back cleanly with no dangling links, which also exercises a backwards move.
- **Cleanup:** I removed `/opt/bespunky` and its links, so the container is back to its prior state: apt gcloud 588
  at `/usr/bin` (from W1) and an untouched `~/.config/gcloud`. My temporary directories are gone.

**Tests:**
- `node tools/test-layers/run.mjs`: **101 passed, 0 failed**.
  - A new behaviour case runs the rendered installer against a re-rooted filesystem with stubbed curl and uname. It
    covers: install, a no-op at the pin, a pin moved forward (old release and its dangling link gone), a pin moved
    back, a sha mismatch refused with `current` untouched, a foreign file not clobbered, and a missing arch failing.
  - The firebase case asserts both arch lines carry the projected sha, nothing from apt, and the `containerEnv`.
- `node tools/firebase-compat/project.mjs`: ok, and `--write` is idempotent for `firebase-compat.ts`.
- `bash tools/test-scaffold/run.sh`: all passed (22 files).
- `node tools/test-migrations/run.mjs`: 220 passed, 4 failed. The gcloud rung's 4 cases pass.
- `node tools/test-generators/run.mjs`: 179 passed, 2 failed, 23 skipped.
- All 6 failures are in the Node / `.nvmrc` work (`node-spec.ts` `'latest'`, `.nvmrc` seeding and reporting). That is
  the concurrent agent's in-flight code, untracked in this tree, and none of it touches the devcontainer or gcloud.

## Not verified

- **The image build as root** (`house.Dockerfile`): there is no Docker here. The root path runs the same script with
  `as_root=""`, and as root `tar --no-same-owner` gives root-owned files with the archive's modes. It still needs the
  rebuild dogfood before release.
- **arm64**: the archive's hash is projected and its URL answers, but nothing was installed on an arm machine.
- An adopted image whose own `/usr/local/bin/gcloud` is a real file: the installer leaves it and reports it (covered
  by the test), so that image keeps its own gcloud first on PATH.
