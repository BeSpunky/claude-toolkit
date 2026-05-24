# Template-Literal & Branded Types

Make the *type system itself* enforce string shapes, parse formats, and distinguish values that look alike — so misuse can't compile (`architect-mentality` → *Design for the consumer*; *Model the missing concept* / make illegal states unrepresentable).

---

## 1. Ergonomic string types via template literals

**What.** Accept human-friendly string formats while keeping them type-checked.

```ts
type Duration = number | `${number}${'ms' | 's' | 'm'}`;   // 3000 | '10s' | '0.5m' — all valid; '10x' is not
type HexColor = `#${string}`;
type EventName = `on${Capitalize<'click' | 'hover'>}`;      // 'onClick' | 'onHover'
```

**Why.** *Design for the consumer* — the caller writes what's natural and the compiler still guards them.

---

## 2. Parse strings at the type level

**What.** Decompose a string literal into parts with recursive conditional types.

```ts
type Split<S extends string, D extends string> =
  S extends `${infer Head}${D}${infer Tail}` ? [Head, ...Split<Tail, D>] : [S];

type PathParams<P extends string> = Extract<Split<P, '/'>[number], `:${string}`>;
// PathParams<'/users/:userId/posts/:postId'>  ->  ':userId' | ':postId'
```

**Why.** *Work smart* — a single literal (e.g. a route or a format string) becomes the source of truth for derived names and argument shapes; nothing is hand-mirrored.

**Capstone (illustration).** Combining this with key transforms and `type-level-diagnostics.md`, you can derive a fully-typed command/navigation API from a string-literal config — method names *and* argument object shapes computed from the literals, with mismatches reported as readable type errors. Powerful; reserve it for genuinely high-leverage APIs (*Know when not to do it*).

---

## 3. Branded (nominal) types — distinguish look-alikes

**What.** Two values with the same structural type (e.g. `string`) that must not be interchangeable get a phantom brand.

```ts
type Brand<T, B extends string> = T & { readonly __brand: B };
type UserId = Brand<string, 'UserId'>;
type Email  = Brand<string, 'Email'>;

const asUserId = (s: string) => s as UserId;     // one guarded entry point
// function load(id: UserId) {}  load(someEmail)  ->  compile error
```

**Why.** *Model the missing concept* / make illegal states unrepresentable — "a user id is not just any string" becomes a fact the compiler enforces.

---

## When NOT to use

Don't brand or template-parse what a plain type already expresses clearly. These shine for **formats, identifiers, and string-derived APIs**; elsewhere they add noise (*Know when not to do it*).

## Pitfalls

- Recursive string types hit recursion/instantiation limits and slow compiles — keep inputs bounded.
- Branding adds a cast at the boundary; centralize it in one constructor/guard so the brand stays trustworthy.

---

**Mentality anchors:** *Design for the consumer*, *Model the missing concept*, *Work smart, not hard*, *Know when not to do it* — in the `architect-mentality` skill.
