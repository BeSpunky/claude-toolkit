---
effort: publish-token-check
status: concluded
concluded: 2026-11-02
summary: The publish workflow names the npm account its token belongs to before publishing, dry runs included, so a bad NPM_TOKEN fails clearly and can be checked without a release.
tags: [ci, publish, npm]
---

CI got `404` on upload three times while the token believed to be the same one published from a machine, and a dry run never touched the token. `npm whoami` proves the token is valid, not that it may upload; only a real publish proves that.
