# container-check result

- when: 2026-10-08T05:58:05Z
- host: a217c6cbcbc1  user: node  arch: x86_64
- image: Debian GNU/Linux 13 (trixie)
- in a container: yes
- **15 passed, 0 failed**

### PASS — node -v matches .nvmrc

```
.nvmrc: 24
node -v: v24.20.0
which -a node: /usr/local/bin/node /usr/bin/node /bin/node 
```

### PASS — firebase is only node_modules/.bin, at the pinned devDependency

```
which -a firebase:
/workspaces/fb-container-check/node_modules/.bin/firebase
every entry resolves to: /workspaces/fb-container-check/node_modules/firebase-tools/lib/bin/firebase.js
entries resolving elsewhere: none
global firebase-tools installs: none
package.json devDependencies.firebase-tools: 15.32.1
node_modules/firebase-tools version: 15.32.1
firebase --version: 15.32.1
```

### PASS — gcloud is the pinned archive, no apt source, config in persisted ~/.config

```
pin (nx-tools versions.js GCLOUD_CLI_VERSION): 588.0.0
which -a gcloud:
/usr/local/bin/gcloud
first resolves to: /opt/bespunky/google-cloud-cli/588.0.0/google-cloud-sdk/bin/gcloud
/opt/bespunky/google-cloud-cli/current -> 588.0.0
gcloud --version (line 1): Google Cloud SDK 588.0.0
apt sources mentioning Google Cloud: none
dpkg google-cloud-cli/sdk installed: none
gcloud global config dir: /home/node/.config/gcloud  (~/.config is a mount: yes)
CLOUDSDK_COMPONENT_MANAGER_DISABLE_UPDATE_CHECK=true
```

### PASS — java is installed (21+)

```
which -a java: /usr/bin/java /bin/java 
openjdk version "21.0.12.1" 2026-08-18
OpenJDK Runtime Environment (build 21.0.12.1+1-1-deb13u1-Debian)
OpenJDK 64-Bit Server VM (build 21.0.12.1+1-1-deb13u1-Debian, mixed mode, sharing)
```

### PASS — house.packages.sh says all present

```
[os-packages] all present — nothing to install
```

### PASS — devcontainer.json / devcontainer-lock.json carry no firebase-cli (or gcloud) feature

```
devcontainer-lock.json: present
features in lock: ghcr.io/devcontainers/features/github-cli
matches for firebase-cli|gcloud-cli|jajera: none
```

### PASS — ~/.config, ~/.cache, ~/.local, ~/.claude are mounts

```
/home/node/.config: MOUNT  5664 5647 259:8 /var/lib/docker/volumes/fb-container-check-config/_data /home/node/.config rw,relatime master:1 - ext4 /dev/nvme0n1p8 rw,stripe=128
/home/node/.cache: MOUNT  5662 5647 259:8 /var/lib/docker/volumes/fb-container-check-cache/_data /home/node/.cache rw,relatime master:1 - ext4 /dev/nvme0n1p8 rw,stripe=128
/home/node/.local: MOUNT  5665 5647 259:8 /var/lib/docker/volumes/fb-container-check-local/_data /home/node/.local rw,relatime master:1 - ext4 /dev/nvme0n1p8 rw,stripe=128
/home/node/.claude: MOUNT  5663 5647 259:8 /home/shy/Projects/claude-toolkit/.claude/worktrees/fb-container-check/.claude/data /home/node/.claude rw,relatime - ext4 /dev/nvme0n1p8 rw,stripe=128

```

### PASS — dev loop: served on an isolated offset (never the default ports)

```
stack: web@30000  owner: container-check-4543  serve pid: 4855 (record pid 4855)
ready after 28s
ports: {"app":34200,"auth":39099,"firestore":38080,"firestore-websocket":39150,"storage":39199,"functions":35001,"ui":34000,"hub":34400,"logging":34500}
```

### PASS — dev loop: the app answers

```
GET http://localhost:34200/ -> 200, 506 bytes
<title>web</title>
<app-root>
```

### PASS — dev loop: tools/dev/dev ps lists the stack

```
web@30000  main [main]  pid 4855  up 28s  owner container-check-4543 (you)  — serve of web (tools/dev)
    http://localhost:34200/
    ports app=34200  auth=39099  firestore=38080  firestore-websocket=39150  storage=39199  functions=35001  ui=34000  hub=34400  logging=34500
    emulators: running (pid 5626, log /workspaces/fb-container-check/.bespunky/run/logs/web@30000.emulators.log)
```

### PASS — dev loop: the emulators run under the demo- project id

```
hub file: /tmp/bespunky-69ff13498dd7/hub-demo-fb-container-check.json
project id: demo-fb-container-check
suite log (/workspaces/fb-container-check/.bespunky/run/logs/web@30000.emulators.log):
i  emulators: Detected demo project ID "demo-fb-container-check", emulated services will use a demo configuration and attempts to access non-emulated services for this project will fail.
```

### PASS — dev loop: wrote a Firestore doc through the emulator REST API

```
POST :38080 …/containerCheck?documentId=check-1791439082-19736
{
  "name": "projects/demo-fb-container-check/databases/(default)/documents/containerCheck/check-1791439082-19736",
  "fields": {
    "marker": {
      "stringValue": "check-1791439082-19736"
    }
  },
  "createTime": "2026-10-08T05:58:03.313456Z",
  "updateTime": "2026-10-08T05:58:03.313456Z"
}

HTTP 200
```

### PASS — dev loop: tools/dev/dev stop

```
exit 0
[stop] stopping web@30000 (pid 4855, /workspaces/fb-container-check)…
[stop] web@30000: exported to /workspaces/fb-container-check/.emulator-data-30000
[stop] web@30000 stopped — ports free: app=34200 auth=39099 firestore=38080 firestore-websocket=39150 storage=39199 functions=35001 ui=34000 hub=34400 logging=34500
```

### PASS — dev loop: the export on stop contains the doc

```
data dir: /workspaces/fb-container-check/.emulator-data-30000
export metadata: 2026-10-08 05:58:04.066256478 +0000
files containing check-1791439082-19736: /workspaces/fb-container-check/.emulator-data-30000/firestore_export/all_namespaces/all_kinds/output-0
```

### PASS — dev loop: no process of the stack remains (by its recorded PIDs)

```
recorded before stop:
  4855 (start 25653128) node tools/dev/dev.mjs serve web --port-offset=auto --no-shared-browser 
  4894 (start 25653134) node node_modules/.bin/nx run web:dev-server --port=34200 
  4895 (start 25653134) node node_modules/.bin/nx run firebase:emulators 
  5626 (start 25653436) bash tools/emulators.sh 
  5569 (start 25653392) bash tools/emulators.sh 
  5631 (start 25653436) node /workspaces/fb-container-check/node_modules/.bin/firebase --config /workspaces/fb-container-check/.firebase.offset-
  5678 (start 25653450) tail -n +1 -F --pid=5626 /workspaces/fb-container-check/.bespunky/run/logs/web@30000.emulators.log 
  6491 (start 25654865) java -Dgoogle.cloud_firestore.debug_log_level=FINE -Duser.language=en -jar /home/node/.cache/firebase/emulators/cloud-fi
  7016 (start 25655814) java -Djava.security.manager=disallow -Duser.language=en -jar /home/node/.cache/firebase/emulators/cloud-storage-rules-r
  (stack-lock holders per /proc/locks: none; processes with TMPDIR=/tmp/bespunky-69ff13498dd7: 5631 5678 6491 7016)

still alive: none
ports still answering: none
serve (4855) alive: no
records left for container-check-4543: none
stack lock /workspaces/fb-container-check/.bespunky/run/locks/4855-1e79ff6e6626.lock: removed
stack TMPDIR /tmp/bespunky-69ff13498dd7: removed
```

