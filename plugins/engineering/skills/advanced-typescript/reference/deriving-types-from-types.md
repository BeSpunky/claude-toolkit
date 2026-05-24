# Derive Types From Types

Make one type the **single source of truth** and let others follow it automatically — so a change in the source propagates with zero manual edits (`architect-mentality` → *Work smart, not hard*; *Place everything on purpose*). Mapped types, conditional types, and `infer` are the tools.

---

## 1. Filter members by kind (mapped type + key remapping)

**What.** Produce a type containing only the members of another type that match a criterion — e.g. only its function-valued properties.

**Why.** *Work smart* — you never hand-list the members; the derived type tracks the source.

```ts
type Properties<T, Of> = { [K in keyof T as T[K] extends Of ? K : never]: T[K] };
type FunctionsOf<T>     = Properties<T, Function>;     // only method members
type DataOf<T>          = Omit<T, keyof FunctionsOf<T>>; // only data members
```

The `as … ? K : never` **key remapping** (TS 4.1+) drops keys by remapping them to `never`.

---

## 2. Extract an inner type with `infer`

**What.** Pull a type back out of a generic wrapper.

```ts
type ElementOf<T>  = T extends readonly (infer E)[] ? E : never;
type NativeOf<W>   = W extends Wrapper<infer N> ? N : never;   // recover the wrapped type
type Resolved<T>   = T extends Promise<infer R> ? R : T;       // (or use built-in Awaited<T>)
```

**Why.** *Refuse false tradeoffs* — a generic abstraction stays generic *and* callers can still name its inner type.

---

## 3. Reach for the built-in toolkit before hand-rolling

`Pick` / `Omit` / `Partial` / `Required` / `Readonly` / `Record`, and function-level `Parameters` / `ReturnType` / `ConstructorParameters` / `InstanceType` / `Awaited`.

```ts
type SetterArgs = Parameters<HTMLElement['setAttribute']>;   // [name: string, value: string]
type ConfigPatch = Partial<Readonly<MapEngineConfig>>;
```

**Why.** *Don't reinvent* — the built-ins are battle-tested and instantly readable; compose them before writing custom conditionals.

---

## 4. Derived types as a single source of truth

**What.** When you have a value-typed source (a native SDK type, a schema, a config object), derive the API/DTO/mock shapes *from it* instead of maintaining a parallel hand-written copy.

**Why.** *Work smart* + *single source of truth* (a duplicated shape is a future bug): when the source changes, every derived type updates on the next compile, and mismatches surface immediately.

```ts
type PublicApi = Omit<FunctionsOf<google.maps.Map>, 'setMap' | 'unbindAll'>;  // exclude on purpose
```

---

## When NOT to use

If a hand-written type is **clearer** and the source won't drift, write it by hand (`architect-mentality` → *Know when not to do it*). Type-level derivation earns its keep when the source is large, volatile, or owned by someone else.

## Pitfalls

- Deep conditional/recursive derivations hurt compile performance and produce inscrutable errors — keep them shallow and named.
- Key remapping needs TS 4.1+; `Awaited` needs 4.5+.
- A derived type is only as honest as its source — see `declaration-merging.md` on keeping types and runtime in lockstep.

---

**Mentality anchors:** *Work smart, not hard*, *Refuse false tradeoffs*, *Place everything on purpose* — in the `architect-mentality` skill.
