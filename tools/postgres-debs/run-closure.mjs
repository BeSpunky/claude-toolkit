#!/usr/bin/env node
// Run the GENERATED installer on the REAL projected closures, unprivileged, against a fixture root — and then a real server
// through the wrappers it wrote. This is the half of a closure install that needs no root: download, sha256, extraction,
// prune, wrappers, and whether what comes out runs. `apt-get` and `sudo` are stubs (the first records what it was asked),
// so this machine's system does not change; root extraction and `apt-get satisfy` itself need a real image build.
//
//   node tools/postgres-debs/run-closure.mjs <empty scratch dir>
//
// Every closure in the table is extracted; a server only runs where the table's codename is this machine's, because the
// others' libraries are not here. Network, ~1 min. By hand, deliberately not CI: tools/test-layers proves the mechanism
// offline with hand-built packages, and this proves the real packages when a pin or the installer moves.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { compilePayload, requireFromRepo } from '../test-support/payload.mjs';
import { parseRelations } from './closure.mjs';

const scratch = process.argv[2] && resolve(process.argv[2]);
if (!scratch) throw new Error('usage: run-closure.mjs <empty scratch dir>');
const { build } = compilePayload('bespunky-postgres-closure-run');
const { compose, renderOsPackagesScript } = requireFromRepo(join(build, 'src/generators/devcontainer/compose'));
const { POSTGRES_CLOSURES } = requireFromRepo(join(build, 'src/generators/_utils/postgres-closures'));
const hostCodename = /^VERSION_CODENAME=(.*)$/m.exec(readFileSync('/etc/os-release', 'utf8'))?.[1];

const freePort = () =>
  new Promise((done, fail) => {
    const server = createServer();
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => done(port));
    });
  });

let failures = 0;
const say = (ok, what) => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`);
};

for (const [major, closures] of Object.entries(POSTGRES_CLOSURES)) {
  for (const [codename, closure] of Object.entries(closures)) {
    const dir = join(scratch, `${codename}-${major}`);
    const [root, stubs] = [join(dir, 'root'), join(dir, 'stubs')];
    mkdirSync(join(root, 'etc'), { recursive: true });
    mkdirSync(stubs, { recursive: true });
    writeFileSync(join(root, 'etc/os-release'), `ID=debian\nVERSION_CODENAME=${codename}\n`);
    const aptLog = join(dir, 'apt.log');
    writeFileSync(join(stubs, 'apt-get'), `#!/bin/sh\nfor a; do printf '%s\\n' "$a"; done >> '${aptLog}'\necho --- >> '${aptLog}'\n`, { mode: 0o755 });
    writeFileSync(join(stubs, 'sudo'), '#!/bin/sh\nexec "$@"\n', { mode: 0o755 });
    writeFileSync(join(stubs, 'dpkg-query'), "#!/bin/sh\nprintf 'install ok installed'\n", { mode: 0o755 });
    const fragment = {
      image: { ref: 'img', remoteUser: 'node' },
      archives: [{ format: 'deb', id: 'postgres', bin: `usr/lib/postgresql/${major}/bin`, libraryPaths: ['usr/lib/*-linux-gnu'], prune: ['usr/share/man', 'usr/share/doc', 'usr/share/locale', `usr/lib/postgresql/${major}/bin/pg_config`], closures }],
    };
    const script = join(dir, 'house.packages.sh');
    writeFileSync(script, renderOsPackagesScript(compose([{ id: 'x', fragment }], { nodeMajor: '22' })));
    console.log(`${codename} / Postgres ${major} (${closure.version})`);
    const env = { PATH: `${stubs}:${process.env.PATH}`, HOUSE_PACKAGES_ROOT: root };
    execFileSync('sh', [script], { env, stdio: ['ignore', 'pipe', 'inherit'] });
    const tree = join(root, 'opt/bespunky/postgres');
    const links = join(root, 'usr/local/bin');
    say(readFileSync(aptLog, 'utf8').includes(`satisfy\n-y\n--no-install-recommends\n${closure.systemDepends}\n`), 'apt-get was asked to satisfy exactly the projected string, without Recommends');
    say(existsSync(join(tree, closure.version, `usr/lib/postgresql/${major}/bin/postgres`)) && !existsSync(join(tree, closure.version, 'usr/share/doc')), `extracted to ${closure.version} and pruned`);
    say(readdirSync(links).includes('initdb') && readFileSync(join(links, 'initdb'), 'utf8').includes('LD_LIBRARY_PATH='), `${readdirSync(links).length} wrappers, setting LD_LIBRARY_PATH`);
    if (codename !== hostCodename) {
      console.log(`  ---- no server: this machine is ${hostCodename}, so ${codename}'s libraries are not here`);
      continue;
    }
    say(!existsSync(join(links, 'pg_config')), 'a pruned executable gets no wrapper (it would shadow a libpq-dev pg_config, whose headers the closure lacks)');
    // Stand in for `apt-get satisfy`: what it would install here is unpacked beside the tree and reaches the wrappers through
    // LD_LIBRARY_PATH — which also proves they ADD to the variable rather than replace it.
    const system = join(dir, 'system');
    mkdirSync(system);
    const absent = parseRelations(closure.systemDepends).map(([{ name }]) => name).filter((name) => {
      try {
        return !execFileSync('dpkg-query', ['-W', '-f=${Status}', name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).endsWith(' installed');
      } catch {
        return true;
      }
    });
    for (const name of absent) {
      execFileSync('apt-get', ['download', name], { cwd: system, stdio: 'ignore' });
      execFileSync('sh', ['-c', 'dpkg-deb -x "$1" .', 'sh', readdirSync(system).find((file) => file.startsWith(`${name}_`))], { cwd: system });
    }
    console.log(`  ---- satisfied by hand, unpacked beside the tree: ${absent.join(', ') || 'nothing; all already here'}`);
    const toolEnv = { ...process.env, LD_LIBRARY_PATH: join(system, `usr/lib/${execFileSync('dpkg-architecture', ['-qDEB_HOST_MULTIARCH'], { encoding: 'utf8' }).trim()}`) };
    const tool = (name, ...args) => execFileSync(join(links, name), args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], cwd: dir, env: toolEnv }).trim();
    say(new RegExp(`\\(PostgreSQL\\) ${major}\\.`).test(tool('postgres', '--version')), tool('postgres', '--version'));
    say(new RegExp(`\\(PostgreSQL\\) ${major}\\.`).test(tool('psql', '--version')), `${tool('psql', '--version')} (needs its own libpq)`);
    const data = join(dir, 'data');
    tool('initdb', '-D', data, '-U', 'postgres', '-A', 'trust', '--no-sync');
    say(existsSync(join(data, 'PG_VERSION')) && readFileSync(join(data, 'PG_VERSION'), 'utf8').trim() === major, 'initdb through the wrapper');
    const port = await freePort();
    tool('pg_ctl', '-D', data, '-w', '-l', join(dir, 'server.log'), '-o', `-p ${port} -c listen_addresses=127.0.0.1 -c unix_socket_directories=''`, 'start');
    try {
      const sql = (text) => tool('psql', '-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', 'postgres', '-Atc', text);
      say(sql('show server_version').startsWith(`${major}.`), `a server on 127.0.0.1:${port}, ${sql('show server_version')}`);
      sql('create extension vector');
      say(sql("select '[1,2,3]'::vector <-> '[1,2,4]'::vector") === '1', `pgvector ${sql("select extversion from pg_extension where extname = 'vector'")}: a distance query`);
    } finally {
      tool('pg_ctl', '-D', data, '-w', '-m', 'fast', 'stop');
    }
    say(!existsSync(join(data, 'postmaster.pid')), 'stopped, pidfile gone');
  }
}
console.log(failures ? `FAILED: ${failures}` : 'all ok');
process.exit(failures ? 1 : 0);
