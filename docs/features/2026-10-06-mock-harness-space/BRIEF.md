# Brief — the mock harness gives the mock the screen

User, 2026-10-06 (verbatim):
> the mock app is compacted. Also, the browser in the machine takes part of the screen realestate, the comments inside of the mock interface also do that... We need to optimize it and make the experience a lot more accessible at all levels - VNC, machine, browser, mock app, mock app modules, etc.

Approved plan, phases 2–3 (user: "Good."):
- Comment side panel → drawer, collapsed by default, overlays instead of taking a column; rail collapsible; drop the 1320px cap and big padding.
- Header + hint + toolbar → one slim row; bottom bar keeps Comment and Choose, Copy/Clear/auto-send into a menu.
- Focus fit modes: fit-to-screen (default), 1:1, fit-width; show the real scale; never claim "true size" falsely.
- Presentation mode `f`, hide pins `h`, arrow keys between concepts.
- A11y: rem type, tokenized colours meeting AA, prefers-reduced-motion, light theme, keyboard-reachable comment actions + keyboard comment placement, aria-live, focus return.
- Fix the "true size" claims in SKILL.md:262 and gallery.js.

## Investigation findings (assets/mock-harness/ unless noted)
- Focus layout: body pad 22/clamp(16,4vw,40)/92 (gallery.html:26); `.wrap{max-width:1320px}` (:34); sticky .top: topbar ~54 (:43,:46), subhint ~28 (:49), toolbar ~67 (:70-71); grid 88 | 1fr | 300, gap 24 (:128-129); fixed .bar ~57+ wraps (:230-251). Only breakpoint 900px (:130-136).
- Mock iframe: fixed width/height from mocks.json viewports (Phone 390×844, Desktop 1280×800), transform: scale, origin top-left (gallery.js:120,:144-146; html:148). Focus scale = min(1, avail/w) — width only (gallery.js:142). At 1280 viewport Desktop renders ~0.60. Phone at 1.0 overflows → double scroll.
- Compare: auto-fit minmax(clamp(220px,26vw,300px),1fr) (:96-97), scale min(1,avail/w,0.62·innerHeight/h); Evolution strip clamp(200px,22vw,264px) (:195), 0.52·innerHeight.
- Comments: pins 22px overlay (review.css:9-25; review.js:69,206-221); popovers fixed max min(280px,78vw) (css:88-104; js:92-109); composer 320px with focus trap (js:295-341; css:126-166); comment-mode badge (css:188-202). .side 300px column always present (html:128,150), comments + History (gallery.js:328-340); row actions hover-only (html:171-173).
- State: hash deep links #compare/…, #focus/Name/Phone[/v2], #evolution/… (gallery.js:11,87-105). Keys: c (gallery.js:448; review.js:268), Esc (gallery.js:51,:528).
- A11y debts: no reduced-motion (css:135, :70, review.js:284 smooth scroll); all px, 10–13px chrome text; dark only (html:10); --faint #6f688a on #0d0b14 ≈3.9:1; hard-coded hex in review.css; composer not announced, no focus return; .bar no :focus-visible; toast no aria-live; Remove inside hover popover; no keyboard comment placement.
- Documented intent to respect/revisit: "compact, sticky — the mock starts right below it" (html:39); "slim VERTICAL column beside the mock" (html:107); "collapsed by default so the mock starts high" (js:44).
