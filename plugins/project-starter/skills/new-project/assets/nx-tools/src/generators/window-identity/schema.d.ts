import { type Surface } from './color';

export interface WindowIdentitySchema {
  // The name that seeds the NAME-HASH colour (and nothing else — the window.title label uses VSCode's
  // ${rootName} so it tracks the folder automatically). Defaults to the workspace package.json name.
  name?: string;
  // The design-system primary as a hex colour. When given, the band is derived from THIS instead of the
  // name hash, and the default source becomes 'design-system'. The skill supplies it once a DS exists.
  primary?: string;
  // The window emoji, prepended to window.title. Defaults to the existing marker's emoji, then to a neutral
  // placeholder — the colour already makes each window distinct, so a generic emoji at baseline is fine.
  emoji?: string;
  // Which window surfaces to drive. Defaults to 'status' (always rendered; no custom-title-bar dependency).
  surface?: Surface;
  // Git-ignore the settings + provenance marker so the identity is this developer's own, not committed.
  personal?: boolean;
  // Where this identity came from — the provenance that drives the no-clobber ratchet
  // (name-hash < design-system < manual). Defaults to 'design-system' when --primary is passed, else
  // 'name-hash'. The skill passes 'manual' when a human deliberately picks the colour/emoji.
  source?: 'name-hash' | 'design-system' | 'manual';
}
