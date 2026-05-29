# Naming

A name is part of the **contract** — what you call something shapes how everyone (including future-you) thinks about it (`architect-mentality` → *Design for the consumer*; *Place everything on purpose*; *Lead with one mental model*). Naming is the cheapest, highest-leverage design decision you make. Treat it that way.

---

## 1. Name by purpose, not by architectural role

**What.** Name a code element by *what it does for its consumer*, not by *what kind of architectural piece it is*. The name should answer **"what does this give me?"**, not **"where does this sit in the architecture?"**

Architectural-role suffixes are the usual offenders: **`Service`, `Manager`, `Facade`, `Provider`, `Util`, `Helper`, `Wrapper`, `Handler`, `Processor`, `Coordinator`, `Engine`**. They describe a position in some mental org-chart, not the thing's purpose. They're nearly always reached for when the author hasn't yet found the right concept and grabbed a generic word to keep moving.

**Wrong → Right:**

| Architectural role (avoid) | Purpose-named (prefer) |
| --- | --- |
| `DefectsApiService` / `DefectsService` / `DefectsApi` | `Defects` · `DefectsClient` |
| `UserManager` | `UserDirectory` · `Users` |
| `OrderProcessorService` | `OrderPlacement` · `Checkout` |
| `ConfigUtil` | `Config` · `Settings` |
| `StringHelper` | the verb it actually does — e.g. `Slug`, `Truncate` |
| `PaymentFacade` | `PaymentGateway` · `Payments` |

**Why.** *Design for the consumer*. At the call site, `defects.findFor(branch)` reads as **intent**; `defectsApiService.findFor(branch)` reads as **architecture trivia**. Architecture is *thought*, not *spoken*. The role belongs in the design discussion and the dependency graph — it doesn't belong in the name your callers type a thousand times.

**The test.** If you can delete the role-suffix without losing meaning, delete it. If after deleting you'd struggle to say what the thing *is*, you haven't found the real concept yet — keep searching (`architect-mentality` → *Model the missing concept*).

**The narrow exception.** A few "role" words *are* the domain concept in their context: an HTTP framework's `Handler`, a UI framework's `Component`, an Nx `Generator`/`Executor`, an Angular `Pipe`/`Directive`. These name a precise kind of thing the framework defines, not a generic position — keep them. The rule forbids **generic role-suffixes that hide the real concept**, not domain-specific terms that *are* the concept.

---

## 2. Intention-revealing names

**What.** A name should let a reader infer what the thing does, why it exists, and how it's used — **without reading the body**.

Bad smells:
- Single-letter names outside tiny scopes.
- Abbreviations that aren't already domain language (`usrCtx`, `mgr`, `svc`).
- Hungarian / type prefixes (`strName`, `IFoo` for interfaces).
- Names that **lie**: `getUser` that mutates, `isReady` with side effects.
- Names that **under-promise**: `doStuff`, `process`, `handle`.

**Why.** *Lead with one mental model* + *Design for the consumer* — the cost of *choosing* a name is paid by you once; the cost of *parsing* a vague name is paid by every reader, forever.

---

## 3. Speak the domain (ubiquitous language)

**What.** Names in code match the words domain experts use, exactly. **One concept = one name.** Don't paraphrase, don't translate.

**Why.** *Lead with one mental model* (see also `domain-modeling.md` → *Ubiquitous language*) — when code and conversation share vocabulary, there is no translation layer to get wrong, and a stranger who learned the domain in a meeting can read the code.

---

## 4. Symmetric pairs read as symmetric pairs

**What.** Operations that mirror each other get names that mirror: `open`/`close`, `add`/`remove`, `subscribe`/`unsubscribe`, `acquire`/`release`, `lock`/`unlock`. Don't mix idioms (`start`/`stop` paired with `init`/`tearDown`).

**Why.** *Design for the consumer* — symmetry is a one-time-learn / infinite-time-predict win.

(For broader API-surface conventions, see `contracts-and-api-design.md` → *Guessable naming & symmetry*.)

---

## When NOT to over-name

Names *inside* a tiny scope — a one-line lambda, a loop counter, a destructured local that's about to be used once — can be terse; context disambiguates. **The rule scales with scope and lifetime:** a public class name is far more expensive to misname than a local variable. Don't ceremony-pad a `for (const u of users)` into `for (const userElement of users)`.

## Pitfalls

- **"I'll rename it later."** You won't. The first call site cements the name in everyone's vocabulary.
- **A name that *used to* describe the thing and no longer does** is worse than an ugly accurate one — rename when the meaning shifts.
- **"Defensive" generic names** (`DataService`, `BaseHandler`) buy you nothing and cost every reader clarity. They feel safe; they're not.
- **Reaching for a role-suffix because the concept hasn't crystallized** is a signal to keep thinking, not a signal to commit. Pause and ask "what does this *do*?" until the name writes itself.

---

**Mentality anchors:** *Design for the consumer*, *Place everything on purpose*, *Lead with one mental model*, *Model the missing concept* — in the `architect-mentality` skill.
