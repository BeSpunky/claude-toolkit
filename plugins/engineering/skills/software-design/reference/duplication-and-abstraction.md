# Duplication & Abstraction

Remove real duplication ruthlessly — and resist abstracting things that only *look* alike (`architect-mentality` → *Work smart, not hard*; *Know when not to do it*). This cluster is a balance, not a slogan.

---

## 1. Single source of truth

**What.** Each rule, constant, or piece of knowledge lives in exactly one place; everything else derives from it.

```ts
// one place defines the tiers; limits, labels, and validation all derive from it
const TIERS = { free: { seats: 1 }, pro: { seats: 10 } } as const;
```

**Why.** *Work smart* — a change happens once and can't drift out of sync. (See also `nx-monorepo-and-dx` → generators, for *generating* derived artifacts from the source of truth.)

---

## 2. Extract the essence; parameterize by data, not by a boolean

**What.** When two paths are genuinely the same behavior with different values, collapse them into one path parameterized **by data**. (If you'd parameterize by a boolean, you probably have two behaviors — see `replace-conditionals-with-structure.md`.)

**Why.** *Concentrate complexity* — the shared logic is written, understood, and fixed once.

---

## 3. DRY is about knowledge — not about text

**What.** Two passages that *look* identical but **change for different reasons** are not duplication; they're coincidentally similar. Keep them separate.

**Why.** *Place everything on purpose* — merging unrelated things couples them, so a change driven by one reason wrongly forces a change in the other. The question is never "do these look the same?" but "do these represent the *same decision*?"

---

## 4. The rule of three; prefer duplication over the wrong abstraction

**What.** Don't abstract on the first or even second occurrence. Wait until a *third* makes the shared concept clear, so you abstract the real commonality, not a guess.

**Why.** *Know when not to do it* — a premature/wrong abstraction is **costlier than duplication**: it's a shape everyone must contort to fit, and it's hard to unwind once depended on. When unsure, duplicate, learn, then extract.

## When NOT to use

Don't unify code paths that merely resemble each other (false DRY), and don't keep duplicating something whose single underlying rule is already obvious. Both extremes hurt — judgment is the technique.

## Pitfalls

- A "unified" function bristling with boolean/option parameters is two (or five) functions in a trenchcoat — split it.
- Extracting too early freezes the wrong seams; extracting too late leaves drift bugs. Watch for the *third* occurrence and for divergent reasons-to-change.

---

**Mentality anchors:** *Work smart, not hard*, *Know when not to do it*, *Concentrate complexity*, *Place everything on purpose* — in the `architect-mentality` skill.
