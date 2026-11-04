# Spike: a pinned, verified Postgres closure

> 2026-11-04. Unprivileged spike for `ARCHITECTURE.md` decision 4. No root, no chroot, no namespaces, no change to this container. Evidence marks: **[O]** observed here, **[I]** inferred (from reading scripts, or reasoning), **[U]** unverifiable from here. Prototype projection tool: `spike-install-closure.mjs` beside this file. Raw logs were in the session scratchpad and are disposable.

## Verdict

**Yes, the Postgres side can be fully pinned and sha256-verified, and nothing floats.** The Debian side cannot be durably pinned and should not be.

**This spike changes decision 4's install step.** Keep the projected, sha256-pinned closure from `apt-archive`. Install it by **extraction to a versioned directory, not by `apt-get install ./*.deb`**, and resolve Debian's libraries by name with `apt-get satisfy`. `postgres.md` §2.5 recommended the opposite (option A); the reason it changes is below: on the image the `node` layer uses, option A **removes `libpq-dev`** [O].

This is a recommendation for the design owner to confirm. It has not been proven in a real image build (see *Remains unproven*).

## 1. The closure

Computed by the script from signed indexes only: `InRelease` signature (gpg, PGDG fingerprint checked) → `Packages` sha256 → `.deb` sha256. The sources are `<codename>-pgdg-archive` plus Debian `<codename>`, `-updates` and `-security`.

### The six PGDG pins [O]

| | Postgres 18 | Postgres 17 |
|---|---|---|
| `postgresql-NN`, `postgresql-client-NN`, `libpq5` | `18.6-1.pgdg13+2` (bookworm `pgdg12+2`) | `17.11-1.pgdg13+2` (bookworm `pgdg12+2`) |
| `postgresql-NN-pgvector` | `0.8.7-1.pgdg13+1` (bookworm `pgdg12+1`) | same |
| `postgresql-common`, `postgresql-client-common` | `293.pgdg13+1` (bookworm `pgdg12+1`) | same |

### Sizes, amd64 [O]

Debian's own packages all resolved from Debian. **Nothing the closure needs is PGDG-only** apart from the six pins.

| | PGDG 6 debs: download / installed | Debian packages in the full resolved tree | **A:** net install on a minbase-like Debian: packages, download, installed | **C:** 4 PGDG debs + libs-only Debian deps on minbase | Debian packages not on this container |
|---|---|---|---|---|---|
| trixie 18 | 9.7 MB / 48 MB | 80 | 41, 36.3 MB, 167 MB | 9.5 MB + 16 pkgs, 11.9 MB | 3 (0.1 MB) |
| trixie 17 | 18.5 MB / 69 MB | 82 | 43, 78.1 MB, 339 MB | 18.4 MB + 18 pkgs, 44.9 MB | 2 (0.1 MB) |
| bookworm 18 | 9.6 MB / 47 MB | 83 | 30, 31.4 MB, 131 MB | 9.4 MB + 14 pkgs, 12.6 MB | 21 (21.2 MB) |
| bookworm 17 | 18.5 MB / 69 MB | 85 | 32, 72.0 MB, 298 MB | 18.3 MB + 16 pkgs, 44.4 MB | 20 (21.2 MB) |

- "Minbase-like" is a synthetic dpkg status: Essential and required packages plus `apt`, transitively (83 packages on trixie, 101 on bookworm). The real base images hold far more, so these are upper bounds [I].
- The whole 17-over-18 gap is LLVM. `postgresql-17` depends on `libllvm19` and `libz3-4` (33 MB of download). 18 split JIT into `postgresql-18-jit`, a Recommends [O]. So JIT is absent on 18 unless that package joins the closure. `SHOW jit` still says `on`, which I infer means it silently does nothing without the provider [I].
- An extracted tree is 50 MB (18) or 73 MB (17), of which `usr/share/locale`, `man` and `doc` are 24 MB. Without them: 26 MB and 49 MB [O].

### The pin rules that hold [O]

1. **`libpq5` must be selected by major, not just "newest without `~`".** The archive's newest is `19~rc1`, and that is what apt floats to. A no-tilde rule is enough today but **stops being enough at 19 GA (planned 2026-11-19)**, when `19.0` has no tilde [I]. The prototype requires `upstream major == NN`. `17.11` being published after 18's GA shows older majors keep getting their own `libpq5` [O].
2. **`libpq5` cannot come from Debian.** Though `postgresql-18` only wants `libpq5 (>= 17~~)`, `postgresql-client-18` wants `>= 18.6`. apt refuses Debian's 17.11 [O]. The dependency is real: `psql` 18 against this container's libpq 17 dies with `undefined symbol: PQfullProtocolVersion`, though `ldd` looked clean [O].
3. **Versions are per codename**, so the table is keyed codename × arch × major [O].

## 2. Download, simulation, maintainer scripts

**Download.** All 190 distinct amd64 debs matched their index sha256 and size, checked by the script and again independently with `sha256sum -c`; a corrupted copy failed [O].

**Does the simulated install float? No** [O]. `apt-get --simulate --no-install-recommends install ./*.deb`, with Debian as the only configured source, exit 0 on all four. Every `Inst` line is `local-deb` or Debian, and each package and version equals what the script resolved. No tilde in the Postgres set.

| Control | Result |
|---|---|
| Archive repo configured, only the three obvious pins | **Reproduces the float:** `libpq5 19~rc1-1.pgdg13+1` [O] |
| Local files, archive repo also configured | Holds at `18.6` [O] |
| After install, archive repo still configured, `apt-get upgrade` | **Floats:** `libpq5 18.6 → 19~rc1` [O]. Rules out option B, the repo-based one |
| After install, Debian sources only, `upgrade` / `autoremove` | No Postgres package touched [O] |
| Without `--no-install-recommends` | Adds about 60 packages: `systemd`, `dbus`, `exim4`, `cron`, `bsd-mailx`, `sysstat` and more [O]. Today's `install_packages` does not pass this flag |

### The finding that decides it: `libpq5` collides with `libpq-dev`

- On this real container (`libpq5` and `libpq-dev` 17.11 from Debian): installing the closure gives `Remv libpq-dev` [O], silently under `apt-get -y`. Same for 17.
- A synthetic bookworm status holding `libpq-dev` 15: same removal [O].
- Installing Debian's `libpq-dev` afterwards: refused, `Depends: libpq5 (= 17.11-0+deb13u1) but 18.6-1.pgdg13+2 is to be installed` [O].
- This container is the toolkit's own house image, and I infer `libpq-dev` comes with the `typescript-node` base [I]. So a project wearing `node` and `postgres` would lose its C headers, and any native module building against them, as a side effect of adding a layer.
- Adding PGDG's `libpq-dev` to the closure is possible (`18.6-1.pgdg13+2`, wants `libssl-dev`), but it means tracking what each image already holds, and a project's own `libpq-dev` in `os-packages.txt` would still fight it [I].

**Extraction has no such collision**: `apt-get satisfy` with libs only, on the real status, installs just `liburing2`, with no removal [O].

### What the maintainer scripts would do as root

Read, not run [I for behaviour; O for the text].

| Package | As root | Needs systemd or a service? |
|---|---|---|
| `postgresql-common` | preinst `dpkg-divert`s `/usr/bin/pg_config`. postinst: creates system user and group `postgres`, joins it to `ssl-cert`; creates `/var/lib/postgresql`, `/var/log/postgresql`, `/var/run/postgresql`, `/etc/postgresql-common/root.crt`; `ucf` for `createcluster.conf`; `pg_updatedicts`; `update-rc.d postgresql defaults`, `invoke-rc.d … start \|\| exit 1`; `deb-systemd-helper enable` | No: every `systemctl` is behind `[ -d /run/systemd/system ]` |
| `postgresql-NN` | `configure_version`: man alternatives, `create_main_cluster`, `pg_updateaptconfig`, then `invoke-rc.d postgresql start NN` | No: with no cluster, `do_ctl_all` returns 0 |
| `postgresql-client-NN` | man alternatives | No |
| `ssl-cert` (Debian) | adds group, generates the snakeoil key and cert | No |
| `libpq5` | `ldconfig` trigger only | No |
| `postgresql-NN-pgvector` | **none** | No |

- `/usr/sbin/policy-rc.d` here exits 101, which `invoke-rc.d` treats as denied and carries on [O text, I outcome]. Whether `devcontainers/base:debian` ships it is [U]. Without it, the start is a no-op once there are no clusters [I].

**Does `create_main_cluster = false` stop the default cluster? Yes, if the file is there and read in time.**

- The check is `pg_conftool /etc/postgresql-common/createcluster.conf show -bs create_main_cluster`, and it skips on `off`. I ran the extracted `pg_conftool`: `false` and `off` both print `off`; commented out or absent prints nothing, which **creates the cluster** [O]. The shipped template has it commented out [O].
- **The trap for one-transaction preseeding:** the file is written by `ucf` in `postgresql-common`'s postinst. A file already there with no ucf hash is treated as locally modified, so ucf asks through debconf [O text]. The prompt's default should keep the local file under noninteractive, but ucf refuses to act as non-root (`Need to be run as root … no action mode`), so **that branch could not be run here** [U]. With `UCF_FORCE_CONFFOLD=1`, its trace keeps the destination [O, dry-run mode only].
- `docker-library/postgres`, from memory, installs `postgresql-common` first, edits the file, then installs the server [I, not checked here]. That avoids the question, at the cost of a second transaction.

Extraction needs none of this: no scripts run, no user, no cluster, no diversion.

## 3. Unprivileged run

Extracted `postgresql-NN`, `postgresql-client-NN`, pgvector and `libpq5` to `root/<codename>-<NN>/<version>/pg`; `initdb`; `pg_ctl start` on a random free TCP port with `unix_socket_directories=''`; `CREATE EXTENSION vector`; a distance query; a table with an HNSW index; `pg_ctl stop`.

| | initdb | start | `vector` | HNSW query | timezone conversion | ICU collations | stop, pidfile gone |
|---|---|---|---|---|---|---|---|
| trixie 18 (18.6) | ok | ok | 0.8.7 | ok | ok | 871 | ok |
| trixie 17 (17.11) | ok | ok | 0.8.7 | ok | ok | 871 | ok |
| bookworm 18 (18.6) | ok | ok | 0.8.7 | ok | ok | 807 | ok |
| bookworm 17 (17.11) | ok | ok | 0.8.7 | ok | ok | 807 | ok |

All [O]. `wal_level` reports `replica`, the default; `postgres.md` §5 covers `logical`.

**Library resolution** [O]:

- **Trixie:** 31 of `postgres`' 32 libraries come from this system. Only `liburing.so.2` (18 only) and `libpq.so.5` came from the extraction. It proves the tree on trixie's libraries.
- **Bookworm:** `postgres` lacks `libldap-2.5`, `libicu*72` and (18) `liburing` here. I supplied every bookworm Debian library except glibc via `LD_LIBRARY_PATH`. 39 came from the extraction, 3 from this system, including **trixie's glibc 2.41**.
- **What bookworm cannot show here:** its real glibc 2.36, and its loader. I tried running under bookworm's `ld.so`; it aborts with `stack smashing detected` even on this system's `/bin/true`, so that harness is invalid and says nothing about Postgres [O]. Whether PGDG's bookworm build runs on bookworm is only [I] until a real bookworm container.

**What the extraction road must supply** [O]:

- **Binaries have no RUNPATH.** 23 of 36 tools link `libpq` (`initdb`, `psql`, `pg_dump`, `pg_isready`, `pgbench`…), `pg_ctl` and `postgres` itself do not; `dblink`, `postgres_fdw` and `libpqwalreceiver` do. So plain symlinks into `/usr/local/bin` are not enough: **wrappers that set `LD_LIBRARY_PATH` are required.** `ldd` does not warn you (see rule 2 above).
- **Relocation is fine.** `pg_config` reports paths under the extraction, including through a symlink. `share/` and `$libdir` resolve, so `CREATE EXTENSION` works.
- `/var/run/postgresql` is the compiled-in socket dir and is not writable without the postinst, so the layer must set `unix_socket_directories`. `--sysconfdir=/etc/postgresql-common` reads an absent `psqlrc`, harmless. Timezones need `tzdata` (`--with-system-tzdata`), so it stays in the satisfy list.
- `postgresql-common` and `postgresql-client-common` are not needed at all: 4 debs rather than 6.

## 4. Verdict on the install road

| | **A:** `apt-get install ./*.deb` | **C:** extract to `/opt/bespunky/postgres/<version>` |
|---|---|---|
| Run end to end | No, simulation only | **Yes, on four combinations**, as non-root, minus the real root install |
| Other packages | **Removes `libpq-dev`**, blocks a later Debian one [O] | Touches nothing; Debian's libpq stays [O] |
| A PGDG repo a project adds later | `libpq5` floats, to `19~rc1` today [O] | Unaffected [I] |
| Root side effects | User, group, dirs, diversion, cluster, service attempts, ucf question | None |
| Debian deps | apt resolves them | `apt-get satisfy "<libs from the debs' Depends>"`; worked on all four with no table of names [O] |
| Size | adds 6 debs' worth of scripts and Perl tools | Smaller, and 24 MB can be pruned |
| Own costs | Two-step install or ucf override; tracking `libpq-dev` | Wrappers; socket dir; arch's lib dir |
| Extra extensions | `apt install postgresql-18-postgis` would work, if the repo were configured, which it must not be | Another deb in the projected closure; same effort as A in practice [I] |
| `pg_wrapper`, `pg_lsclusters`, `/etc/postgresql` | Present, unused by the house | Absent |
| Durability | Same pins, same failure | Same pins, same failure |

**Recommend C.** It matches what `ArchiveTool` already is (a versioned directory, a `current` link, a sha256), and the decision behind that type: not depending on a shared, rolling system state. A's only real advantage is familiarity. `dpkg -x` run as root by the installer is ordinary; the deb's internals are inputs already pinned by sha256.

### What the descriptor should model

**Extend `archives`; no new fragment kind.** The install root, `current`, sha256 refusal and "fails loudly" all carry over [I]. `ArchiveTool` lacks four things:

1. **A closure, keyed by codename:** `Record<codename, Record<DebianArch, {url, sha256}[]>>` with a `format` of `tar.gz` or `deb`. Today it is one tarball per arch. An **unknown codename must fail loudly**, the existing `!<id>` path extended; the base tags float across Debian releases (`postgres.md` §2.2). `forky-pgdg-archive` already exists [O].
2. **`libraryPaths`**, turning `bin` links into generated wrappers. Glob the multiarch dir rather than typing `x86_64-linux-gnu`.
3. **`systemDepends`**, per codename, the satisfy string, projected from the debs' control data with the family and non-library entries (`debconf`, `locales`, `ssl-cert`, `sensible-utils`) removed. Run after `apt-get update`, with `--no-install-recommends`. It is not an `osPackages` group: those are static names, and `libicu76` versus `libicu72` differ by codename.
4. **`prune`**, optional: `usr/share/{man,doc,locale}`.

The major comes from the project (decision 3), so the fragment picks an entry from a table `major → closure`. `name=version` in `wanted()` stays refused: this road never needs it. The projection tool joins `firebase-compat` and `node-facts`: weekly and pre-publish, never per-push. It should also HEAD every pin.

### arm64 (index read only)

Every pin has the same version as amd64 on all four, the same Debian package names, and a 200 from the pool. Arch-`all` debs share their sha256. Sizes are about 5% smaller [O]. So arm64 adds one column of hashes and nothing else. The library dir would be `aarch64-linux-gnu`, hence the glob [I]. Nothing was executed on arm64.

## 5. Retention and lag

**Observed:**

- The archive's front page: "hosts historical Debian and Ubuntu packages … since April 2013" and "all versions of all packages … updated daily", Packages files containing "all versions at once". The FAQ points to it for older versions.
- Everything in both rolling indexes was in the archive, with identical sha256 and identical pool path: 4,605 and 4,614 stanzas, 0 missing.
- 32 of 32 sampled index entries served from the archive pool.
- Old pins that are gone from the rolling pool (`17~beta1`, 404) still serve from the archive (200). Prereleases are retained, which is the same fact that causes the float.
- Oldest checked files serve too: `jessie-pgdg-archive` 9.3.25, `stretch-pgdg-archive` 10.x and `buster-pgdg-archive` 11.x, with pool dates back to February 2020 (a date probably set by a re-sync, so not their age) [I].
- **Publish lag:** `postgresql-18 18.6` reached the rolling pool on 2026-08-13 01:25 and the archive on 2026-08-14 between 00:36 and 03:25, so about 23 to 26 hours for that release. Today's rolling index is dated 17:55 and archive 00:17 the next day. A daily sync fits.
- **Lag cannot break a pin** if the projection reads the archive index, since it can only name what is already there [I]. It delays a same-day security pin by a day.
- `InRelease` carries no `Valid-Until` on either [O].

**Debian, for comparison:** a superseded `libssl3t64 3.5.1-1` is 404 on `deb.debian.org` and 200 on `snapshot.debian.org` [O]. This is why the Debian side must float by name: a pin there expires at the next security update. It is safe to float because PGDG's builds need sonames and minimum versions, and Debian holds those stable within a codename [I].

**Unverifiable [U]:**

- Any published retention promise or SLA. I found none; the front page describes, and does not commit.
- Whether a version has ever been removed from the archive, and uptime. It is a single host run by the PGDG project, and no independent mirror was found.
- Index and pool consistency beyond the samples.

**If a pin vanishes** [I, from the installer's existing paths]:

- A Docker cached layer keeps working. Only a cache miss hits it.
- On a miss, `curl -f` fails, the installer exits non-zero and **the image build fails loudly**. In post-create (an adopted image) it reports and carries on, leaving no Postgres. It never silently picks another version; the same goes for a sha256 mismatch.
- Repair is a toolkit release moving the pin, and each project holds a frozen table, so it reaches them on upgrade. Because that takes a release, the weekly HEAD check matters: it finds this before a consumer does.
- For the newest three releases the rolling pool serves the same file at the same path and hash [O], so a second URL is cheap safety. Any host is safe because of the sha256. It does not help an old pin.

## Remains unproven for the rebuild

1. `dpkg -x` and `apt-get satisfy` **as root in a real image build**, then running as the non-root remote user, on trixie.
2. **A real bookworm container**: glibc 2.36, bookworm's libraries in place. Not shown here at all.
3. **The wrappers and `/opt/bespunky/postgres/<version>`**: not written or run, only the same tree at a scratch path with `LD_LIBRARY_PATH` set by hand.
4. **arm64**: not executed.
5. `apt-get satisfy` against a real `devcontainers/base:debian`, not this image or a synthetic floor.
6. If A is chosen anyway: every postinst, ucf's noninteractive branch and `policy-rc.d` behaviour; none could be run here.

## Process roster and side effects

- **Postgres:** four postmasters (3081055, 3083861, 3088989, 3095244), each stopped by `pg_ctl`, pidfile gone. Two server starts under bookworm's `ld.so` (3274130, 3498705) and its short-lived `--version` and discrimination probes aborted immediately. None left running; `pgrep postgres` 0 and no listener at the end [O].
- **Other:** `gpg` could not start `gpg-agent` (socket path too long under the scratch dir), which is why the script tolerates that import exit code; no agent left. A concurrent sibling spike's processes were not touched.
- **System:** the first `apt-get update`s ran this container's `docker-clean` hook, which tried `rm /var/cache/apt/archives/partial/*.deb` and got `Permission denied`, so nothing changed [O]. Later runs set `APT_CONFIG=/dev/null`.
- **Files:** everything under the scratch `spike-install/` (1.1 GB, disposable), and these two research files. Not committed.
