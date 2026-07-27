// BeSpunky-standard devcontainer. Node from the base image; Claude CLI (feature) + Claude VS Code extension.
// Conditional blocks (`{{#flag}}...{{/flag}}`) are expanded by the devcontainer generator before writing.
{
  "name": "{{name}}",
  "image": "mcr.microsoft.com/devcontainers/typescript-node:{{nodeMajor}}",

  "features": {
    "ghcr.io/devcontainers-extra/features/claude-code": {},
    "ghcr.io/devcontainers/features/github-cli": {}{{#firebase}},
    "ghcr.io/devcontainers-extra/features/firebase-cli": {},
    "ghcr.io/jajera/features/gcloud-cli": {}{{/firebase}}
    // Note: the JDK required by the Firebase emulators (Firestore / RTDB / Storage all run
    // on the JVM) is installed via apt in .devcontainer/post-create.sh — NOT as a
    // devcontainer feature. The canonical `ghcr.io/devcontainers/features/java` is
    // SDKMAN-based and structurally fragile (its install fetches from github.com, which
    // intermittently fails: TLS errors / "Could not connect to server"). apt pulls from
    // Debian's package mirrors which are far more reliable, and apt runs in the container's
    // runtime network stack rather than the buildx build phase.
  },

  "customizations": {
    "vscode": {
      "extensions": [
        "Anthropic.claude-code",
        "nrwl.angular-console",
        "Angular.ng-template",
        "dbaeumer.vscode-eslint",
        "esbenp.prettier-vscode",
        "EditorConfig.EditorConfig",
        "eamodio.gitlens",
        "GitHub.vscode-github-actions",
        "Tobermory.es6-string-html",
        "christian-kohler.path-intellisense",
        "formulahendry.auto-rename-tag",
        "usernamehw.errorlens"{{#firebase}},
        "toba.vsfire"{{/firebase}}
      ],
      "settings": {
        // Claude's permission posture is set once in .claude/settings.json (permissions.defaultMode: "auto")
        // — deliberately NOT a blanket skip here. "auto" gives frictionless auto-approval WITH the background
        // safety classifier (it still blocks actions that escalate beyond the request or touch unrecognized
        // infrastructure), the right default even in an isolated container.
        "editor.formatOnSave": false,
        "editor.codeActionsOnSave": {
          "source.fixAll.eslint": "explicit"
        },
        "eslint.validate": ["javascript", "typescript", "html"],
        "typescript.preferences.importModuleSpecifier": "relative",
        "typescript.updateImportsOnFileMove.enabled": "always",
        // Auto-forwarding is LOAD-BEARING here, not a convenience: the shared browser's noVNC port is
        // allocated at runtime (see forwardPorts below), so it can only reach the host by being detected
        // and forwarded when it starts listening. Pinned here explicitly — these land at the container
        // (Remote) scope, which overrides a user who turned auto-forward off globally, so the viewer URL
        // still works. (A committed .vscode/settings.json would override THIS, so don't contradict it
        // there.) "process" watches /proc for listening sockets, which is how the loopback-bound
        // websockify is found — VS Code keeps candidates bound to localhost as well as 0.0.0.0.
        "remote.autoForwardPorts": true,
        "remote.autoForwardPortsSource": "process",
        "files.associations": {
          "*.mdc": "markdown"
        }
      }
    }
  },

  // All post-create setup (yarn install, claude-toolkit plugin pre-install, Firebase
  // prerequisites when firebase.json is present) lives in .devcontainer/post-create.sh
  // so this stays a one-liner. The script is self-adapting — no mustache conditional needed.
  "postCreateCommand": "bash .devcontainer/post-create.sh",
  "remoteUser": "node",

  // `--sysctl`: let the non-root `node` user bind privileged ports — the worktree-domains reverse proxy
  // binds :80 so each worktree gets a pretty http://<slug>.localhost/ domain. Applied at container start,
  // so the proxy binds :80 with no runtime sudo.
  // `--add-host`: give the container a name for the host it runs on, so the shared-browser port
  // allocator can probe the host side (the gate that spots a NON-devcontainer process squatting a port
  // in the noVNC band). Docker Desktop provides this name already; on a plain Linux engine it doesn't
  // exist, hence the flag.
  // KNOW ITS LIMIT: on a plain Linux engine host-gateway is the bridge address, which does NOT reach
  // services bound to the host's own 127.0.0.1 — and forwarded ports are loopback-bound. So this probe
  // is a bonus that can only REJECT a port, never a proof of freeness. The cross-container registry
  // (the volume mounted below) is the gate that actually carries the guarantee.
  // NOTE: `runArgs` is image/Dockerfile-only. If this ever converts to `dockerComposeFile`, `--add-host`
  // must move to the service's `extra_hosts` or the allocator loses its host probe silently.
  "runArgs": [
    "--sysctl", "net.ipv4.ip_unprivileged_port_start=0",
    "--add-host=host.docker.internal:host-gateway"
  ],

  // Forward :80 (the worktree-domains reverse proxy → pretty http://<slug>.localhost/ URLs, reachable
  // from a HOST browser too) in EVERY scaffold. NOTE — :80 has the SAME silent-wrong-target problem the
  // noVNC port just had, and it is NOT fixed here: `<slug>.localhost` on the host has no port to
  // remap, so with two containers up it resolves to whichever one won host :80. Treat the host tab as
  // first-come; the shared browser is the surface that works for every container.
  //
  // The shared-browser noVNC port is deliberately NOT listed. It is ALLOCATED at `up` out of the
  // 6080-6119 band (claimed in the `bespunky-shared-ports` volume mounted below — shared by every
  // BeSpunky devcontainer on this engine), so parallel containers each get their own number and the
  // editor's auto-forward maps it host==container with no remap. Statically forwarding a fixed 6080
  // is exactly what broke: two containers both bind their own 6080, the second gets silently forwarded
  // to a different HOST port, and any URL naming 6080 then points at the OTHER container's browser.
  // Read the real URL from `tools/shared-browser/shared-browser url` (or `status --json`) — never
  // hardcode it. CDP 9223 and VNC 5900 stay loopback-only, so full browser control never leaves the
  // container. The Firebase dev-server + emulator ports are appended below when applicable.
{{#firebase}}  //
  // Firebase also forwards the dev server + emulator ports to the SAME host port. This is
  // REQUIRED for the app to work in a *host* browser: the page loads over forwarded
  // :4200, then the Firebase SDK *inside that page* calls the emulators at the
  // hardcoded localhost:9099 / localhost:8080 (environment.ts) — addresses that only
  // resolve from the host if those container ports are forwarded to the identical
  // host port. Auto-forward alone may map a container port to a *different* free host
  // port, which the browser SDK can't discover → the page hammers localhost:9099 and
  // gets ERR_CONNECTION_REFUSED (auth token refresh fails → Firestore writes hang).
  //
  // KNOWN LIMITATION, still open: running SEVERAL Firebase devcontainers in parallel
  // collides on these host ports, and unlike the noVNC port they are NOT arbitrated —
  // the second container is silently remapped. The mitigation is to stop depending on
  // them: the shared browser runs INSIDE the container and reaches 4200/9099/8080 on
  // container loopback, so watch a second container's app at its own allocated noVNC
  // URL and these forwards don't matter to it. But the host surface is still
  // first-come, and real Google OAuth is pinned to whichever container holds host
  // :4200. Same applies to :80 below. If you insist on a HOST browser for a second
  // container, remap its ports here AND in environment.ts + firebase.json together
  // (they must agree). For the normal single-container case, same-port is correct.
{{/firebase}}  "forwardPorts": [80{{#firebase}}, 4200, 4000, 9099, 8080, 9150, 9199, 5001{{/firebase}}],
  // `portsAttributes` labels the (forwarded or auto-detected) ports; `onAutoForward`
  // controls per-port notification behavior — backend emulators are silenced (you
  // rarely click into them), the dev server opens in the preview pane.
  //
  // The noVNC band is emitted as ONE EXACT KEY PER PORT (by the generator, from the shared band
  // constants) rather than a "{{novncBand}}" range — deliberately. A range key matches for `label` and
  // `onAutoForward` but the editor DISCARDS `requireLocalPort` unless the key is an exact port number,
  // and `requireLocalPort` is the piece that matters: the editor prefers host port == container port and
  // only remaps on conflict, but that remap is SILENT. With this flag it prompts instead. That is the
  // backstop for the one case allocation cannot see — a host process bound to the host's own 127.0.0.1,
  // or a second Docker engine with its own registry — so even a wrong allocation is VISIBLE, never a
  // quietly-wrong URL.
  //
  // Two side effects worth keeping (don't "tidy" these entries away): having ANY attributes entry for a
  // port defeats the editor's "initial candidates are never auto-forwarded" skip, so a window reload
  // with the browser already up still forwards it; and it overrides the blanket
  // `otherPortsAttributes: silent` below, so the viewer port still notifies while everything else stays
  // quiet. Setting `remote.autoForwardPortsSource` explicitly (above) likewise stops the 20-port
  // "switched to hybrid" fallback from silently disabling process detection.
  "portsAttributes": {
    "80": { "label": "Worktree domains (pretty <slug>.localhost URLs)", "onAutoForward": "silent" },
{{novncPortsAttributes}},
    "4200": { "label": "Angular Dev Server", "onAutoForward": "openPreview" }{{#firebase}},
    "4000": { "label": "Firebase Emulator UI", "onAutoForward": "notify" },
    "9099": { "label": "Auth Emulator", "onAutoForward": "silent" },
    "8080": { "label": "Firestore Emulator", "onAutoForward": "silent" },
    "9150": { "label": "Firestore WebSocket", "onAutoForward": "silent" },
    "9199": { "label": "Storage Emulator", "onAutoForward": "silent" },
    "5001": { "label": "Functions Emulator", "onAutoForward": "silent" }{{/firebase}}
  },
  "otherPortsAttributes": {
    "onAutoForward": "silent"
  },
  // ${devcontainerId} is the platform's own identifier — "unique to the dev container ... and stable
  // across rebuilds" (containers.dev). The shared browser's port allocator uses it as the identity that
  // OWNS a host-port claim, so a rebuild reclaims the same port (the viewer URL stays bookmarkable)
  // instead of burning a fresh slot in the band and orphaning the old claim. containerEnv rather than
  // remoteEnv so ANY process in the container sees it, not only editor-spawned ones.
  "containerEnv": {
    "BESPUNKY_DEVCONTAINER_ID": "${devcontainerId}"
  },
  "remoteEnv": {
    "PATH": "${containerWorkspaceFolder}/node_modules/.bin:${containerEnv:PATH}",
    // No CLAUDE_CODE_BYPASS_ALL_PERMISSIONS here: Claude's permission mode is governed by
    // .claude/settings.json (permissions.defaultMode: "auto"), not a hard bypass override — a
    // bypass env var would win over settings.json and defeat the "auto" default.
    // Reliable file-watching for chokidar-based watchers over WSL/Docker mounts.
    // (Replaces the legacy `poll` option on serve targets, which the modern @angular/build:dev-server schema rejects.)
    "CHOKIDAR_USEPOLLING": "true",
    "CHOKIDAR_INTERVAL": "1000"{{#voice}},
    // Bridge to WSL2's WSLg PulseAudio server (mounted below) so a process in the container
    // can reach the real speaker + mic — the sink the bespunky-voice plugin speaks/listens through.
    "PULSE_SERVER": "unix:/mnt/wslg/PulseServer"{{/voice}}
  },
  "mounts": [
    "source=${localWorkspaceFolder}/.claude/data,target=/home/node/.claude,type=bind,consistency=cached",
    "source=${localWorkspaceFolderBasename}-node_modules,target=${containerWorkspaceFolder}/node_modules,type=volume",
    "source=${localWorkspaceFolderBasename}-nx,target=${containerWorkspaceFolder}/.nx,type=volume",
    "source=${localWorkspaceFolderBasename}-angular,target=${containerWorkspaceFolder}/.angular,type=volume",
    // Playwright browser binaries (~150 MB Chromium). Mounted as a per-workspace
    // volume so rebuilds reuse the cached browser instead of re-downloading on
    // every postCreate. Populated by post-create.sh when @playwright/test is in
    // package.json.
    "source=${localWorkspaceFolderBasename}-playwright-cache,target=/home/node/.cache/ms-playwright,type=volume",
    // The cross-container host-port registry. A FIXED volume name (not per-workspace, unlike every
    // other mount here) is the whole point: every BeSpunky devcontainer on this Docker engine mounts
    // the SAME volume, which makes it the one substrate where containers can see each other's noVNC
    // port claims — and one engine is exactly one host, i.e. exactly the scope where host ports
    // collide. post-create.sh chowns it to `node` (a fresh named volume is root-owned).
    "source=bespunky-shared-ports,target=/var/opt/bespunky/ports,type=volume"{{#voice}},
    // WSLg audio (bespunky-voice): exposes the host PulseAudio socket at /mnt/wslg/PulseServer.
    // WSL-specific — this is why voice is an opt-in flag, not always-on: binding /mnt/wslg on a
    // non-WSL host (macOS / Codespaces) has no source socket. If the socket is absent after a
    // rebuild on the Docker Desktop WSL2 backend, swap the source to /run/desktop/mnt/host/wslg.
    "source=/mnt/wslg,target=/mnt/wslg,type=bind"{{/voice}}
  ]
}
