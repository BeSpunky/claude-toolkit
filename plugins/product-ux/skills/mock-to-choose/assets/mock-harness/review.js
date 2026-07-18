/**
 * review.js — the per-variant review layer of the mock harness.
 *
 *   1. INTENT PINS  — any element with data-note="…" gets a numbered pin whose popover
 *      narrates what the low-fidelity thing stands for. Authored by Claude, at build time.
 *   2. COMMENTS     — the user presses `c` (or the gallery's Comment button) and clicks
 *      anything to pin a comment to it. POSTed to the server → comments.json ON DISK.
 *
 * Claude reads the comments back by reading comments.json (or GET /comments) — NOT from a
 * live browser, so an asynchronous review works exactly as well as a co-driven one.
 *
 * Never edit this file per-project. It is harness, not mock.
 */
(() => {
  const VARIANT = location.pathname.split('/').pop().replace(/\.html$/, '');

  // ---- a stable, full-path selector for the clicked element (id > data-note > nth-child path) ----
  const selectorFor = (el) => {
    if (el.id && document.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1) {
      return `#${CSS.escape(el.id)}`;
    }
    if (el.dataset.note) {
      const sel = `[data-note="${CSS.escape(el.dataset.note)}"]`;
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

  const pins = [];   // { el, node, kind, text }

  const addPin = (el, text, kind, marker) => {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = 'mk-pin';
    node.dataset.kind = kind;
    node.textContent = marker;
    node.setAttribute('aria-label', `${kind === 'comment' ? 'Comment' : 'Design intent'}: ${text}`);
    const pop = document.createElement('span');
    pop.className = 'mk-pop';
    pop.textContent = text;
    node.append(pop);
    layer.append(node);
    pins.push({ el, node, kind, text });
    place();
  };

  // Position every pin over the top-left of its target. Recomputed on load, scroll, resize —
  // and readable from the gallery, which drives the same layout.
  const place = () => {
    for (const { el, node } of pins) {
      const r = el.getBoundingClientRect();
      node.style.left = `${r.left + scrollX}px`;
      node.style.top = `${r.top + scrollY}px`;
      node.style.display = r.width || r.height ? '' : 'none';   // hide pins on collapsed elements
    }
  };
  addEventListener('scroll', place, { passive: true });
  addEventListener('resize', place);
  new ResizeObserver(place).observe(document.body);

  // ---- 1. intent pins (authored by Claude, via data-note) ----
  document.querySelectorAll('[data-note]').forEach((el, i) => addPin(el, el.dataset.note, 'note', String(i + 1)));

  // ---- 2. comments (authored by the user, persisted to disk) ----
  let comments = [];

  const renderComments = () => {
    pins.filter((p) => p.kind === 'comment').forEach((p) => p.node.remove());
    pins.splice(0, pins.length, ...pins.filter((p) => p.kind !== 'comment'));
    comments
      .filter((c) => c.variant === VARIANT)
      .forEach((c, i) => {
        let el = null;
        try { el = document.querySelector(c.anchor); } catch { /* stale selector */ }
        addPin(el || document.body, c.text, 'comment', String(i + 1));
      });
    place();
  };

  const pull = () => fetch('/comments')
    .then((r) => r.json())
    .then((all) => { comments = Array.isArray(all) ? all : []; renderComments(); })
    .catch(() => { /* served statically without the endpoint — intent pins still work */ });

  let on = false;
  const setMode = (v) => {
    on = !!v;
    document.body.classList.toggle('mk-commenting', on);
    parent?.postMessage({ type: 'mk:mode', on }, '*');
  };

  addEventListener('keydown', (e) => {
    if (e.key === 'c' && !e.ctrlKey && !e.metaKey && !e.altKey
        && !/^(input|textarea|select)$/i.test(e.target.tagName)) setMode(!on);
  });

  addEventListener('message', (e) => {
    if (e.data?.type === 'mk:set-mode') setMode(e.data.on);
    if (e.data?.type === 'mk:refresh') pull();
  });

  document.addEventListener('click', (e) => {
    if (!on) return;
    if (e.target.closest('.mk-pin')) return;          // clicking a pin isn't commenting on it
    e.preventDefault();
    e.stopPropagation();
    const el = e.target.closest('[data-note], [id], section, header, main, article, li, figure, button, a, h1, h2, h3, p, img')
      || document.body;
    const text = prompt(`Comment on ${label(el)}:`);
    if (!text) return;
    const r = el.getBoundingClientRect();
    const body = {
      text,
      variant: VARIANT,
      element: label(el),
      anchor: selectorFor(el),
      note: el.dataset.note || null,                  // the intent claim they reacted to, if any
      at: { x: +((e.clientX - r.left) / (r.width || 1)).toFixed(3), y: +((e.clientY - r.top) / (r.height || 1)).toFixed(3) },
      viewport: innerWidth,
    };
    fetch('/comments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then((r) => r.json())
      .then((all) => { comments = all; renderComments(); parent?.postMessage({ type: 'mk:changed' }, '*'); })
      .catch(() => alert('Could not save the comment — is the folder served with serve.sh?'));
  }, true);

  // ---- the contract Claude reads (also readable straight off disk: comments.json) ----
  window.mockComments = () => comments.filter((c) => c.variant === VARIANT);
  window.mockCommentMode = setMode;
  window.mockRefresh = pull;

  pull();
})();
