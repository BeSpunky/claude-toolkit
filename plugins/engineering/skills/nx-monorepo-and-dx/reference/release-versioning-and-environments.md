# Release, Versioning & Environments

Make shipping, versioning, environment-switching, and onboarding **one step each** — never a remembered recipe (`architect-mentality` → *Automate every repeated process*; *Compensate for your materials' weaknesses*).

---

## 1. Release as one command

**What.** Use `nx release` to version, generate changelogs, and publish monorepo packages in one flow; for bespoke pipelines, compose `run-commands` targets (build → publish → deploy) so the whole thing is a single `nx run`.

```bash
nx release            # version + changelog + publish (configure in nx.json "release")
```
```jsonc
// custom pipeline as a composed target
"build-and-publish": { "executor": "nx:run-commands",
  "options": { "commands": ["nx build lib", "npm publish dist/libs/lib --access public"], "parallel": false } }
```

**Why.** *Automate every repeated process* — a release nobody can mis-sequence, because the sequence is encoded.

---

## 2. Per-package versioning; consider pinning to the framework major

**What.** Version each publishable package independently; for a framework-coupled library, consider pinning its **major** to the framework's major (e.g. a library's v18 targets the framework's v18).

**Why.** *Design for the consumer* — predictable compatibility; a consumer reads the major and knows.

---

## 3. Environments = one unambiguous action, not remembered flags

**What.** Encode each launch context as a **serve configuration**, so "run against staging" is one selection — never hand-assembled flags.

```jsonc
// project.json — serve target
"serve": {
  "configurations": {
    "local":   { "buildTarget": "app:build:development" },
    "staging": { "buildTarget": "app:build:staging",    "proxyConfig": "proxy.staging.json" },
    "prod-api":{ "buildTarget": "app:build:development", "proxyConfig": "proxy.prod.json" }
  }
}
```
```bash
nx serve app --configuration=staging      # one click / one command per environment
```

**Why.** *Automate every repeated process* — local, local-vs-staging, local-vs-prod become single, named, unambiguous actions; no one reconstructs the right flags from memory.

---

## 4. Reproducible environment (devcontainer)

**What.** Pin the toolchain, the editor extension set, and mount heavy dirs (`node_modules`) as a volume in a devcontainer; onboarding becomes "reopen in container."

**Why.** *Compensate for weaknesses* + *Automate every repeated process* — "works on my machine" stops being a category of bug. (The `project-starter` plugin generates the house devcontainer.)

---

## 5. Docs as a deployable artifact

**What.** Generate docs deterministically (API docs from source + narrative guides) and **deploy them as a pipeline step**, ideally beside the live demo app.

**Why.** *Treat understanding and verification as first-class* — docs that build and deploy automatically stay current; docs done by hand rot. (Generate any nav/index from the folder tree — see `generators-and-automation.md`.)

## When NOT to

A solo throwaway project doesn't need a release pipeline or multi-env configs (*Know when not to do it*). Add each piece when the repetition or the onboarding cost is real.

## Pitfalls

- Keep publish/deploy credentials in CI secrets, never in committed config.
- A release pipeline that isn't run in CI drifts from "works locally" — run it where it ships.

---

**Mentality anchors:** *Automate every repeated process*, *Compensate for your materials' weaknesses*, *Design for the consumer*, *Treat understanding and verification as first-class* — in the `architect-mentality` skill.
