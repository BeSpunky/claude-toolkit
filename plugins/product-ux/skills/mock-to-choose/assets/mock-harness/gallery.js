/**
 * gallery.js — the harness shell. Renders whatever mocks.json declares, and gives a mock review
 * the instruments it needs:
 *
 *   · COMPARE — every concept side by side at a readable scale, so the eye can pick.
 *   · FOCUS   — one concept, as large as the screen allows: FIT (the whole mock, width AND height, never
 *     upscaled — the default), WIDTH (fit the width, scroll the height) or 1:1 (actual pixels, scroll both).
 *     The live scale is always shown ("64%") — a mock is never silently presented as "true size" when it
 *     isn't. A comment lands on the exact clicked point at any scale (the frame works in its own pixels).
 *   · ROUNDS  — a mock is iterated v1 → v2 → … . Comments are version-bound; the live mock shows only
 *     the CURRENT round's OPEN pins (handled + past-round pins never clutter it). Every committed round
 *     is snapshotted, so the whole EVOLUTION over time is viewable. This is the review's own record.
 *
 * The chrome gives the mock the screen: one slim top row, one slim bottom bar, a concept rail that
 * collapses, a comment DRAWER that overlays (collapsed by default), and PRESENTATION mode (`f`) that hides
 * every pixel of harness chrome. Keys: c f h ← → ? Esc (the `?` sheet is generated from KEYS below).
 *
 * Where the user IS lives in the URL (location.hash): #compare/Desktop · #focus/Lantern/Phone ·
 * #focus/Lantern/Phone/v2 (a past round, read-only) · #evolution/Lantern/Phone. Back, refresh and shared
 * links all work. How THIS viewer likes the room (fit mode, drawer, rail, auto-send) is a per-viewer
 * preference in localStorage — never shared, never required (the page works without storage).
 *
 * Claude never edits this. Reads / drives over CDP:
 *   window.allComments() · window.mockInbox() · window.mockVersions() · window.mockState()
 *   window.mockGoto(name) · window.mockViewport(label) · window.mockCompare() · window.mockEvolution() · window.mockCommentMode(bool)
 *   window.mockFit('screen'|'width'|'actual') · window.mockPresent(bool) · window.mockPins(bool)
 *   window.mockHandle(n,{reply}) · window.mockCommit(variant,note)  ← freeze a round before re-mocking
 */
(async () => {
  const $ = (s, r = document) => r.querySelector(s);
  const PROP = new Set(['className', 'textContent', 'id', 'type', 'value', 'tabIndex', 'src', 'title', 'loading', 'width', 'height', 'placeholder']);
  const el = (tag, props = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k.startsWith('on') && typeof v === 'function') n[k.toLowerCase()] = v;
      else if (PROP.has(k)) n[k] = v;
      else n.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null) n.append(kid.nodeType ? kid : document.createTextNode(kid));
    return n;
  };
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const esc = (s) => String(s ?? '');

  // Per-viewer preferences. Storage can be absent or throw (private window, blocked site data) — the
  // page must work exactly the same without it, so every access is guarded and falls back to a default.
  const pref = {
    get: (k, fallback) => { try { const v = localStorage.getItem(`mk-${k}`); return v == null ? fallback : v; } catch { return fallback; } },
    set: (k, v) => { try { localStorage.setItem(`mk-${k}`, String(v)); } catch { /* preference only */ } },
  };

  const manifest = await fetch('mocks.json').then((r) => r.json());
  const variants = manifest.variants || [];
  const viewports = manifest.viewports?.length
    ? manifest.viewports
    : [{ label: 'Phone', width: 390, height: 844 }, { label: 'Desktop', width: 1280, height: 800 }];

  $('#question').textContent = manifest.question ?? 'Which one — and what would you change?';
  $('#question').title = manifest.question ?? '';   // the row truncates to one line; full text on hover
  $('#question-full').textContent = $('#question').textContent;   // … and in full atop "What's faked"
  const honesty = manifest.honesty?.length ? manifest.honesty : ['Nothing faked.'];
  $('#honesty').replaceChildren(...honesty.map((h) => el('li', { textContent: h })));
  $('#faked-count').textContent = manifest.honesty?.length ? `(${manifest.honesty.length})` : '';   // surfaced up front

  // ---- state ----
  // URL state (where the user is): mode 'compare' | 'focus' | 'evolution'; focus = concept index; vp =
  // viewport index; hist: null = current round, a number = viewing that past round (read-only).
  const state = { mode: 'compare', focus: 0, vp: 0, hist: null };
  // Viewer state (how this person likes the room) — remembered per viewer, never in the URL.
  const FITS = [
    { id: 'screen', label: 'Fit', title: 'Fit the whole mock on screen — width and height' },
    { id: 'width', label: 'Width', title: 'Fit the width; scroll the height' },
    { id: 'actual', label: '1:1', title: 'Actual pixels; scroll both ways' },
  ];
  const ui = {
    fit: FITS.some((f) => f.id === pref.get('fit')) ? pref.get('fit') : 'screen',
    rail: pref.get('rail', '1') !== '0',
    drawer: pref.get('drawer', '0') === '1',
    pins: true,                          // session-only: hidden pins must never be a forgotten state
    presenting: false,                   // session-only
    scale: null,                         // the Focus mock's live scale (read by mockState + the readout)
  };
  let comments = [];
  let versions = {};
  let verdict = null;                    // THE DECISION: {kind:'chosen'|'none', choice, note, version, ts} or null
  let reloadV = 0;
  let commentOn = false;
  let evoSig = '';                       // last-rendered evolution data signature (skip needless re-renders)
  let handledSeen = null;                // n's already handled (to announce only NEWLY handled ones)
  let autosend = pref.get('autosend', '1') !== '0';   // DEFAULT ON: pin = sent. Uncheck to batch.
  let editingN = null;                   // an inline edit in progress — don't rebuild the list under it
  let composerOpen = false;              // the in-mock comment composer is open with unsaved text (a frame in it)
  let pendingChanged = null;             // Set of file paths whose hot-reload was DEFERRED while the composer is open
  let pendingFull = false;               // a full page reload deferred likewise (mocks.json / gallery.* changed)
  const userBusy = () => composerOpen || editingN != null;

  const variantKey = (v) => v.file.split('/').pop().replace(/\.html$/, '');
  const nameOfKey = (key) => variants.find((v) => variantKey(v) === key)?.name || key;
  const curVersion = (v) => Number(versions[variantKey(v)]?.current) || 1;
  const roundsOf = (v) => versions[variantKey(v)]?.rounds || [];
  const snapshotPath = (v, n) => roundsOf(v).find((r) => Number(r.v) === Number(n))?.snapshot;

  const vpByLabel = (l) => Math.max(0, viewports.findIndex((v) => slug(v.label) === slug(l)));
  const variantByName = (n) => {
    if (typeof n === 'number') return Math.max(0, Math.min(variants.length - 1, n));
    const i = variants.findIndex((v) => slug(v.name) === slug(n) || v.file === n);
    return i < 0 ? 0 : i;
  };

  const readHash = () => {
    const parts = decodeURIComponent(location.hash.replace(/^#/, '')).split('/');
    const [mode, a, b, c] = parts;
    state.hist = null;
    if (mode === 'focus' || mode === 'evolution') {
      state.mode = mode;
      state.focus = variantByName(a || '');
      if (b) state.vp = vpByLabel(b);
      const vm = /^v(\d+)$/.exec(c || '');
      if (mode === 'focus' && vm) state.hist = Number(vm[1]);   // #focus/x/vp/v2 = view that past round
    } else { state.mode = 'compare'; if (a) state.vp = vpByLabel(a); }
  };
  let lastWritten = null;
  const writeHash = () => {
    const vp = slug(viewports[state.vp]?.label || '');
    const nm = slug(variants[state.focus]?.name || '');
    let h = `#compare/${vp}`;
    if (state.mode === 'focus') h = `#focus/${nm}/${vp}${state.hist != null ? `/v${state.hist}` : ''}`;
    if (state.mode === 'evolution') h = `#evolution/${nm}/${vp}`;
    if (location.hash !== h) { lastWritten = h; location.hash = h; }
  };

  // ---- announcements (one polite live region for state changes a sighted user SEES happen) ----
  const srStatus = $('#sr-status');
  const announce = (msg) => { srStatus.textContent = ''; requestAnimationFrame(() => { srStatus.textContent = msg; }); };

  // ---- frame builder + fit ----
  // kind: 'focus' (the one reviewed mock) · 'rail' (a concept-rail thumbnail) · 'preview' (compare card,
  // evolution step). Only the focus frame is interactive; the others are inert pictures.
  const frames = [];
  const frameFor = (variant, vpi, container, opts = {}) => {
    const vp = viewports[vpi];
    const kind = opts.kind || 'preview';
    const box = el('div', { className: `frame-box ${slug(vp.label)}` });
    const version = opts.version != null ? opts.version : curVersion(variant);
    const file = opts.snapshot || variant.file;
    const q = `variant=${encodeURIComponent(variantKey(variant))}&v=${version}${opts.mode ? `&mode=${opts.mode}` : ''}`;
    const f = el('iframe', { src: `${file}?${q}&r=${reloadV}`, title: `${variant.name} — ${vp.label}`, loading: 'lazy' });
    f.dataset.file = file;                 // the file actually loaded (live mock or a snapshot)
    f.dataset.q = q;                       // preserved across hot-reload re-points
    f.width = vp.width; f.height = vp.height;
    // keyboard/SR users shouldn't tab INTO a mock document that isn't the one being reviewed
    if (kind !== 'focus') { f.inert = true; f.tabIndex = -1; f.setAttribute('aria-hidden', 'true'); }
    // every frame learns the viewer's pin visibility as it loads (a reload or a new round included)
    f.addEventListener('load', () => post(f, { type: 'mk:set-pins', visible: ui.pins }));
    box.append(f);
    container.append(box);
    frames.push({ iframe: f, w: vp.width, h: vp.height, box, kind });
    return box;
  };
  const post = (iframe, m) => { try { iframe.contentWindow?.postMessage(m, '*'); } catch { /* frame gone */ } };

  // The scale each kind of frame gets. Focus answers the viewer's fit choice against the VIEWER's box
  // (what is actually left for the mock); the thumbnails keep a readable size that still fits the stage.
  const COMPARE_MAX_H = 0.7;    // a compare card's mock may use this share of the stage height
  const EVOLUTION_MAX_H = 0.6;  // an evolution step's, leaving room for its notes below
  const scaleFor = ({ w, h, box, kind }) => {
    const host = box.parentElement;
    if (kind === 'rail') return host.clientWidth / w;   // fill the fixed thumb width; the thumb crops the height
    if (kind === 'focus') {
      const cs = getComputedStyle(host);
      const aw = host.clientWidth - parseFloat(cs.paddingInlineStart) - parseFloat(cs.paddingInlineEnd);
      const ah = host.clientHeight - parseFloat(cs.paddingBlockStart) - parseFloat(cs.paddingBlockEnd);
      if (ui.fit === 'actual') return 1;
      if (ui.fit === 'width') return Math.min(1, aw / w);
      return Math.min(1, aw / w, ah / h);              // 'screen' — never upscaled past the mock's own pixels
    }
    const maxH = (state.mode === 'evolution' ? EVOLUTION_MAX_H : COMPARE_MAX_H) * stage.clientHeight;
    return Math.min(1, host.clientWidth / w, maxH / h);
  };
  const fit = () => {
    for (const f of frames) {
      if (!f.box.parentElement) continue;
      const scale = Math.max(0.05, scaleFor(f));
      f.iframe.style.transform = `scale(${scale})`;
      f.box.style.width = `${f.w * scale}px`;
      f.box.style.height = `${f.h * scale}px`;
      if (f.kind === 'focus') paintScale(scale, f);
    }
  };
  const scaleOut = $('#scale');
  const paintScale = (scale, f) => {
    ui.scale = Math.round(scale * 1000) / 1000;
    scaleOut.textContent = `${Math.round(scale * 100)}%`;
    scaleOut.title = `Shown at ${Math.round(scale * 100)}% of its ${f.w}×${f.h} design size`;
  };
  // Fit follows the boxes it fits into — the window, the rail opening, presentation mode — not just `resize`.
  const sizeWatch = new ResizeObserver(() => fit());

  // ---- status helpers ----
  const statusOf = (c) => (c.handled ? 'handled' : c.status === 'draft' ? 'draft' : 'sent');
  const STATUS_PILL = { draft: 'draft', sent: 'sent', handled: '✓ handled' };
  const inRound = (c, v, roundVersion) => c.variant === variantKey(v) && Number(c.version ?? roundVersion) === roundVersion;

  // ---- render ----
  const nav = $('#nav');
  const stage = $('#stage');
  const toggle = $('#comment-toggle');
  const inLiveFocus = () => state.mode === 'focus' && state.hist == null;

  const render = () => {
    frames.length = 0;
    sizeWatch.disconnect();
    stage.replaceChildren();
    nav.replaceChildren();
    editingN = null;                     // any full re-render (incl. the Back button) discards an in-progress edit
    // A render rebuilds the focus iframe, so any composer inside it is gone — clear the flag (its close
    // message can't fire from a destroyed frame) so reloads never get stuck deferred.
    composerOpen = false;
    pendingChanged = null;
    // Keep comment mode across a re-render WITHIN the current-round Focus; clear it elsewhere.
    if (!inLiveFocus()) commentOn = false;
    ui.scale = null;

    if (!variants.length) {
      stage.append(el('p', { className: 'empty' }, 'No variants declared in mocks.json.'));
      renderTools(); setCommentButton(); return;
    }

    if (state.mode === 'compare') renderCompare();
    else if (state.mode === 'evolution') renderEvolution();
    else renderFocus();

    renderTools();
    setCommentButton();
    paintBadges();
    paintDecision();                     // chosen ribbon/tag/button state for the freshly-built DOM
    sizeWatch.observe(stage);
    const viewer = $('.viewer');
    if (viewer) sizeWatch.observe(viewer);
    requestAnimationFrame(fit);
    flushReload();                       // a full reload deferred while the user was mid-input, now that they've moved on
  };

  // The top row's tools for the current mode: viewport + fit + scale + the Focus-only toggles.
  const renderTools = () => {
    $('#viewport-seg').replaceChildren(...viewports.map((vp, i) =>
      el('button', {
        type: 'button', textContent: vp.label, title: `${vp.label} · ${vp.width}×${vp.height}`,
        'aria-pressed': String(i === state.vp),
        onclick: () => { state.vp = i; apply(); },
      })));
    const focus = state.mode === 'focus';
    $('#fit-seg').hidden = !focus;
    $('#fit-seg').replaceChildren(...FITS.map((f) => el('button', {
      type: 'button', textContent: f.label, title: f.title, 'aria-pressed': String(ui.fit === f.id),
      onclick: () => setFit(f.id),
    })));
    scaleOut.hidden = !focus;
    $('#rail-toggle').hidden = !(focus && variants.length > 1);
    $('#drawer-toggle').hidden = !focus;
    paintToggles();
  };
  const paintToggles = () => {
    $('#rail-toggle').setAttribute('aria-expanded', String(ui.rail));
    $('#drawer-toggle').setAttribute('aria-expanded', String(ui.drawer));
    $('#pins-toggle').hidden = false;
    $('#pins-toggle').setAttribute('aria-pressed', String(ui.pins));
    $('#pins-toggle').textContent = ui.pins ? 'Pins' : 'Pins hidden';
  };

  const renderCompare = () => {
    const wall = el('div', { className: 'wall' });
    variants.forEach((v, i) => {
      const card = el('div', { className: 'card', role: 'button', tabIndex: 0, 'aria-label': `Open ${v.name}` },
        el('span', { className: 'open-hint', 'aria-hidden': 'true' }, 'Open ▸'),
        el('h2', {}, v.name),
        el('p', { className: 'pitch' }, v.pitch || ''));
      card.dataset.key = variantKey(v);
      const holder = el('div');
      card.append(holder);
      frameFor(v, state.vp, holder);
      // Actions row: the comment tally (badge) and a direct "Choose" — a verdict can be cast from the wall.
      card.append(el('div', { className: 'card-actions' },
        el('div', { className: 'badge' }),
        el('button', { className: 'chip card-choose', type: 'button', title: `Choose ${v.name} as the direction`,
          onclick: (e) => { e.stopPropagation(); chooseVariant(v); } }, 'Choose ✓')));
      const go = () => { state.mode = 'focus'; state.focus = i; state.hist = null; apply(); };
      card.addEventListener('click', go);
      card.addEventListener('keydown', (e) => { if (e.target === card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); go(); } });
      wall.append(card);
    });
    stage.append(wall);
    toggle.disabled = true;
    toggle.title = 'Open a concept to comment on the exact spot';
  };

  const goConcept = (i) => { state.mode = 'focus'; state.focus = (i + variants.length) % variants.length; state.hist = null; apply(); };

  const renderFocus = () => {
    const v = variants[state.focus];
    // A stale/typo'd version deep-link (#…/v99) has no snapshot → fall back to the current round.
    if (state.hist != null && !snapshotPath(v, state.hist)) state.hist = null;
    const viewingHistory = state.hist != null;
    const ver = viewingHistory ? state.hist : curVersion(v);

    const many = variants.length > 1;
    nav.append(
      el('button', { type: 'button', className: 'chip', title: 'Back to every concept side by side', onclick: () => { state.mode = 'compare'; state.hist = null; apply(); } }, '← All'),
      many ? el('button', { type: 'button', className: 'icon', 'aria-label': 'Previous concept', title: 'Previous concept (←)', onclick: () => goConcept(state.focus - 1) }, '‹') : null,
      el('span', { className: 'whoami', title: v.pitch || v.name }, v.name),
      el('button', { type: 'button', className: `chip vchip ${viewingHistory ? 'hist' : ''}`, title: viewingHistory ? 'Back to the current round' : 'Current round',
        onclick: () => { if (viewingHistory) { state.hist = null; apply(); } } }, `v${ver}${viewingHistory ? ' · history' : ''}`),
      many ? el('button', { type: 'button', className: 'icon', 'aria-label': 'Next concept', title: 'Next concept (→)', onclick: () => goConcept(state.focus + 1) }, '›') : null);

    const focusEl = el('div', { className: `focus${many && ui.rail ? ' rail-open' : ''}` });

    // The viewer — the mock's whole box. Built FIRST so frames[0] is the focus frame.
    const viewer = el('div', { className: 'viewer' });
    frameFor(v, state.vp, viewer, viewingHistory
      ? { kind: 'focus', version: state.hist, mode: 'history', snapshot: snapshotPath(v, state.hist) }
      : { kind: 'focus', version: ver });
    if (!viewingHistory) {
      const mainFrame = frames[0].iframe;   // capture — don't read frames[0] later (it may be replaced)
      mainFrame.addEventListener('load', () => post(mainFrame, { type: 'mk:set-mode', on: commentOn, via: 'pointer' }));
    }

    // Concept rail — live thumbnails of every concept; collapsible (the top row's "Concepts").
    if (many) {
      const rail = el('div', { className: 'concept-rail', id: 'rail', role: 'tablist', 'aria-label': 'Concepts', 'aria-orientation': 'vertical' });
      variants.forEach((cv, i) => {
        const thumb = el('div', { className: 'rail-thumb' });
        frameFor(cv, state.vp, thumb, { kind: 'rail' });
        const current = i === state.focus;
        const item = el('div', { className: `rail-item ${current ? 'current' : ''}`, role: 'tab',
          tabIndex: current ? 0 : -1, title: cv.name, 'aria-selected': String(current), onclick: () => { if (!current) goConcept(i); } },
          thumb, el('span', { className: 'rail-name' }, cv.name));
        item.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!current) goConcept(i); }
          // a vertical tablist: ↑/↓ moves between concepts (← / → do too, globally)
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); goConcept(i + (e.key === 'ArrowDown' ? 1 : -1)); requestAnimationFrame(() => $('.rail-item.current')?.focus()); }
        });
        rail.append(item);
      });
      focusEl.append(rail);
    }
    focusEl.append(viewer);

    // The comment drawer — overlays the viewer's right edge, so opening it never shrinks the mock.
    const drawer = el('aside', { className: `drawer${ui.drawer ? ' open' : ''}`, id: 'drawer', 'aria-label': 'Comments and history' });
    drawer.append(el('div', { className: 'drawer-head' },
      el('div', {}, el('h2', {}, v.name), v.pitch ? el('p', { className: 'pitch' }, v.pitch) : null),
      el('button', { type: 'button', className: 'icon', 'aria-label': 'Close comments', title: 'Close (Esc)', onclick: () => setDrawer(false, { returnFocus: true }) }, '×')),
    el('div', { id: 'drawer-body' }));
    focusEl.append(drawer);
    stage.append(focusEl);
    renderSide($('#drawer-body', drawer), v, ver, viewingHistory);

    toggle.disabled = viewingHistory;
    toggle.title = viewingHistory ? 'Viewing a past round — read-only' : 'Press c, then click the exact spot — or move the crosshair with the arrows and press Enter';
  };

  // The EVOLUTION timeline — the whole life of one concept in order: v1 → v2 → … → current.
  const renderEvolution = () => {
    const v = variants[state.focus];
    const cur = curVersion(v);
    nav.append(
      el('button', { type: 'button', className: 'chip', onclick: () => { state.mode = 'focus'; state.hist = null; apply(); } }, '← Back to Focus'),
      el('span', { className: 'whoami' }, `${v.name} — evolution, v1 to now`));

    const steps = roundsOf(v).map((r) => ({ version: r.v, snapshot: r.snapshot, note: r.note, current: false }));
    steps.push({ version: cur, snapshot: null, note: null, current: true });   // the live, un-snapshotted current round

    if (steps.length < 2) {
      stage.append(el('p', { className: 'empty' },
        'Just the first round so far — the timeline fills in as you re-mock (each committed round is snapshotted here).'));
      toggle.disabled = true; return;
    }

    const strip = el('div', { className: 'evolution' });
    steps.forEach((s, i) => {
      if (i > 0) strip.append(el('div', { className: 'evo-arrow', 'aria-hidden': 'true', title: 'the feedback on the left drove the version on the right' }, '→'));
      const stepComments = comments
        .filter((c) => c.variant === variantKey(v) && Number(c.version) === Number(s.version))
        .sort((a, b) => (a.n || 0) - (b.n || 0));
      const fig = el('figure', { className: `evo-step ${s.current ? 'current' : ''}` });
      fig.append(el('figcaption', {}, el('b', {}, `v${s.version}`), s.current ? ' · current' : ''));
      const holder = el('div', { className: 'evo-frame', role: 'button', tabIndex: 0, title: `Open v${s.version} in Focus`, 'aria-label': `Open v${s.version} in Focus` });
      frameFor(v, state.vp, holder, s.current ? { version: cur } : { version: s.version, mode: 'history', snapshot: s.snapshot });
      const open = () => { state.mode = 'focus'; state.hist = s.current ? null : s.version; apply(); };
      holder.addEventListener('click', open);
      holder.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
      fig.append(holder);
      if (s.note) fig.append(el('div', { className: 'evo-note' }, s.note));
      fig.append(stepComments.length
        ? el('ul', { className: 'evo-comments' },
          stepComments.map((c) => el('li', { className: c.handled ? 'done' : '' },
            el('span', { className: `pill pill-${statusOf(c)}` }, STATUS_PILL[statusOf(c)]), ' ', c.text)))
        : el('p', { className: 'evo-empty' }, s.current ? 'no feedback yet' : 'no comments this round'));
      strip.append(fig);
    });
    stage.append(strip);
    toggle.disabled = true;
  };

  // ---- the drawer body: current round comments + management + history ----
  const renderSide = (side, v, ver, viewingHistory) => {
    side.replaceChildren();
    if (viewingHistory) {
      side.append(el('div', { className: 'histbanner' },
        `Viewing v${ver} — read-only`,
        el('button', { type: 'button', className: 'linklike', onclick: () => { state.hist = null; apply(); } }, 'back to current')));
    } else {
      side.append(el('h3', {}, `This round · v${ver}`));
    }
    side.append(commentList(v, ver, viewingHistory));
    if (!viewingHistory) side.append(historySection(v));
    paintDrawerCount(v, ver);
  };
  const paintDrawerCount = (v, ver) => {
    const open = comments.filter((c) => inRound(c, v, ver) && !c.handled).length;
    $('#drawer-count').textContent = open ? String(open) : '';
    $('#drawer-toggle').setAttribute('aria-label', `Comments${open ? ` — ${open} open` : ''}`);
  };

  const commentList = (v, roundVersion, readonly) => {
    const mine = comments.filter((c) => inRound(c, v, roundVersion)).sort((a, b) => (a.n || 0) - (b.n || 0));
    if (!mine.length) {
      return el('p', { className: 'empty' }, readonly ? 'No comments in this round.'
        : 'None yet. Press c and click the exact spot — or use the arrow keys and Enter — to leave one.');
    }
    const ul = el('ul', { className: 'clist' });
    mine.forEach((c) => {
      const s = statusOf(c);
      const li = el('li', { className: `st-${s}` });
      li.dataset.n = c.n;
      // recognition, not recall: hovering or focusing a row lights its pin; activating it reveals the pin.
      const lit = () => msgFrame({ type: 'mk:highlight', n: c.n });
      const unlit = () => msgFrame({ type: 'mk:unhighlight', n: c.n });
      li.addEventListener('mouseenter', lit);
      li.addEventListener('mouseleave', unlit);
      li.addEventListener('focusin', lit);
      li.addEventListener('focusout', unlit);
      const reveal = el('button', { type: 'button', className: 'reveal', 'data-ctl': 'reveal', title: 'Show this comment on the mock',
        onclick: () => msgFrame({ type: 'mk:reveal', n: c.n }) },
        el('span', { className: 'num', 'aria-hidden': 'true' }, c.handled ? '✓' : String(c.n)),
        el('span', { className: 'txt' }, el('span', { className: 'sr-only' }, `Comment ${c.n}: `), c.text));
      li.append(el('span', { className: 'chead' }, reveal));
      li.append(el('div', { className: 'meta' },
        el('span', { className: `pill pill-${s}` }, STATUS_PILL[s]),
        ` ${c.element || ''} · ${c.viewport || ''}px${c.reply ? ` · ${c.reply}` : ''}`));
      if (!readonly) {
        const acts = el('div', { className: 'acts' });
        acts.append(el('button', { type: 'button', className: 'act', 'data-ctl': 'edit', 'aria-label': `Edit comment ${c.n}`, onclick: () => beginEdit(li, c) }, 'Edit'));
        if (s === 'draft') acts.append(el('button', { type: 'button', className: 'act send', 'data-ctl': 'send', 'aria-label': `Send comment ${c.n} to Claude`, onclick: () => sendOne(c.n) }, 'Send'));
        acts.append(el('button', { type: 'button', className: 'act rm', 'data-ctl': 'rm', 'aria-label': `Remove comment ${c.n}`, onclick: () => removeWithUndo(c) }, 'Remove'));
        li.append(acts);
      }
      ul.append(li);
    });
    return ul;
  };

  const beginEdit = (li, c) => {
    if (editingN != null) return;
    editingN = c.n;
    const head = $('.chead', li);
    const input = el('input', { className: 'editin', type: 'text', value: c.text, 'aria-label': `Edit comment ${c.n}` });
    let settled = false;                 // guard: the re-render below removes the focused input → a
    const commit = (save) => {           // spurious blur must not re-run commit (Escape would then save)
      if (settled) return;
      settled = true;
      editingN = null;
      // Persist (or refresh) FIRST, then flush any full reload deferred during the edit.
      const p = (save && input.value.trim() && input.value !== c.text) ? editComment(c.n, input.value.trim()) : pullAll();
      p.then(() => { $(`.clist li[data-n="${c.n}"] .reveal`)?.focus(); flushReload(); }).catch(() => {});
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(true); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); commit(false); }
    });
    input.addEventListener('blur', () => commit(true));
    head.replaceChildren(el('span', { className: 'num', 'aria-hidden': 'true' }, String(c.n)), input);
    input.focus(); input.select();
  };

  const historySection = (v) => {
    const rounds = roundsOf(v);
    const wrap = el('div', { className: 'history' });
    wrap.append(el('div', { className: 'history-head' },
      el('h4', {}, rounds.length ? 'History' : 'History — none yet'),
      rounds.length
        ? el('button', { type: 'button', className: 'linklike', title: 'See the whole evolution over time', onclick: () => { state.mode = 'evolution'; apply(); } }, 'See the evolution →')
        : null));
    rounds.slice().reverse().forEach((r) => {
      const count = comments.filter((c) => c.variant === variantKey(v) && Number(c.version) === Number(r.v)).length;
      wrap.append(el('div', { className: 'hround' },
        el('button', { type: 'button', className: 'linklike', title: 'Open this version (read-only)', onclick: () => { state.hist = r.v; apply(); } }, `v${r.v}`),
        el('span', { className: 'hmeta' }, ` · ${count} comment${count === 1 ? '' : 's'}${r.note ? ` · ${esc(r.note)}` : ''}`)));
    });
    return wrap;
  };

  const apply = () => { writeHash(); render(); };

  // ---- viewer state: fit · rail · drawer · pins · presentation ----
  const setFit = (id) => {
    ui.fit = id; pref.set('fit', id);
    renderTools(); fit();
    announce(`${FITS.find((f) => f.id === id).title} — ${scaleOut.textContent}`);
  };
  const setRail = (open) => {
    ui.rail = open; pref.set('rail', open ? '1' : '0');
    $('.focus')?.classList.toggle('rail-open', open && variants.length > 1);
    paintToggles();
  };
  const setDrawer = (open, { returnFocus = false, moveFocus = false } = {}) => {
    const drawer = $('#drawer');
    const hadFocus = drawer?.contains(document.activeElement);
    ui.drawer = open; pref.set('drawer', open ? '1' : '0');
    drawer?.classList.toggle('open', open);
    paintToggles();
    if (open && moveFocus) requestAnimationFrame(() => $('#drawer .drawer-head button')?.focus());
    if (!open && (returnFocus || hadFocus)) $('#drawer-toggle').focus();
  };
  const setPins = (visible) => {
    ui.pins = visible;
    frames.forEach(({ iframe }) => post(iframe, { type: 'mk:set-pins', visible }));
    paintToggles();
    announce(visible ? 'Pins shown' : 'Pins hidden — press h to show them');
  };
  const presentExit = $('#present-exit');
  const setPresenting = (on) => {
    const wasOnChrome = document.activeElement === $('#present-toggle');
    const wasOnExit = document.activeElement === presentExit;
    ui.presenting = on;
    document.body.classList.toggle('presenting', on);
    presentExit.hidden = !on;
    if (on && wasOnChrome) presentExit.focus();
    if (!on && wasOnExit) $('#present-toggle').focus();
    announce(on ? 'Presentation mode — press f or Escape to leave' : 'Presentation mode off');
  };
  $('#rail-toggle').addEventListener('click', () => setRail(!ui.rail));
  $('#drawer-toggle').addEventListener('click', (e) => setDrawer(!ui.drawer, { moveFocus: e.detail === 0 }));
  $('#pins-toggle').addEventListener('click', () => setPins(!ui.pins));
  $('#present-toggle').addEventListener('click', () => setPresenting(true));
  presentExit.addEventListener('click', () => setPresenting(false));

  // ---- anchored popovers: "What's faked" (top row) and the ⋯ menu (bottom bar) ----
  // One mechanism: open beside its trigger, clamp to the window, close on outside click / Esc / Tab-out,
  // and give focus back to the trigger.
  const popovers = [];
  const anchoredPopover = (trigger, panel, { side, onOpen }) => {
    const p = { trigger, panel, isOpen: () => !panel.hidden };
    p.place = () => {
      const r = trigger.getBoundingClientRect(), m = 8;
      const w = panel.offsetWidth, h = panel.offsetHeight;
      const left = Math.max(m, Math.min(r.right - w, innerWidth - w - m));
      const top = side === 'below' ? r.bottom + m : r.top - h - m;
      panel.style.left = `${left}px`;
      panel.style.top = `${Math.max(m, top)}px`;
    };
    p.open = () => {
      popovers.forEach((o) => o !== p && o.close());
      panel.hidden = false; trigger.setAttribute('aria-expanded', 'true'); p.place(); onOpen?.();
    };
    p.close = ({ returnFocus = false } = {}) => {
      if (panel.hidden) return;
      const hadFocus = panel.contains(document.activeElement);
      panel.hidden = true; trigger.setAttribute('aria-expanded', 'false');
      if (returnFocus || hadFocus) trigger.focus();
    };
    trigger.addEventListener('click', (e) => { e.stopPropagation(); if (p.isOpen()) p.close(); else p.open(); });
    panel.addEventListener('focusout', (e) => { if (!panel.contains(e.relatedTarget) && e.relatedTarget !== trigger) p.close(); });
    popovers.push(p);
    return p;
  };
  const info = anchoredPopover($('#info-toggle'), $('#info-panel'), { side: 'below' });
  const moreMenu = $('#more-menu');
  const menuItems = () => [...moreMenu.querySelectorAll('[role^="menuitem"]')];
  const more = anchoredPopover($('#more-toggle'), moreMenu, { side: 'above', onOpen: () => menuItems()[0].focus() });
  moreMenu.addEventListener('keydown', (e) => {
    const items = menuItems(), i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
    }
    if (e.key === 'Home') { e.preventDefault(); items[0].focus(); }
    if (e.key === 'End') { e.preventDefault(); items[items.length - 1].focus(); }
  });
  document.addEventListener('click', (e) => { popovers.forEach((p) => { if (!p.panel.contains(e.target)) p.close(); }); });
  addEventListener('resize', () => popovers.forEach((p) => p.isOpen() && p.place()));

  // ---- comment mode ----
  const setCommentButton = () => {
    toggle.setAttribute('aria-pressed', String(commentOn));
    toggle.textContent = commentOn ? 'Commenting — pick a spot (c)' : 'Comment (c)';
  };
  const focusFrame = () => (state.mode === 'focus' ? frames.find((f) => f.kind === 'focus')?.iframe : null);
  const msgFrame = (m) => { const f = focusFrame(); if (f) post(f, m); };
  // via 'keyboard': the frame takes focus and raises its crosshair (arrows move it, Enter comments).
  const setMode = (on, via = 'pointer') => {
    if (!inLiveFocus()) { commentOn = false; setCommentButton(); return; }
    commentOn = !!on;
    setCommentButton();
    if (commentOn && via === 'keyboard') focusFrame()?.focus();
    msgFrame({ type: 'mk:set-mode', on: commentOn, via });
  };
  toggle.addEventListener('click', (e) => setMode(!commentOn, e.detail === 0 ? 'keyboard' : 'pointer'));

  // ---- keys: ONE table drives the handler AND the `?` sheet ----
  const step = (d) => goConcept(state.focus + d);
  const KEYS = [
    { key: 'c', show: 'c', does: 'Comment mode (Focus) — click a spot, or arrows + Enter', when: inLiveFocus, run: () => setMode(!commentOn, 'keyboard') },
    { key: 'f', show: 'f', does: 'Presentation mode — hide all harness chrome', run: () => setPresenting(!ui.presenting) },
    { key: 'h', show: 'h', does: 'Hide / show the pins', run: () => setPins(!ui.pins) },
    { key: 'ArrowLeft', show: '←', does: 'Previous concept (Focus)', when: () => state.mode === 'focus' && variants.length > 1, run: () => step(-1) },
    { key: 'ArrowRight', show: '→', does: 'Next concept (Focus)', when: () => state.mode === 'focus' && variants.length > 1, run: () => step(1) },
    { key: '?', show: '?', does: 'This list', run: () => openKeys() },
    { key: 'Escape', show: 'Esc', does: 'Close what is open · leave comment mode · leave presentation', run: () => escape() },
  ];
  const FRAME_KEYS = [   // handled inside the mock frame, listed so the sheet tells the whole story
    { show: '← ↑ → ↓', does: 'In comment mode: move the crosshair (Shift = faster)' },
    { show: 'Enter', does: 'In comment mode: comment on the spot under the crosshair' },
    { show: 'Delete', does: 'On a focused comment pin: remove it (with Undo)' },
  ];
  // Escape closes the top-most thing, one press at a time.
  const escape = () => {
    const openPop = popovers.find((p) => p.isOpen());
    if (openPop) { openPop.close({ returnFocus: true }); return; }
    if (commentOn) { setMode(false); return; }
    if (ui.presenting) { setPresenting(false); return; }
    if (ui.drawer && state.mode === 'focus') setDrawer(false, { returnFocus: $('#drawer')?.contains(document.activeElement) });
  };
  const isTyping = (t) => t instanceof HTMLElement && (/^(input|textarea|select)$/i.test(t.tagName) || t.isContentEditable);
  const modalOpen = () => !$('#confirm-backdrop').hidden || !$('#keys-backdrop').hidden;
  const runKey = (key, e) => {
    const k = KEYS.find((x) => x.key === key);
    if (!k || (k.when && !k.when())) return false;
    k.run(e); return true;
  };
  addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
    if (isTyping(e.target) || modalOpen() || userBusy()) return;
    // arrows inside a control that owns them (a segmented group, the menu, the rail tablist) stay theirs
    if (/^Arrow/.test(e.key) && e.target.closest?.('.seg, .menu, .concept-rail, .drawer')) return;
    if (runKey(e.key, e)) e.preventDefault();
  });

  // ---- the `?` sheet ----
  const keysBackdrop = $('#keys-backdrop');
  let keysReturn = null;
  $('#keys-list').replaceChildren(...[...KEYS, ...FRAME_KEYS].flatMap((k) => [el('dt', {}, el('kbd', {}, k.show)), el('dd', {}, k.does)]));
  const openKeys = () => {
    keysReturn = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    keysBackdrop.hidden = false; $('#keys-close').focus();
  };
  const closeKeys = () => { keysBackdrop.hidden = true; keysReturn?.focus?.(); keysReturn = null; };
  $('#keys-toggle').addEventListener('click', openKeys);
  $('#keys-close').addEventListener('click', closeKeys);
  keysBackdrop.addEventListener('click', (e) => { if (e.target === keysBackdrop) closeKeys(); });
  keysBackdrop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === '?') { e.preventDefault(); closeKeys(); }
    if (e.key === 'Tab') { e.preventDefault(); $('#keys-close').focus(); }   // one control: focus stays on it
  });

  addEventListener('message', (e) => {
    const d = e.data || {};
    if (d.type === 'mk:mode') { commentOn = d.on; setCommentButton(); }
    // The composer opened/closed. While open, hot-reloads are deferred (userBusy); on close, resync then
    // apply whatever was deferred.
    if (d.type === 'mk:composer') { composerOpen = d.open; if (!d.open) pullAll().then(flushReload); }
    if (d.type === 'mk:changed') { if (autosend) submitDrafts(); else pullAll(); }
    // a harness key pressed while focus is inside the mock (its keydown never reaches this document)
    if (d.type === 'mk:key' && !modalOpen() && !userBusy()) runKey(d.key);
    // a pin's Remove (button or Delete key): the gallery owns removal, so it is undoable from one place
    if (d.type === 'mk:remove') { const c = comments.find((x) => String(x.n) === String(d.n)); if (c) removeWithUndo(c); }
    // pin hover in the frame → light the matching list row (the other half of recognition)
    if (d.type === 'mk:pin-enter') $(`.clist li[data-n="${d.n}"]`)?.classList.add('hot');
    if (d.type === 'mk:pin-leave') $(`.clist li[data-n="${d.n}"]`)?.classList.remove('hot');
  });

  // ---- data ops ----
  const submitDrafts = () => fetch('/submit', { method: 'POST' }).then(() => pullAll()).catch(() => {});
  const sendOne = (n) => patch(n, { status: 'submitted' });
  const editComment = (n, text) => patch(n, { text });
  const handleComment = (n, extra) => patch(n, { handled: true, ...(typeof extra === 'object' ? extra : {}) });
  const patch = (n, body) => fetch('/comments', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ n, ...body }),
  }).then(() => pullAll()).catch(() => {});

  const removeComment = (n) => fetch(`/comments?n=${n}`, { method: 'DELETE' }).then(() => pullAll()).catch(() => {});
  const removeWithUndo = (c) => {
    removeComment(c.n);
    showToast(`Comment ${c.n} removed`, 'Undo', () => {
      // restore it exactly (status + version preserved) — the server re-stamps only n + ts
      fetch('/comments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(c) })
        .then(() => pullAll()).catch(() => {});
    });
  };

  const resolveVariant = (nameOrIndex) => {
    if (nameOrIndex == null) return variants[state.focus];
    if (typeof nameOrIndex === 'number') return variants[nameOrIndex];
    const i = variants.findIndex((v) => slug(v.name) === slug(nameOrIndex) || v.file === nameOrIndex || variantKey(v) === nameOrIndex);
    return i < 0 ? null : variants[i];       // no fuzzy fallback — committing the WRONG concept is worse than erroring
  };
  const commitRound = (variantName, note = '') => {
    const v = resolveVariant(variantName);
    if (!v) return Promise.reject(new Error(`mockCommit: no variant "${variantName}"`));
    return fetch('/version', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ variant: variantKey(v), note }) })
      .then((r) => r.json()).then(() => pullAll());
  };

  // ---- the verdict (the decision) ----
  const setVerdict = (body) => fetch('/verdict', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }).then((r) => r.json()).then(() => pullAll()).catch(() => {});
  const clearVerdict = () => fetch('/verdict', { method: 'DELETE' }).then(() => pullAll()).catch(() => {});

  // A small, explicit, reversible confirm — choosing a direction (or rejecting all) is the review's GATE,
  // never an accidental click. onYes runs on confirm; Esc / Cancel / backdrop-click dismiss.
  const cbk = $('#confirm-backdrop');
  let confirmYes = null;
  let confirmReturnFocus = null;
  const openConfirm = (title, bodyText, yesLabel, onYes, tone = 'go') => {
    $('#confirm-title').textContent = title;
    $('#confirm-body').textContent = bodyText;
    const yes = $('#confirm-yes'); yes.textContent = yesLabel;
    yes.classList.toggle('neutral', tone !== 'go');   // green affirms a "go"; reject / un-choose get a neutral button
    confirmYes = onYes;
    confirmReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cbk.hidden = false;
    yes.focus();
  };
  const closeConfirm = () => {
    cbk.hidden = true; confirmYes = null;
    const back = confirmReturnFocus; confirmReturnFocus = null;
    back?.focus?.();                                   // restore focus to the control that opened the dialog
  };
  $('#confirm-yes').addEventListener('click', () => { const h = confirmYes; closeConfirm(); h?.(); });
  $('#confirm-cancel').addEventListener('click', closeConfirm);
  cbk.addEventListener('click', (e) => { if (e.target === cbk) closeConfirm(); });
  cbk.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeConfirm(); return; }
    if (e.key !== 'Tab') return;
    const first = $('#confirm-cancel'), last = $('#confirm-yes');
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  const isChosen = (v) => verdict?.kind === 'chosen' && v && verdict.choice === variantKey(v);
  const chooseVariant = (v) => {
    if (isChosen(v)) {   // choosing the already-chosen concept un-decides it
      openConfirm(`Un-choose ${v.name}?`, 'This clears the decision so you can pick again. Claude waits for a new choice.',
        'Un-choose', () => clearVerdict().then(() => showToast('Decision cleared', 'Choose again', () => setVerdict({ kind: 'chosen', choice: variantKey(v) }))), 'neutral');
      return;
    }
    const switching = verdict?.kind === 'chosen';
    openConfirm(`${switching ? 'Switch to' : 'Proceed with'} ${v.name}?`,
      'Claude will build this direction. A mock “yes” is provisional — it picks the direction; a fresh pair of eyes still reviews the finished screen.',
      switching ? 'Switch choice' : 'Confirm choice',
      () => setVerdict({ kind: 'chosen', choice: variantKey(v) })
        .then(() => showToast(`✓ ${v.name} chosen — Claude will proceed`, 'Undo', clearVerdict)));
  };
  const chooseFocused = () => { const v = variants[state.focus]; if (v) chooseVariant(v); };
  const rejectAll = () => openConfirm('Reject all concepts?',
    'None of these is a first-class outcome, not a failure. Claude will rethink the approach and produce fresh mocks.',
    'Reject all',
    () => setVerdict({ kind: 'none' }).then(() => showToast('Rejected all — Claude will reconceive', 'Undo', clearVerdict)),
    'neutral');

  // Paint the decision everywhere it shows — bar status + button, compare ribbons, rail markers, focus tag.
  const paintDecision = () => {
    const d = $('#decision'), choose = $('#choose');
    if (!verdict) { d.textContent = 'no decision yet'; d.className = 'decision'; d.disabled = true; d.onclick = null; }
    else if (verdict.kind === 'none') { d.textContent = '✗ Rejected all — reconceiving'; d.className = 'decision rejected'; d.disabled = true; d.onclick = null; }
    else {
      const cv = variants.find((v) => variantKey(v) === verdict.choice);
      const cur = cv ? curVersion(cv) : null;
      const behind = cur != null && verdict.version != null && verdict.version < cur;   // approved an OLDER round
      d.textContent = `✓ Chosen: ${nameOfKey(verdict.choice)}${verdict.version ? ` · v${verdict.version}` : ''}${behind ? ` (now v${cur})` : ''}`;
      d.className = 'decision chosen'; d.disabled = false;
      d.title = behind ? `Chosen on v${verdict.version}; the mock is now on v${cur}. Click to view the approved round.` : 'Click to view the chosen concept';
      d.onclick = () => {
        state.mode = 'focus'; state.focus = variantByName(verdict.choice);
        state.hist = behind ? verdict.version : null;   // open exactly the round the user approved
        apply();
      };
    }
    const focusedChosen = inLiveFocus() && isChosen(variants[state.focus]);
    choose.disabled = !inLiveFocus();
    choose.textContent = focusedChosen ? '✓ Your choice — click to clear' : '✓ Choose this concept';
    choose.classList.toggle('is-chosen', !!focusedChosen);
    document.querySelectorAll('.card').forEach((card) => {
      const chosen = verdict?.kind === 'chosen' && card.dataset.key === verdict.choice;
      card.classList.toggle('chosen', chosen);
      const existing = $('.chosen-ribbon', card);
      if (chosen && !existing) card.append(el('div', { className: 'chosen-ribbon' }, '✓ Chosen'));
      else if (!chosen && existing) existing.remove();
    });
    document.querySelectorAll('.rail-item').forEach((item, i) => {
      item.classList.toggle('chosen', verdict?.kind === 'chosen' && variants[i] && variantKey(variants[i]) === verdict.choice);
    });
    const whoami = $('#nav .whoami');
    $('.chosen-tag')?.remove();
    if (focusedChosen && whoami) whoami.after(el('span', { className: 'chosen-tag' }, '✓ chosen'));
  };

  const setText = (node, text) => { if (node.textContent !== text) node.textContent = text; };   // a live region speaks only on change
  const paintBar = () => {
    const draft = comments.filter((c) => statusOf(c) === 'draft').length;
    const sent = comments.filter((c) => statusOf(c) === 'sent').length;
    const handled = comments.filter((c) => c.handled).length;
    setText($('#count'), comments.length
      ? [draft && `${draft} draft`, sent && `${sent} sent`, handled && `${handled} handled`].filter(Boolean).join(' · ')
      : 'no comments yet');
    const submit = $('#submit');
    submit.textContent = `Submit review (${draft})`;
    submit.hidden = !draft;              // only exists while there is a batch to send
  };
  const paintBadges = () => {
    document.querySelectorAll('.card').forEach((card) => {
      const key = card.dataset.key;
      const open = comments.filter((c) => c.variant === key && !c.handled).length;
      const handled = comments.filter((c) => c.variant === key && c.handled).length;
      const badge = $('.badge', card);
      if (!badge) return;
      badge.replaceChildren();
      if (!open && !handled) { badge.textContent = 'no comments yet'; return; }
      badge.append(el('span', {}, open ? el('b', {}, String(open)) : '0', ` open${handled ? ` · ${handled} handled` : ''}`));
    });
  };
  const pushToFrames = () => frames.forEach(({ iframe }) => { try { iframe.contentWindow.mockRefresh?.(); } catch { /* */ } });

  // Pull comments AND versions together (a commit bumps the same SSE channel), then refresh the view.
  const pullAll = () => Promise.all([
    fetch('/comments').then((r) => r.json()).catch(() => comments),
    fetch('/versions').then((r) => r.json()).catch(() => versions),
    fetch('/verdict').then((r) => r.json()).catch(() => verdict),
  ]).then(([cs, vs, vd]) => {
    comments = Array.isArray(cs) ? cs : [];
    versions = vs && typeof vs === 'object' ? vs : {};
    verdict = vd && typeof vd === 'object' ? vd : null;
    announceHandled();
    paintBar();
    paintDecision();
    if (state.mode === 'evolution') {
      // Re-render only when the data actually changed (else the poll would reload every snapshot iframe).
      const sig = JSON.stringify([versions, comments.map((c) => [c.n, c.status, c.handled, c.text, c.reply, c.version])]);
      if (sig !== evoSig) { evoSig = sig; render(); }
      return;
    }
    evoSig = '';
    if (state.mode === 'focus' && editingN == null && !composerOpen) {
      const v = variants[state.focus];
      const wantV = state.hist != null ? state.hist : curVersion(v);
      const loadedV = /(?:^|&)v=(\d+)/.exec(focusFrame()?.dataset.q || '')?.[1];
      // A round was just committed → re-render fully so the frame reloads (new version → clean pins).
      if (frames.length && String(wantV) !== String(loadedV)) { render(); return; }
      const body = $('#drawer-body');
      if (body) {
        // keep keyboard focus on the same row's control across the list rebuild
        // Keep keyboard focus on the same row's control across the list rebuild; if that row is gone
        // (removed), land on the row now in its place, else the drawer's close button — never on <body>.
        const row = document.activeElement?.closest?.('.clist li');
        const focusedCtl = document.activeElement?.dataset?.ctl;
        const rowIndex = row ? [...row.parentElement.children].indexOf(row) : -1;
        renderSide(body, v, wantV, state.hist != null);
        if (row && focusedCtl) {
          const rows = [...body.querySelectorAll('.clist li')];
          const same = rows.find((li) => li.dataset.n === row.dataset.n);
          const target = same ? $(`[data-ctl="${focusedCtl}"]`, same) || $('[data-ctl="reveal"]', same)
            : rows.length ? $('[data-ctl="reveal"]', rows[Math.min(rowIndex, rows.length - 1)]) : $('#drawer .drawer-head button');
          target?.focus();
        }
      }
    } else if (state.mode === 'compare') {
      paintBadges();
    }
    pushToFrames();
  });

  // ---- toast (undo) ----
  const toast = el('div', { className: 'toast', id: 'toast', 'aria-live': 'polite', role: 'status' });
  document.body.append(toast);
  let toastTimer = null;
  const showToast = (msg, actionLabel, onAction) => {
    clearTimeout(toastTimer);
    toast.replaceChildren(el('span', {}, msg),
      el('button', { type: 'button', className: 'toast-act', onclick: () => { clearTimeout(toastTimer); toast.classList.remove('show'); onAction(); } }, actionLabel));
    toast.classList.add('show');
    toastTimer = setTimeout(() => toast.classList.remove('show'), 6000);
  };

  // A handled comment's pin VANISHES from the mock (declutter) — so acknowledge it, or it reads as "deleted".
  const announceHandled = () => {
    const nowHandled = new Set(comments.filter((c) => c.handled).map((c) => c.n));
    if (handledSeen === null) { handledSeen = nowHandled; return; }   // first pull: don't announce pre-existing
    const fresh = [...nowHandled].filter((n) => !handledSeen.has(n));
    handledSeen = nowHandled;
    if (!fresh.length) return;
    if (fresh.length === 1) {
      const c = comments.find((x) => x.n === fresh[0]);
      showToast(`✓ Comment ${fresh[0]} handled${c?.reply ? ` — ${c.reply}` : ''}`, 'View',
        () => { if (c) { state.mode = 'focus'; state.focus = variantByName(c.variant); state.hist = null; apply(); } });
    } else {
      showToast(`✓ ${fresh.length} comments handled`, 'Dismiss', () => {});
    }
  };

  // ---- the ⋯ menu's actions ----
  $('#export').addEventListener('click', async () => {
    more.close({ returnFocus: true });
    try { await navigator.clipboard.writeText(JSON.stringify(comments, null, 2)); showToast('Comments copied as JSON', 'OK', () => {}); }
    catch { showToast('Clipboard unavailable — the comments are in comments.json beside the mocks', 'OK', () => {}); }
  });
  $('#clear').addEventListener('click', async () => {
    more.close({ returnFocus: true });
    if (!comments.length) return;
    const snapshot = comments.slice();    // keep for Undo — no jarring confirm, forgiving like single-delete
    await fetch('/comments', { method: 'DELETE' }).catch(() => {});
    await pullAll();
    showToast(`Cleared ${snapshot.length} comment${snapshot.length > 1 ? 's' : ''}`, 'Undo', async () => {
      for (const c of snapshot) {
        await fetch('/comments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(c) }).catch(() => {});
      }
      pullAll();
    });
  });
  const autoItem = $('#autosend');
  autoItem.setAttribute('aria-checked', String(autosend));
  autoItem.addEventListener('click', () => {
    autosend = !autosend;
    autoItem.setAttribute('aria-checked', String(autosend));
    pref.set('autosend', autosend ? '1' : '0');
    announce(autosend ? 'Auto-send on — each comment goes to Claude as you pin it' : 'Auto-send off — comments collect as drafts until you submit');
    if (autosend) submitDrafts();
  });
  $('#submit').addEventListener('click', submitDrafts);
  $('#choose').addEventListener('click', chooseFocused);
  $('#reject').addEventListener('click', rejectAll);
  // Safety net for BATCH mode (auto-send off): don't let a reviewer close the tab with unsent drafts.
  addEventListener('beforeunload', (e) => {
    if (comments.some((c) => statusOf(c) === 'draft')) { e.preventDefault(); e.returnValue = ''; }
  });

  // ---- hot reload ----
  const doFrameReload = (changed) => {
    frames.forEach(({ iframe }) => {
      const base = (iframe.dataset.file || '').split('/').pop();
      const hit = changed.some((p) => p.split('/').pop() === base) || changed.some((p) => /review\.(js|css)$/.test(p));
      if (hit) iframe.src = `${iframe.dataset.file}?${iframe.dataset.q}&r=${reloadV}`;
    });
  };
  const flushReload = () => {
    if (userBusy()) return;
    if (pendingFull) { pendingFull = false; location.reload(); return; }
    if (pendingChanged) { const c = [...pendingChanged]; pendingChanged = null; doFrameReload(c); }
  };
  const live = $('#live');
  let poll = setInterval(pullAll, 3000);
  try {
    const es = new EventSource('/events');
    es.onopen = () => { live.classList.add('on'); if (poll) { clearInterval(poll); poll = null; } };
    es.onerror = () => { live.classList.remove('on'); if (!poll) poll = setInterval(pullAll, 3000); };
    es.addEventListener('reload', (ev) => {
      const changed = (JSON.parse(ev.data || '{}').changed) || [];
      reloadV++;
      const full = changed.some((p) => p.endsWith('mocks.json') || /gallery\.(js|html)$/.test(p));
      // NEVER yank the document out from under a user who is mid-comment.
      if (full) { if (userBusy()) { pendingFull = true; return; } location.reload(); return; }
      if (composerOpen) { (pendingChanged ||= new Set()); changed.forEach((p) => pendingChanged.add(p)); return; }
      doFrameReload(changed);
    });
    es.addEventListener('comments', () => pullAll());
  } catch { /* interval poll stays active */ }

  // ---- Claude's drive + read API ----
  window.mockManifest = () => manifest;
  window.allComments = () => comments;
  window.mockVersions = () => versions;
  window.mockInbox = () => comments.filter((c) => c.status === 'submitted' && !c.handled);
  window.mockVerdict = () => verdict;    // THE DECISION — null until the user chooses / rejects all
  window.mockState = () => {
    const v = variants[state.focus];
    return {
      mode: state.mode,
      variant: state.mode !== 'compare' ? v?.name : null,
      viewport: viewports[state.vp]?.label,
      version: v ? curVersion(v) : null,
      viewingHistory: state.hist,
      fit: ui.fit,
      scale: ui.scale,                   // the Focus mock's live scale (1 = its own pixels); null outside Focus
      presenting: ui.presenting,
      pins: ui.pins,
      drawer: ui.drawer,
      comments: comments.length,
      drafts: comments.filter((c) => statusOf(c) === 'draft').length,
      pending: window.mockInbox().length,
      handled: comments.filter((c) => c.handled).length,
      verdict,                           // {kind, choice, note, version, ts} or null
    };
  };
  window.mockCompare = () => { state.mode = 'compare'; state.hist = null; apply(); };
  window.mockGoto = (n) => { state.mode = 'focus'; state.focus = variantByName(n); state.hist = null; apply(); };
  window.mockEvolution = (n) => { state.mode = 'evolution'; if (n != null) state.focus = variantByName(n); state.hist = null; apply(); };
  window.mockViewport = (l) => { state.vp = typeof l === 'number' ? l : vpByLabel(l); apply(); };
  window.mockFit = (id) => { if (!FITS.some((f) => f.id === id)) throw new Error(`mockFit: one of ${FITS.map((f) => f.id).join(', ')}`); setFit(id); };
  window.mockPresent = (on) => setPresenting(!!on);
  window.mockPins = (visible) => setPins(!!visible);
  window.mockCommentMode = (v) => setMode(v);
  window.mockHandle = (n, extra) => handleComment(n, extra);
  window.mockSubmit = () => submitDrafts();
  window.mockCommit = (variantName, note) => commitRound(variantName, note);
  window.mockChoose = (nameOrIndex, note) => {
    const v = resolveVariant(nameOrIndex);
    return v ? setVerdict({ kind: 'chosen', choice: variantKey(v), note: note || '' })
      : Promise.reject(new Error(`mockChoose: no variant "${nameOrIndex}"`));
  };
  window.mockRejectAll = (note) => setVerdict({ kind: 'none', note: note || '' });
  window.mockClearVerdict = () => clearVerdict();

  // ---- boot ----
  addEventListener('hashchange', () => {
    if (location.hash === lastWritten) return;
    readHash(); render(); pullAll();
  });
  readHash();
  await pullAll();      // load versions before first render so the version chip is right
  render();
  window.mockReady = true;
})();
