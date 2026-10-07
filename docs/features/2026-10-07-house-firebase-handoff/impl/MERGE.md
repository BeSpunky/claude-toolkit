# Integration — merging W2..W8 into feat/house-firebase-handoff

Written as it happens. Order: w7, w4, w5, w2, w3, w6, w8 (w1 later). After each merge: test-generators + test-migrations.
Test-generators skips (18+) are the cases needing `@nx/angular` / `@nx/js`, which are not installed in this worktree.

## Merges

### w7 (App Hosting story)
- Clean merge. test-generators 116 ok / 18 skip · test-migrations 119 ok.
