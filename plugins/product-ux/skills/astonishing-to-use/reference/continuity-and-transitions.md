# Continuity & transitions

The bar: **no "what just happened?" and no "wait, where am I?" — ever.** Every change in the interface is *continuous* — the user's eye is carried from the before to the after, never jolted. Things move from where they were to where they go; nothing teleports, pops, or shoves. A highly *expected*, smooth interface is one the user never has to re-orient inside.

## Smooth transitions — always

**The principle: nothing teleports.** Every meaningful change from one state to another is carried by continuous, gentle, quick motion, so the user's eye follows the thread from *before* to *after* and never has to re-find its place. A hard cut forces the user to re-orient; a transition hands them across. Apply this to *any* state change in the interface — wherever it goes from one arrangement to another.

A few illustrations to extrapolate from — **not a checklist to tick**:

- A new route that *arrives* rather than swaps, with **shared elements morphing** across (a list thumbnail growing into the detail hero) so list → detail → back stays one continuous thread.
- A region that *eases* between states (empty → loaded, collapsed → expanded), and a menu/sidebar/sheet/modal sliding or scaling in *from where it belongs* rather than blinking into being.
- A layout that *reflows* smoothly on resize instead of snapping.
- A list whose items *animate in and out* while their neighbours move to open or close the gap (FLIP), so add/remove/reorder reads as motion, not a flicker.

The instances are endless — hold the *principle* (carry the eye across every change) and apply it to whatever changes in *your* interface; don't stop at the four above.

(Build-side: `realize`'s motion cluster — View Transitions for routes & shared elements, FLIP for list/reorder, compositor-only so it stays at 60fps.)

## Avoid abrupt layout shifts — at all costs

A layout that jumps as content arrives is the top cause of "what just happened?" and mis-taps. Prevent it:

- **Reserve the space.** Anything still loading must hold its **correct position and size** up front — a skeleton/placeholder of the right dimensions — so when the real content lands, **nothing moves.** (This is CLS — cumulative layout shift — and it must be near zero.)
- **No late shovers.** Images, ads, async data, fonts — none may push the layout when they appear. Size them in advance.
- **Smooth the structural changes the *user* makes** — expand/collapse eases open, doesn't pop; toggles reveal with motion; nothing snaps to a new height.

## Keep the user oriented through change

When the layout *must* change, keep them anchored: preserve scroll position and context, move focus deliberately (not randomly), and never yank the viewport out from under them. (Pairs with `keep-users-oriented`.)

## Device-driven changes (anticipate them)

**The principle: the device itself will change the viewport out from under the user — anticipate it and keep them oriented and in control through the change**, never letting it scramble the layout, hide what they're working on, or lose their place. Because *you* don't trigger these, they're easy to forget — so design for them deliberately.

A few illustrations to extrapolate from — **not a checklist**:

- The **mobile keyboard** popping up on focus resizes the viewport in a big, sudden jump — keep the focused field visible (scrolled above the keyboard) and editable, don't let the rest scramble, restore cleanly on dismiss. A keyboard hiding the very field you're typing in is the classic failure.
- **Orientation flips, window resizes, foldables unfolding, browser chrome growing or shrinking** — each suddenly changes the available space; reflow smoothly and keep the user's place rather than re-laying-out jarringly.

Hold the principle and extrapolate to any device-driven change your context can throw — text-scaling, split-screen, an external display, an incoming interruption — and make sure none of them disorients the user.

## The continuity test

Trigger every change — route, open, expand, add/remove, load, keyboard — and ask: *did anything pop, jump, or teleport? did the user's eye lose its place?* If yes, it isn't done. The goal is that a change never surprises.

## Pitfalls

- **Content popping in and shoving the layout** (CLS) — the late image/data/font that moves everything.
- **Hard route swaps** and **teleporting** between list and detail (no shared-element continuity).
- **Items blinking** into and out of lists instead of animating in/out with neighbours adjusting.
- **Expand/collapse that snaps** to a new height; menus that appear instantly.
- **The keyboard hiding the focused input**, or the layout scrambling when it opens.
- **A change that makes the user ask "where am I?"** — lost scroll position, yanked viewport, randomly moved focus.
