import nx from '@nx/eslint-plugin';

// THE PLATFORM FIREWALL (house) — every code project carries exactly ONE platform tag:
//   platform:web     browser / SSR code — may depend on web and shared projects
//   platform:server  server-only code (Cloud Functions, Node) — may depend on server and shared projects
//   platform:shared  isomorphic code — may depend on shared projects only, and import no platform-specific package
// Enforced by `@nx/enforce-module-boundaries`: these join the workspace's own (`moduleBoundaryOptions`).
// What lint says:
//   'A project tagged with "platform:…" can only depend on libs tagged with …' — the project it imports has no
//     platform (or another one). Classify it — inferred from its imports, or stated:
//       yarn nx g @bespunky/nx-tools:platform <project> [--platform=web|server|shared]
//   'A project without tags matching at least one constraint cannot depend on any libraries' — THIS project has
//     no platform: the same command, for it. `yarn nx sync` classifies every project whose evidence settles it.
//   '… is not allowed to import "<package>"' — that package belongs to another platform: move the code into a
//     project of that platform, or re-classify this one. Never widen these lists to make it pass.
// Not judged: tests and the tools' own configs (they never ship), and in a platform:web project the server half
// of SSR (src/server.ts, src/server/**), which runs only in Node — the blocks at the end of this config.
const platformConstraints = [
  {
    sourceTag: 'platform:web',
    onlyDependOnLibsWithTags: ['platform:web', 'platform:shared'],
    bannedExternalImports: [
      'firebase-admin',
      'firebase-admin/*',
      'firebase-functions',
      'firebase-functions/*',
      'firebase-functions-test',
      'firebase-functions-test/*',
      '@google-cloud/*',
      'express',
      'express/*',
    ],
  },
  {
    sourceTag: 'platform:server',
    onlyDependOnLibsWithTags: ['platform:server', 'platform:shared'],
    bannedExternalImports: [
      'firebase',
      'firebase/*',
      '@firebase/*',
      'rxfire',
      'rxfire/*',
      '@angular/*',
    ],
  },
  {
    sourceTag: 'platform:shared',
    onlyDependOnLibsWithTags: ['platform:shared'],
    bannedExternalImports: [
      'firebase',
      'firebase/*',
      '@firebase/*',
      'rxfire',
      'rxfire/*',
      '@angular/*',
      'firebase-admin',
      'firebase-admin/*',
      'firebase-functions',
      'firebase-functions/*',
      'firebase-functions-test',
      'firebase-functions-test/*',
      '@google-cloud/*',
      'express',
      'express/*',
    ],
  },
];

// @nx/enforce-module-boundaries — ONE rule instance, and these are this workspace's own options for it: an
// exemption (`allow`, `ignoredCircularDependencies`, …) or a constraint of its own goes HERE. Every
// block that configures the rule builds its entry with `moduleBoundaries(…)`, which adds the platform
// constraints for that block's files — so these options hold in all of them.
const moduleBoundaryOptions = {
  enforceBuildableLibDependency: true,
  allow: [],
  depConstraints: [],
};
const moduleBoundaries = (platform) => ['error', { ...moduleBoundaryOptions, depConstraints: [...(moduleBoundaryOptions.depConstraints ?? []), ...platform] }];

export default [
  // THE PLATFORM FIREWALL (house) — `platformConstraints` on every linted file; a block below may still narrow it.
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.cts', '**/*.mts', '**/*.js', '**/*.jsx', '**/*.cjs', '**/*.mjs'],
    rules: { '@nx/enforce-module-boundaries': moduleBoundaries(platformConstraints) },
  },
  ...nx.configs['flat/base'],
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': moduleBoundaries(platformConstraints),
    },
  },
  // THE PLATFORM FIREWALL (house) — the same rule, scoped by file (`moduleBoundaries` keeps the own options).
  // The server half of an SSR web app runs only in Node: there, platform:web may reach server code too.
  {
    files: ['**/src/server.ts', '**/src/server/**'],
    rules: { '@nx/enforce-module-boundaries': moduleBoundaries(platformConstraints.map((c) => (c.sourceTag === 'platform:web' ? { sourceTag: c.sourceTag } : c))) },
  },
  // Tests and the tools' own configs never ship: the firewall does not judge them (any project may reach any).
  {
    files: ['**/*.{spec,test}.{ts,tsx,cts,mts,js,jsx,cjs,mjs}', '**/test-setup.{ts,tsx,cts,mts,js,jsx,cjs,mjs}', '**/{e2e,__tests__,__mocks__}/**'],
    rules: { '@nx/enforce-module-boundaries': moduleBoundaries([{ sourceTag: '*', onlyDependOnLibsWithTags: ['*'] }]) },
  },
  {
    files: ['**/*.config.{ts,tsx,cts,mts,js,jsx,cjs,mjs}'],
    ignores: ['**/src/**'],
    rules: { '@nx/enforce-module-boundaries': moduleBoundaries([{ sourceTag: '*', onlyDependOnLibsWithTags: ['*'] }]) },
  },
];
