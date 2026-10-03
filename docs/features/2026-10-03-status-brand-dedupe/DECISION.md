---
effort: status-brand-dedupe
status: concluded
concluded: 2026-10-03
summary: Status-line entries carry the ✦ glyph alone again — Claude Code already titles them `bespunky-<plugin>:`, so spelling `bespunky` made the line say it twice.
tags: [mods, brand, fix]
---

# Status-line brand, de-duplicated

> "There's now redundancy in the workflow line. `bespunky-workflow: * bespunky ................`"

Claude Code prefixes every plugin status entry (and toast) with the plugin's name. In the toolkit-mods trial
the plugins ran under `try-<plugin>` names, which don't say "bespunky", so the line looked unbranded and
`brandStatus()` spelled the wordmark in (see `2026-10-03-toolkit-mods`). Under the real names the prefix
already carries it. `brandStatus()` is removed; status entries use `brandLine()` (`✦ <text>`), and the brand
source's rule now says why: the engine's title names the plugin, the glyph marks it as the toolkit's.

Lesson: a trial copy under a different plugin name is not a faithful preview of anything the engine titles
with that name.
