/**
 * gallery.js — the harness shell. Renders whatever mocks.json declares:
 * every variant, at every viewport, side by side, under the question being asked.
 *
 * Claude never edits this. Claude writes mocks.json and the variant files.
 *
 * Reads over CDP:
 *   window.allComments()   → every comment across every variant, flattened
 *   window.mockManifest()  → what is being shown
 */
(async () => {
  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const manifest = await fetch('mocks.json').then((r) => r.json());
  const viewports = manifest.viewports?.length
    ? manifest.viewports
    : [{ label: 'Phone', width: 390, height: 844 }, { label: 'Desktop', width: 1280, height: 800 }];

  $('#question').textContent = manifest.question ?? 'Which one — and what would you change?';
  $('#honesty').innerHTML = (manifest.honesty ?? [])
    .map((h) => `<li>${esc(h)}</li>`).join('') || '<li>Nothing faked.</li>';

  const frames = [];

  $('#variants').innerHTML = manifest.variants.map((v) => `
    <section class="variant">
      <header>
        <h2>${esc(v.name)}</h2>
        <p>${esc(v.pitch)}</p>
      </header>
      <div class="views">
        ${viewports.map((vp) => `
          <figure class="view">
            <figcaption>
              ${esc(vp.label)} · ${vp.width}px
              <a href="${esc(v.file)}" target="_blank" rel="noopener" class="mk-fullsize">open full-size ↗</a>
            </figcaption>
            <div class="frame-box">
              <iframe src="${esc(v.file)}" title="${esc(v.name)} — ${esc(vp.label)}"
                      data-variant="${esc(v.file)}" width="${vp.width}" height="${vp.height}"
                      loading="lazy"></iframe>
            </div>
          </figure>`).join('')}
      </div>
    </section>`).join('');

  document.querySelectorAll('iframe').forEach((f) => frames.push(f));

  // Each view scales to fit its column — the mock renders at its TRUE viewport width (a phone mock
  // laid out at 390px, never a squashed desktop), then scaled visually. A desktop mock in a narrow
  // column scales down hard, so every view links to the full-size page (the "open full-size" link)
  // where the eye — and the pins — are full resolution.
  const fit = () => {
    document.querySelectorAll('.view').forEach((view) => {
      const box = view.querySelector('.frame-box');
      const frame = view.querySelector('iframe');
      const scale = Math.min(1, view.clientWidth / frame.width);
      frame.style.scale = scale;
      // The box wraps the SCALED frame exactly — otherwise a phone mock sits in a wide white gutter.
      box.style.width = `${frame.width * scale}px`;
      box.style.height = `${frame.height * scale}px`;
    });
  };
  addEventListener('resize', fit);
  setTimeout(fit, 0);

  // ---- the comment layer ----
  // Comments live on the SERVER (comments.json), not in the frames — so the gallery is the single
  // source of truth (no phone-vs-desktop double-count) and Claude can read them straight off disk.
  const eachFrame = (fn) => frames.forEach((f) => { try { fn(f.contentWindow); } catch { /* not loaded */ } });

  let comments = [];
  const paint = () => {
    $('#count').textContent = comments.length
      ? `${comments.length} comment${comments.length > 1 ? 's' : ''}`
      : 'no comments yet';
  };
  const pull = () => fetch('/comments').then((r) => r.json())
    .then((all) => { comments = Array.isArray(all) ? all : []; paint(); })
    .catch(() => { /* served statically without the endpoint — intent pins still work */ });

  let on = false;
  const toggle = $('#comment-toggle');
  const setMode = (v) => {
    on = v;
    toggle.setAttribute('aria-pressed', String(on));
    toggle.textContent = on ? 'Commenting — click anything (c)' : 'Comment (c)';
    eachFrame((w) => w.mockCommentMode?.(on));   // drive every frame → mode never desyncs
  };

  toggle.addEventListener('click', () => setMode(!on));
  addEventListener('keydown', (e) => {
    if (e.key === 'c' && !e.ctrlKey && !e.metaKey && !e.altKey
        && !/^(input|textarea|select)$/i.test(e.target.tagName)) setMode(!on);
  });

  addEventListener('message', (e) => {
    // a frame reports its own mode back → keep the toggle honest even after a click into a frame
    if (e.data?.type === 'mk:mode') { on = e.data.on; toggle.setAttribute('aria-pressed', String(on)); }
    if (e.data?.type === 'mk:changed') { pull(); eachFrame((w) => w.mockRefresh?.()); }
  });
  setInterval(pull, 1500);

  $('#export').addEventListener('click', async () => {
    const json = JSON.stringify(comments, null, 2);
    try {
      await navigator.clipboard.writeText(json);
      $('#export').textContent = 'Copied ✓';
    } catch {
      $('#export').textContent = 'see comments.json';   // don't claim a copy that didn't happen
    }
    setTimeout(() => { $('#export').textContent = 'Copy comments'; }, 1800);
  });

  $('#clear').addEventListener('click', async () => {
    if (!confirm('Delete every comment on every variant?')) return;
    await fetch('/comments', { method: 'DELETE' }).catch(() => {});
    await pull();
    eachFrame((w) => w.mockRefresh?.());
  });

  // ---- the contract Claude reads (over CDP, or straight off comments.json) ----
  window.allComments = () => comments;
  window.mockManifest = () => manifest;

  pull();
})();
