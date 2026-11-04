// The real tools, installed by the GENERATED installer: the layer's own fragment, composed and run unprivileged into a cache
// with `apt-get` and `sudo` stubbed, so this machine's system does not change. Whatever `apt-get satisfy` would have installed
// and this host lacks is unpacked beside it and reached through LD_LIBRARY_PATH. Returns the environment the tools run under.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compilePayload, requireFromRepo } from '../test-support/payload.mjs';
import { parseRelations } from '../postgres-debs/closure.mjs';

/** This machine is not a Debian the closures cover: nothing can be said about the tools here, by any caller. */
export class NoClosureHere extends Error {}

export async function ensureTools({ major = '18' } = {}) {
  const codename = /^VERSION_CODENAME=(.*)$/m.exec(readFileSync('/etc/os-release', 'utf8'))?.[1];
  const { build, load, dispose } = compilePayload('bespunky-test-postgres');
  const { compose, renderOsPackagesScript } = requireFromRepo(join(build, 'src/generators/devcontainer/compose'));
  const { layer } = load('layers/registry');
  const { createTreeWithEmptyWorkspace } = requireFromRepo('@nx/devkit/testing');
  const tree = createTreeWithEmptyWorkspace();
  tree.write('.bespunky/postgres.json', JSON.stringify({ major: Number(major) }));
  const fragment = layer('postgres').devcontainer(tree);
  const closure = fragment.archives.find((a) => a.format === 'deb').closures[codename];
  if (!closure) throw new NoClosureHere(`this machine is ${codename}, and the closures are for other releases: this needs a Debian the closures cover.`);
  const script = renderOsPackagesScript(compose([{ id: 'postgres', fragment: { image: { ref: 'img', remoteUser: 'node' }, ...fragment } }], { nodeMajor: '22' }));
  dispose();

  const cache = process.env.POSTGRES_TOOLS_CACHE || join(tmpdir(), 'bespunky-postgres-tools');
  const home = join(cache, `${codename}-${major}-${closure.version}`);
  const root = join(home, 'root');
  const bin = join(root, 'usr/local/bin');
  const system = join(home, 'system');
  if (!existsSync(join(bin, 'postgres')) || !existsSync(join(bin, 'dbmate'))) {
    console.log(`installing the pinned tools into ${home} (one minute)...`);
    rmSync(home, { recursive: true, force: true });
    const stubs = join(home, 'stubs');
    mkdirSync(join(root, 'etc'), { recursive: true });
    mkdirSync(stubs, { recursive: true });
    mkdirSync(system, { recursive: true });
    writeFileSync(join(root, 'etc/os-release'), `ID=debian\nVERSION_CODENAME=${codename}\n`);
    writeFileSync(join(stubs, 'apt-get'), '#!/bin/sh\n', { mode: 0o755 });
    writeFileSync(join(stubs, 'sudo'), '#!/bin/sh\nexec "$@"\n', { mode: 0o755 });
    writeFileSync(join(stubs, 'dpkg-query'), "#!/bin/sh\nprintf 'install ok installed'\n", { mode: 0o755 });
    const file = join(home, 'house.packages.sh');
    writeFileSync(file, script);
    execFileSync('sh', [file], { env: { PATH: `${stubs}:${process.env.PATH}`, HOUSE_PACKAGES_ROOT: root }, stdio: ['ignore', 'ignore', 'inherit'] });
    const absent = parseRelations(closure.systemDepends).map(([{ name }]) => name).filter((name) => {
      try {
        return !execFileSync('dpkg-query', ['-W', '-f=${Status}', name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).endsWith(' installed');
      } catch {
        return true;
      }
    });
    // apt's own state, private to this cache: no root, and this machine's lists stay as they are.
    const aptState = join(home, 'apt');
    mkdirSync(join(aptState, 'lists/partial'), { recursive: true });
    mkdirSync(join(aptState, 'cache/archives/partial'), { recursive: true });
    const apt = ['-o', `Dir::State::lists=${join(aptState, 'lists')}`, '-o', `Dir::Cache=${join(aptState, 'cache')}`, '-o', 'Debug::NoLocking=1', '-o', 'APT::Sandbox::User=', '-qq'];
    if (absent.length) execFileSync('apt-get', [...apt, 'update'], { stdio: ['ignore', 'ignore', 'inherit'] });
    for (const name of absent) {
      execFileSync('apt-get', [...apt, 'download', name], { cwd: system, stdio: ['ignore', 'ignore', 'inherit'] });
      execFileSync('dpkg-deb', ['-x', readdirSync(system).find((entry) => entry.startsWith(`${name}_`)), '.'], { cwd: system });
    }
  }
  const multiarch = execFileSync('dpkg-architecture', ['-qDEB_HOST_MULTIARCH'], { encoding: 'utf8' }).trim();
  return { PATH: `${bin}:${process.env.PATH}`, LD_LIBRARY_PATH: join(system, `usr/lib/${multiarch}`) };
}
