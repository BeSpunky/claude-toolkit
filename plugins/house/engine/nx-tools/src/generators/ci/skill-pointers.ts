// The ci layer's pointers to toolkit skills, in the text it persists into a project (`.bespunky/ci.json`'s
// `pending`, the deploy workflow's header) — filled through ../_utils/plugin-pointers. Each value continues a
// sentence that reads whole without it ("change them …, then upgrade").
import type { PluginPointers } from '../_utils/plugin-pointers';

export const CI_SKILL_POINTERS: PluginPointers = {
  throughBranchModelSkill: ['bespunky-workflow', ' through the bespunky-workflow:branch-and-release skill'],
};
