# Baton — the real image build, verified by the user's rebuild (pending)

> "No. I'll do the rebuild. Prepare everything so I come back to you after it and you can verify" — the user
> (declined docker-outside-of-docker for this repo)

**State:** feat/playwright-deps-layer is done and reviewed (nx-tools 0.49.0, house 0.47.0, browser-automation 0.6.1),
NOT landed. The only open check is a real web-layer image build.

**Prepared:** a throwaway angular-preset project built from THIS branch (`house.sh new --local --preset=angular`) at
`.claude/worktrees/house-web-verify/` (gitignored in the toolkit repo; on the host under the repo folder). Its
`.devcontainer/post-create.local.sh` ends with `bash ./verify-image.sh`, which writes
`.verify/report-<UTC>.txt` (house build, apt lists empty, installer all-present, Chromium deps via dpkg, no
--with-deps, Chromium resolves + ldd clean + runs headless, ~/.cache|.local|.config|.claude mounted, no nested
ms-playwright mount, timestamps for comparing a second rebuild).

**On return:** read every report in `.claude/worktrees/house-web-verify/.verify/`; all PASS → second report's
timestamps equal the first's (nothing reinstalled) → propose landing; then delete the throwaway project and its
volumes are the user's to `docker volume rm house-web-verify-*`.

**Found on the way (separate, NOT this effort):** `house.sh new <absolute path>` joins the path under ~/projects/
(the app came out as `apps//workspaces/...`) and tries `gh repo create` for the project (failed here — nothing created).
