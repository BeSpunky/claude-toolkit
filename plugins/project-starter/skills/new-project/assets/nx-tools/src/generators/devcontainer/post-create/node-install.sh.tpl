# --- The project's dependencies (node — this repo has a package.json) ---
# Which package manager does THIS project use? Detected at RUN time, not baked in at generation time: this
# script re-runs on every container rebuild, long after it was generated, and a project can change package
# manager in between.
#
# Getting this wrong is not cosmetic. `yarn install` in an npm project does not switch it, it writes a SECOND
# lockfile beside the first — after which `npm ci` fails for the whole team, caused by a container rebuild.
# THE DECLARATION FIRST, then the artifacts. `packageManager` is the only signal a human deliberately wrote;
# a lockfile is a by-product, and a STRAY one is exactly what an unconditional `yarn install` used to leave
# behind. Same order as scaffold.sh and the house-doc generator.
if [ -f "$WS/package.json" ]; then
  case "$(grep -m1 '"packageManager"' "$WS/package.json" 2>/dev/null)" in
    *pnpm*) PM=pnpm; PM_INSTALL="pnpm install"; PM_EXEC="pnpm exec" ;;
    *yarn*) PM=yarn; PM_INSTALL="yarn install"; PM_EXEC="yarn" ;;
    *npm*)  PM=npm;  PM_INSTALL="npm install";  PM_EXEC="npx --no-install" ;;
    *)
      if [ -f "$WS/pnpm-lock.yaml" ]; then
        PM=pnpm;  PM_INSTALL="pnpm install";  PM_EXEC="pnpm exec"
      elif [ -f "$WS/yarn.lock" ]; then
        PM=yarn;  PM_INSTALL="yarn install";  PM_EXEC="yarn"
      elif [ -f "$WS/package-lock.json" ]; then
        PM=npm;   PM_INSTALL="npm install";   PM_EXEC="npx --no-install"
      else
        # A package.json that declares nothing and has no lockfile: the house default — the same one scaffold.sh
        # falls back to, so the container and the sync never disagree about it.
        PM=yarn;  PM_INSTALL="yarn install";  PM_EXEC="yarn"
      fi
      ;;
  esac
  echo "[post-create] package manager: $PM"
  echo "[post-create] $PM_INSTALL"
  $PM_INSTALL
else
  echo "[post-create] no package.json — no package-manager install (the Nx wrapper hosts the house tooling)"
fi
