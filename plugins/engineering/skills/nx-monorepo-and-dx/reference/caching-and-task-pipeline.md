# Caching & the Task Pipeline

Never recompute what hasn't changed, and never run more than you must (`architect-mentality` → *Work smart, not hard*; *Automate every repeated process*). Modern Nx: `targetDefaults`, `namedInputs`, `nx affected`.

---

## 1. Make targets cacheable and order them

**What.** Declare which targets cache and what they depend on.

```jsonc
// nx.json
"targetDefaults": {
  "build": { "cache": true, "dependsOn": ["^build"], "inputs": ["production", "^production"] },
  "test":  { "cache": true, "inputs": ["default", "^production", "{workspaceRoot}/jest.preset.js"] },
  "lint":  { "cache": true, "inputs": ["default", "{workspaceRoot}/.eslintrc.json"] }
}
```

`dependsOn: ["^build"]` builds dependencies first; `cache: true` reuses prior results when inputs are unchanged.

**Why.** *Work smart* — the build graph and the cache do the bookkeeping; you stop manually deciding what to rebuild.

---

## 2. Name your inputs — and exclude tests from the build cache key

**What.** Define `namedInputs` so a target's cache invalidates on exactly the right files.

```jsonc
"namedInputs": {
  "default":    ["{projectRoot}/**/*", "sharedGlobals"],
  "production": ["default",
    "!{projectRoot}/**/*.spec.ts",
    "!{projectRoot}/**/jest.config.ts",
    "!{projectRoot}/**/*.stories.ts"],
  "sharedGlobals": ["{workspaceRoot}/tsconfig.base.json"]
}
```

**Why.** *Work smart* + *Compensate for weaknesses* — with a `production` input that **excludes test files**, editing a spec doesn't bust the *build* cache (only the test cache). Conversely, putting shared config (jest preset, eslint, tsconfig.base) in the relevant `inputs` means the cache **does** invalidate when that shared config changes — correctness *and* speed.

---

## 3. Do the minimum: `affected`

**What.** Run a target only for projects touched by your changes.

```bash
nx affected -t build test lint
```

**Why.** *Automate every repeated process* — CI and local checks scale with the change, not the repo.

---

## 4. Remote cache — share results, guard the token

**What.** A remote cache (Nx Cloud or self-hosted) shares artifacts across machines/CI.

**Why / pitfall.** Big speed-up — but keep the **access token in an env var/secret, never committed** to `nx.json` (`architect-mentality` → *Compensate for weaknesses*; a committed read-write cache token is a real hazard).

---

## When NOT to fuss

A tiny workspace gets little from elaborate input tuning — defaults are fine until builds are slow enough to measure (*Know when not to do it*). Tune inputs when cache misses actually cost you.

## Pitfalls

- A target that reads files outside its declared inputs will serve **stale** cache — declare every real input.
- Non-deterministic builds (timestamps, random) poison the cache — make builds reproducible.

---

**Mentality anchors:** *Work smart, not hard*, *Automate every repeated process*, *Compensate for your materials' weaknesses* — in the `architect-mentality` skill.
