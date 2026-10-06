---
effort: playwright-deps-layer
status: concluded
concluded: 2026-10-06
summary: Container setup is unattended (no prompt can hang it); Chromium's system libraries are image packages (projected from Playwright's own table for the pinned version; foreign images keep --with-deps) and ~/.cache is one persisted volume — the last things a rebuild still reinstalled. nx-tools 0.49.0, bespunky-house 0.47.0, bespunky-browser-automation 0.6.1.
tags: [house, devcontainer, docker, playwright, rebuild, persistence, migration]
---

# The last things a rebuild still reinstalled

> "Why would you not include it in the refactor?? Now we have to test again, release another version, run upgrade
> again in consumer projects.." — the user, on 0.48.0 shipping with Playwright `--with-deps` still reinstalling.

0.48.0 should have carried this; it went out minutes before this effort, no consumer had upgraded, so 0.49.0 lands
both in one upgrade. Saved as a standing rule (memory: no deferred gaps).

## Decisions
- **Chromium's OS dependencies are `osPackages`** of `web` and `js` (one shared group, de-duplicated) — the cached
  image layer. The list is a **projection of Playwright's own `install-deps` table** for `PLAYWRIGHT_VERSION` on Debian
  13 (`tools/playwright-deps/project.mjs`; the table is read in an empty vm context). test-layers fails offline on a
  stale version; CI re-projects from the real tarball. All 32 names resolve on trixie, no conflicts with tigervnc.
- **House-image-only**: on a foreign image (bookworm, Ubuntu) one Debian-13 name failed the whole apt transaction, so
  the group is left out there and the browser installs keep Playwright's own `--with-deps` for that distro.
- **The installer falls back to one-by-one** when a batch fails, names the culprit, still exits non-zero.
- **`~/.cache` is one persisted volume** (agent) — Playwright browsers, the shared browser's own runtime (which sat
  outside any volume and downloaded every rebuild), package-manager caches. Replaces web's per-tool volume; migration
  0.49.0 removes that mount whoever wrote it (superseded — the 0.43.0 precedent), keeps a differently-sourced one,
  reports the unused host volume by name.
- **The runtime prunes earlier pins' copies** before installing (persisted ~/.cache would otherwise keep their
  browsers forever); `shared-browser up` names missing Chromium libraries and the fix.
- **Accepted**: Chromium's recommends (+~130 MB once, in the cached layer — dropping recommends also drops tools other
  pieces may use); ~/.cache over a foreign image masks what that image ships there after an image update (documented
  reset: `docker volume rm <folder>-cache`; 0.48 already had this for ms-playwright).

## Verified
test-layers 95 · test-generators · test-migrations 113 · test-scaffold · projection check against the real tarball ·
two read-only reviews (upgrade simulation over 8 shapes with 0.48 generator output; diff critique incl. apt
simulation) — every finding fixed or accepted above · dogfood upgrade on this repo (no web layer: ~/.cache only).
**Real image build, verified by the user's rebuild** (a throwaway angular-preset project built from this branch, its
setup ending in a self-check; the user declined docker-outside-of-docker for this repo):

> "No. I'll do the rebuild. Prepare everything so I come back to you after it and you can verify" — the user

21/21 on both rebuilds: built from house.Dockerfile; apt lists empty and the installer all-present (every package
from the image); Chromium's libraries via dpkg; no --with-deps; Chromium resolves, ldd clean, runs headless; ~/.cache,
~/.local, ~/.config, ~/.claude mounted, no nested ms-playwright. Second rebuild: identical timestamps for the package
layer, the Chromium download, the shared-browser runtime and Claude Code — nothing reinstalled.
The first attempt HUNG on a yarn 1 prompt (the fixture pinned the unpublished 0.49.0) — which exposed a real bug,
fixed here: post-create is unattended (stdin /dev/null; yarn 1 --non-interactive, since without it yarn 1 exits 0
with nothing installed).
