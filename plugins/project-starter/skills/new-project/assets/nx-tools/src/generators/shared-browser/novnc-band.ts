/**
 * The noVNC allocation band — defined ONCE, consumed by two generators that must agree.
 *
 * The shared browser's noVNC port is the only port that reaches the host, so it is allocated per
 * container out of this band rather than fixed (see `shared-browser.tpl`'s header for why a fixed port
 * fails silently rather than loudly). Two independent places have to know the band:
 *
 *   1. `shared-browser` (the CLI) — it allocates from it.
 *   2. `devcontainer.json`'s `portsAttributes` — it must carry an EXACT-key entry per port in the band,
 *      because that is the only form in which the editor honours `requireLocalPort` (a range key like
 *      "6080-6119" silently discards it). `requireLocalPort` is what turns a host-side remap from a
 *      silent wrong-target into a visible prompt — the last hole the registry can't close, since a
 *      non-devcontainer process or a second Docker engine is invisible to it.
 *
 * If those two ever disagreed, the uncovered ports would be exactly the ones that fail silently — the
 * original bug, reintroduced by a copy-paste. So neither hard-codes the band: the devcontainer generator
 * imports these constants, and the shared-browser generator substitutes them into the script.
 */
export const NOVNC_BAND_START = 6080;
export const NOVNC_BAND_SIZE = 40;

/** Every port in the band, ascending. */
export function novncBandPorts(): number[] {
  return Array.from({ length: NOVNC_BAND_SIZE }, (_, i) => NOVNC_BAND_START + i);
}

/** Human/inclusive form, e.g. "6080-6119" — for labels and prose. */
export const NOVNC_BAND_LABEL = `${NOVNC_BAND_START}-${NOVNC_BAND_START + NOVNC_BAND_SIZE - 1}`;

/**
 * The `portsAttributes` entries for the band, as JSON text ready to splice into devcontainer.json.
 *
 * `requireLocalPort: true` is the point: the editor prefers host port == container port and only remaps
 * on conflict, but that remap is SILENT unless this flag is set — at which point it prompts instead. So
 * even when allocation is wrong (a host-loopback squatter the probe can't see, two engines on one host),
 * the human is told rather than quietly shown another container's browser.
 */
export function novncPortsAttributesJson(indent = '    '): string {
  return novncBandPorts()
    .map(
      (port) =>
        `${indent}"${port}": { "label": "Shared Browser (noVNC)", "onAutoForward": "notify", "requireLocalPort": true }`
    )
    .join(',\n');
}
