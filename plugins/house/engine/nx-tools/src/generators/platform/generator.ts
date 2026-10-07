// House generator: classify a project for the platform firewall — set its ONE `platform:` tag (src/platform).
//
//     nx g @bespunky/nx-tools:platform <project>                    # inferred, with the reason
//     nx g @bespunky/nx-tools:platform <project> --platform=shared   # stated
//
// THE COMMAND THE FIREWALL'S OWN GUIDANCE NAMES. The lint error for an unclassified dependency is Nx's fixed text
// ("A project tagged with "platform:web" can only depend on libs tagged with …") and cannot carry advice, so the
// comment above the constraints, HOUSE.md and every upgrade report point here instead: one line that fixes the
// common case, for a developer or for Claude, without knowing where the project is defined (project.json or a
// package.json `nx` block — written to whichever it is).
//
// Inference is the classifier's (src/platform/classify) — the same one an upgrade uses — so `platform <project>`
// and the migration can never disagree about a project. It refuses, with the evidence, when the project mixes web
// and server code: no tag makes that honest; splitting the project does.
import { type Tree, logger, readProjectConfiguration } from '@nx/devkit';
import { nxInvocation } from '../_utils/nx-host';
import {
  type Platform,
  PLATFORM_MEANING,
  classifyWorkspace,
  isPlatform,
  platformCommand,
  platformExternals,
  platformOf,
  platformTag,
  setProjectPlatform,
  violations,
} from '../../platform';

interface PlatformSchema {
  project: string;
  platform?: Platform;
}

export default async function platformGenerator(tree: Tree, options: PlatformSchema): Promise<void> {
  if (!options.project) throw new Error('platform generator requires a project (positional arg 0 / --project).');
  if (options.platform !== undefined && !isPlatform(options.platform)) {
    throw new Error(`[platform] Unknown platform "${options.platform}" — one of web, server, shared.`);
  }
  const { project } = options;
  const config = readProjectConfiguration(tree, project);
  const nx = nxInvocation(tree).command;
  const externals = platformExternals(tree);

  let platform = options.platform;
  let why = 'as stated';
  if (!platform) {
    const declared = platformOf(config.tags);
    if (declared) {
      logger.info(`[platform] \`${project}\` is already ${platformTag(declared)} (${PLATFORM_MEANING[declared]}). To change it: ${platformCommand(nx, project, '<web|server|shared>')}`);
      return;
    }
    const entry = classifyWorkspace(tree, externals).get(project)!;
    if (entry.platform === null) {
      throw new Error(
        `[platform] \`${project}\` mixes web and server code — ${entry.evidence.join('; ')}. No tag makes that safe: ` +
          `split the server part into its own platform:server library, or, if the evidence is wrong, state it: ` +
          platformCommand(nx, project, '<web|server|shared>'),
      );
    }
    platform = entry.platform;
    why = entry.evidence.length ? `inferred: ${entry.evidence.join('; ')}` : 'inferred: nothing in it is bound to a platform';
  }

  const changed = setProjectPlatform(tree, project, platform);
  logger.info(`[platform] \`${project}\` ${changed ? 'is now' : 'is already'} ${platformTag(platform)} — ${PLATFORM_MEANING[platform]} (${why}).`);

  // What the firewall will say about it now, before lint does.
  for (const leak of violations(classifyWorkspace(tree, externals))) {
    if (leak.project !== project && leak.dependency !== project) continue;
    logger.warn(
      `[platform] \`${leak.project}\` (${platformTag(leak.platform)}) imports \`${leak.dependency}\` (${platformTag(leak.dependencyPlatform)}) — ` +
        `the platform firewall fails lint there. Move what ${leak.project} needs into a library it may depend on, or re-classify one of them.`,
    );
  }
}
