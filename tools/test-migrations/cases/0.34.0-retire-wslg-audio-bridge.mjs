// 0.34.0 — retire the WSLg-only audio bridge (`/mnt/wslg` bind + PULSE_SERVER) that `--voice` wrote.
//
// The two shapes it meets in the wild: an OWNED devcontainer as the template rendered it (house comments
// around the entries, trailing commas), and an ADOPTED one the merge spliced values into (no house comments,
// the project's own mounts and comments all around). Only the exact house values may go; every other byte —
// above all a comment explaining somebody's own mount — must survive.
import { createRequire } from 'node:module';

const DC = '.devcontainer/devcontainer.json';
const HOUSE_MOUNT = '"source=/mnt/wslg,target=/mnt/wslg,type=bind"';
const HOUSE_PULSE = '"unix:/mnt/wslg/PulseServer"';

/** Record what the migration reports, on top of the harness's own capture (which it still feeds). */
const devkitLogger = createRequire(import.meta.url)('@nx/devkit').logger;
let reports = [];
let restore = () => {};
function recordReports() {
  reports = [];
  const through = devkitLogger.warn;
  devkitLogger.warn = (...args) => {
    reports.push(args.join(' '));
    return through(...args);
  };
  restore = () => (devkitLogger.warn = through);
}

const OWNED = `// BeSpunky-standard devcontainer.
{
  "name": "demo",
  "remoteEnv": {
    "PATH": "\${containerWorkspaceFolder}/node_modules/.bin:\${containerEnv:PATH}",
    // Reliable file-watching for chokidar-based watchers over WSL/Docker mounts.
    "CHOKIDAR_USEPOLLING": "true",
    "CHOKIDAR_INTERVAL": "1000",
    // Bridge to WSL2's WSLg PulseAudio server (mounted below) so a process in the container
    // can reach the real speaker + mic — the sink the bespunky-voice plugin speaks/listens through.
    "PULSE_SERVER": "unix:/mnt/wslg/PulseServer",
  },
  "mounts": [
    "source=\${localWorkspaceFolder}/.claude/data,target=/home/node/.claude,type=bind,consistency=cached",
    // The cross-container host-port registry.
    "source=bespunky-shared-ports,target=/var/opt/bespunky/ports,type=volume",
    // WSLg audio (bespunky-voice): exposes the host PulseAudio socket at /mnt/wslg/PulseServer.
    // WSL-specific — this is why voice is an opt-in flag, not always-on: binding /mnt/wslg on a
    // non-WSL host (macOS / Codespaces) has no source socket. If the socket is absent after a
    // rebuild on the Docker Desktop WSL2 backend, swap the source to /run/desktop/mnt/host/wslg.
    "source=/mnt/wslg,target=/mnt/wslg,type=bind",
  ]
}
`;

// Merged by the adoption path: values spliced in, no house prose — and here in the MIDDLE of the arrays, the
// position where jsonc-parser's own removal would take the next member's comment with it.
const ADOPTED = `{
  // Our own container.
  "image": "ours:latest",
  "remoteEnv": {
    "PULSE_SERVER": "unix:/mnt/wslg/PulseServer",
    // Our API key lives in the host env.
    "API_KEY": "\${localEnv:API_KEY}"
  },
  "mounts": [
    // Our datasets, read-only.
    "source=/data,target=/data,type=bind,readonly",
    "source=/mnt/wslg,target=/mnt/wslg,type=bind",
    // Our ssh keys.
    "source=\${localEnv:HOME}/.ssh,target=/home/node/.ssh,type=bind"
  ]
}
`;

// The swap the house comment itself recommended on the Docker Desktop backend, and a PULSE_SERVER of the
// project's own choosing. Neither is the house literal: both stay, both are reported.
const VARIANT = `{
  "remoteEnv": {
    "PULSE_SERVER": "unix:/mnt/wslg/runtime-dir/pulse/native"
  },
  "mounts": [
    // Docker Desktop: WSLg lives elsewhere.
    "source=/run/desktop/mnt/host/wslg,target=/mnt/wslg,type=bind"
  ]
}
`;

const BROKEN_FILE = `{\n  "mounts": [ ${HOUSE_MOUNT}, \n`;

export default {
  name: '0.34.0 · retire-wslg-audio-bridge',
  ladder: ['0.34.0/retire-wslg-audio-bridge'],
  cases: [
    {
      name: 'owned: removes the house bridge and its house comments, keeps every other comment',
      setup: (tree) => {
        tree.write('.devcontainer/.bespunky-devcontainer.json', '{ "owned": true, "voice": true }\n');
        tree.write(DC, OWNED);
      },
      expect: (tree, t) => {
        t.hasNot(DC, '/mnt/wslg');
        t.hasNot(DC, 'PULSE_SERVER');
        t.hasNot(DC, 'WSLg');
        t.has(DC, '// BeSpunky-standard devcontainer.');
        t.has(DC, '// Reliable file-watching for chokidar-based watchers over WSL/Docker mounts.');
        t.has(DC, '"CHOKIDAR_INTERVAL": "1000",\n  },');
        t.has(DC, '// The cross-container host-port registry.\n    "source=bespunky-shared-ports,target=/var/opt/bespunky/ports,type=volume",\n  ]');
      },
    },

    {
      name: 'adopted: removes only the house entries, mid-array, leaving the project’s mounts and comments',
      setup: (tree) => {
        tree.write('.devcontainer/.bespunky-devcontainer.json', '{ "owned": false, "voice": true }\n');
        tree.write(DC, ADOPTED);
      },
      expect: (tree, t) => {
        t.hasNot(DC, HOUSE_MOUNT);
        t.hasNot(DC, HOUSE_PULSE);
        t.ok(
          t.read(DC) ===
            ADOPTED.replace('    "PULSE_SERVER": "unix:/mnt/wslg/PulseServer",\n', '').replace(`    ${HOUSE_MOUNT},\n`, ''),
          `expected ${DC} to differ from the original by exactly the two house lines, got:\n${t.read(DC)}`
        );
      },
    },

    {
      name: 'house entries as the LAST members with no trailing comma: separators stay valid',
      setup: (tree) =>
        tree.write(
          DC,
          `{
  "remoteEnv": {
    "CHOKIDAR_INTERVAL": "1000",
    "PULSE_SERVER": "unix:/mnt/wslg/PulseServer"
  },
  "mounts": [
    "source=a,target=/a,type=volume",
    "source=/mnt/wslg,target=/mnt/wslg,type=bind"
  ]
}
`
        ),
      expect: (tree, t) => {
        t.has(DC, '"CHOKIDAR_INTERVAL": "1000"\n  },');
        t.has(DC, '"source=a,target=/a,type=volume"\n  ]');
        t.ok(
          (() => {
            try {
              JSON.parse(t.read(DC));
              return true;
            } catch {
              return false;
            }
          })(),
          `expected ${DC} to still be strict JSON, got:\n${t.read(DC)}`
        );
      },
    },

    {
      name: 'variant source and PULSE_SERVER: untouched, and reported with the file',
      setup: (tree) => {
        tree.write(DC, VARIANT);
        recordReports();
      },
      expect: (tree, t) => {
        restore();
        t.ok(t.read(DC) === VARIANT, `expected ${DC} untouched, got:\n${t.read(DC)}`);
        t.ok(
          reports.some((r) => r.includes(DC) && r.includes('/run/desktop/mnt/host/wslg')),
          `expected the variant mount reported, got: ${JSON.stringify(reports)}`
        );
        t.ok(
          reports.some((r) => r.includes(DC) && r.includes('PULSE_SERVER') && r.includes('runtime-dir')),
          `expected the variant PULSE_SERVER reported, got: ${JSON.stringify(reports)}`
        );
      },
    },

    {
      name: 'unparseable devcontainer.json: left exactly as it is (and reported)',
      setup: (tree) => tree.write(DC, BROKEN_FILE),
      expect: (tree, t) => t.ok(tree.read(DC, 'utf8') === BROKEN_FILE, 'a file that does not parse was edited'),
    },
    {
      name: 'no devcontainer: no-op',
      setup: () => {},
      expect: (tree, t) => t.missing(DC),
    },
  ],
};
