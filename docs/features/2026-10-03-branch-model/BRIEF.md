# branch-model — brief

## The ask

> "Our toolkit expects a fixed branching model of development/staging/main. That's not true for all repos. Some have different needs. Some are simpler or more complex. How do you suggest we go about that? Also consider that some repos already using our toolkit were 'forced' into that model and might need simplification"

## Direction the user set (2026-10-03)

> "Projects without a json file should trigger Claude to investigate the current layout and suggest one to the user. That should happen on `/sync`. The investigation should not rely on current branches alone because of what I told you before about projects already scaffolded with the model. Claude should figure out if the branches have matching CI/CD, how they were used up to that point, etc. and see if the structure justifies itself or can/should be simplified. At any point - no json means asking the user.
> Projects with json should be allowed to change the model at any give time - but Claude will verify, do risk management, and confirm with the user"

## Where the model is hard-coded today

- `plugins/workflow/skills/branch-and-release/SKILL.md` — the method, its description ("four branches"), every command literal.
- `house-doc` → `HOUSE.rules.md.tpl` (the always-on branch rules) and `HOUSE.md.tpl` (*Branch & release parameters*); canonical directive text also in `README.md` ("The always-on half").
- `scaffold.sh` protected-branch preflight — "`development` exists" is its evidence the model was adopted; a lone `main` → `ask no-branch-model`.
- `--staging` Firebase environment bundle assumes a `staging` branch to deploy from.
- `workflow/hooks/checkpoint-on-compact.sh` mentions the branches.

## Open

- Linear pipeline of 1–N branches only, or also gitflow-style release/hotfix lines? (Asked; user deferred: "I'll tell you later.")
