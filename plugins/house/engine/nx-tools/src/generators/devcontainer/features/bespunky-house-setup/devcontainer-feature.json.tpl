{
  "id": "bespunky-house-setup",
  "version": "1.0.0",
  "name": "BeSpunky house setup (chain)",
  "description": "Chains the house provisioning script, and does nothing else. Its postCreateCommand runs `.devcontainer/post-create.bespunky.sh` when that file exists and is a no-op when it does not - which is the whole feature: a Feature's lifecycle commands are ADDITIVE and run before the project's own, so house setup finally runs in a `devcontainer.json` this generator does not own and must never overwrite. Installs nothing at build time; `install.sh` is the spec-required no-op and carries the reasoning. Generator-owned (@bespunky/nx-tools:devcontainer) - regenerated on every `scaffold.sh --sync`; edit the template in the toolkit, not this copy.",
  "options": {},
  "postCreateCommand": "if [ -f .devcontainer/post-create.bespunky.sh ]; then bash .devcontainer/post-create.bespunky.sh || echo '[bespunky-house-setup] WARNING: .devcontainer/post-create.bespunky.sh FAILED - house setup is INCOMPLETE. Re-run it to see the error: bash .devcontainer/post-create.bespunky.sh'; fi"
}
