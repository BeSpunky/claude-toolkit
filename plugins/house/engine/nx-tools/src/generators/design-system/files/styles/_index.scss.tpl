// ============================================================================================
//  THE DESIGN SYSTEM'S PUBLIC SASS API — the ONE file anyone outside this library `@use`s.
//
//  This is the CONTRACT. Everything it forwards, we support. Everything it does not forward is
//  PRIVATE and may change without notice.
//
//  The separation is enforced twice, on purpose:
//    - AT THE EXPORT LEVEL — every `@forward` below carries an explicit `show` list. A member that
//      isn't named there is not public, even though its file is. Adding a member to the system does
//      NOT publish it; publishing is a deliberate act, performed here.
//    - AT THE FOLDER LEVEL — the implementation lives in `_`-prefixed folders named for WHAT THEY
//      ARE, not for the fact that they're private: `_core/` (the token engine) and `_utils/` (the
//      authoring toolkit). The leading `_` says "not yours"; the word says what it is. A
//      `@use 'design-system/styles/_core/tokens'` from outside is visibly reaching past the contract.
//  (And inside a partial, a member named with a leading `-` is private to that file entirely.)
//
//  CONSUMING IT
//
//    in-repo    ->  @use '{{specifier}}' as ds;
//    published  ->  @use '{{importPath}}/styles' as ds;
//
//  (Same specifier, minus the npm scope. In-repo it resolves through the sass load path the
//  `design-system-styles` generator put on your app's build target; published it resolves through this
//  package's `exports` map. One mental model, three consumers.)
//
//  Then, in the APP's global stylesheet — exactly once, nowhere else:
//
//    @include ds.theme();
//
//  And in any component's SCSS (app or design system):
//
//    @use '{{specifier}}' as ds;
//
//    :host {
//      padding: ds.space(3);
//      color: ds.color('on-surface');
//      background: ds.color('surface');
//      border-radius: ds.radius('md');
//      @include ds.focus-ring();
//    }
//
//  `@use`-ing this file emits ZERO CSS. Only `ds.theme()` emits, and only where you call it.
// ============================================================================================

// ── _core — the token engine ───────────────────────────────────────────────────────────────────

// The token MAPS stay private: a consumer reads tokens through the accessors below, never by reaching
// into `$base`/`$modes` — which would re-bake the value at compile time and silently break theming.
// Only the namespace is public, for anyone who must build a custom-property name by hand.
@forward '_core/tokens' show $prefix;

// The accessors. `var-name` is deliberately NOT public: building a raw `var(--…)` yourself bypasses
// the compile-time unknown-token check, which is the whole reason a typo can't ship.
@forward '_core/functions' show token, color, space, radius, font, border, duration, easing, elevation, z;

// The theme. `scope-mode()` re-binds a whole mode's tokens on a scope (an inverted hero, a dark
// sidebar); `declare()` is the lower-level primitive it's built on; `mode()` scopes a block to a
// pinned mode for a structural swap.
@forward '_core/theme' show theme, mode, scope-mode, theme-overrides, declare;

// ── _utils — the authoring toolkit ─────────────────────────────────────────────────────────────

// Mechanisms, not looks.
@forward '_utils/mixins' show $breakpoints, media, container, focus-ring, elevation, transition, reduced-motion;

// Placeholders: %visually-hidden, %reset-button, %truncate, %overlay-surface.
// No `show` list here, and not by choice: a sass `show`/`hide` list accepts only variables, functions
// and mixins — naming a `%placeholder` in one is a parse error. So a placeholder's visibility is
// controlled at the DECLARATION instead: name it with a leading `-` to keep it private to its file.
@forward '_utils/placeholders';
