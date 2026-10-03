#!/usr/bin/env bash
# Where are bespunky-project-starter and bespunky-house installed FOR THIS PROJECT? A keyed read of the CLI's
# own record (`installed_plugins.json`), never a directory scan — the same discipline as bespunky-house's
# scripts/resolve-plugin-root.sh, which this stub cannot carry (it has no engine, and that script lives in the
# plugin it is handing over to).
#
#   installs.sh [<project-dir>]      # default: $CLAUDE_PROJECT_DIR, else $PWD
#
# Prints one line per install that applies to the project, newest version first within each plugin:
#
#   <plugin-id> <scope> <version> <installPath>
#
# An install APPLIES when its scope is `user`, or `project`/`local` with a `projectPath` equal to the project.
# Entries whose installPath no longer exists are stale records and are skipped. Prints nothing (exit 0) when the
# manifest is absent or unreadable, or node is missing: the callers treat "nothing known" as "say nothing" (the
# hook) or "ask the user" (sync.md) — never as a fact to act on. Read-only; writes nothing anywhere.
set -uo pipefail

PROJECT_DIR="${1:-${CLAUDE_PROJECT_DIR:-$PWD}}"
CONFIG_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
MANIFEST="$CONFIG_DIR/plugins/installed_plugins.json"

[ -f "$MANIFEST" ] || exit 0
command -v node >/dev/null 2>&1 || exit 0

node -e '
  const fs = require("fs"), path = require("path");
  const [manifest, project] = process.argv.slice(1);
  let doc;
  try { doc = JSON.parse(fs.readFileSync(manifest, "utf8")); } catch { process.exit(0); }
  const real = p => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
  const here = real(project);
  const core = v => { const m = String(v).match(/^[0-9]+(\.[0-9]+)*/); const n = (m ? m[0] : "").split(".").filter(s => s !== "").map(Number); while (n.length < 3) n.push(0); return n; };
  const cmp = (a, b) => { const x = core(a), y = core(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
  const safe = s => /^[A-Za-z0-9._+-]{1,64}$/.test(String(s));
  for (const id of ["bespunky-project-starter@claude-toolkit", "bespunky-house@claude-toolkit"]) {
    const entries = ((doc && doc.plugins && doc.plugins[id]) || [])
      .filter(e => e && e.installPath && fs.existsSync(e.installPath) && safe(e.scope))
      .filter(e => e.scope === "user" || (e.projectPath && real(e.projectPath) === here))
      .sort((a, b) => cmp(b.version || "0.0.0", a.version || "0.0.0"));
    for (const e of entries) console.log([id, e.scope, safe(e.version) ? e.version : "?", e.installPath].join(" "));
  }
' "$MANIFEST" "$PROJECT_DIR" 2>/dev/null
exit 0
