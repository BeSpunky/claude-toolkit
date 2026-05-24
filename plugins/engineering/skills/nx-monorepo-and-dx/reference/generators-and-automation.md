# Generators & Automation

Never create by hand what a machine can create reliably (`architect-mentality` → *Automate every repeated process*; *Work smart, not hard*; *Place everything on purpose*). In an Nx workspace this means: generate, don't hand-write structure.

---

## 1. Generator-first scaffolding

**What.** For anything Nx can generate — apps, libraries, components, services, configuration — use the generator (`nx g …`); don't hand-create and fill files. Verify flags against `--help` / `nx list`; never guess.

```bash
nx list                      # what plugins/generators exist
nx g @nx/js:lib --help       # exact options
nx g @nx/angular:library libs/bookings/data --tags=type:data,scope:bookings
```

**Why.** *Work smart* + *Place everything on purpose* — generated structure is consistent, correctly wired (paths, tags, test config), and not a copy-paste of the last one. This is the **house standard** (see the `project-starter` plugin).

**When not.** Only fall back to hand-creating files when no generator covers the task.

---

## 2. Write house generators/executors for repeatable structure

**What.** When you repeatedly set up the same thing, encode it as a **local workspace generator/executor** (an `@nx/plugin` plugin) so it's one command, every time.

**Why.** *Automate every repeated process* — the second time you'd do a multi-step setup by hand is the signal to make a generator. The `project-starter` plugin's house generators (`serve-options`, `devcontainer`, `claude-settings`) are the canonical example: every config change is generated via the Nx devkit `Tree`, never hand-edited.

---

## 3. Generate derived artifacts from a single source of truth

**What.** If a value must stay in sync with something else (a list of files in a folder reflected in a constant, an index of routes, a manifest), **generate it** and run that generation automatically (e.g. on each build) — never hand-maintain the mirror.

**Why.** *Automate every repeated process* (the canonical example) — the source of truth owns the data; the derived artifact can never drift because a human forgot to update it.

```jsonc
// project.json — make generation a real, ordered build step
"targets": {
  "gen-manifest": { "executor": "nx:run-commands", "options": { "command": "node tools/gen-manifest.mjs" } },
  "build": { "dependsOn": ["gen-manifest", "^build"] }
}
```

---

## 4. Small scripts in `tools/` when no generator fits

**What.** A dependency-free Node script in `tools/`, wired as a target/`dependsOn` step, is the right amount of automation for one-off glue (the scanned repos' wiki-summary generator is exactly this).

**Why.** *Know when not to do it* — don't reach for a framework when a 90-line `fs` script does the job; don't leave it manual either.

## Pitfalls

- A generated file should be obviously generated (a header comment) and ideally git-ignored or regenerated in CI, so no one hand-edits it.
- Verify generator flags against `--help`/docs — guessing produces silently wrong scaffolding.

---

**Mentality anchors:** *Automate every repeated process*, *Work smart, not hard*, *Place everything on purpose*, *Know when not to do it* — in the `architect-mentality` skill.
