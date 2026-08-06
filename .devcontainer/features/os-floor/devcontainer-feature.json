{
  "id": "bespunky-os-floor",
  "version": "1.0.0",
  "name": "BeSpunky OS floor",
  "description": "The apt packages EVERY BeSpunky devcontainer carries, whatever it is a devcontainer for — installed at IMAGE BUILD time as one transaction, so the container is already provisioned when post-create starts instead of racing it. Three capabilities, one list: the shared browser (xvfb + x11vnc + novnc + websockify + fluxbox + fonts, a headed Chromium on a virtual X display streamed to the human over noVNC), durable shells (tmux — a session outlives the client attached to it, the only way a shell opened into this container from the outside survives its opener restarting), and the general utilities the house tooling shells out to (procps for sysctl, which the worktree-domains proxy needs to lower net.ipv4.ip_unprivileged_port_start; iproute2 for ss port probes; curl for fetches). Unconditional by design — it is gated on no flag and no layer. install.sh is best-effort: a transient apt/DNS failure WARNS with the exact hand-recovery command and exits 0, because a non-zero exit here fails the whole container build and a half-provisioned container beats no container. Generator-owned (@bespunky/nx-tools:devcontainer) — regenerated on every scaffold.sh --sync; edit the template in the toolkit, not this copy.",
  "options": {}
}
