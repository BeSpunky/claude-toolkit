// The Firebase layer's pointers to toolkit skills and commands, in the files it writes into a project (the deploy
// runners' messages, the welcome banner, the seeded App Hosting config and prod environment) — filled through the
// same `{{token}}` substitution as their other placeholders (../_utils/plugin-pointers). Each renders empty without
// its plugin — or, where the pointer is the MEANS (the upgrade, adding the ci layer), as the same means without it:
// the `house.sh` command the layers' own hints name — and every sentence around it reads whole either way. Values
// land inside single-quoted JS strings and template literals, a shell printf, YAML and TS comments, so none carries a
// quote, a backtick or a `%`.
import type { PluginPointers } from '../_utils/plugin-pointers';

export const FIREBASE_SKILL_POINTERS: PluginPointers = {
  appHostingSkill: ['bespunky-house', ' (the bespunky-house:firebase-app-hosting skill)'],
  branchModelSkill: ['bespunky-workflow', ' (the bespunky-workflow:branch-and-release skill)'],
  upgradeCommand: ['bespunky-house', ' (/bespunky-house:upgrade)', ' (house.sh upgrade .)'],
  addCiLayerCommand: ['bespunky-house', ':  /bespunky-house:add-layer ci   (in Claude Code)', ':  house.sh add-layer ci .'],
};
