# Declaration Merging & Dynamic Surfaces

Give a fully-typed public surface to code whose members are supplied **at runtime** (a Proxy, a mixin, a factory) — without losing IntelliSense (`architect-mentality` → *Refuse false tradeoffs*; *Abstractions must never trap*).

---

## 1. Type a dynamically-implemented class via a same-name interface

**What.** Declare an `interface` with the **same name** as a `class`. TypeScript merges them, so the class is typed as if it had members it doesn't physically declare — perfect when something else (a Proxy/delegation layer) provides them at runtime.

**Why.** *Refuse false tradeoffs* — dynamic implementation **and** full static types, not either/or.

```ts
type Delegated = FunctionsOf<google.maps.Map>;                  // derived elsewhere

export interface MapWrapper extends Delegated {}               // promises the methods to the type system
export class     MapWrapper extends NativeWrapper<google.maps.Map> {
  // the methods aren't written here; the Proxy supplies them at runtime
}
```

**This is exactly what `angular-native-wrappers` uses** — that skill *applies* this; the mechanism lives here.

---

## 2. Augment external / global types (module augmentation)

**What.** Add or extend types on a third-party module or the global scope from your own code.

```ts
declare module 'some-lib' {
  interface LibOptions { myPlugin?: MyPluginOptions; }   // extend their config type
}
declare global { interface Window { __APP_VERSION__: string; } }
```

**Why.** *Abstractions must never trap* — you can teach the type system about a legitimate extension instead of casting to `any`.

---

## 3. Interface merging for open/extensible config

**What.** Multiple `interface` declarations with the same name merge — a deliberate extension point where features contribute fields to a shared config type.

**Why.** *Define the seam* — an open interface is a typed plug-in point.

---

## Keep types and runtime in lockstep (the rule that makes all of this safe)

A same-name interface (or an augmentation) **promises** members the compiler will then trust. If the runtime doesn't actually deliver them, you get runtime errors the compiler can't catch. So:

- Pair declaration merging with a mechanism that **guarantees** the members exist (a Proxy/delegation layer, a mixin that really adds them).
- When you exclude a member at runtime, also remove it from the merged type (`Omit` it), so the type and the runtime agree.

**Why.** *Architecture-first / model honestly* — the type is a contract; a contract the implementation doesn't honor is worse than no contract.

## When NOT to use

If you can write the members directly, do — declaration merging is for the cases where members are genuinely supplied dynamically. Don't merge to paper over a design you could express plainly (*Know when not to do it*).

## Pitfalls

- A merged interface that over-promises = confident autocompletion for methods that throw at runtime.
- Only merge what is truly provided; resist "it'll probably be there."

---

**Mentality anchors:** *Refuse false tradeoffs*, *Abstractions must never trap*, *Define the seam* — in the `architect-mentality` skill.
