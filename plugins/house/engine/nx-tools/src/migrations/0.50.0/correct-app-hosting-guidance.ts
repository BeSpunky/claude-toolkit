// 0.50.0 — the App Hosting instructions the house SEEDED into a project stop saying what is false.
//
// WHY. Three seeded files carried deploy guidance in their comments, and they are seeded-never-owned (class C), so
// no upgrade would ever correct them — the regenerated HOUSE.md would say one thing and the file beside the config
// another, and Claude reads both:
//   - apphosting.staging.yaml told users to bind the staging backend with
//     `firebase apphosting:backends:create … --environment staging`. That flag does not exist (firebase-tools'
//     backends:create takes --app, --backend, --service-account, --primary-region, --root-dir). The Environment
//     name is a console setting; until it is set the staging backend builds PRODUCTION's config.
//   - apphosting.yaml and environment.prod.ts said deploys are "GitHub-driven" (there is also local-source
//     `firebase deploy`) and that the config lives "at the workspace root" (it is found by walking up from the
//     backend's Root Directory — which an Nx app MUST set to the app, something no house text said).
//
// WHAT IT TOUCHES. Only the comment blocks the house wrote, matched exactly (every variant the templates ever
// shipped); nothing else in the file moves. A file whose block was edited is not guessed at — if it still carries
// the false instruction, it is REPORTED by name with the correction.
import { type Tree, getProjects, logger } from '@nx/devkit';
import { appHostingFilesIn } from '../../generators/firebase-emulators/apphosting-config';

const TAG = '[0.50.0 correct-app-hosting-guidance]';

const STAGING_OLD = `# One-time binding (so this applies to the right backend): give the staging backend the
# environment name \`staging\` — at create time:
#   firebase apphosting:backends:create ... --environment staging
# or set the backend's environment to \`staging\` in the Firebase console.
`;
const STAGING_NEW = `# One-time binding (so this applies to the right backend): set the staging backend's Environment
# name to \`staging\` — Firebase console → App Hosting → the backend → Settings → Environment.
# There is no CLI flag for it (backends:create has none). Until it is set, the backend reads only
# apphosting.yaml and staging silently builds PRODUCTION's config. This file must sit beside the
# apphosting.yaml that backend reads (see that file's header).
`;

/** The `# Deploy flow` paragraph of apphosting.yaml — every shipped variant starts and ends the same way. */
const BASE_START = '# Deploy flow (after `firebase login` + `firebase use --add`):\n';
const BASE_END = 'for the full flow.\n';
const BASE_NEW = `# WHERE THIS FILE IS READ FROM. App Hosting starts at the backend's Root Directory (for an Nx app:
# <appsDir>/<app>) and walks UP to the first directory holding any apphosting*.yaml — so this file
# applies to every backend rooted in or below its directory. apphosting.<env>.yaml overrides are
# read BESIDE it. Any apphosting*.yaml nearer to an app SHADOWS this one (and its overrides)
# for that app's backend; the house upgrade warns when it finds one.
#
# Deploying: ask Claude, or see the bespunky-house:firebase-app-hosting skill — create the backend
# with its Root Directory set to the app (an Nx build fails without it), then deploy either from
# GitHub (rollouts on push to the live branch) or from local source (firebase deploy).
`;

const PROD_STEP_OLD =
  '//   3) Create the App Hosting backend:  firebase apphosting:backends:create --project <projectId>     (one-time; interactive)\n';
const PROD_STEP_NEW =
  "//   3) Create the App Hosting backend:  firebase apphosting:backends:create --project <projectId> --root-dir <this app's directory>     (one-time; interactive)\n";
const PROD_FLOW_OLD = `// After the backend exists, App Hosting deploys are GitHub-driven (push to the
// configured branch). App Hosting build/runtime config lives in
// \`apphosting.yaml\` at the workspace root.
`;
const PROD_FLOW_NEW = `// The backend then deploys from GitHub (a rollout on every push to its live
// branch) or from local source (\`firebase deploy --only apphosting:<backendId>\`).
// Build/runtime config: the nearest \`apphosting.yaml\` walking up from the app's
// directory (the house seeds it at the workspace root). The full story — and
// moving accounts — is the bespunky-house:firebase-app-hosting skill.
`;

/** What still reads false after the exact rewrites — each with the correction a human applies by hand. */
const STILL_FALSE: ReadonlyArray<[RegExp, string]> = [
  [/--environment\s+staging/, 'there is no `--environment` flag — set the backend\'s Environment name in the console (Settings → Environment)'],
  [/GitHub-driven/, 'App Hosting also deploys from local source (`firebase deploy --only apphosting:<backendId>`)'],
];

export default async function correctAppHostingGuidance(tree: Tree): Promise<void> {
  const rewritten: string[] = [];
  const report: string[] = [];

  const visit = (path: string, rewrite: (text: string) => string) => {
    if (!tree.isFile(path)) return;
    const before = tree.read(path, 'utf8') ?? '';
    const after = rewrite(before);
    if (after !== before) {
      tree.write(path, after);
      rewritten.push(path);
    }
    for (const [pattern, fix] of STILL_FALSE) if (pattern.test(after)) report.push(`${path}: ${fix}`);
  };

  // apphosting*.yaml live wherever the project put them: the root, or a project's directory.
  const projectRoots = [...getProjects(tree).values()].map((p) => p.root);
  const dirs = [...new Set(['.', ...projectRoots])];
  for (const dir of dirs) {
    for (const file of appHostingFilesIn(tree, dir)) {
      const path = dir === '.' ? file : `${dir}/${file}`;
      if (file === 'apphosting.staging.yaml') visit(path, (t) => t.replace(STAGING_OLD, STAGING_NEW));
      else if (file === 'apphosting.yaml') visit(path, replaceDeployFlow);
    }
  }

  // The client app's production environment file (the Angular adapter's home for it).
  for (const root of projectRoots) {
    visit(`${root}/src/environments/environment.prod.ts`, (t) => t.replace(PROD_STEP_OLD, PROD_STEP_NEW).replace(PROD_FLOW_OLD, PROD_FLOW_NEW));
  }

  if (rewritten.length) {
    logger.info(`${TAG} corrected the App Hosting guidance in the comments of: ${rewritten.join(', ')} (no configuration changed).`);
  }
  for (const line of report) {
    logger.warn(`${TAG} ${line}. Left as is — the comment was edited, so it is yours to correct.`);
  }
}

/** Replace the `# Deploy flow` paragraph, only when it is still a run of comment lines the house wrote. */
function replaceDeployFlow(text: string): string {
  const start = text.indexOf(BASE_START);
  if (start < 0) return text;
  const endAt = text.indexOf(BASE_END, start);
  if (endAt < 0) return text;
  const end = endAt + BASE_END.length;
  const block = text.slice(start, end);
  if (!block.split('\n').filter(Boolean).every((line) => line.startsWith('#'))) return text;
  return text.slice(0, start) + BASE_NEW + text.slice(end);
}
