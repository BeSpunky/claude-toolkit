// The pinned CLI, installed by the GENERATED installer: the layer's own fragment, composed and run unprivileged into a cache with
// `apt-get` and `sudo` stubbed, so this machine's system does not change. Returns where the binary is. Its artifacts (1.7 GB) are the
// caller's: they live under whatever SUPABASE_HOME the caller gives it.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compilePayload, requireFromRepo } from '../test-support/payload.mjs';

export const defaultCache = () => process.env.SUPABASE_TOOLS_CACHE || join(tmpdir(), 'bespunky-supabase-tools');

export function ensureCli({ cache = defaultCache() } = {}) {
  const { build, load, dispose } = compilePayload('bespunky-test-supabase-tools');
  const { compose, renderOsPackagesScript } = requireFromRepo(join(build, 'src/generators/devcontainer/compose'));
  const { layer } = load('layers/registry');
  const { SUPABASE_CLI_VERSION: pin } = load('generators/_utils/versions');
  const fragment = layer('supabase').devcontainer;
  const script = renderOsPackagesScript(compose([{ id: 'supabase', fragment: { image: { ref: 'img', remoteUser: 'node' }, archives: fragment.archives } }], { nodeMajor: '22' }));
  dispose();

  const root = join(cache, `cli-${pin}`);
  const bin = join(root, 'usr/local/bin');
  if (!existsSync(join(bin, 'supabase'))) {
    console.log(`installing the pinned CLI into ${root}...`);
    rmSync(root, { recursive: true, force: true });
    const stubs = join(cache, 'stubs');
    mkdirSync(join(root, 'etc'), { recursive: true });
    mkdirSync(stubs, { recursive: true });
    writeFileSync(join(root, 'etc/os-release'), 'ID=debian\nVERSION_CODENAME=trixie\n');
    writeFileSync(join(stubs, 'apt-get'), '#!/bin/sh\n', { mode: 0o755 });
    writeFileSync(join(stubs, 'sudo'), '#!/bin/sh\nexec "$@"\n', { mode: 0o755 });
    writeFileSync(join(stubs, 'dpkg-query'), "#!/bin/sh\nprintf 'install ok installed'\n", { mode: 0o755 });
    const file = join(cache, 'house.packages.sh');
    writeFileSync(file, script);
    execFileSync('sh', [file], { env: { PATH: `${stubs}:${process.env.PATH}`, HOUSE_PACKAGES_ROOT: root }, stdio: ['ignore', 'ignore', 'inherit'] });
  }
  return { bin, pin };
}
