/**
 * review.js — the per-variant review layer of the mock harness.
 *
 *   1. INTENT PINS  — any element with data-note="…" gets a numbered pin whose popover
 *      narrates what the low-fidelity thing stands for. Authored by Claude, at build time.
 *   2. COMMENTS     — the user presses `c` (or the gallery's Comment button) and clicks
 *      anything to pin a comment RIGHT WHERE THEY CLICKED — or, entered by keyboard, steers a
 *      crosshair with the arrows and presses Enter. POSTed to the server → comments.json.
 *
 * Two properties this file guarantees, because their absence is what made the old harness
 * feel half-baked:
 *   · A comment pin sits on the EXACT spot the user clicked (its fractional position inside the
 *     element), not at the element's corner. "This, here" lands where they pointed.
 *   · A popover NEVER leaves the frame — it flips and clamps to the viewport, so an intent note
 *     near a right/bottom edge is still readable.
 *
 * Claude reads the comments back by reading comments.json (or GET /comments) — NOT from a live
 * browser, so an asynchronous review works exactly as well as a co-driven one.
 *
 * Never edit this file per-project. It is harness, not mock.
 */
(() => {
  // The gallery loads this frame with query params identifying which variant/round/mode it is:
  //   live mock:   variants/lantern.html?variant=lantern&v=<current>
  //   history:     .versions/lantern__v2.html?variant=lantern&v=2&mode=history   (read-only)
  const params = new URLSearchParams(location.search);
  const VARIANT = params.get('variant')
    || location.pathname.split('/').pop().replace(/\.html$/, '').replace(/__v\d+$/, '');
  const VIEW_VERSION = params.get('v') != null ? Number(params.get('v')) : null;
  const READONLY = params.get('mode') === 'history';   // a past snapshot — view its comments, don't add
  // Hosted = framed by the gallery. The gallery owns removal (with Undo) and the gallery-level keys;
  // standalone, the frame does both itself.
  const HOSTED = window.parent !== window;
  const toGallery = (msg) => { if (HOSTED) window.parent.postMessage(msg, '*'); };
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const isEditable = (t) => !!t && (/^(input|textarea|select)$/i.test(t.tagName) || t.isContentEditable);
  let uid = 0;
  const nextId = (stem) => `mk-${stem}-${++uid}`;

  // Which comments belong on THIS frame:
  //   history → exactly that round's comments (handled shown, as a record);
  //   live    → the current round's OPEN comments only, so handled + past-round pins never clutter it.
  const belongsHere = (c) => {
    if (c.variant !== VARIANT) return false;
    if (VIEW_VERSION == null) return !c.handled;        // served standalone: just hide handled
    const v = c.version == null ? VIEW_VERSION : Number(c.version);
    return READONLY ? v === VIEW_VERSION : (v === VIEW_VERSION && !c.handled);
  };

  // ---- a stable, full-path selector for the clicked element (id > data-note > nth-child path) ----
  const selectorFor = (el) => {
    if (el.id && document.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1) {
      return `#${CSS.escape(el.id)}`;
    }
    if (el.dataset.note) {
      // Escape for a QUOTED attribute value (only \ and "), not CSS.escape (which is for identifiers).
      const sel = `[data-note="${el.dataset.note.replace(/["\\]/g, '\\$&')}"]`;
      if (document.querySelectorAll(sel).length === 1) return sel;
    }
    const path = [];
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const parent = n.parentElement;
      if (!parent) break;
      const i = [...parent.children].indexOf(n) + 1;
      path.unshift(`${n.tagName.toLowerCase()}:nth-child(${i})`);
      if (parent === document.body) { path.unshift('body'); break; }
    }
    return path.join(' > ');
  };

  const label = (el) =>
    el.dataset.note ? `“${el.dataset.note.slice(0, 32)}…”`
      : el.id ? `#${el.id}`
        : el.tagName.toLowerCase();

  // A pin is anchored to an element but positioned in an OVERLAY layer at the top of <body>, so
  // it is never clipped by the mock's own overflow:hidden and never mutates the mock's layout.
  const layer = document.createElement('div');
  layer.className = 'mk-layer';
  document.body.append(layer);

  // One polite announcer for the frame (the keyboard crosshair says what it would comment on).
  const live = document.createElement('div');
  live.className = 'mk-sr';
  live.setAttribute('aria-live', 'polite');
  document.body.append(live);

  const pins = [];   // { el, node, pop, kind, text, at, n }

  // ---- popovers ----
  // A popover is its pin's SIBLING in the layer (it may hold a Remove button, which can't nest in the
  // pin's button). It opens on hover, focus or click. A HOVER-opened popover closes shortly after the
  // pointer leaves both pin and popover (so the pointer can cross the gap to Remove); one that holds
  // FOCUS (the pin, or Tab into it) or was CLICK-pinned stays until focus leaves, Escape, or a click away.
  let hideTimer = null;
  let pinned = null;          // the pin whose popover a click pinned open
  let quietFocus = false;     // the next pin focus is a focus RETURN (Escape), not a request to open
  const isOpen = (p) => p.pop.classList.contains('mk-open');
  const holdsFocus = (p) => p.node === document.activeElement || p.pop.contains(document.activeElement);
  const closePop = (p) => {
    p.pop.classList.remove('mk-open');
    p.node.setAttribute('aria-expanded', 'false');
    if (pinned === p) pinned = null;
  };
  const openPop = (p) => {
    clearTimeout(hideTimer);
    for (const o of pins) if (o !== p && isOpen(o)) closePop(o);
    positionPop(p.node, p.pop);
    p.pop.classList.add('mk-open');
    p.node.setAttribute('aria-expanded', 'true');
  };
  const closePopSoon = (p) => {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { if (pinned !== p && !holdsFocus(p)) closePop(p); }, 140);
  };
  // The popover an Escape belongs to right now — focus-held or click-pinned (a merely hovered one isn't).
  const ownedPop = () => pins.find((p) => isOpen(p) && (pinned === p || holdsFocus(p)));
  const dismissPop = (p) => {
    const focusInside = p.pop.contains(document.activeElement);
    closePop(p);
    if (focusInside) { quietFocus = true; p.node.focus(); }
  };
  document.addEventListener('pointerdown', (e) => {
    if (pinned && !pinned.node.contains(e.target) && !pinned.pop.contains(e.target)) closePop(pinned);
  }, true);

  // Position a popover so it is ALWAYS inside the frame: below-right of the pin by default,
  // flipped above / clamped left when that would overflow. Measured against the frame's own
  // viewport (innerWidth/innerHeight) — which, in the gallery's Focus view, IS the mock viewport.
  const positionPop = (pinNode, pop) => {
    pop.style.left = '0px';
    pop.style.top = '0px';
    pop.classList.add('mk-measuring');       // render at full size, invisibly, to measure
    const pr = pinNode.getBoundingClientRect();
    const pw = pop.offsetWidth;
    const ph = pop.offsetHeight;
    const m = 8;
    let left = pr.left;
    let top = pr.bottom + 6;
    if (top + ph + m > innerHeight) top = pr.top - ph - 6;   // flip above
    top = Math.max(m, Math.min(top, innerHeight - ph - m));  // clamp vertically
    if (left + pw + m > innerWidth) left = innerWidth - pw - m;
    left = Math.max(m, left);
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
    pop.classList.remove('mk-measuring');
  };

  // Removing a comment. Hosted, the GALLERY owns it (it deletes, then offers Undo) — the frame only asks.
  // Standalone, the frame is the whole review, so it deletes itself.
  const removeComment = (n) => {
    if (HOSTED) { toGallery({ type: 'mk:remove', n }); return; }
    fetch(`/comments?n=${encodeURIComponent(n)}`, { method: 'DELETE' })
      .then((r) => r.json())
      .then((all) => { comments = all; renderComments(); })
      .catch(() => {});
  };

  const addPin = (el, text, kind, marker, extra = {}) => {
    const isComment = kind === 'comment';
    const node = document.createElement('button');
    node.type = 'button';
    node.className = 'mk-pin';
    node.dataset.kind = kind;
    node.textContent = marker;
    node.setAttribute('aria-label', isComment
      ? `Comment ${extra.n}${extra.handled ? ', handled' : extra.status === 'draft' ? ', not sent yet' : ''}`
      : `Design intent ${marker}`);

    const pop = document.createElement('div');
    pop.className = 'mk-pop';
    pop.id = nextId('pop');
    pop.dataset.kind = kind;
    const body = document.createElement('span');
    body.className = 'mk-pop-text';
    body.id = nextId('pop-text');
    body.textContent = text;
    pop.append(body);
    const describedBy = [body.id];
    if (isComment && extra.reply) {
      const reply = document.createElement('span');
      reply.className = 'mk-reply';
      reply.id = nextId('pop-reply');
      reply.textContent = `✓ handled — ${extra.reply}`;
      pop.append(reply);
      describedBy.push(reply.id);
    }
    node.setAttribute('aria-describedby', describedBy.join(' '));
    node.setAttribute('aria-controls', pop.id);
    node.setAttribute('aria-expanded', 'false');

    const rec = { el, node, pop, kind, text, at: extra.at || null, n: extra.n };

    if (isComment) {
      node.dataset.n = extra.n;                // so the gallery's list can highlight/reveal this exact pin
      if (extra.handled) {
        node.classList.add('mk-handled');     // green ✓ — Claude addressed it
        node.textContent = '✓';
      } else if (extra.status === 'draft') {
        node.classList.add('mk-draft');       // hollow — pinned but not yet sent
      }                                        // else 'submitted' — solid, waiting on Claude
      // Tell the gallery when this pin is hovered, so it can highlight the matching list row.
      node.addEventListener('mouseenter', () => toGallery({ type: 'mk:pin-enter', n: extra.n }));
      node.addEventListener('mouseleave', () => toGallery({ type: 'mk:pin-leave', n: extra.n }));
    }

    // A comment carries a delete affordance — the Remove button (Tab from the pin reaches it) and
    // Delete/Backspace on the focused pin — so a stray pin is one action to remove.
    if (isComment && extra.n != null) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'mk-del';
      del.textContent = 'Remove';
      del.setAttribute('aria-label', `Remove comment ${extra.n}`);
      del.addEventListener('click', (e) => { e.stopPropagation(); removeComment(extra.n); });
      pop.append(del);
      node.setAttribute('aria-keyshortcuts', 'Delete Backspace');
      node.addEventListener('keydown', (e) => {
        if (e.key !== 'Delete' && e.key !== 'Backspace') return;
        e.preventDefault();
        e.stopPropagation();
        removeComment(extra.n);
      });
    }

    node.addEventListener('mouseenter', () => openPop(rec));
    node.addEventListener('focus', () => { if (quietFocus) quietFocus = false; else openPop(rec); });
    node.addEventListener('click', (e) => {
      e.stopPropagation();
      if (pinned === rec) { closePop(rec); return; }
      openPop(rec);
      pinned = rec;
    });
    node.addEventListener('mouseleave', () => closePopSoon(rec));
    node.addEventListener('blur', () => closePopSoon(rec));
    pop.addEventListener('mouseenter', () => clearTimeout(hideTimer));
    pop.addEventListener('mouseleave', () => closePopSoon(rec));
    pop.addEventListener('focusin', () => clearTimeout(hideTimer));
    pop.addEventListener('focusout', () => closePopSoon(rec));
    layer.append(node, pop);                   // the popover sits right after its pin: Tab order is pin → Remove
    pins.push(rec);
    place();
  };

  // A rich snapshot of the clicked element, so a comment carries full CONTEXT to Claude — not just
  // the words: what it is, what it says, where/how big it is, how it's styled, and its ancestry.
  const cssPath = (el) => {
    const parts = [];
    for (let n = el; n && n !== document.body && parts.length < 6; n = n.parentElement) {
      let s = n.tagName.toLowerCase();
      if (n.id) s += `#${n.id}`;
      else {
        const cls = [...n.classList].filter((c) => !c.startsWith('mk-')).slice(0, 2);
        if (cls.length) s += `.${cls.join('.')}`;
      }
      parts.unshift(s);
    }
    return parts.join(' > ');
  };
  const domContext = (el, r) => {
    const cs = getComputedStyle(el);
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      classes: [...el.classList].filter((c) => !c.startsWith('mk-')),
      text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 140),
      rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
      styles: {
        color: cs.color, background: cs.backgroundColor, fontSize: cs.fontSize,
        fontWeight: cs.fontWeight, display: cs.display, padding: cs.padding, margin: cs.margin,
      },
      path: cssPath(el),
    };
  };

  // Position every pin. An intent pin sits just inside its element's top-left corner; a comment
  // pin sits on the EXACT fractional point the user clicked (at.x, at.y within the element).
  const place = () => {
    for (const p of pins) {
      const r = p.el.getBoundingClientRect();
      let x = r.left + scrollX;
      let y = r.top + scrollY;
      if (p.kind === 'comment' && p.at) {
        x += p.at.x * r.width;
        y += p.at.y * r.height;
      } else {
        x += Math.min(16, r.width / 2);
        y += Math.min(16, r.height / 2);
      }
      p.node.style.left = `${x}px`;
      p.node.style.top = `${y}px`;
      p.node.style.display = r.width || r.height ? '' : 'none';   // hide pins on collapsed elements
    }
  };
  addEventListener('scroll', place, { passive: true });
  addEventListener('resize', place);
  new ResizeObserver(place).observe(document.body);

  // ---- 1. intent pins (authored by Claude, via data-note) ----
  document.querySelectorAll('[data-note]').forEach((el, i) => addPin(el, el.dataset.note, 'note', String(i + 1)));

  // ---- 2. comments (authored by the user, persisted to disk) ----
  let comments = [];

  let commentSig = null;
  const renderComments = () => {
    const mine = comments.filter(belongsHere);
    // Skip the teardown+rebuild if THIS frame's comments are unchanged — otherwise an unrelated comment
    // change elsewhere (a 3s poll, or Claude handling a different comment) would rebuild every pin here
    // and yank an open popover / row-highlight / flash out from under the user. Only rebuild on real change.
    const sig = JSON.stringify(mine.map((c) => [c.n, c.status, c.handled, c.text, c.reply, c.anchor, c.at]));
    if (sig === commentSig) { place(); return; }
    commentSig = sig;
    // If a comment pin (or its popover) held focus — e.g. it was just removed by keyboard — keep focus at
    // the same place in the pin order instead of dropping it to <body>.
    const before = pins.filter((p) => p.kind === 'comment');
    const held = before.findIndex(holdsFocus);
    before.forEach((p) => { closePop(p); p.node.remove(); p.pop.remove(); });
    pins.splice(0, pins.length, ...pins.filter((p) => p.kind !== 'comment'));
    mine
      .forEach((c) => {
        let el = null;
        try { el = document.querySelector(c.anchor); } catch { /* stale selector */ }
        // If the anchor no longer resolves (a re-mock moved things), DON'T apply its fractional
        // point to <body> — that would fling the pin across the page. Anchor to body, no `at`.
        addPin(el || document.body, c.text, 'comment', String(c.n),
          { at: el ? c.at : null, n: c.n, handled: c.handled, reply: c.reply, status: c.status });
      });
    place();
    const after = pins.filter((p) => p.kind === 'comment');
    if (held >= 0 && after.length) after[Math.min(held, after.length - 1)].node.focus({ preventScroll: true });
  };

  const pull = () => fetch('/comments')
    .then((r) => r.json())
    .then((all) => { comments = Array.isArray(all) ? all : []; renderComments(); })
    .catch(() => { /* served statically without the endpoint — intent pins still work */ });

  // ---- pins visibility (the gallery's "hide pins"; `h` standalone) ----
  let pinsVisible = true;
  const setPins = (v) => {
    pinsVisible = !!v;
    document.body.classList.toggle('mk-pins-hidden', !pinsVisible);
    if (!pinsVisible) pins.forEach(closePop);
  };

  // ---- where a comment lands: ONE resolution for a click and for the keyboard crosshair ----
  const ANCHORS = '[data-note], [id], section, header, main, article, li, figure, button, a, h1, h2, h3, p, img';
  const CHROME = '.mk-layer, .mk-xhair, .mk-xtarget, .mk-dlg, .mk-dlg-backdrop, .mk-dlg-dot, .mk-sr';
  const targetAt = (x, y) => {
    const hit = document.elementsFromPoint(x, y).find((n) => !n.closest(CHROME));
    return hit?.closest(ANCHORS) || document.body;
  };

  let on = false;
  const setMode = (v, via) => {
    on = READONLY ? false : !!v;             // a history snapshot is a record; you can't comment on the past
    document.body.classList.toggle('mk-commenting', on);
    if (!on) xhair.hide();
    else if (via === 'keyboard') xhair.show();   // entered by keyboard → place by keyboard; by pointer → just click
    toGallery({ type: 'mk:mode', on });
  };

  // ---- the keyboard crosshair: comment placement without a pointer ----
  // A focusable point in the frame viewport (centre, or wherever it was last). Arrows move it 8px, Shift
  // 48px; pushed against an edge, the DOCUMENT scrolls by the step instead. It outlines and names what
  // a click there would comment on (targetAt — the very same resolution), and Enter comments there.
  const xhair = (() => {
    const node = document.createElement('div');
    node.className = 'mk-xhair';
    node.tabIndex = 0;
    node.hidden = true;
    node.setAttribute('role', 'application');
    node.setAttribute('aria-label',
      'Comment placement. Arrow keys move, Shift+arrows move faster, Enter comments here, Escape leaves comment mode');
    const box = document.createElement('div');
    box.className = 'mk-xtarget';
    box.hidden = true;
    box.setAttribute('aria-hidden', 'true');
    const boxLabel = document.createElement('span');
    boxLabel.className = 'mk-xtarget-label';
    box.append(boxLabel);
    document.body.append(box, node);

    let x = null;
    let y = null;
    let target = null;
    let announceTimer = null;
    const vw = () => document.documentElement.clientWidth;    // the viewport WITHOUT its scrollbar
    const vh = () => document.documentElement.clientHeight;
    const clampX = (v) => Math.max(0, Math.min(v, vw() - 1));
    const clampY = (v) => Math.max(0, Math.min(v, vh() - 1));
    const shown = () => !node.hidden;

    const update = () => {
      x = clampX(x);
      y = clampY(y);
      node.style.left = `${x}px`;
      node.style.top = `${y}px`;
      const el = targetAt(x, y);
      const r = el.getBoundingClientRect();
      const left = Math.max(0, r.left);
      const top = Math.max(0, r.top);
      box.style.left = `${left}px`;
      box.style.top = `${top}px`;
      box.style.width = `${Math.max(0, Math.min(r.right, vw()) - left)}px`;
      box.style.height = `${Math.max(0, Math.min(r.bottom, vh()) - top)}px`;
      box.classList.toggle('mk-label-below', top < 24);
      boxLabel.textContent = label(el);
      if (el === target) return;
      target = el;
      clearTimeout(announceTimer);
      announceTimer = setTimeout(() => { live.textContent = `Comment target: ${label(el)}`; }, 300);
    };
    const show = () => {
      if (!on) return;
      if (x == null) { x = vw() / 2; y = vh() / 2; }
      node.hidden = false;
      box.hidden = false;
      update();
      node.focus({ preventScroll: true });
    };
    const hide = () => {
      node.hidden = true;
      box.hidden = true;
      target = null;
      clearTimeout(announceTimer);
    };
    const move = (dx, dy) => {
      const nx = clampX(x + dx);
      const ny = clampY(y + dy);
      const sx = dx && nx === x ? dx : 0;      // already at that edge → scroll the document instead
      const sy = dy && ny === y ? dy : 0;
      x = nx;
      y = ny;
      if (sx || sy) scrollBy(sx, sy);
      update();
    };

    node.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const step = e.shiftKey ? 48 : 8;
      const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (delta) { e.preventDefault(); e.stopPropagation(); move(...delta); return; }
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (!dialogOpen) commentAt(x, y); return; }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setMode(false); }
    });
    addEventListener('scroll', () => { if (shown()) update(); }, { passive: true });
    addEventListener('resize', () => { if (shown()) update(); });
    return { show, hide };
  })();

  // ---- keys ----
  // The frame owns: `c` (comment mode), Escape for its own things (a held/pinned popover, comment mode),
  // arrows in comment mode (they bring up the crosshair). Hosted, the gallery-level keys are FORWARDED —
  // an iframe's keydown never reaches the parent document on its own.
  const FORWARDED = new Set(['f', 'h', '?', 'ArrowLeft', 'ArrowRight', 'Escape']);
  const ARROWS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);
  addEventListener('keydown', (e) => {
    if (dialogOpen || e.ctrlKey || e.metaKey || e.altKey || isEditable(e.target)) return;
    if (e.key === 'c') { setMode(!on, 'keyboard'); return; }
    if (e.key === 'Escape') {
      const p = ownedPop();
      if (p) { e.preventDefault(); dismissPop(p); return; }
      if (on) { e.preventDefault(); setMode(false); return; }
    }
    if (on && ARROWS.has(e.key)) { e.preventDefault(); xhair.show(); return; }
    if (!HOSTED) {
      if (e.key === 'h') setPins(!pinsVisible);   // standalone, the frame is the whole review
      return;
    }
    if (!FORWARDED.has(e.key) || e.defaultPrevented) return;   // a mock that handled the key keeps it
    if (e.key.startsWith('Arrow')) e.preventDefault();         // it navigates concepts; don't also scroll
    toGallery({ type: 'mk:key', key: e.key, shiftKey: e.shiftKey });
  });

  const pinByN = (n) => pins.find((p) => p.kind === 'comment' && String(p.n) === String(n));

  addEventListener('message', (e) => {
    if (e.data?.type === 'mk:set-mode') setMode(e.data.on, e.data.via);
    if (e.data?.type === 'mk:set-pins') setPins(e.data.visible);
    if (e.data?.type === 'mk:refresh') pull();
    // The gallery's list drives these: highlight a pin on row-hover; reveal (scroll to + flash) on row-click.
    if (e.data?.type === 'mk:highlight') pinByN(e.data.n)?.node.classList.add('mk-focus');
    if (e.data?.type === 'mk:unhighlight') pinByN(e.data.n)?.node.classList.remove('mk-focus');
    if (e.data?.type === 'mk:reveal') {
      const p = pinByN(e.data.n);
      if (p) {
        const behavior = reducedMotion.matches ? 'auto' : 'smooth';
        try { p.el.scrollIntoView({ behavior, block: 'center' }); } catch { p.el.scrollIntoView(); }
        p.node.classList.remove('mk-flash');
        void p.node.offsetWidth;               // restart the animation even on a repeat click
        p.node.classList.add('mk-flash');
      }
    }
  });

  // A delightful in-place composer (replaces the native prompt): a pulsing dot marks the exact spot,
  // the card says what you're commenting ON, Enter pins it, Esc cancels — all without leaving the mock.
  // A modal dialog: announced, focus-trapped, and on close focus returns to wherever it came from
  // (the crosshair, when it was placed by keyboard).
  let dialogOpen = false;
  const openDialog = (labelText, x, y) => new Promise((resolve) => {
    dialogOpen = true;
    const returnFocus = document.activeElement;
    // Tell the gallery a composer is open with (soon) unsaved text, so it DEFERS any hot-reload of this
    // frame until the comment is pinned or cancelled — a reload here would destroy what the user is typing.
    toGallery({ type: 'mk:composer', open: true });
    const backdrop = document.createElement('div'); backdrop.className = 'mk-dlg-backdrop';
    const dot = document.createElement('div'); dot.className = 'mk-dlg-dot';
    dot.style.left = `${x}px`; dot.style.top = `${y}px`;
    const headId = nextId('dlg-head');
    const onId = nextId('dlg-on');
    const dlg = document.createElement('div'); dlg.className = 'mk-dlg';
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-modal', 'true');
    dlg.setAttribute('aria-labelledby', headId);
    dlg.setAttribute('aria-describedby', onId);
    dlg.innerHTML = `<div class="mk-dlg-head" id="${headId}"><span class="mk-dlg-dotmark" aria-hidden="true"></span> Add a comment</div>`
      + `<div class="mk-dlg-on" id="${onId}"></div>`
      + '<textarea class="mk-dlg-input" rows="3" placeholder="What about this?" aria-label="Comment"></textarea>'
      + '<div class="mk-dlg-foot"><span class="mk-dlg-hint"><kbd>Enter</kbd> to pin · <kbd>Esc</kbd> to cancel</span>'
      + '<span class="mk-dlg-btns"><button type="button" class="mk-dlg-cancel">Cancel</button>'
      + '<button type="button" class="mk-dlg-pin">Pin comment</button></span></div>';
    dlg.querySelector('.mk-dlg-on').textContent = `on ${labelText}`;   // textContent → no HTML injection
    document.body.append(backdrop, dot, dlg);

    const place = () => {
      const w = dlg.offsetWidth, h = dlg.offsetHeight, m = 12;
      let left = x + 16, top = y + 16;
      if (left + w + m > innerWidth) left = x - w - 16;
      left = Math.max(m, Math.min(left, innerWidth - w - m));
      if (top + h + m > innerHeight) top = Math.max(m, innerHeight - h - m);
      dlg.style.left = `${left}px`; dlg.style.top = `${top}px`;
    };
    const ta = dlg.querySelector('.mk-dlg-input');
    let done = false;
    const close = (val) => {
      if (done) return;
      done = true;
      dialogOpen = false;
      dlg.remove(); backdrop.remove(); dot.remove();
      if (returnFocus?.isConnected && returnFocus !== document.body) returnFocus.focus({ preventScroll: true });
      resolve(val);
    };
    requestAnimationFrame(() => { place(); dlg.classList.add('mk-dlg-in'); ta.focus(); });
    dlg.querySelector('.mk-dlg-cancel').addEventListener('click', () => close(null));
    dlg.querySelector('.mk-dlg-pin').addEventListener('click', () => close(ta.value.trim() || null));
    backdrop.addEventListener('click', () => close(null));
    dlg.addEventListener('click', (ev) => ev.stopPropagation());
    ta.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); close(ta.value.trim() || null); }
    });
    // Esc closes from anywhere in the dialog (and ONLY the dialog — not comment mode behind it);
    // Tab is trapped so focus can't wander into the mock behind it.
    dlg.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close(null); return; }
      if (ev.key !== 'Tab') return;
      const f = [...dlg.querySelectorAll('textarea, button')];
      const first = f[0], last = f[f.length - 1];
      if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
      else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
    });
  });

  // Comment at a viewport point — the ONE path for a click and for the crosshair's Enter.
  const commentAt = async (x, y) => {
    const el = targetAt(x, y);
    const r = el.getBoundingClientRect();
    const at = {
      x: +((x - r.left) / (r.width || 1)).toFixed(3),
      y: +((y - r.top) / (r.height || 1)).toFixed(3),
    };
    const text = await openDialog(label(el), x, y);
    // Release the gallery's hot-reload deferral (the composer is done). On cancel, release now; on save,
    // release only AFTER the POST settles — a frame reload before the comment is persisted would abort it.
    const release = () => toGallery({ type: 'mk:composer', open: false });
    if (!text) { release(); return; }
    const body = {
      text,
      variant: VARIANT,
      element: label(el),
      anchor: selectorFor(el),
      note: el.dataset.note || null,                  // the intent claim they reacted to, if any
      at,                                             // ← the exact spot; the pin lands here
      viewport: innerWidth,
      dom: domContext(el, r),                         // ← full context for Claude (tag, text, rect, styles, path)
    };
    fetch('/comments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then((res) => res.json())
      .then((all) => { comments = all; renderComments(); toGallery({ type: 'mk:changed' }); })
      .catch(() => alert('Could not save the comment — is the folder served with serve.sh?'))
      .finally(release);
  };

  document.addEventListener('click', (e) => {
    if (!on || dialogOpen) return;
    if (e.target.closest(`.mk-pop, ${CHROME}`)) return;   // pins, popovers & the composer aren't comment targets
    e.preventDefault();
    e.stopPropagation();
    // A keyboard-activated click (Enter/Space on a focused control) has no pointer position: use the
    // centre of what was activated.
    if (e.detail === 0) {
      const r = e.target.getBoundingClientRect();
      commentAt(r.left + r.width / 2, r.top + r.height / 2);
    } else {
      commentAt(e.clientX, e.clientY);
    }
  }, true);

  // ---- the contract Claude reads (also readable straight off disk: comments.json) ----
  window.mockComments = () => comments.filter((c) => c.variant === VARIANT);
  window.mockCommentMode = setMode;
  window.mockRefresh = pull;

  pull();
})();
