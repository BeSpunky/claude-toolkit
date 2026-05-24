# Module-Boundary Enforcement

This is the **black box** principle made *enforceable*: every cross-library dependency is a deliberate, sanctioned, one-directional connection — checked by lint, not left to discipline (`architect-mentality` → *Everything is a black box*). In Nx this is project **tags** + `@nx/enforce-module-boundaries`.

---

## 1. Give every project a tag taxonomy

**What.** Tag each library/app along two axes: **what kind** it is and **what domain** it belongs to.

```jsonc
// project.json
{ "tags": ["type:feature", "scope:bookings"] }
```

Typical `type:` values — `app`, `feature`, `ui`, `data`, `util`. Typical `scope:` values — your business domains. Adapt to your domains; the point is a *small, consistent* vocabulary (*Lead with one mental model*).

---

## 2. Encode the directed dependency rules

**What.** In ESLint, declare which tags may depend on which — making the layering one-directional.

```jsonc
"@nx/enforce-module-boundaries": ["error", {
  "enforceBuildableLibDependency": true,
  "depConstraints": [
    { "sourceTag": "type:app",     "onlyDependOnLibsWithTags": ["type:feature", "type:ui", "type:data", "type:util"] },
    { "sourceTag": "type:feature", "onlyDependOnLibsWithTags": ["type:ui", "type:data", "type:util"] },
    { "sourceTag": "type:ui",      "onlyDependOnLibsWithTags": ["type:ui", "type:util"] },
    { "sourceTag": "type:data",    "onlyDependOnLibsWithTags": ["type:util"] },
    { "sourceTag": "type:util",    "onlyDependOnLibsWithTags": ["type:util"] },
    { "sourceTag": "scope:bookings", "onlyDependOnLibsWithTags": ["scope:bookings", "scope:shared"] }
  ]
}]
```

**Why.** *Everything is a black box* — "utilities flow into data, data into features, presentation never into data, nothing into utilities" stops being a hope and becomes a **compile/lint error**. The architecture is guarded by the toolchain, not by reviewers' memory.

---

## 3. Constrain buildable/publishable libraries

**What.** `enforceBuildableLibDependency: true` stops a buildable/publishable library from depending on a non-buildable one (which would break its build in isolation).

**Why.** *Compensate for weaknesses* — catches a packaging mistake at lint time, not at publish time.

---

## When NOT to over-constrain

Start with a taxonomy you'll actually maintain; an elaborate tag matrix nobody understands is worse than a simple one consistently applied (*Know when not to do it*). Tighten constraints as the workspace grows.

## Pitfalls

- Tags only help if **every** project is tagged — an untagged project is an unguarded hole.
- A circular dependency or an against-the-grain import is the rule catching a real design smell — fix the design, don't relax the rule (`architecture-first`: root cause, not a workaround).

---

**Mentality anchors:** *Everything is a black box* (deliberate, directed connections), *Lead with one mental model*, *Compensate for your materials' weaknesses* — in the `architect-mentality` skill.
