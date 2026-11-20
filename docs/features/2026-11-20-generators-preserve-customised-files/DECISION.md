---
effort: generators-preserve-customised-files
status: concluded
concluded: 2026-11-20
summary: Files the house shares with a project (the design-system barrel and STRUCTURE.md, the Angular tab label) now carry a marked house region; an upgrade rewrites only that region, and a 0.56.0 migration gives existing files their region or leaves customised ones as the project's.
tags: [house, nx-tools, generators, migrations, house-region, design-system, upgrade]
---

# Generators overwrote files a project had customised

## The report (from a consumer's `/bespunky-house:upgrade`)

> packages/design-system/src/index.ts lost the DsMotion and dsToken exports. packages/design-system/STRUCTURE.md went back to the stock text. worktree-tab-label.ts got hardcoded colours instead of tokens again.

## Cause

All three were declared generator-OWNED and rewritten on every run (`alwaysRewrite` in both design-system bindings; an unconditional `tree.write` in worktree-tab-label) — yet each sits exactly where the project is told to extend it: the barrel is the DS's public API (rule 4: model the missing concept in the DS), STRUCTURE.md documents that DS, and the tab label is app source the design-system-first rule tells the project to tokenise.

## Roads

- **Seed once (class C)** — proposed first. Loses every future toolkit improvement to these files without a migration each.
- **Owned regions inside the files** — chosen. The user: "Find a way to make the generated parts detectable, maybe like what we did with the house rules section in CLAUDE.md". Then, on the concrete design: "yes".

## Design

- One marker grammar, `@bespunky/<name>:start` … `@bespunky/<name>:end`, in the file's comment syntax; one helper (`_utils/house-region.ts`). house-doc's CLAUDE.md pointer (`@bespunky/house-tooling`) moves onto it, markers unchanged.
- Generator rule: file absent → seed whole template with its region; region present → rewrite the region only; file present with no region → the project's, never touched.
- Tab label: mechanism in the region; `badgeColors()` below it is the project's seam (tokens go there).
- Migration for existing projects: a file matching ANY historical stock text (all revisions frozen from git) → replaced by the new region-bearing template; the barrel additionally recognises house export statements one by one; anything else is the project's — left, the false "do not hand-edit" line removed, reported.

## Correction (sanity review, 2026-11-20)

The tab label's project seam is `badgeStyle()`, not `badgeColors()` as written above: it carries the badge's whole look (fill, text colour, font), not only its colours. The review's findings and fixes are in `reviews/`.

## Outcome

Shipped as `@bespunky/nx-tools` 0.56.0 and `bespunky-house` 0.54.0. Verified: migration and generator fixtures (every stock revision and its prettier form, the reporter's three files), a self-upgrade of this repo, and the consumer dogfood (251/251 checks; the reporter's shape survived two upgrades and built). The sanity review fixed nine defects before landing; the dogfood caught one more (@nx/angular's demo barrel surviving creation), fixed in the Angular prune.

Open questions the review raised, decided by the session: a barrel that dropped a house export gets it back (reported); a region-less shared file is reported once, by the migration, not on every upgrade; the rung stays one rung.
