// The design system's pointers to toolkit skills — in its seeded files (both the neutral core and a framework
// binding's), filled through the same `{{token}}` substitution as the rest of them. Read by the generator and by the
// 0.45.0 migration, which re-renders seeded files from the current templates.
import type { PluginPointers } from '../_utils/plugin-pointers';

/**
 * The toolkit skills the design system's files point to (../_utils/plugin-pointers): the design phase that replaces the
 * placeholder tokens, and the pattern for persisting an explicit theme mode. Without its plugin each renders empty or
 * as the plain wording its sentence needs. WITH it, `_tokens.scss` and DsTheme read byte-for-byte as they did before the
 * gate; STRUCTURE.md (owned, rewritten every upgrade) was reworded around the token, so it changes once.
 */
export const DESIGN_SYSTEM_SKILL_POINTERS: PluginPointers = {
  designPhaseSkills: ['bespunky-product-ux', ' (`bespunky-product-ux:stage-the-vision` → `realize-the-vision`)'],
  designPhasePipeline: [
    'bespunky-product-ux',
    ':' +
      '\n//      bespunky-product-ux:envision-the-experience  (the feeling)' +
      '\n//   -> bespunky-product-ux:stage-the-vision         (the visual system: palette, type, scales, motion)' +
      '\n//   -> bespunky-product-ux:realize-the-vision       (which lands that visual system HERE, as tokens)',
    ', which lands the real visual system' + '\n//  (the feeling, then palette, type, scales, motion) HERE, as tokens.',
  ],
  resumableStateSkill: ['bespunky-engineering', '; see `bespunky-engineering:resumable-state`'],
};
