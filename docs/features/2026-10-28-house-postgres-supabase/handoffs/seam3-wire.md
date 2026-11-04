# seam3-wire — Landing 3, the `supabase` layer's verification wiring and docs
Branch feat/hps3-wire, off feat/hps3-core. Written as it goes; newest at the bottom.

## Log
- Upstream check: `tools/supabase-cli/check.mjs`. Only a broken pin fails. A newer release (npm `latest`, not GitHub, which lists betas) and the native runtime's stage (the feature page's data) are notices. In `upstream-tables.yml` and `publish.sh`. `brokenDownloads` moved to `tools/postgres-debs/downloads.mjs`, shared with dbmate's check. Run for real: both downloads match, latest 3.0.0, "Public Alpha".
