# Accessibility, reduced-motion & fallbacks

An immersive interface that excludes or harms people is not finished — it's broken with a nice coat of paint. The most expressive visuals ride on top of a core that everyone can use. This cluster is how the craftsman keeps the feeling *and* keeps it for everyone (`architect-mentality` — design for the consumer; abstractions must never trap).

## Reduced motion — non-negotiable

- **`prefers-reduced-motion: reduce`** signals a user who can be made dizzy, nauseated, or worse by motion — vestibular disorders, migraine, seizure triggers (affecting tens of millions). Honor it always.
- **Parallax, scroll-scrubbing, zoom/scale, spinning, large sweeping movement, and auto-playing motion are the worst offenders.** Under reduced-motion, remove or gentle them.
- **Reduced motion ≠ no feedback.** Transitional cues *help* orientation (`keep-users-oriented`). Keep *meaning*, drop *vestibular risk*: prefer opacity fades and color/light changes over movement; shorten and slow what remains; make essential transitions instant rather than animated.
- **Implement at the source:** a global CSS `@media (prefers-reduced-motion: reduce)` guard, and in JS read `matchMedia('(prefers-reduced-motion: reduce)')` and branch the animation. Build it into the animation seam so it's guaranteed, not remembered per component (`architect-mentality` — automate/concentrate; the `keep-users-oriented` "design it in" move).
- **Test with the OS setting actually on.** Don't assume the fallback works — see it.

## Custom visuals must stay operable

- **Keyboard:** everything interactive must be reachable and operable by keyboard (Tab/Shift-Tab, Enter/Space, arrow keys for custom widgets), with a **visible focus indicator**. A sunflower-petal menu is still a menu — its petals are focusable controls in a sensible order.
- **Focus management:** when the view transforms, moves, or routes, move focus deliberately and don't strand it on hidden elements; restore it on close. Cinematic transitions must not break the focus thread.
- **Semantics under the skin:** screen readers don't see your art. Custom controls need correct roles/names/states (native elements first; ARIA only to fill gaps — and *correct* ARIA, since wrong ARIA is worse than none). The drawing is decoration *over* a properly-labeled control.
- **Canvas/WebGL are opaque** to assistive tech: provide a **parallel accessible layer** — real DOM controls and text conveying the same meaning and actions. The immersive canvas is an enhancement on top of a usable core.
- **Don't trap or hijack:** scroll-jacking, focus traps, and gesture-only interactions lock people out. Always leave the native contract (scroll, zoom, back) intact.

## Other inclusion caveats

- **Contrast & legibility** survive over busy/animated/3D backgrounds — text must stay readable as the world moves (WCAG contrast; test against the moving backdrop). The `design:accessibility-review` skill runs a full WCAG audit.
- **No seizure risk:** nothing flashing more than ~3×/second; avoid large high-contrast strobing.
- **Touch targets** large enough (~44px); immersive layouts still need comfortable hit areas.
- **Respect other preferences:** `prefers-reduced-transparency`, `prefers-contrast`, `prefers-color-scheme` — let the world adapt.

## Progressive enhancement & honest fallbacks

- **Start from a usable, meaningful base** (semantic HTML, real content, real controls) and *layer* the immersive experience on top. If WebGL fails, the View Transitions API is unsupported, scroll-driven CSS isn't there, or JS is blocked — the core still works.
- **Feature-detect, then enhance** (WebGPU→WebGL, scroll-timeline→IntersectionObserver, View Transitions→plain swap). Never assume support; design the fallback as a first-class state, not an afterthought.
- **The fallback should still carry the feeling** in a simpler form — a calm static hero instead of a 3D scene is fine; a broken blank canvas is not.

## On the house stack (Angular / Nx)

- Centralize a **reduced-motion signal/service** the whole app reads, so every animation seam honors it by default.
- Angular **CDK a11y** (`FocusTrap`, `LiveAnnouncer`, `FocusMonitor`, roving tabindex) gives focus/announcement primitives for custom immersive widgets.
- Keep semantics in the template and the spectacle in a wrapped, disposable layer (`bespunky-engineering:angular-native-wrappers`) so the accessible core never depends on the effect.

## The rule

**Immersion is an enhancement on a foundation everyone can use — never a gate.** If the experience only works for a mouse-using, motion-tolerant, high-end-device user, it isn't the Vision realized; it's the Vision realized for a few. Pair with `design:accessibility-review` before handoff.
