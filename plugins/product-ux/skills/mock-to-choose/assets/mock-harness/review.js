/**
 * review.js — the per-variant review layer of the mock harness.
 *
 *   1. INTENT PINS  — any element with data-note="…" gets a numbered pin whose popover
 *      narrates what the low-fidelity thing stands for. Authored by Claude, at build time.
 *   2. COMMENTS     — the user presses `c` (or the gallery's Comment button) and clicks
 *      anything to pin a comment RIGHT WHERE THEY CLICKED. POSTed to the server → comments.json.
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

  const pins = [];   // { el, node, pop, kind, text, at, n }

  // A popover opens on hover/focus and closes shortly after the pointer leaves BOTH the pin and
  // the popover — so the pointer can travel across the (possibly flipped) gap to click Remove.
  let hideTimer = null;
  const openPop = (pinNode, pop) => {
    clearTimeout(hideTimer);
    layer.querySelectorAll('.mk-pop.mk-open').forEach((o) => { if (o !== pop) o.classList.remove('mk-open'); });
    positionPop(pinNode, pop);
    pop.classList.add('mk-open');
  };
  const closePopSoon = (pop) => {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => pop.classList.remove('mk-open'), 140);
  };

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

  const addPin = (el, text, kind, marker, extra = {}) => {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = 'mk-pin';
    node.dataset.kind = kind;
    node.textContent = marker;
    node.setAttribute('aria-label', `${kind === 'comment' ? 'Comment' : 'Design intent'}: ${text}`);
    if (kind === 'comment') {
      node.dataset.n = extra.n;                // so the gallery's list can highlight/reveal this exact pin
      if (extra.handled) {
        node.classList.add('mk-handled');     // green ✓ — Claude addressed it
        node.textContent = '✓';
      } else if (extra.status === 'draft') {
        node.classList.add('mk-draft');       // hollow — pinned but not yet sent
      }                                        // else 'submitted' — solid orange, waiting on Claude
      // Tell the gallery when this pin is hovered, so it can highlight the matching list row.
      node.addEventListener('mouseenter', () => parent?.postMessage({ type: 'mk:pin-enter', n: extra.n }, '*'));
      node.addEventListener('mouseleave', () => parent?.postMessage({ type: 'mk:pin-leave', n: extra.n }, '*'));
    }

    const pop = document.createElement('span');
    pop.className = 'mk-pop';
    const body = document.createElement('span');
    body.className = 'mk-pop-text';
    body.textContent = text;
    pop.append(body);
    if (kind === 'comment' && extra.reply) {
      const reply = document.createElement('span');
      reply.className = 'mk-reply';
      reply.textContent = `✓ handled — ${extra.reply}`;
      pop.append(reply);
    }

    // A comment carries a delete affordance, so a stray pin is one click to remove.
    if (kind === 'comment' && extra.n != null) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'mk-del';
      del.textContent = 'Remove';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        fetch(`/comments?n=${extra.n}`, { method: 'DELETE' })
          .then((r) => r.json())
          .then((all) => { comments = all; renderComments(); parent?.postMessage({ type: 'mk:changed' }, '*'); })
          .catch(() => {});
      });
      pop.append(del);
    }

    node.append(pop);
    node.addEventListener('mouseenter', () => openPop(node, pop));
    node.addEventListener('focus', () => openPop(node, pop));
    node.addEventListener('click', (e) => { e.stopPropagation(); openPop(node, pop); });
    node.addEventListener('mouseleave', () => closePopSoon(pop));
    node.addEventListener('blur', () => closePopSoon(pop));
    pop.addEventListener('mouseenter', () => clearTimeout(hideTimer));
    pop.addEventListener('mouseleave', () => closePopSoon(pop));
    layer.append(node);
    pins.push({ el, node, pop, kind, text, at: extra.at || null, n: extra.n });
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
    pins.filter((p) => p.kind === 'comment').forEach((p) => p.node.remove());
    pins.splice(0, pins.length, ...pins.filter((p) => p.kind !== 'comment'));
    mine
      .forEach((c, i) => {
        let el = null;
        try { el = document.querySelector(c.anchor); } catch { /* stale selector */ }
        // If the anchor no longer resolves (a re-mock moved things), DON'T apply its fractional
        // point to <body> — that would fling the pin across the page. Anchor to body, no `at`.
        addPin(el || document.body, c.text, 'comment', String(c.n),
          { at: el ? c.at : null, n: c.n, handled: c.handled, reply: c.reply, status: c.status });
      });
    place();
  };

  const pull = () => fetch('/comments')
    .then((r) => r.json())
    .then((all) => { comments = Array.isArray(all) ? all : []; renderComments(); })
    .catch(() => { /* served statically without the endpoint — intent pins still work */ });

  let on = false;
  const setMode = (v) => {
    on = READONLY ? false : !!v;             // a history snapshot is a record; you can't comment on the past
    document.body.classList.toggle('mk-commenting', on);
    parent?.postMessage({ type: 'mk:mode', on }, '*');
  };

  addEventListener('keydown', (e) => {
    if (e.key === 'c' && !e.ctrlKey && !e.metaKey && !e.altKey
        && !/^(input|textarea|select)$/i.test(e.target.tagName)) setMode(!on);
  });

  const pinByN = (n) => pins.find((p) => p.kind === 'comment' && String(p.n) === String(n));

  addEventListener('message', (e) => {
    if (e.data?.type === 'mk:set-mode') setMode(e.data.on);
    if (e.data?.type === 'mk:refresh') pull();
    // The gallery's list drives these: highlight a pin on row-hover; reveal (scroll to + flash) on row-click.
    if (e.data?.type === 'mk:highlight') pinByN(e.data.n)?.node.classList.add('mk-focus');
    if (e.data?.type === 'mk:unhighlight') pinByN(e.data.n)?.node.classList.remove('mk-focus');
    if (e.data?.type === 'mk:reveal') {
      const p = pinByN(e.data.n);
      if (p) {
        try { p.el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch { p.el.scrollIntoView(); }
        p.node.classList.remove('mk-flash');
        void p.node.offsetWidth;               // restart the animation even on a repeat click
        p.node.classList.add('mk-flash');
      }
    }
  });

  // A delightful in-place composer (replaces the native prompt): a pulsing dot marks the exact spot,
  // the card says what you're commenting ON, Enter pins it, Esc cancels — all without leaving the mock.
  let dialogOpen = false;
  const openDialog = (labelText, x, y) => new Promise((resolve) => {
    dialogOpen = true;
    // Tell the gallery a composer is open with (soon) unsaved text, so it DEFERS any hot-reload of this
    // frame until the comment is pinned or cancelled — a reload here would destroy what the user is typing.
    parent?.postMessage({ type: 'mk:composer', open: true }, '*');
    const backdrop = document.createElement('div'); backdrop.className = 'mk-dlg-backdrop';
    const dot = document.createElement('div'); dot.className = 'mk-dlg-dot';
    dot.style.left = `${x}px`; dot.style.top = `${y}px`;
    const dlg = document.createElement('div'); dlg.className = 'mk-dlg';
    dlg.innerHTML = '<div class="mk-dlg-head"><span class="mk-dlg-dotmark"></span> Add a comment</div>'
      + '<div class="mk-dlg-on"></div>'
      + '<textarea class="mk-dlg-input" rows="3" placeholder="What about this?"></textarea>'
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
    const close = (val) => { if (done) return; done = true; dialogOpen = false; dlg.remove(); backdrop.remove(); dot.remove(); resolve(val); };
    requestAnimationFrame(() => { place(); dlg.classList.add('mk-dlg-in'); ta.focus(); });
    dlg.querySelector('.mk-dlg-cancel').addEventListener('click', () => close(null));
    dlg.querySelector('.mk-dlg-pin').addEventListener('click', () => close(ta.value.trim() || null));
    backdrop.addEventListener('click', () => close(null));
    dlg.addEventListener('click', (ev) => ev.stopPropagation());
    ta.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); close(ta.value.trim() || null); }
    });
    // Esc closes from anywhere in the dialog; Tab is trapped so focus can't wander into the mock behind it.
    dlg.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') { ev.preventDefault(); close(null); return; }
      if (ev.key !== 'Tab') return;
      const f = [...dlg.querySelectorAll('textarea, button')];
      const first = f[0], last = f[f.length - 1];
      if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
      else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
    });
  });

  document.addEventListener('click', async (e) => {
    if (!on || dialogOpen) return;
    if (e.target.closest('.mk-pin, .mk-dlg, .mk-dlg-backdrop')) return;   // pins & the composer aren't comment targets
    e.preventDefault();
    e.stopPropagation();
    const el = e.target.closest('[data-note], [id], section, header, main, article, li, figure, button, a, h1, h2, h3, p, img')
      || document.body;
    const r = el.getBoundingClientRect();
    const at = {
      x: +((e.clientX - r.left) / (r.width || 1)).toFixed(3),
      y: +((e.clientY - r.top) / (r.height || 1)).toFixed(3),
    };
    const text = await openDialog(label(el), e.clientX, e.clientY);
    // Release the gallery's hot-reload deferral (the composer is done). On cancel, release now; on save,
    // release only AFTER the POST settles — a frame reload before the comment is persisted would abort it.
    const release = () => parent?.postMessage({ type: 'mk:composer', open: false }, '*');
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
      .then((r) => r.json())
      .then((all) => { comments = all; renderComments(); parent?.postMessage({ type: 'mk:changed' }, '*'); })
      .catch(() => alert('Could not save the comment — is the folder served with serve.sh?'))
      .finally(release);
  }, true);

  // ---- the contract Claude reads (also readable straight off disk: comments.json) ----
  window.mockComments = () => comments.filter((c) => c.variant === VARIANT);
  window.mockCommentMode = setMode;
  window.mockRefresh = pull;

  pull();
})();
