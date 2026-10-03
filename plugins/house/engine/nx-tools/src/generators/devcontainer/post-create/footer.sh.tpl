# --- Project-specific setup (YOURS — this script's one extension point) ---
# Everything above is GENERATED and is overwritten on every `house.sh upgrade`. That is fine for
# house steps and fatal for yours: a project that needs its own provisioning (a database client, an
# internal CA, a language runtime the house image doesn't carry) had nowhere to put it but this file,
# where the next upgrade would silently delete it. Hence a seam.
#
# `.devcontainer/post-create.local.sh` is YOURS. It is created once, never regenerated, never read by
# any generator, and it runs last — after the workspace has deps, plugins and every house prerequisite,
# which is the only point at which project-specific setup can assume a working environment.
#
# Run in a SUBSHELL (bash, not source) so a stray `exit` or a variable named like one of ours can't
# reach back into this script. A failure WARNS rather than aborts — the same stance every step above
# takes, and for the same reason: a half-provisioned container is worse than a missing optional step.
if [ -f "$WS/.devcontainer/post-create.local.sh" ]; then
  echo "[post-create] running .devcontainer/post-create.local.sh (project-specific)"
  if bash "$WS/.devcontainer/post-create.local.sh"; then
    echo "[post-create] project-specific setup done"
  else
    echo "[post-create] WARNING: .devcontainer/post-create.local.sh exited non-zero — the house setup above completed,"
    echo "[post-create]          but your project-specific step did not. Re-run it directly to see the failure:"
    echo "[post-create]            bash .devcontainer/post-create.local.sh"
  fi
fi

echo "[post-create] done"
