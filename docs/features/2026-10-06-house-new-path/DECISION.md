---
effort: house-new-path
status: concluded
concluded: 2026-10-06
summary: house.sh new takes a path as written (project dir, app name, its own git repo) and creates a private GitHub repo only with --github; the new skill asks first. bespunky-house 0.47.1, nx-tools 0.49.1.
tags: [house, engine, new, github, outward-actions]
---

# `house.sh new`: a path is a path, and GitHub is opt-in

Found while preparing the 0.49.0 web-image verification: `house.sh new --preset=angular /abs/path/house-web-verify`
reported the project under `~/projects//abs/path/…`, created the app at `apps//abs/path/…`, never got a git repository
of its own, and then tried `gh repo create` — which failed only because of the broken path.

> "Did you discover a bug?" … "yes" — the user, to fixing both and making the GitHub repository opt-in.

## Decisions
- **`new` resolves its target like `upgrade`**: a bare name lands in PROJECTS_DIR; a path (absolute, or relative with
  a slash) is taken as written; the project and app are named after its last segment; a missing parent is refused.
- **The private GitHub repository is opt-in (`--github`)**. Creating it was the default — publishing to an outside
  service without being asked. The `new` skill now ASKS (step 0, input 6) and passes `--github` only on a yes.
  `--no-github` is retired (an unknown flag now) — asked first, as its own question: "Does anything you run still
  pass `--no-github` …?" — "No" — the user. No alias kept.
- HOUSE.md's Firebase section no longer promises the repo exists; it says how to create one.

## Verified
`tools/test-scaffold/new-target.test.sh` (8 checks, confirmed failing on the old engine); a real `new --local` at an
absolute path: the project at that path, its own git repo with the scaffold commit, no remote, `github=0`, no `gh`
call. All scaffold suites, test-layers, description and mode checks green. Nothing to migrate: house.sh and the skill
are plugin content; the HOUSE.md template is owned (regenerated).
