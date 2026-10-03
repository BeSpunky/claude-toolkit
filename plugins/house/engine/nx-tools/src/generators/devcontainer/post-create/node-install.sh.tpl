# --- The project's dependencies (node — this repo has a package.json) ---
# Which package manager does THIS project use? Detected at RUN time, not baked in at generation time: this
# script re-runs on every container rebuild, long after it was generated, and a project can change package
# manager in between.
#
# Getting this wrong is not cosmetic. `yarn install` in an npm project does not switch it, it writes a SECOND
# lockfile beside the first — after which `npm ci` fails for the whole team, caused by a container rebuild.
# THE DECLARATION FIRST, then the artifacts. `packageManager` is the only signal a human deliberately wrote;
# a lockfile is a by-product, and a STRAY one is exactly what an unconditional `yarn install` used to leave
# behind. The detection below is RENDERED from the one rule (generators/_utils/package-manager.ts), so it cannot
# disagree with the generators; house.sh keeps the same order.
if [ -f "$WS/package.json" ]; then
{{PM_DETECT}}
  echo "[post-create] package manager: $PM"
  echo "[post-create] $PM_INSTALL"
  $PM_INSTALL
else
  echo "[post-create] no package.json — no package-manager install (the Nx wrapper hosts the house tooling)"
fi
