# Embodied & contextual use

The user in your head — focused, two hands, big screen, fast wifi, full attention — is usually a fiction. The real one might be a thumb on a phone, half-distracted, tired, hurried, in bright sun, on a train with one bar — *or* a professional at a desk with two monitors and full focus — *or* a gloved worker at a kiosk, a driver glancing at a dashboard, someone in bed with a watch. **Astonishing-to-use design isn't built for an assumed context; it's built for the *real* one — which you have to find out.**

So before deciding anything, **ask good questions about the actual use, and treat the answers as thought-food the design grows from** — don't optimize for a context you assumed:

- **Who is the audience, really?** Their familiarity, goals, constraints.
- **On what devices do they actually use this** — and is there a *specific* device context that dominates (phone, desktop pro tool, tablet, kiosk, in-car, wall display, watch, TV)?
- **Where and when** — commuting, at a desk, on the couch, in the field, at the bedside, between other tasks?
- **In what state** — focused or distracted, calm or stressed, patient or rushed, fresh or exhausted?
- **Under what constraints** — network, lighting, noise, one hand, gloves, glance-only, interruptions?

Then design for *that* answer, whatever it is. The thumb-on-a-train picture is a common reality for many consumer apps and a useful corrective to the desk-user fiction — but it is an **example to reason from, not a target**: a focused desktop power tool should be built for focus and precision, never dumbed down for a distraction that isn't there.

The rest of this cluster is the **dimensions to investigate** — the body, the mind and the moment, the environment, the device-shaped layout. Read them as questions to ask of *your* real context, not universal mandates.

## The body

- **Thumbs, not cursors** — *when your real context is phone use* (confirm it). Then most interaction is a single thumb: primary actions belong in the **easy reach zone** (lower and center); the top corners are a stretch, and a gorgeous bottom-corner CTA the thumb can't reach one-handed is a defect. (On a desktop pro tool, this inverts — precision pointer, dense targets, keyboard-first.)
- **Touch ergonomics.** Comfortable target sizes (~44px+) and spacing; no precision-tapping tiny or crowded targets; account for the finger covering what it touches.
- **One-handed by default.** Assume the other hand is holding a coffee, a pole, a child. Reachability and gestures should work one-handed.
- **Gestures are invisible.** Swipe/long-press/pinch are great accelerators but undiscoverable — never make them the *only* path to something important; back them with a visible control.
- **Plan for the on-screen keyboard.** Focusing a field pops the keyboard and resizes the viewport — the whole layout shifts. Keep the focused field visible and editable and don't let the layout scramble (see `continuity-and-transitions.md`).

## Different layouts for different devices

Devices are not one canvas at different widths — they are different *contexts*. A layout that's right on a laptop is often *wrong* on a phone, and **reflowing it doesn't fix that**: a desktop grid squeezed onto a phone is cramped and awkward. The mobile version may need to be **something else entirely** — often more creative, and definitely more thumb-native: a swipeable stack instead of a grid, a bottom sheet instead of a sidebar, a single focused column instead of three panes. Design the *right* layout for each device; don't reorganize one layout to fit all. (This is `stage-the-vision`'s *re-stage, don't shrink* and `realize`'s responsive-and-adaptive-layout, seen from the use side.)

## The mind & the moment

- **Partial attention.** People use apps in gaps — in line, on a couch, between things — glancing, not studying. Make the important thing **glanceable**: readable and actionable in a two-second look.
- **Interruption is normal.** They will be pulled away mid-task and come back. Preserve state, don't lose their progress, let them resume where they were. Never punish a return with a reset.
- **Tired, stressed, hurried.** The user is often not at their best. The design must hold up when attention and patience are low — which means *more* clarity and *less* friction, not a clever puzzle.
- **Emotional state.** How does using this *feel* — calm or anxious, in control or lost, respected or nagged? The felt experience of use is part of UX, not separate from it.

## The environment

- **Bad connections.** Slow, flaky, offline. Design for the wait and the failure: optimistic UI, useful offline states, graceful degradation, never a frozen blank (`keep-users-oriented`).
- **Sun, motion, noise.** Readable in glare (contrast, size); usable in motion (no precision required); doesn't depend on sound.
- **Battery & data.** Heavy, always-animating, always-fetching designs cost the user real battery and data — a hidden tax on use (ties to `realize`'s performance cluster).

## The context test

Picture the actual use: a tired person, one thumb, half-watching, on a slow train. Walk your design through *that*. If it only works for the focused desktop user, it's designed for the demo, not the life.

## Pitfalls

- **Desk-and-cursor assumptions** — hover-dependent UI, tiny targets, top-corner primary actions, two-handed gestures.
- **Gesture-only actions** — important things reachable only by an invisible swipe.
- **State loss on interruption** — coming back resets the task.
- **Demo-conditions design** — only holds up with full attention, big screen, fast network.
- **Ignoring the felt state** — adding pressure (timers, nags) to a user who's already stretched.
