/**
 * gallery.js — the harness shell. Renders whatever mocks.json declares, and gives a mock review
 * the instruments it needs:
 *
 *   · COMPARE — every concept side by side at a readable scale, so the eye can pick.
 *   · FOCUS   — one concept at TRUE size, where a comment lands on the exact clicked pixel.
 *   · ROUNDS  — a mock is iterated v1 → v2 → … . Comments are version-bound; the live mock shows only
 *     the CURRENT round's OPEN pins (handled + past-round pins never clutter it). Every committed round
 *     is snapshotted, so the whole EVOLUTION over time is viewable. This is the review's own record.
 *
 * Deep-linked (location.hash): #compare/Desktop · #focus/Lantern/Phone · #focus/Lantern/Phone/v2 (a past
 * round, read-only) · #evolution/Lantern/Phone (the timeline). Back button, refresh, and shared links all work.
 *
 * Claude never edits this. Reads / drives over CDP:
 *   window.allComments() · window.mockInbox() · window.mockVersions() · window.mockState()
 *   window.mockGoto(name) · window.mockViewport(label) · window.mockCompare() · window.mockEvolution() · window.mockCommentMode(bool)
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

  const manifest = await fetch('mocks.json').then((r) => r.json());
  const variants = manifest.variants || [];
  const viewports = manifest.viewports?.length
    ? manifest.viewports
    : [{ label: 'Phone', width: 390, height: 844 }, { label: 'Desktop', width: 1280, height: 800 }];

  $('#question').textContent = manifest.question ?? 'Which one — and what would you change?';
  $('#question').title = manifest.question ?? '';   // the bar truncates to one line; full text on hover + in the panel
  const honesty = manifest.honesty?.length ? manifest.honesty : ['Nothing faked.'];
  $('#honesty').replaceChildren(...honesty.map((h) => el('li', { textContent: h })));
  $('#faked-count').textContent = manifest.honesty?.length ? `(${manifest.honesty.length}) ` : '';   // surfaced up front
  // "What's faked" info panel — collapsed by default so the mock starts high; opens on demand.
  const infoBtn = $('#info-toggle'), infoPanel = $('#info-panel');
  const setInfo = (open) => { infoPanel.hidden = !open; infoBtn.setAttribute('aria-expanded', String(open)); measureHeader(); };
  infoBtn.addEventListener('click', (e) => { e.stopPropagation(); setInfo(infoPanel.hidden); });
  document.addEventListener('click', (e) => { if (!e.target.closest('#info-panel, #info-toggle')) setInfo(false); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') setInfo(false); });

  // ---- state (mirrored to the URL hash) ----
  // hist: null = current round; a number = viewing that past round (read-only). diff: a past version to
  // a number = viewing that past round (read-only). mode: 'compare' | 'focus' | 'evolution' (the timeline).
  const state = { mode: 'compare', focus: 0, vp: 0, hist: null };
  let comments = [];
  let versions = {};
  let reloadV = 0;
  let commentOn = false;
  let evoSig = '';                       // last-rendered evolution data signature (skip needless re-renders)
  let handledSeen = null;                // n's already handled (to announce only NEWLY handled ones)
  let autosend = localStorage.getItem('mk-autosend') !== '0';   // DEFAULT ON: pin = sent. Uncheck to batch.
  let editingN = null;                   // an inline edit in progress — don't rebuild the list under it

  const variantKey = (v) => v.file.split('/').pop().replace(/\.html$/, '');
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

  // ---- frame builder + fit ----
  const frames = [];
  // opts: { version, mode ('history'|undefined), snapshot (rel path for a past round) }
  const frameFor = (variant, vpi, container, opts = {}) => {
    const vp = viewports[vpi];
    const box = el('div', { className: `frame-box ${slug(vp.label)}` });
    const version = opts.version != null ? opts.version : curVersion(variant);
    const file = opts.snapshot || variant.file;
    const q = `variant=${encodeURIComponent(variantKey(variant))}&v=${version}${opts.mode ? `&mode=${opts.mode}` : ''}`;
    const f = el('iframe', { src: `${file}?${q}&r=${reloadV}`, title: `${variant.name} — ${vp.label}`, loading: 'lazy' });
    f.dataset.file = file;                 // the file actually loaded (live mock or a snapshot)
    f.dataset.q = q;                       // preserved across hot-reload re-points
    f.width = vp.width; f.height = vp.height;
    // Preview frames (rail thumbs, compare cards, evolution steps) are non-interactive: the click falls
    // through to the card/tile, and keyboard/SR users shouldn't tab INTO a mock document that isn't the
    // one being reviewed. `inert` removes it from focus + the a11y tree. Only the Focus main frame stays live.
    if (opts.kind === 'rail' || opts.preview) { f.inert = true; f.tabIndex = -1; f.setAttribute('aria-hidden', 'true'); }
    box.append(f);
    container.append(box);
    frames.push({ iframe: f, w: vp.width, h: vp.height, box, kind: opts.kind || null });
    return box;
  };

  const fit = () => {
    for (const { iframe, w, h, box, kind } of frames) {
      const host = box.parentElement;
      if (!host) continue;
      let scale;
      if (kind === 'rail') {
        scale = host.clientWidth / w;    // fill the fixed rail-thumb width; the thumb crops the height
      } else {
        const scaled = state.mode === 'compare' || state.mode === 'evolution';   // thumbnail grids
        const avail = host.clientWidth - (state.mode === 'compare' ? 28 : 0);
        const maxH = (state.mode === 'evolution' ? 0.52 : 0.62) * innerHeight;
        scale = scaled ? Math.min(1, avail / w, maxH / h) : Math.min(1, avail / w);   // focus = true size
      }
      iframe.style.transform = `scale(${scale})`;
      box.style.width = `${w * scale}px`;
      box.style.height = `${h * scale}px`;
    }
  };
  addEventListener('resize', fit);
  // Publish the real sticky-header height so the concept rail sticks just BELOW it (not under it). The
  // header height varies: Compare hides the toolbar, and opening the info panel grows it.
  const measureHeader = () => {
    const top = $('.top');
    if (top) document.documentElement.style.setProperty('--header-h', `${Math.round(top.getBoundingClientRect().height) + 8}px`);
  };
  addEventListener('resize', measureHeader);

  // ---- status helpers ----
  const statusOf = (c) => (c.handled ? 'handled' : c.status === 'draft' ? 'draft' : 'sent');
  const STATUS_PILL = { draft: 'draft', sent: 'sent', handled: '✓ handled' };
  const inRound = (c, v, roundVersion) => c.variant === variantKey(v) && Number(c.version ?? roundVersion) === roundVersion;

  // ---- render ----
  const navLeft = $('#nav-left');
  const stage = $('#stage');
  const toggle = $('#comment-toggle');

  const render = () => {
    frames.length = 0;
    stage.replaceChildren();
    navLeft.replaceChildren();
    editingN = null;                     // any full re-render (incl. the Back button) discards an in-progress edit
    // Keep comment mode across a re-render WITHIN the current-round Focus (switching viewport/concept
    // shouldn't drop you out of commenting — the frame's load handler re-arms it). Clear it elsewhere.
    if (state.mode !== 'focus' || state.hist != null) commentOn = false;

    if (!variants.length) {
      stage.append(el('p', { className: 'empty' }, 'No variants declared in mocks.json.'));
      renderViewportSeg(); setCommentButton(); return;
    }

    if (state.mode === 'compare') renderCompare();
    else if (state.mode === 'evolution') renderEvolution();
    else renderFocus();

    renderViewportSeg();
    setCommentButton();
    paintBadges();
    requestAnimationFrame(() => { fit(); measureHeader(); });
  };

  const renderViewportSeg = () => {
    $('#viewport-seg').replaceChildren(...viewports.map((vp, i) =>
      el('button', {
        type: 'button', textContent: `${vp.label} · ${vp.width}`,
        'aria-pressed': String(i === state.vp),
        onclick: () => { state.vp = i; apply(); },
      })));
  };

  const renderCompare = () => {
    const wall = el('div', { className: 'wall' });
    variants.forEach((v, i) => {
      const card = el('div', { className: 'card', role: 'button', tabIndex: 0 },
        el('span', { className: 'open-hint' }, 'Open ▸'),
        el('h2', {}, v.name),
        el('p', { className: 'pitch' }, v.pitch || ''));
      card.dataset.key = variantKey(v);
      const holder = el('div');
      card.append(holder);
      frameFor(v, state.vp, holder, { preview: true });
      card.append(el('div', { className: 'badge' }));
      const go = () => { state.mode = 'focus'; state.focus = i; state.hist = null; apply(); };
      card.addEventListener('click', go);
      card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
      wall.append(card);
    });
    stage.append(wall);
    toggle.disabled = true;
    toggle.title = 'Open a concept to comment on the exact spot';
  };

  const renderFocus = () => {
    const v = variants[state.focus];
    // A stale/typo'd version deep-link (#…/v99) has no snapshot → fall back to the current round rather
    // than render the live mock mislabeled "v99 · history".
    if (state.hist != null && !snapshotPath(v, state.hist)) state.hist = null;
    const viewingHistory = state.hist != null;
    const ver = viewingHistory ? state.hist : curVersion(v);

    navLeft.append(
      el('button', { className: 'backbtn', onclick: () => { state.mode = 'compare'; state.hist = null; apply(); } }, '← All concepts'),
      el('span', { className: 'focusnav' },
        el('button', { className: 'arrow', title: 'Previous concept', onclick: () => { state.focus = (state.focus - 1 + variants.length) % variants.length; state.hist = null; apply(); } }, '‹'),
        el('span', { className: 'whoami' }, v.name, el('small', {}, v.pitch || '')),
        el('button', { className: 'arrow', title: 'Next concept', onclick: () => { state.focus = (state.focus + 1) % variants.length; state.hist = null; apply(); } }, '›')),
      el('button', { className: `vchip ${viewingHistory ? 'hist' : ''}`, title: viewingHistory ? 'Back to the current round' : 'Current round',
        onclick: () => { if (viewingHistory) { state.hist = null; apply(); } } }, `v${ver}${viewingHistory ? ' · history' : ' · current'}`));

    const main = el('div', { className: 'focus-main' });
    frameFor(v, state.vp, main, viewingHistory
      ? { version: state.hist, mode: 'history', snapshot: snapshotPath(v, state.hist) }
      : { version: ver });
    if (!viewingHistory) {
      const mainFrame = frames[0].iframe;   // capture — don't read frames[0] later (it may be replaced)
      mainFrame.addEventListener('load', () => {
        try { mainFrame.contentWindow.postMessage({ type: 'mk:set-mode', on: commentOn }, '*'); } catch { /* */ }
      });
    }

    const side = el('div', { className: 'side' });
    renderSide(side, v, ver, viewingHistory);

    // Concept rail — live thumbnails of every concept, a slim vertical column beside the mock; current
    // highlighted, click to jump between mocks directly (not just the ‹ › arrows). Built AFTER the main
    // frame so frames[0] stays the focus frame.
    const focusEl = el('div', { className: `focus${variants.length > 1 ? ' has-rail' : ''}` });
    if (variants.length > 1) {
      const rail = el('div', { className: 'concept-rail', role: 'tablist', 'aria-label': 'Concepts' });
      variants.forEach((cv, i) => {
        const thumb = el('div', { className: 'rail-thumb' });
        frameFor(cv, state.vp, thumb, { kind: 'rail' });
        const go = () => { if (i !== state.focus) { state.focus = i; state.hist = null; apply(); } };
        const item = el('div', { className: `rail-item ${i === state.focus ? 'current' : ''}`, role: 'tab',
          tabIndex: 0, title: cv.name, 'aria-selected': String(i === state.focus), onclick: go },
          thumb, el('span', { className: 'rail-name' }, cv.name));
        item.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
        rail.append(item);
      });
      focusEl.append(rail);
    }
    focusEl.append(main, side);
    stage.append(focusEl);

    toggle.disabled = viewingHistory;
    toggle.title = viewingHistory ? 'Viewing a past round — read-only' : 'Press c, then click the exact spot on the mock';
  };

  // The EVOLUTION timeline — the whole life of one concept in order: v1 → v2 → … → current, each round
  // a snapshot thumbnail with the feedback it drew beneath it, so you read the arc through time (not a
  // two-version diff). Every step is clickable → open that version at full size.
  const renderEvolution = () => {
    const v = variants[state.focus];
    const cur = curVersion(v);
    navLeft.append(
      el('button', { className: 'backbtn', onclick: () => { state.mode = 'focus'; state.hist = null; apply(); } }, '← Back to Focus'),
      el('span', { className: 'whoami' }, v.name, el('small', {}, 'evolution — v1 to now')));

    const steps = roundsOf(v).map((r) => ({ version: r.v, snapshot: r.snapshot, note: r.note, current: false }));
    steps.push({ version: cur, snapshot: null, note: null, current: true });   // the live, un-snapshotted current round

    if (steps.length < 2) {
      stage.append(el('p', { className: 'empty' },
        'Just the first round so far — the timeline fills in as you re-mock (each committed round is snapshotted here).'));
      toggle.disabled = true; return;
    }

    const strip = el('div', { className: 'evolution' });
    steps.forEach((s, i) => {
      if (i > 0) strip.append(el('div', { className: 'evo-arrow', title: 'the feedback on the left drove the version on the right' }, '→'));
      const stepComments = comments
        .filter((c) => c.variant === variantKey(v) && Number(c.version) === Number(s.version))
        .sort((a, b) => (a.n || 0) - (b.n || 0));
      const fig = el('figure', { className: `evo-step ${s.current ? 'current' : ''}` });
      // ONLY the version label sits above the thumbnail (uniform one line) → every thumbnail aligns.
      fig.append(el('figcaption', {}, el('b', {}, `v${s.version}`), s.current ? ' · current' : ''));
      const holder = el('div', { className: 'evo-frame', role: 'button', tabIndex: 0, title: `Open v${s.version} full-size` });
      frameFor(v, state.vp, holder, s.current ? { version: cur, preview: true } : { version: s.version, mode: 'history', snapshot: s.snapshot, preview: true });
      const open = () => { state.mode = 'focus'; state.hist = s.current ? null : s.version; apply(); };
      holder.addEventListener('click', open);
      holder.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
      fig.append(holder);
      // The full note (what this round changed) lives BELOW the thumbnail — its length can't shift the row.
      if (s.note) fig.append(el('div', { className: 'evo-note' }, s.note));
      // the feedback this version drew — the reason it changed (or, on the current step, what's still open)
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

  // ---- the side panel: current round comments + management + history ----
  const renderSide = (side, v, ver, viewingHistory) => {
    side.replaceChildren();
    if (viewingHistory) {
      side.append(el('div', { className: 'histbanner' },
        `Viewing v${ver} — read-only`,
        el('button', { className: 'linklike', onclick: () => { state.hist = null; apply(); } }, 'back to current')));
    } else {
      side.append(el('h3', {}, `This round · v${ver}`));
    }
    side.append(commentList(v, ver, viewingHistory));
    if (!viewingHistory) side.append(historySection(v));
  };

  const commentList = (v, roundVersion, readonly) => {
    const mine = comments.filter((c) => inRound(c, v, roundVersion)).sort((a, b) => (a.n || 0) - (b.n || 0));
    if (!mine.length) {
      return el('p', { className: 'empty' }, readonly ? 'No comments in this round.' : 'None yet. Press c and click the exact spot to leave one.');
    }
    const ul = el('ul', { className: 'clist' });
    mine.forEach((c, i) => {
      const s = statusOf(c);
      const li = el('li', { className: `st-${s}` });
      li.dataset.n = c.n;

      // recognition, not recall: hovering a row lights its pin; clicking reveals (scroll-to + flash) it.
      li.addEventListener('mouseenter', () => msgFrame({ type: 'mk:highlight', n: c.n }));
      li.addEventListener('mouseleave', () => msgFrame({ type: 'mk:unhighlight', n: c.n }));
      li.addEventListener('click', (e) => { if (!e.target.closest('button,input')) msgFrame({ type: 'mk:reveal', n: c.n }); });

      const num = el('span', { className: 'num', style: c.handled ? 'background:#3aa76a' : '' }, c.handled ? '✓' : String(c.n));
      const txt = el('span', { className: 'txt', style: c.handled ? 'opacity:.6' : '' }, c.text);
      const head = el('span', { className: 'chead' }, num, txt);
      li.append(head);

      const meta = el('div', { className: 'meta' },
        el('span', { className: `pill pill-${s}` }, STATUS_PILL[s]),
        ` ${c.element || ''} · ${c.viewport || ''}px${c.reply ? ` · ${c.reply}` : ''}`);
      li.append(meta);

      if (!readonly) {
        const acts = el('div', { className: 'acts' });
        acts.append(el('button', { className: 'act', title: 'Edit', onclick: (e) => { e.stopPropagation(); beginEdit(li, c); } }, 'Edit'));
        if (s === 'draft') acts.append(el('button', { className: 'act send', title: 'Send just this to Claude', onclick: (e) => { e.stopPropagation(); sendOne(c.n); } }, 'Send'));
        acts.append(el('button', { className: 'act rm', title: 'Remove', onclick: (e) => { e.stopPropagation(); removeWithUndo(c); } }, 'Remove'));
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
    const input = el('input', { className: 'editin', type: 'text', value: c.text });
    let settled = false;                 // guard: the re-render below removes the focused input → a
    const commit = (save) => {           // spurious blur must not re-run commit (Escape would then save)
      if (settled) return;
      settled = true;
      editingN = null;
      if (save && input.value.trim() && input.value !== c.text) editComment(c.n, input.value.trim());
      else pullAll();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(true); }
      if (e.key === 'Escape') { e.preventDefault(); commit(false); }
    });
    input.addEventListener('blur', () => commit(true));
    head.replaceChildren($('.num', li), input);
    input.focus(); input.select();
  };

  const historySection = (v) => {
    const rounds = roundsOf(v);
    const wrap = el('div', { className: 'history' });
    wrap.append(el('div', { className: 'history-head' },
      el('h4', {}, rounds.length ? 'History' : 'History — none yet'),
      rounds.length
        ? el('button', { className: 'evo-open', title: 'See the whole evolution over time', onclick: () => { state.mode = 'evolution'; apply(); } }, 'See the evolution →')
        : null));
    rounds.slice().reverse().forEach((r) => {
      const count = comments.filter((c) => c.variant === variantKey(v) && Number(c.version) === Number(r.v)).length;
      wrap.append(el('div', { className: 'hround' },
        el('button', { className: 'linklike', title: 'Open this version (read-only)', onclick: () => { state.hist = r.v; apply(); } }, `v${r.v}`),
        el('span', { className: 'hmeta' }, ` · ${count} comment${count === 1 ? '' : 's'}${r.note ? ` · ${esc(r.note)}` : ''}`)));
    });
    return wrap;
  };

  const apply = () => { writeHash(); render(); };

  // ---- comment bar ----
  const setCommentButton = () => {
    toggle.setAttribute('aria-pressed', String(commentOn));
    toggle.textContent = commentOn ? 'Commenting — click a spot (c)' : 'Comment (c)';
  };
  const focusFrame = () => ((state.mode === 'focus') ? frames[0]?.iframe?.contentWindow : null);
  const msgFrame = (m) => { try { focusFrame()?.postMessage(m, '*'); } catch { /* */ } };
  const setMode = (v) => {
    if (state.mode !== 'focus' || state.hist != null) { commentOn = false; setCommentButton(); return; }
    commentOn = !!v;
    setCommentButton();
    msgFrame({ type: 'mk:set-mode', on: commentOn });
  };
  toggle.addEventListener('click', () => setMode(!commentOn));
  addEventListener('keydown', (e) => {
    if (e.key === 'c' && !e.ctrlKey && !e.metaKey && !e.altKey
        && !/^(input|textarea|select)$/i.test(e.target.tagName) && state.mode === 'focus' && state.hist == null) setMode(!commentOn);
  });

  addEventListener('message', (e) => {
    const d = e.data || {};
    if (d.type === 'mk:mode') { commentOn = d.on; setCommentButton(); }
    if (d.type === 'mk:changed') { if (autosend) submitDrafts(); else pullAll(); }
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
    showToast('Comment removed', 'Undo', () => {
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

  const paintBar = () => {
    const draft = comments.filter((c) => statusOf(c) === 'draft').length;
    const sent = comments.filter((c) => statusOf(c) === 'sent').length;
    const handled = comments.filter((c) => c.handled).length;
    $('#count').textContent = comments.length
      ? [draft && `${draft} draft`, sent && `${sent} sent`, handled && `${handled} handled`].filter(Boolean).join(' · ')
      : 'no comments yet';
    const submit = $('#submit');
    submit.textContent = draft ? `Submit review (${draft})` : 'Submit review';
    submit.disabled = !draft;
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
  ]).then(([cs, vs]) => {
    comments = Array.isArray(cs) ? cs : [];
    versions = vs && typeof vs === 'object' ? vs : {};
    // Notice comments that just became handled → a small acknowledgement, since the pin vanishes silently.
    announceHandled();
    paintBar();
    if (state.mode === 'evolution') {
      // The timeline shows the review's record — keep it live. Re-render only when the data actually
      // changed (else the SSE-down 3s poll would reload every snapshot iframe on a tick).
      const sig = JSON.stringify([versions, comments.map((c) => [c.n, c.status, c.handled, c.text, c.reply, c.version])]);
      if (sig !== evoSig) { evoSig = sig; render(); }
      return;
    }
    evoSig = '';
    if (state.mode === 'focus' && editingN == null) {
      const v = variants[state.focus];
      const wantV = state.hist != null ? state.hist : curVersion(v);
      const loadedV = /(?:^|&)v=(\d+)/.exec(frames[0]?.iframe?.dataset.q || '')?.[1];
      // A round was just committed → the current version changed: re-render fully so the frame reloads
      // (new version param → clean pins) and the version chip updates, not just the side list.
      if (frames.length && String(wantV) !== String(loadedV)) { render(); return; }
      const side = $('.side');
      if (side) renderSide(side, v, wantV, state.hist != null);
    } else if (state.mode === 'compare') {
      paintBadges();
    }
    pushToFrames();
  });

  // ---- toast (undo) ----
  const toast = el('div', { className: 'toast', id: 'toast' });
  document.body.append(toast);
  let toastTimer = null;
  const showToast = (msg, actionLabel, onAction) => {
    clearTimeout(toastTimer);
    toast.replaceChildren(el('span', {}, msg),
      el('button', { className: 'toast-act', onclick: () => { clearTimeout(toastTimer); toast.classList.remove('show'); onAction(); } }, actionLabel));
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

  $('#export').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(JSON.stringify(comments, null, 2)); $('#export').textContent = 'Copied ✓'; }
    catch { $('#export').textContent = 'see comments.json'; }
    setTimeout(() => { $('#export').textContent = 'Copy comments'; }, 1800);
  });
  $('#clear').addEventListener('click', async () => {
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
  $('#submit').addEventListener('click', submitDrafts);
  const autoBox = $('#autosend');
  autoBox.checked = autosend;
  autoBox.addEventListener('change', () => {
    autosend = autoBox.checked;
    localStorage.setItem('mk-autosend', autosend ? '1' : '0');
    if (autosend) submitDrafts();
  });
  // Safety net for BATCH mode (auto-send off): don't let a reviewer close the tab with unsent drafts.
  addEventListener('beforeunload', (e) => {
    if (comments.some((c) => statusOf(c) === 'draft')) { e.preventDefault(); e.returnValue = ''; }
  });

  // ---- hot reload ----
  const live = $('#live');
  let poll = setInterval(pullAll, 3000);
  try {
    const es = new EventSource('/events');
    es.onopen = () => { live.classList.add('on'); if (poll) { clearInterval(poll); poll = null; } };
    es.onerror = () => { live.classList.remove('on'); if (!poll) poll = setInterval(pullAll, 3000); };
    es.addEventListener('reload', (ev) => {
      const changed = (JSON.parse(ev.data || '{}').changed) || [];
      reloadV++;
      if (changed.some((p) => p.endsWith('mocks.json'))) { location.reload(); return; }
      if (changed.some((p) => /gallery\.(js|html)$/.test(p))) { location.reload(); return; }
      frames.forEach(({ iframe }) => {
        const base = (iframe.dataset.file || '').split('/').pop();
        const hit = changed.some((p) => p.split('/').pop() === base) || changed.some((p) => /review\.(js|css)$/.test(p));
        if (hit) iframe.src = `${iframe.dataset.file}?${iframe.dataset.q}&r=${reloadV}`;   // keep the version/mode params
      });
    });
    es.addEventListener('comments', () => pullAll());
  } catch { /* interval poll stays active */ }

  // ---- Claude's drive + read API ----
  window.mockManifest = () => manifest;
  window.allComments = () => comments;
  window.mockVersions = () => versions;
  window.mockInbox = () => comments.filter((c) => c.status === 'submitted' && !c.handled);
  window.mockState = () => {
    const v = variants[state.focus];
    return {
      mode: state.mode,
      variant: state.mode !== 'compare' ? v?.name : null,
      viewport: viewports[state.vp]?.label,
      version: v ? curVersion(v) : null,
      viewingHistory: state.hist,
      comments: comments.length,
      drafts: comments.filter((c) => statusOf(c) === 'draft').length,
      pending: window.mockInbox().length,
      handled: comments.filter((c) => c.handled).length,
    };
  };
  window.mockCompare = () => { state.mode = 'compare'; state.hist = null; apply(); };
  window.mockGoto = (n) => { state.mode = 'focus'; state.focus = variantByName(n); state.hist = null; apply(); };
  window.mockEvolution = (n) => { state.mode = 'evolution'; if (n != null) state.focus = variantByName(n); state.hist = null; apply(); };
  window.mockViewport = (l) => { state.vp = typeof l === 'number' ? l : vpByLabel(l); apply(); };
  window.mockCommentMode = (v) => setMode(v);
  window.mockHandle = (n, extra) => handleComment(n, extra);
  window.mockSubmit = () => submitDrafts();
  window.mockCommit = (variantName, note) => commitRound(variantName, note);

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
