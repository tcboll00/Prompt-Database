/* Markline application: viewer, tools, panels, file handling. */
(function () {
  'use strict';
  const MK = window.MK, { G, Units, TYPES, BASE, Shapes, IO } = MK;
  const $ = (s, r = document) => r.querySelector(s);
  const native = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.native;
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';

  function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const k in attrs || {}) {
      const v = attrs[k];
      if (k === 'class') e.className = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v === true) e.setAttribute(k, '');
      else if (v !== false && v != null) e.setAttribute(k, v);
    }
    for (const c of kids.flat()) if (c != null) e.append(c);
    return e;
  }
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const load = (k, def) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (e) { return def; } };
  const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } };
  const clone = (o) => JSON.parse(JSON.stringify(o));

  const S = {
    docs: [], cur: -1, tool: 'select', toolProps: null, snap: load('mk.snap', true), lock: false,
    defaults: load('mk.defaults', {}), session: {}, chest: load('mk.chest', []), clip: [],
    list: { sort: 'page', dir: 1, filter: '', group: 'none', scope: 'all' }, applyAll: true,
    draft: null, hover: null, drag: null, snapMark: null, space: false, editing: null,
  };
  const doc = () => S.docs[S.cur];
  const stage = $('#stage'), base = $('#base'), over = $('#over'), editor = $('#editor');
  const bctx = base.getContext('2d'), octx = over.getContext('2d');
  const mctx = document.createElement('canvas').getContext('2d');
  let mfont = 0;
  const measure = (t, s) => { if (mfont !== s) { mctx.font = `${s}px Helvetica, Arial, sans-serif`; mfont = s; } return mctx.measureText(t).width; };

  const ICON = {
    open: 'M3 6h6l2 2h10v11H3z', save: 'M5 3h11l3 3v15H5zM8 3v6h7V3M8 21v-7h8v7', csv: 'M6 3h9l4 4v14H6zM15 3v4h4M9 12h7M9 15h7M9 18h4',
    undo: 'M4 10h10a6 6 0 010 12h-3M4 10l5-5M4 10l5 5', redo: 'M20 10H10a6 6 0 000 12h3M20 10l-5-5M20 10l-5 5',
    select: 'M5 3l14 8-6 2-2 6z', pan: 'M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3',
    text: 'M5 6V4h14v2M12 4v16M9 20h6', callout: 'M4 4h13v8H4zM14 12l6 8', line: 'M4 20L20 4', arrow: 'M4 20L20 4M20 4h-7M20 4v7',
    rect: 'M4 6h16v12H4z', ellipse: 'M12 5c5 0 9 3 9 7s-4 7-9 7-9-3-9-7 4-7 9-7z', polygon: 'M12 3l8 6-3 10H7L4 9z',
    cloud: 'M7 18a4 4 0 010-8 5 5 0 019.6-1.5A4.5 4.5 0 0117 18z', polyline: 'M3 18l5-9 5 6 8-11', pen: 'M4 20l1-5L16 4l4 4L9 19z',
    hlpen: 'M5 21h14M8 16l8-12 3 2-8 12z', highlight: 'M3 9h18v6H3zM6 12h12',
    calibrate: 'M3 16L16 3l5 5L8 21zM7 14l2 2M10 11l2 2M13 8l2 2', length: 'M3 7v10M21 7v10M3 12h18',
    polylength: 'M3 18l6-10 6 6 6-9M2 16l2 4M20 3l2 4', area: 'M4 4h16v16H4zM4 12l8-8M4 20L20 4M12 20l8-8',
    perimeter: 'M4 4h5M12 4h5M20 4v5M20 12v5M20 20h-5M12 20H7M4 20v-5M4 12V7', volume: 'M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8',
    count: 'M4 12l5 5L20 6', rotate: 'M20 12a8 8 0 11-3-6.2M20 4v5h-5', trash: 'M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13', plus: 'M12 5v14M5 12h14',
    prev: 'M14 6l-6 6 6 6', next: 'M10 6l6 6-6 6',
  };
  const svg = (n) => `<svg viewBox="0 0 24 24"><path d="${ICON[n]}"/></svg>`;
  const TOOLS = [
    ['Navigate', [['select', 'Select', 'V'], ['pan', 'Pan', 'H']]],
    ['Markup', [['text', 'Text Box', 'T'], ['callout', 'Callout', 'Q'], ['line', 'Line', 'L'], ['arrow', 'Arrow', 'A'], ['rect', 'Rectangle', 'R'], ['ellipse', 'Ellipse', 'E'],
      ['polygon', 'Polygon', 'G'], ['cloud', 'Cloud', 'C'], ['polyline', 'Polyline', 'N'], ['pen', 'Pen', 'P'], ['hlpen', 'Highlighter', 'Y'], ['highlight', 'Highlight Area', 'I']]],
    ['Measure', [['calibrate', 'Calibrate Scale', 'K'], ['length', 'Length', 'M'], ['polylength', 'Polylength', 'J'], ['area', 'Area', 'S'], ['perimeter', 'Perimeter', 'D'], ['volume', 'Volume', 'U'], ['count', 'Count', 'O']]],
  ];
  const HOTKEY = {};
  TOOLS.forEach(([, ts]) => ts.forEach(([id, , k]) => (HOTKEY[k.toLowerCase()] = id)));
  const toolType = (t) => (t === 'cloud' ? 'polygon' : t === 'calibrate' ? 'length' : TYPES[t] ? t : null);
  const toolMode = (t) => (t === 'select' || t === 'pan' ? t : TYPES[toolType(t)].mode);

  // ---------- small UI utilities ----------
  let toastT;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 2600); }
  function busy(msg) { const b = $('#busy'); b.hidden = !msg; if (msg) b.firstChild.textContent = msg; }
  /** fields: [{k,label,value,type,options}] ; returns values object or null */
  function dialog(title, text, fields = [], okLabel = 'OK', extra) {
    return new Promise((res) => {
      const modal = $('#modal');
      const inputs = {};
      const rows = fields.map((f) => {
        const inp = f.options ? el('select', {}, f.options.map((o) => el('option', { value: o, selected: o === f.value }, o))) : el('input', { type: f.type || 'text', value: f.value ?? '', step: 'any' });
        inputs[f.k] = inp;
        return el('div', { class: 'row' }, el('label', {}, f.label), inp);
      });
      const done = (v) => { modal.hidden = true; modal.innerHTML = ''; document.removeEventListener('keydown', onKey, true); res(v); };
      const ok = () => { const v = {}; for (const k in inputs) v[k] = inputs[k].value; done(v); };
      const onKey = (e) => { e.stopPropagation(); if (e.key === 'Escape') done(null); else if (e.key === 'Enter') ok(); };
      const actions = el('div', { class: 'actions' }, el('button', { onclick: () => done(null) }, 'Cancel'));
      if (extra) actions.append(el('button', { onclick: () => done({ extra: true }) }, extra));
      actions.append(el('button', { class: 'primary', onclick: ok }, okLabel));
      modal.innerHTML = '';
      modal.append(el('div', { class: 'dlg' }, el('h2', {}, title), text ? el('p', {}, text) : null, rows, actions));
      modal.hidden = false;
      document.addEventListener('keydown', onKey, true);
      const first = Object.values(inputs)[0];
      if (first) { first.focus(); if (first.select) first.select(); }
    });
  }

  // ---------- view transforms ----------
  function toScreen(d, p) {
    const t = d.vp.transform, s = d.view.s;
    return { x: (t[0] * p.x + t[2] * p.y + t[4]) * s + d.view.ox, y: (t[1] * p.x + t[3] * p.y + t[5]) * s + d.view.oy };
  }
  function toPdf(d, sx, sy) {
    const t = d.vp.transform, s = d.view.s;
    const X = (sx - d.view.ox) / s - t[4], Y = (sy - d.view.oy) / s - t[5], det = t[0] * t[3] - t[1] * t[2];
    return { x: (t[3] * X - t[2] * Y) / det, y: (-t[1] * X + t[0] * Y) / det };
  }
  function matrix(d, dpr) {
    const t = d.vp.transform, s = d.view.s * dpr;
    return [t[0] * s, t[1] * s, t[2] * s, t[3] * s, t[4] * s + d.view.ox * dpr, t[5] * s + d.view.oy * dpr];
  }
  const envFor = (d, pi = d.pi) => ({ scale: MK.scaleFor(d, pi), measure, rot: d.vp ? d.vp.rotation : 0 });

  function fit(d = doc()) {
    if (!d || !d.vp) return;
    const W = stage.clientWidth, H = stage.clientHeight;
    const s = Math.min((W - 40) / d.vp.width, (H - 40) / d.vp.height);
    d.view = { s, ox: (W - d.vp.width * s) / 2, oy: (H - d.vp.height * s) / 2 };
    viewChanged();
  }
  function zoomAt(sx, sy, f) {
    const d = doc();
    if (!d || !d.vp) return;
    const s2 = Math.max(0.02, Math.min(64, d.view.s * f)), k = s2 / d.view.s;
    d.view.ox = sx - (sx - d.view.ox) * k;
    d.view.oy = sy - (sy - d.view.oy) * k;
    d.view.s = s2;
    viewChanged();
  }
  function viewChanged() { placeEditor(); draw(); scheduleHi(); renderStatus(); }

  // ---------- rendering ----------
  let rafPending = false;
  function draw() { if (!rafPending) { rafPending = true; requestAnimationFrame(() => { rafPending = false; drawBase(); drawOver(); }); } }
  function sizeCanvases() {
    const dpr = window.devicePixelRatio || 1, w = Math.round(stage.clientWidth * dpr), h = Math.round(stage.clientHeight * dpr);
    for (const c of [base, over]) if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  }
  function drawBase() {
    sizeCanvases();
    const d = doc(), dpr = window.devicePixelRatio || 1;
    bctx.setTransform(1, 0, 0, 1, 0, 0);
    bctx.fillStyle = '#4a4e55';
    bctx.fillRect(0, 0, base.width, base.height);
    if (!d || !d.vp) return;
    const { s, ox, oy } = d.view, x = ox * dpr, y = oy * dpr, pw = d.vp.width * s * dpr, ph = d.vp.height * s * dpr;
    bctx.fillStyle = 'rgba(0,0,0,.35)';
    bctx.fillRect(x + 3 * dpr, y + 3 * dpr, pw, ph);
    bctx.fillStyle = '#fff';
    bctx.fillRect(x, y, pw, ph);
    bctx.imageSmoothingQuality = 'high';
    const lo = d.lo.get(d.pi);
    if (lo) bctx.drawImage(lo.c, x, y, pw, ph);
    const hi = d.hi;
    if (hi && hi.pi === d.pi) { const k = (s * dpr) / hi.sc; bctx.drawImage(hi.c, x + hi.x0 * k, y + hi.y0 * k, hi.c.width * k, hi.c.height * k); }
  }
  async function renderLo(d) {
    const pi = d.pi, page = d.page;
    if (d.lo.has(pi) || !page) return;
    const sc = Math.min(2400 / Math.max(d.vp.width, d.vp.height), 3), vp = page.getViewport({ scale: sc });
    const c = el('canvas');
    c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
    try { await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise; } catch (e) { return; }
    d.lo.set(pi, { c, sc });
    if (d.lo.size > 4) d.lo.delete(d.lo.keys().next().value);
    draw();
  }
  let hiT, hiTask;
  function scheduleHi() { clearTimeout(hiT); hiT = setTimeout(renderHi, 140); }
  async function renderHi() {
    const d = doc();
    if (!d || !d.page) return;
    const dpr = window.devicePixelRatio || 1, sc = d.view.s * dpr, lo = d.lo.get(d.pi), pi = d.pi;
    if (lo && sc <= lo.sc * 1.02) { d.hi = null; return; }
    const W = stage.clientWidth * dpr, H = stage.clientHeight * dpr, mg = 0.35;
    const x0 = Math.max(0, Math.floor(-d.view.ox * dpr - W * mg)), y0 = Math.max(0, Math.floor(-d.view.oy * dpr - H * mg));
    const x1 = Math.min(d.vp.width * sc, -d.view.ox * dpr + W * (1 + mg)), y1 = Math.min(d.vp.height * sc, -d.view.oy * dpr + H * (1 + mg));
    if (x1 - x0 < 2 || y1 - y0 < 2) return;
    if (hiTask) { try { hiTask.cancel(); } catch (e) { /* already done */ } }
    const c = el('canvas');
    c.width = Math.ceil(x1 - x0); c.height = Math.ceil(y1 - y0);
    const task = (hiTask = d.page.render({ canvasContext: c.getContext('2d'), viewport: d.page.getViewport({ scale: sc }), transform: [1, 0, 0, 1, -x0, -y0] }));
    try { await task.promise; } catch (e) { return; }
    if (doc() !== d || d.pi !== pi) return;
    d.hi = { c, sc, x0, y0, pi };
    draw();
  }

  function drawOver() {
    const d = doc(), dpr = window.devicePixelRatio || 1;
    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.clearRect(0, 0, over.width, over.height);
    if (!d || !d.vp) return;
    const M = matrix(d, dpr), env = envFor(d);
    octx.save();
    octx.beginPath();
    octx.rect(d.view.ox * dpr, d.view.oy * dpr, d.vp.width * d.view.s * dpr, d.vp.height * d.view.s * dpr);
    octx.clip();
    if (d.search && d.search.hits.length) {
      octx.setTransform(M[0], M[1], M[2], M[3], M[4], M[5]);
      d.search.hits.forEach((h, i) => {
        if (h.page !== d.pi) return;
        octx.fillStyle = i === d.search.at ? 'rgba(255,120,0,.5)' : 'rgba(255,230,0,.4)';
        octx.beginPath();
        h.quad.forEach((p, j) => (j ? octx.lineTo(p.x, p.y) : octx.moveTo(p.x, p.y)));
        octx.fill();
      });
      octx.setTransform(1, 0, 0, 1, 0, 0);
    }
    for (const m of d.markups) if (m.page === d.pi && m !== S.editing) Shapes.paint(octx, Shapes.build(m, env), M);
    if (S.editing && S.editing.page === d.pi) Shapes.paint(octx, Shapes.build(Object.assign({}, S.editing, { text: '' }), env), M);
    octx.restore();
    // in-progress markup
    const dr = S.draft;
    if (dr) {
      let pm = dr;
      const mode = TYPES[dr.type].mode, h = S.hover;
      if (mode === 'multi' && h) pm = Object.assign({}, dr, { pts: S.drag && S.drag.rect ? rectFrom(dr.pts[0], h) : dr.pts.concat([h]) });
      else if (mode === 'callout' && h && dr.pts.length === 1) pm = Object.assign({}, BASE.line, { type: 'line', pts: [dr.pts[0], h], stroke: dr.stroke, w: dr.w });
      else if (mode === 'two' && !S.drag && h) pm = Object.assign({}, dr, { pts: [dr.pts[0], h] });
      if (pm.pts.length > 1 || mode === 'count') Shapes.paint(octx, Shapes.build(pm, env), M);
      octx.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (const p of dr.pts) { const q = toScreen(d, p); octx.fillStyle = '#fff'; octx.strokeStyle = '#f2a33a'; octx.lineWidth = 1.5; octx.beginPath(); octx.arc(q.x, q.y, 3, 0, 7); octx.fill(); octx.stroke(); }
    }
    // selection
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sel = selected(d).filter((m) => m.page === d.pi);
    for (const m of sel) {
      const bb = Shapes.itemsBBox(Shapes.build(m, env), measure);
      if (bb && (sel.length > 1 || TYPES[m.type].mode === 'free' || m.type === 'count')) {
        const c = [toScreen(d, { x: bb.x0, y: bb.y0 }), toScreen(d, { x: bb.x1, y: bb.y1 })];
        octx.setLineDash([4, 3]); octx.strokeStyle = '#f2a33a'; octx.lineWidth = 1;
        octx.strokeRect(Math.min(c[0].x, c[1].x), Math.min(c[0].y, c[1].y), Math.abs(c[1].x - c[0].x), Math.abs(c[1].y - c[0].y));
        octx.setLineDash([]);
      }
      if (sel.length === 1 && !S.editing) for (const h of handles(m)) {
        const q = toScreen(d, h), r = h.mid ? 2.5 : 4;
        octx.fillStyle = h.mid ? '#f2a33a' : '#fff'; octx.strokeStyle = '#b36b00'; octx.lineWidth = 1.2;
        octx.beginPath(); octx.rect(q.x - r, q.y - r, r * 2, r * 2); octx.fill(); octx.stroke();
      }
    }
    if (S.drag && S.drag.k === 'marquee') {
      const a = S.drag.a, b = S.drag.b;
      octx.fillStyle = 'rgba(242,163,58,.12)'; octx.strokeStyle = '#f2a33a'; octx.lineWidth = 1;
      octx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y); octx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    }
    if (S.snapMark) { const q = toScreen(d, S.snapMark); octx.strokeStyle = '#00d084'; octx.lineWidth = 2; octx.strokeRect(q.x - 5, q.y - 5, 10, 10); }
  }

  // ---------- documents ----------
  async function openBytes(name, path, bytes) {
    busy('Opening ' + name + '…');
    try {
      let imp;
      try { imp = await IO.importPdf(bytes); }
      catch (e) { imp = { bytes, markups: [], scales: { all: null, pages: {} }, locked: true }; }
      const pdf = await pdfjsLib.getDocument({ data: imp.bytes.slice(), cMapUrl: 'vendor/cmaps/', cMapPacked: true, standardFontDataUrl: 'vendor/standard_fonts/' }).promise;
      const d = { id: MK.uid(), name, path, bytes: imp.bytes, pdf, n: pdf.numPages, pi: 0, page: null, vp: null, view: { s: 1, ox: 0, oy: 0 }, markups: imp.markups, scales: imp.scales,
        undo: [], redo: [], dirty: false, sel: new Set(), lo: new Map(), hi: null, search: null, locked: !!imp.locked, fitted: false };
      S.docs.push(d);
      await switchDoc(S.docs.length - 1);
      if (d.locked) toast('This PDF is protected or damaged: markups can be drawn but not saved.');
      else if (imp.markups.length) toast(`${imp.markups.length} existing markup${imp.markups.length > 1 ? 's' : ''} loaded for editing`);
    } catch (e) {
      console.error(e);
      toast(e && e.name === 'PasswordException' ? 'Password-protected PDFs are not supported.' : 'Could not open ' + name);
    }
    busy(null);
  }
  async function switchDoc(i) {
    commitEdit();
    cancelDraft();
    S.cur = i;
    const d = doc();
    $('#welcome').hidden = !!d;
    renderTabs();
    buildThumbs();
    if (d) await gotoPage(d.pi);
    else { draw(); refresh(); }
  }
  async function closeDoc(i) {
    const d = S.docs[i];
    if (d.dirty) {
      const r = await dialog('Unsaved changes', `Save changes to “${d.name}” before closing?`, [], 'Save', 'Discard');
      if (!r) return;
      if (!r.extra) { S.cur = i; if (!(await save(false))) return; }
    }
    try { d.pdf.destroy(); } catch (e) { /* ignore */ }
    S.docs.splice(i, 1);
    await switchDoc(S.cur > i ? S.cur - 1 : Math.min(S.cur, S.docs.length - 1));
  }
  let pageTok = 0;
  async function gotoPage(i) {
    const d = doc();
    if (!d) return;
    commitEdit();
    cancelDraft();
    i = Math.max(0, Math.min(d.n - 1, i));
    const tok = ++pageTok;
    const page = await d.pdf.getPage(i + 1);
    if (tok !== pageTok || doc() !== d) return;
    const old = d.vp;
    d.pi = i; d.page = page; d.vp = page.getViewport({ scale: 1 }); d.hi = null;
    if (!d.fitted || !old || Math.abs(old.width - d.vp.width) > 1 || Math.abs(old.height - d.vp.height) > 1) { d.fitted = true; fit(d); }
    renderLo(d);
    scheduleHi();
    refresh();
    document.querySelectorAll('.thumb').forEach((t, k) => t.classList.toggle('on', k === i));
    const on = $('.thumb.on');
    if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
  }
  async function reloadPdf(d) {
    try { d.pdf.destroy(); } catch (e) { /* ignore */ }
    d.pdf = await pdfjsLib.getDocument({ data: d.bytes.slice(), cMapUrl: 'vendor/cmaps/', cMapPacked: true, standardFontDataUrl: 'vendor/standard_fonts/' }).promise;
    d.n = d.pdf.numPages; d.lo.clear(); d.hi = null; d.search = null; d.undo = []; d.redo = []; d.dirty = true; d.fitted = false;
    d.pi = Math.min(d.pi, d.n - 1);
    buildThumbs();
    await gotoPage(d.pi);
  }

  // thumbnails
  let thumbObs;
  function buildThumbs() {
    const box = $('#thumbs'), d = doc();
    box.innerHTML = '';
    if (thumbObs) thumbObs.disconnect();
    if (!d) return;
    const queue = [];
    let running = false;
    const pump = async () => {
      if (running) return;
      running = true;
      while (queue.length) {
        const { i, holder } = queue.shift();
        if (doc() !== d) break;
        try {
          const page = await d.pdf.getPage(i + 1), v1 = page.getViewport({ scale: 1 }), vp = page.getViewport({ scale: (140 * Math.min(2, window.devicePixelRatio || 1)) / v1.width });
          const c = el('canvas');
          c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
          await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
          holder.querySelector('.ph').replaceWith(c);
        } catch (e) { /* skip */ }
      }
      running = false;
    };
    thumbObs = new IntersectionObserver((ents) => {
      for (const e of ents) if (e.isIntersecting) { thumbObs.unobserve(e.target); queue.push({ i: +e.target.dataset.i, holder: e.target }); }
      pump();
    }, { root: box, rootMargin: '300px' });
    for (let i = 0; i < d.n; i++) {
      const t = el('div', { class: 'thumb' + (i === d.pi ? ' on' : ''), 'data-i': i, onclick: () => gotoPage(i) }, el('div', { class: 'ph', style: 'height:100px' }), el('div', {}, String(i + 1)));
      box.append(t);
      thumbObs.observe(t);
    }
  }

  // ---------- mutations / undo ----------
  const snapshot = (d) => JSON.stringify({ m: d.markups, s: d.scales });
  function pushUndo(d = doc()) { d.undo.push(snapshot(d)); if (d.undo.length > 150) d.undo.shift(); d.redo = []; d.dirty = true; }
  function restore(d, snap) { const o = JSON.parse(snap); d.markups = o.m; d.scales = o.s; const ids = new Set(d.markups.map((m) => m.id)); d.sel = new Set([...d.sel].filter((id) => ids.has(id))); }
  function undo() { const d = doc(); if (!d || !d.undo.length) return; commitEdit(); cancelDraft(); d.redo.push(snapshot(d)); restore(d, d.undo.pop()); d.dirty = true; refresh(); }
  function redo() { const d = doc(); if (!d || !d.redo.length) return; d.undo.push(snapshot(d)); restore(d, d.redo.pop()); d.dirty = true; refresh(); }
  const selected = (d) => (d ? d.markups.filter((m) => d.sel.has(m.id)) : []);
  let propSig = '';
  function refresh() { draw(); renderList(); renderProps(); renderScale(); renderTabs(); renderStatus(); }

  /** Look of the next markup for a tool. Text and markers start larger on big sheets so they stay readable. */
  function toolLook(type) {
    const d = doc(), b = clone(BASE[type]);
    if (d && d.vp) {
      const big = Math.max(d.vp.width, d.vp.height);
      if (b.fs) b.fs = Math.max(b.fs, Math.round(big / (TYPES[type].measure ? 130 : 110)));
      if (b.size) b.size = Math.max(b.size, Math.round(big / 220));
      if (big > 1500 && b.w) b.w = b.w * 1.5;
    }
    return Object.assign(b, S.toolProps ? {} : S.defaults[type], S.toolProps ? {} : S.session[type], S.toolProps, S.tool === 'cloud' ? { cloud: true } : null);
  }
  function newMarkup(type) {
    const d = doc();
    return Object.assign({}, toolLook(type), { id: MK.uid(), type, page: d.pi, pts: [], author: load('mk.author', 'Markline'), date: Date.now() });
  }
  function deleteSel() {
    const d = doc();
    if (!d || !d.sel.size) return;
    pushUndo(d);
    d.markups = d.markups.filter((m) => !d.sel.has(m.id));
    d.sel.clear();
    refresh();
  }
  function copySel() { const d = doc(); if (d && d.sel.size) S.clip = clone(selected(d)); }
  function paste() {
    const d = doc();
    if (!d || !S.clip.length) return;
    pushUndo(d);
    d.sel.clear();
    for (const src of S.clip) {
      const m = clone(src);
      m.id = MK.uid();
      if (m.page === d.pi) m.pts.forEach((p) => { p.x += 14; p.y -= 14; });
      m.page = d.pi;
      d.markups.push(m);
      d.sel.add(m.id);
    }
    S.clip = clone(selected(d));
    setTool('select');
    refresh();
  }

  // ---------- handles & hit testing ----------
  const rectFrom = (a, b) => [{ x: a.x, y: a.y }, { x: b.x, y: a.y }, { x: b.x, y: b.y }, { x: a.x, y: b.y }];
  const boxH = (pts, b) => [0, 1, 2, 3].map((k) => ({ x: pts[b + (k & 1)].x, y: pts[b + (k >> 1)].y, box: b, k }));
  function handles(m) {
    const mode = TYPES[m.type].mode;
    if (mode === 'box') return boxH(m.pts, 0);
    if (mode === 'callout') return [{ x: m.pts[0].x, y: m.pts[0].y, i: 0 }].concat(boxH(m.pts, 1));
    if (mode === 'free') return [];
    const hs = m.pts.map((p, i) => ({ x: p.x, y: p.y, i }));
    if (mode === 'multi') {
      const n = m.pts.length, lim = TYPES[m.type].closed ? n : n - 1;
      for (let i = 0; i < lim; i++) { const a = m.pts[i], b = m.pts[(i + 1) % n]; hs.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, mid: true, after: i }); }
    }
    return hs;
  }
  function applyHandle(m, h, p) {
    if (h.box != null) { m.pts[h.box + (h.k & 1)].x = p.x; m.pts[h.box + (h.k >> 1)].y = p.y; }
    else if (h.mid) { m.pts.splice(h.after + 1, 0, { x: p.x, y: p.y }); h.mid = false; h.i = h.after + 1; }
    else m.pts[h.i] = { x: p.x, y: p.y };
  }
  function hit(m, p, tol) {
    const P = m.pts, w = (m.w || 0) / 2 + tol, mode = TYPES[m.type].mode;
    const near = (pts, closed) => {
      for (let i = 1; i < pts.length; i++) if (G.segDist(p, pts[i - 1], pts[i]) <= w) return true;
      return !!closed && pts.length > 2 && G.segDist(p, pts[pts.length - 1], pts[0]) <= w;
    };
    if (m.type === 'count') return P.some((q) => G.dist(p, q) <= (m.size || 6) + tol);
    if (mode === 'box' || mode === 'callout') {
      const b = mode === 'box' ? 0 : 1, bb = G.bbox([P[b], P[b + 1]]);
      if (mode === 'callout' && G.segDist(p, P[0], { x: (bb.x0 + bb.x1) / 2, y: (bb.y0 + bb.y1) / 2 }) <= w) return true;
      if (m.type === 'ellipse') { const e = G.ellipsePts(bb); return near(e, true) || (!!m.fill && G.pointInPoly(p, e)); }
      if (m.type === 'rect' && !m.fill) return near(rectFrom({ x: bb.x0, y: bb.y0 }, { x: bb.x1, y: bb.y1 }), true);
      return p.x >= bb.x0 - tol && p.x <= bb.x1 + tol && p.y >= bb.y0 - tol && p.y <= bb.y1 + tol;
    }
    if (mode === 'multi' && TYPES[m.type].closed) return near(P, true) || (!!m.fill && G.pointInPoly(p, P));
    return near(P, false);
  }
  function hitTest(d, p) {
    const tol = 5 / d.view.s;
    for (let i = d.markups.length - 1; i >= 0; i--) { const m = d.markups[i]; if (m.page === d.pi && hit(m, p, tol)) return m; }
    return null;
  }

  // ---------- tools ----------
  function setTool(t, props) {
    commitEdit();
    cancelDraft();
    S.tool = t;
    S.toolProps = props ? clone(props) : null;
    const d = doc();
    if (d && t !== 'select' && t !== 'pan') d.sel.clear();
    document.querySelectorAll('.tb[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
    over.style.cursor = t === 'pan' ? 'grab' : t === 'select' ? 'default' : 'crosshair';
    refresh();
  }
  function cancelDraft() { if (S.draft || S.drag) { S.draft = null; S.drag = null; S.hover = null; S.snapMark = null; draw(); } }
  function evPos(e) { const r = over.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function snapPoint(d, pos, e, from, skip) {
    let p = toPdf(d, pos.x, pos.y);
    S.snapMark = null;
    if (e.shiftKey && from) {
      const dx = p.x - from.x, dy = p.y - from.y, ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4), L = Math.hypot(dx, dy);
      return { x: from.x + Math.cos(ang) * L, y: from.y + Math.sin(ang) * L };
    }
    if (!S.snap) return p;
    const tol = 8 / d.view.s;
    let best = tol;
    const tryPt = (q) => { const l = G.dist(p, q); if (l < best) { best = l; S.snapMark = { x: q.x, y: q.y }; } };
    for (const m of d.markups) if (m.page === d.pi && TYPES[m.type].mode !== 'free' && !(skip && skip.has(m.id))) m.pts.forEach(tryPt);
    if (S.draft && S.draft.pts.length > 2) tryPt(S.draft.pts[0]);
    return S.snapMark ? { x: S.snapMark.x, y: S.snapMark.y } : p;
  }

  function fromPt(dr) {
    if (!dr) return null;
    const mode = TYPES[dr.type].mode;
    return mode === 'two' ? dr.pts[0] : mode === 'multi' ? dr.pts[dr.pts.length - 1] : null;
  }
  async function finishDraft() {
    const d = doc(), m = S.draft;
    S.draft = null; S.drag = null; S.hover = null; S.snapMark = null;
    if (!m || !d) return draw();
    const T = TYPES[m.type];
    if (T.mode === 'multi') {
      m.pts = m.pts.filter((p, i) => !i || G.dist(p, m.pts[i - 1]) > 0.01);
      if (m.pts.length < (T.closed ? 3 : 2)) return draw();
    }
    if (T.mode === 'two' && G.dist(m.pts[0], m.pts[1]) < 0.5) return draw();
    if (S.tool === 'calibrate') return calibrate(d, m.pts);
    pushUndo(d);
    d.markups.push(m);
    const repeat = S.lock || T.measure;
    if (m.type === 'text' || m.type === 'callout') { d.sel = new Set([m.id]); S.tool = 'select'; setTool('select'); startEdit(m, true); return; }
    if (!repeat) { d.sel = new Set([m.id]); setTool('select'); } else refresh();
  }
  async function calibrate(d, pts) {
    const L = G.dist(pts[0], pts[1]);
    draw();
    if (L < 0.5) return;
    const cur = MK.scaleFor(d, d.pi);
    const r = await dialog('Calibrate scale', 'Enter the real-world distance between the two points you picked.', [
      { k: 'dist', label: 'Distance', type: 'number', value: '' }, { k: 'unit', label: 'Unit', options: ['ft', 'in', 'yd', 'm', 'cm', 'mm'], value: cur.unset ? 'ft' : cur.unit },
      { k: 'scope', label: 'Apply to', options: ['All pages', 'This page only'], value: S.applyAll ? 'All pages' : 'This page only' }]);
    if (!r || !(+r.dist > 0)) return;
    S.applyAll = r.scope === 'All pages';
    const per = (+r.dist / (L / 72));
    setScale({ label: `Calibrated: 1 in = ${Units.fmtNum(per, 3)} ${r.unit}`, paper: L / 72, real: +r.dist, unit: r.unit, prec: 2, arch: false });
    setTool('select');
    toast('Scale calibrated');
  }
  function setScale(sc) {
    const d = doc();
    if (!d) return;
    pushUndo(d);
    if (S.applyAll) d.scales = { all: sc, pages: {} };
    else d.scales.pages[d.pi] = sc;
    refresh();
  }

  over.addEventListener('pointerdown', (e) => {
    const d = doc();
    if (!d || !d.vp) return;
    if (S.editing) { commitEdit(); return; }
    over.setPointerCapture(e.pointerId);
    const pos = evPos(e);
    if (e.button === 1 || e.button === 2 || S.space || S.tool === 'pan') {
      S.drag = { k: 'pan', sx: pos.x, sy: pos.y, ox: d.view.ox, oy: d.view.oy, prev: S.drag };
      over.style.cursor = 'grabbing';
      return;
    }
    if (e.button !== 0) return;
    const mode = toolMode(S.tool);
    if (mode === 'select') {
      const raw = toPdf(d, pos.x, pos.y), sel = selected(d);
      if (sel.length === 1 && sel[0].page === d.pi) {
        for (const h of handles(sel[0])) {
          const q = toScreen(d, h);
          if (Math.abs(q.x - pos.x) <= 6 && Math.abs(q.y - pos.y) <= 6) {
            if (e.altKey && h.i != null && TYPES[sel[0].type].mode === 'multi' && sel[0].pts.length > (TYPES[sel[0].type].closed ? 3 : 2)) { pushUndo(d); sel[0].pts.splice(h.i, 1); refresh(); return; }
            S.drag = { k: 'handle', m: sel[0], h: Object.assign({}, h), moved: false };
            return;
          }
        }
      }
      const m = hitTest(d, raw);
      if (m) {
        if (e.shiftKey || e.metaKey) { d.sel.has(m.id) ? d.sel.delete(m.id) : d.sel.add(m.id); }
        else if (!d.sel.has(m.id)) d.sel = new Set([m.id]);
        S.drag = { k: 'move', start: raw, orig: selected(d).map((x) => ({ m: x, pts: clone(x.pts) })), moved: false };
      } else {
        if (!e.shiftKey) d.sel.clear();
        S.drag = { k: 'marquee', a: pos, b: pos };
      }
      refresh();
      return;
    }
    const type = toolType(S.tool), dr = S.draft;
    const p = snapPoint(d, pos, e, fromPt(dr));
    if (mode === 'box') { S.draft = newMarkup(type); S.draft.pts = [p, { x: p.x, y: p.y }]; S.drag = { k: 'box', start: pos }; }
    else if (mode === 'two') {
      if (dr) { dr.pts[1] = p; finishDraft(); return; }
      S.draft = newMarkup(type); S.draft.pts = [p, { x: p.x, y: p.y }]; S.drag = { k: 'two', start: pos };
    } else if (mode === 'multi') {
      if (!dr) { S.draft = newMarkup(type); S.draft.pts = [p]; S.drag = { k: 'rectdrag', start: pos, rect: false }; }
      else if (dr.pts.length > 2 && TYPES[type].closed && G.dist(p, dr.pts[0]) < 0.01) { finishDraft(); return; }
      else dr.pts.push(p);
    } else if (mode === 'free') { S.draft = newMarkup(type); S.draft.pts = [toPdf(d, pos.x, pos.y)]; S.drag = { k: 'free', last: pos }; }
    else if (mode === 'count') { if (!dr) S.draft = newMarkup(type); S.draft.pts.push(p); }
    else if (mode === 'callout') {
      if (!dr) { S.draft = newMarkup(type); S.draft.pts = [p]; }
      else {
        const fs = dr.fs || 12, R = d.vp.rotation, sz = G.rot({ x: fs * 11, y: -fs * 2.6 }, R);
        dr.pts = [dr.pts[0], p, { x: p.x + sz.x, y: p.y + sz.y }];
        finishDraft();
        return;
      }
    }
    S.hover = p;
    draw();
  });

  over.addEventListener('pointermove', (e) => {
    const d = doc();
    if (!d || !d.vp) return;
    const pos = evPos(e), g = S.drag;
    S.lastPos = pos;
    if (g && g.k === 'pan') { d.view.ox = g.ox + pos.x - g.sx; d.view.oy = g.oy + pos.y - g.sy; viewChanged(); return; }
    if (g && g.k === 'move') {
      const raw = toPdf(d, pos.x, pos.y), dx = raw.x - g.start.x, dy = raw.y - g.start.y;
      if (!g.moved && Math.hypot(dx, dy) * d.view.s < 3) return;
      if (!g.moved) { g.moved = true; pushUndo(d); }
      for (const o of g.orig) o.m.pts = o.pts.map((p) => ({ x: p.x + dx, y: p.y + dy }));
      draw(); renderReadout();
      return;
    }
    if (g && g.k === 'handle') {
      if (!g.moved) { g.moved = true; pushUndo(d); }
      const anchor = g.h.i != null && TYPES[g.m.type].mode !== 'callout' ? g.m.pts[(g.h.i || g.m.pts.length) - 1] : null;
      applyHandle(g.m, g.h, snapPoint(d, pos, e, anchor, new Set([g.m.id])));
      draw(); renderReadout();
      return;
    }
    if (g && g.k === 'marquee') { g.b = pos; draw(); return; }
    const dr = S.draft;
    if (!dr) { if (S.tool !== 'select' && S.tool !== 'pan') { S.hover = snapPoint(d, pos, e, null); draw(); } return; }
    const p = snapPoint(d, pos, e, fromPt(dr));
    S.hover = p;
    if (g && (g.k === 'box' || g.k === 'two')) dr.pts[1] = p;
    else if (g && g.k === 'rectdrag') g.rect = Math.hypot(pos.x - g.start.x, pos.y - g.start.y) > 6;
    else if (g && g.k === 'free') { if (Math.hypot(pos.x - g.last.x, pos.y - g.last.y) > 1.5) { dr.pts.push(toPdf(d, pos.x, pos.y)); g.last = pos; } }
    draw();
  });

  over.addEventListener('pointerup', (e) => {
    const d = doc(), g = S.drag;
    if (!d || !g) return;
    const pos = evPos(e);
    S.drag = null;
    if (g.k === 'pan') { over.style.cursor = S.tool === 'pan' || S.space ? 'grab' : S.tool === 'select' ? 'default' : 'crosshair'; return; }
    if (g.k === 'move' || g.k === 'handle') { S.snapMark = null; refresh(); return; }
    if (g.k === 'marquee') {
      const a = toPdf(d, g.a.x, g.a.y), b = toPdf(d, g.b.x, g.b.y), bb = G.bbox([a, b]);
      if (Math.hypot(g.b.x - g.a.x, g.b.y - g.a.y) > 4)
        for (const m of d.markups) if (m.page === d.pi) { const mb = G.bbox(m.pts); if (mb.x0 >= bb.x0 && mb.x1 <= bb.x1 && mb.y0 >= bb.y0 && mb.y1 <= bb.y1) d.sel.add(m.id); }
      refresh();
      return;
    }
    const dr = S.draft;
    if (!dr) return;
    const moved = Math.hypot(pos.x - g.start?.x, pos.y - g.start?.y) > 4;
    if (g.k === 'box') {
      if (!moved) {
        if (dr.type !== 'text') return cancelDraft();
        const fs = dr.fs || 12, sz = G.rot({ x: fs * 12, y: -fs * 2.6 }, d.vp.rotation);
        dr.pts[1] = { x: dr.pts[0].x + sz.x, y: dr.pts[0].y + sz.y };
      }
      finishDraft();
    } else if (g.k === 'two') { if (moved) finishDraft(); else draw(); }
    else if (g.k === 'rectdrag') { if (g.rect) { dr.pts = rectFrom(dr.pts[0], S.hover); finishDraft(); } else draw(); }
    else if (g.k === 'free') { if (dr.pts.length > 1) finishDraft(); else cancelDraft(); }
  });
  over.addEventListener('dblclick', (e) => {
    const d = doc();
    if (!d || !d.vp) return;
    if (S.draft && (TYPES[S.draft.type].mode === 'multi' || S.draft.type === 'count')) {
      if (S.draft.type === 'count' && S.draft.pts.length > 1) S.draft.pts.pop();
      finishDraft();
      return;
    }
    if (S.tool === 'select') { const pos = evPos(e), m = hitTest(d, toPdf(d, pos.x, pos.y)); if (m && (m.type === 'text' || m.type === 'callout')) startEdit(m, false); }
  });
  over.addEventListener('contextmenu', (e) => e.preventDefault());
  over.addEventListener('wheel', (e) => {
    e.preventDefault();
    const d = doc();
    if (!d) return;
    const pos = evPos(e);
    const mouse = e.deltaMode !== 0 || (e.deltaX === 0 && Math.abs(e.wheelDeltaY || 0) >= 120 && (e.wheelDeltaY || 0) % 120 === 0);
    if (e.ctrlKey || e.metaKey) zoomAt(pos.x, pos.y, Math.exp(-e.deltaY * 0.012));
    else if (mouse) zoomAt(pos.x, pos.y, Math.exp(-Math.sign(e.deltaY) * 0.22));
    else { d.view.ox -= e.deltaX; d.view.oy -= e.deltaY; viewChanged(); }
  }, { passive: false });
  let gestS = 1;
  over.addEventListener('gesturestart', (e) => { e.preventDefault(); gestS = 1; });
  over.addEventListener('gesturechange', (e) => { e.preventDefault(); const p = S.lastPos || { x: stage.clientWidth / 2, y: stage.clientHeight / 2 }; zoomAt(p.x, p.y, e.scale / gestS); gestS = e.scale; });
  over.addEventListener('gestureend', (e) => e.preventDefault());

  // ---------- text editing ----------
  function startEdit(m, isNew) {
    S.editing = m; S.editNew = isNew;
    editor.value = m.text || '';
    editor.hidden = false;
    placeEditor();
    draw();
    setTimeout(() => { editor.focus(); if (isNew) editor.select(); else editor.setSelectionRange(editor.value.length, editor.value.length); }, 0);
  }
  function placeEditor() {
    const d = doc(), m = S.editing;
    if (!d || !m) return;
    const b = m.type === 'callout' ? 1 : 0, a = toScreen(d, m.pts[b]), c = toScreen(d, m.pts[b + 1]);
    const fs = (m.fs || 12) * d.view.s, pad = (3 + (m.w || 0) / 2) * d.view.s;
    Object.assign(editor.style, { left: Math.min(a.x, c.x) + 'px', top: Math.min(a.y, c.y) + 'px', width: Math.max(30, Math.abs(c.x - a.x)) + 'px', height: Math.max(fs * 1.5, Math.abs(c.y - a.y)) + 'px',
      fontSize: fs + 'px', color: m.tc || m.stroke, padding: `${pad}px` });
  }
  function commitEdit() {
    const m = S.editing, d = doc();
    if (!m) return;
    S.editing = null;
    editor.hidden = true;
    const val = editor.value;
    if (d && d.markups.includes(m)) {
      if (!val.trim() && S.editNew) { d.markups = d.markups.filter((x) => x !== m); d.sel.delete(m.id); d.undo.pop(); }
      else if (val !== (m.text || '')) {
        if (!S.editNew) pushUndo(d);
        m.text = val;
        if (d.vp.rotation === 0) { // grow the box downward to fit
          const b = m.type === 'callout' ? 1 : 0, bb = G.bbox([m.pts[b], m.pts[b + 1]]), fs = m.fs || 12, pad = 3 + (m.w || 0) / 2;
          const need = Shapes.wrap(val, fs, Math.max(4, bb.x1 - bb.x0 - pad * 2), measure).length * fs * 1.2 + pad * 2 + fs * 0.15;
          if (bb.y1 - bb.y0 < need) { m.pts[b] = { x: bb.x0, y: bb.y1 - need }; m.pts[b + 1] = { x: bb.x1, y: bb.y1 }; }
        }
        d.dirty = true;
      }
    }
    refresh();
  }
  editor.addEventListener('blur', () => setTimeout(commitEdit, 0));
  editor.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') commitEdit(); });

  // ---------- toolbar / tabs / status ----------
  function buildBar() {
    const bar = $('#bar');
    const tb = (icon, title, fn, attrs) => el('button', Object.assign({ class: 'tb', title, html: svg(icon), onclick: fn }, attrs));
    const grp = (cap, btns) => el('div', { class: 'grp' }, el('div', { class: 'btns' }, btns), el('div', { class: 'cap' }, cap));
    bar.append(grp('File', [tb('open', 'Open PDF (⌘O)', () => cmd('open')), tb('save', 'Save (⌘S)', () => cmd('save')), tb('csv', 'Export markups to CSV', () => cmd('csv'))]));
    bar.append(grp('Edit', [tb('undo', 'Undo (⌘Z)', () => cmd('undo')), tb('redo', 'Redo (⇧⌘Z)', () => cmd('redo'))]));
    for (const [cap, ts] of TOOLS) bar.append(grp(cap, ts.map(([id, name, key]) => tb(id, `${name} (${key})`, () => setTool(id), { 'data-tool': id }))));
    const inp = el('input', { type: 'search', placeholder: 'Search text…', id: 'q' });
    inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') runSearch(inp.value, e.shiftKey ? -1 : 1); if (e.key === 'Escape') { inp.value = ''; runSearch('', 1); inp.blur(); } });
    bar.append(el('div', { id: 'search' }, inp, el('span', { class: 'cnt', id: 'qcnt' }), tb('prev', 'Previous match', () => runSearch(inp.value, -1)), tb('next', 'Next match', () => runSearch(inp.value, 1))));
    const pb = $('#pagebar');
    pb.append(tb('rotate', 'Rotate page 90°', () => pageOp('rotate')), tb('plus', 'Insert pages from another PDF after this page', () => pageOp('insert')), tb('trash', 'Delete this page', () => pageOp('delete')));
    document.querySelectorAll('.ptabs button').forEach((b) => b.addEventListener('click', () => {
      document.querySelectorAll('.ptabs button').forEach((x) => x.classList.toggle('on', x === b));
      $('#pagesPane').hidden = b.dataset.p !== 'pages';
      $('#chestPane').hidden = b.dataset.p !== 'chest';
    }));
    $('#wopen').addEventListener('click', () => cmd('open'));
  }
  function renderTabs() {
    const t = $('#tabs');
    t.innerHTML = '';
    S.docs.forEach((d, i) => t.append(el('div', { class: 'dtab' + (i === S.cur ? ' on' : ''), onclick: () => { if (i !== S.cur) switchDoc(i); } },
      d.dirty ? el('span', { class: 'dot' }, '●') : null, el('span', {}, d.name), el('span', { class: 'x', title: 'Close', onclick: (e) => { e.stopPropagation(); closeDoc(i); } }, '×'))));
    const d = doc();
    document.title = d ? `${d.name}${d.dirty ? ' — Edited' : ''}` : 'Markline';
    if (native) native.postMessage({ cmd: 'title', title: document.title, dirty: S.docs.some((x) => x.dirty) });
  }
  const HINTS = {
    select: 'Click to select · drag to move · drag handles to reshape · ⌥-click a vertex to remove it · double-click text to edit',
    pan: 'Drag to pan · scroll or pinch to zoom', box: 'Drag to draw', two: 'Drag, or click start and end points · hold ⇧ to constrain',
    multi: 'Click each corner, double-click or Enter to finish · or drag for a rectangle · ⌫ removes last point', free: 'Drag to draw freehand',
    count: 'Click each item to count · Enter or double-click to finish', callout: 'Click the point to call out, then click where the text goes',
  };
  function renderStatus() {
    const st = $('#status'), d = doc();
    st.innerHTML = '';
    st.append(el('div', { class: 'hintx' }, S.tool === 'calibrate' ? 'Click two points a known distance apart' : HINTS[toolMode(S.tool)] || ''));
    if (!d || !d.vp) return;
    const pg = el('input', { type: 'text', value: d.pi + 1 });
    pg.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { gotoPage((parseInt(pg.value, 10) || 1) - 1); pg.blur(); } });
    const sc = MK.scaleFor(d, d.pi);
    st.append(
      el('div', { class: 'seg' }, `${Units.fmtNum(d.vp.width / 72, 1)} × ${Units.fmtNum(d.vp.height / 72, 1)} in`),
      el('div', { class: 'seg' }, 'Scale: ' + (sc.unset ? 'not set' : sc.label)),
      el('div', { class: 'seg' }, el('button', { class: S.snap ? 'on' : '', title: 'Snap to markup points', onclick: () => { S.snap = !S.snap; store('mk.snap', S.snap); renderStatus(); } }, 'Snap'),
        el('button', { class: S.lock ? 'on' : '', title: 'Keep the current tool active after drawing', onclick: () => { S.lock = !S.lock; renderStatus(); } }, 'Reuse tool')),
      el('div', { class: 'seg' }, el('button', { title: 'Previous page', onclick: () => gotoPage(d.pi - 1) }, '‹'), pg, `/ ${d.n}`, el('button', { title: 'Next page', onclick: () => gotoPage(d.pi + 1) }, '›')),
      el('div', { class: 'seg' }, el('button', { title: 'Zoom out', onclick: () => zoomAt(stage.clientWidth / 2, stage.clientHeight / 2, 1 / 1.25) }, '−'), `${Math.round(d.view.s * 75)}%`,
        el('button', { title: 'Zoom in', onclick: () => zoomAt(stage.clientWidth / 2, stage.clientHeight / 2, 1.25) }, '+'), el('button', { title: 'Fit page (⌘0)', onclick: () => fit() }, 'Fit')));
  }

  // ---------- properties panel ----------
  const PALETTE = ['#d92b2b', '#f28c1c', '#ffe600', '#1d9a4a', '#18a8a8', '#1668d6', '#7a3fc4', '#d63fa3', '#000000', '#6b7280', '#ffffff'];
  const HAS_FILL = new Set(['text', 'callout', 'rect', 'ellipse', 'polygon', 'highlight', 'area', 'perimeter', 'volume']);
  const HAS_TEXT = new Set(['text', 'callout', 'length', 'polylength', 'area', 'perimeter', 'volume']);
  const SESSION_KEYS = new Set(['subject', 'label', 'comment']);
  let propSnap = false;
  function propTarget() {
    const d = doc(), sel = selected(d);
    if (sel.length) return { kind: 'sel', items: sel, type: sel[0].type, v: sel[0] };
    const type = toolType(S.tool);
    if (!type || S.tool === 'calibrate') return null;
    return { kind: 'tool', type, v: toolLook(type) };
  }
  function setProp(key, val, final) {
    const t = propTarget(), d = doc();
    if (!t) return;
    if (t.kind === 'sel') {
      if (!propSnap) { pushUndo(d); propSnap = true; }
      for (const m of t.items) m[key] = val;
      if (final) propSnap = false;
      draw(); renderList(); renderReadout(); renderTabs();
    } else if (S.toolProps) S.toolProps[key] = val;
    else if (SESSION_KEYS.has(key)) (S.session[t.type] = S.session[t.type] || {})[key] = val;
    else { (S.defaults[t.type] = S.defaults[t.type] || {})[key] = val; store('mk.defaults', S.defaults); }
  }
  function renderProps(force) {
    const box = $('#props'), t = propTarget(), d = doc();
    const sig = t ? `${S.cur}|${t.kind}|${t.kind === 'sel' ? t.items.map((m) => m.id).join(',') : S.tool + (S.toolProps ? '*' : '')}|${d ? d.undo.length + ':' + d.redo.length : ''}` : 'none';
    if (!force && sig === propSig && box.contains(document.activeElement)) return renderReadout();
    propSig = sig;
    box.innerHTML = '';
    if (!t) { box.append(el('div', { class: 'sect' }, el('h3', {}, 'Properties'), el('div', { class: 'hint' }, d ? 'Select a markup, or pick a tool to set how the next markup will look.' : 'Open a PDF to begin.'))); return; }
    const v = t.v, type = t.type, multi = t.kind === 'sel' && t.items.some((m) => m.type !== type);
    const head = t.kind === 'sel' ? (t.items.length > 1 ? `${t.items.length} markups selected` : TYPES[type].name) : `${S.tool === 'cloud' ? 'Cloud' : TYPES[type].name} tool — next markup`;
    const sect = el('div', { class: 'sect' }, el('h3', {}, 'Properties', el('b', {}, head)));
    const row = (label, ...c) => el('div', { class: 'row' }, el('label', {}, label), ...c);
    const textIn = (key, label, area) => {
      const i = area ? el('textarea', {}) : el('input', { type: 'text' });
      i.value = v[key] || '';
      i.addEventListener('input', () => setProp(key, i.value, false));
      i.addEventListener('change', () => setProp(key, i.value, true));
      i.addEventListener('keydown', (e) => e.stopPropagation());
      return row(label, i);
    };
    const numIn = (key, label, min, max, step, def) => {
      const i = el('input', { type: 'number', min, max, step, value: v[key] ?? def });
      const f = (fin) => () => { const n = parseFloat(i.value); if (!isNaN(n)) setProp(key, Math.max(min, Math.min(max, n)), fin); };
      i.addEventListener('input', f(false)); i.addEventListener('change', f(true));
      i.addEventListener('keydown', (e) => e.stopPropagation());
      return row(label, i);
    };
    const slider = (key, label, def) => {
      const i = el('input', { type: 'range', min: 5, max: 100, value: Math.round((v[key] ?? def) * 100) }), o = el('span', { class: 'val' }, i.value + '%');
      i.addEventListener('input', () => { o.textContent = i.value + '%'; setProp(key, i.value / 100, false); });
      i.addEventListener('change', () => setProp(key, i.value / 100, true));
      return row(label, i, o);
    };
    const color = (key, label, allowNone) => {
      const wrap = el('div', { class: 'swatches' });
      const hex = el('input', { type: 'text', value: v[key] || '', placeholder: 'none', maxlength: 7 });
      const pick = (c) => { setProp(key, c, true); hex.value = c || ''; wrap.querySelectorAll('i').forEach((s) => s.classList.toggle('on', s.dataset.c === (c || ''))); };
      if (allowNone) wrap.append(el('i', { class: 'none' + (!v[key] ? ' on' : ''), title: 'None', 'data-c': '', onclick: () => pick(null) }));
      for (const c of PALETTE) wrap.append(el('i', { style: `background:${c}`, class: v[key] === c ? 'on' : '', 'data-c': c, onclick: () => pick(c) }));
      hex.addEventListener('keydown', (e) => e.stopPropagation());
      hex.addEventListener('change', () => { let c = hex.value.trim().toLowerCase(); if (c && c[0] !== '#') c = '#' + c; if (/^#[0-9a-f]{6}$/.test(c)) pick(c); else if (!c && allowNone) pick(null); else hex.value = v[key] || ''; });
      wrap.append(hex);
      return row(label, wrap);
    };
    const check = (key, label) => { const i = el('input', { type: 'checkbox' }); i.checked = !!v[key]; i.addEventListener('change', () => setProp(key, i.checked, true)); return el('label', { class: 'check' }, i, label); };
    if (t.kind === 'sel') sect.append(el('div', { class: 'readout', id: 'readout' }));
    sect.append(textIn('subject', 'Subject'), textIn('label', 'Label'));
    if (!multi) {
      sect.append(color('stroke', type === 'count' ? 'Color' : 'Line'));
      if (type !== 'count' && type !== 'highlight') sect.append(numIn('w', 'Width', 0, 40, 0.25, 1.5));
      if (HAS_FILL.has(type)) sect.append(color('fill', 'Fill', true), slider('fillAlpha', 'Fill opacity', 0.25));
      sect.append(slider('alpha', 'Opacity', 1));
      if (HAS_TEXT.has(type)) sect.append(numIn('fs', 'Font size', 4, 200, 1, 10), color('tc', 'Text'));
      if (type === 'volume') sect.append(numIn('depth', 'Depth', 0, 1e6, 0.01, 1));
      if (type === 'count') sect.append(numIn('size', 'Marker size', 2, 60, 1, 6));
      if (!['pen', 'hlpen', 'count', 'highlight'].includes(type)) sect.append(check('dash', 'Dashed line'));
      if (type === 'polygon' || type === 'rect') sect.append(check('cloud', 'Cloud edge'));
    }
    sect.append(textIn('comment', 'Comment', true));
    const btns = el('div', { class: 'btnrow' }, el('button', { onclick: addToChest }, 'Add to Tool Chest'));
    if (t.kind === 'sel' && !multi) btns.append(el('button', { title: 'Use this look for new markups of this type', onclick: () => {
      const { id, type: ty, page, pts, author, date, text, subject, label, comment, ...look } = t.items[0];
      S.defaults[ty] = look; store('mk.defaults', S.defaults); toast('Saved as default for ' + TYPES[ty].name);
    } }, 'Set as Default'));
    sect.append(btns);
    box.append(sect);
    renderReadout();
  }
  function renderReadout() {
    const r = $('#readout'), d = doc();
    if (!r || !d) return;
    const sel = selected(d);
    let len = 0, area = 0, vol = 0, count = 0, has = {};
    let sc0 = null, mixed = false;
    for (const m of sel) {
      const sc = MK.scaleFor(d, m.page), c = Units.calc(m, sc);
      if (sc0 && sc0.unit !== sc.unit) mixed = true;
      sc0 = sc0 || sc;
      if (c.len != null) { len += c.len; has.len = 1; }
      if (c.area != null) { area += c.area; has.area = 1; }
      if (c.vol != null) { vol += c.vol; has.vol = 1; }
      if (c.count != null) { count += c.count; has.count = 1; }
    }
    const line = (k, t) => `<div><span>${k}</span><b>${esc(t)}</b></div>`;
    let h = '';
    if (mixed) h = '<div><span>Pages use different units</span></div>';
    else {
      if (has.area) h += line('Area', Units.fmtArea(area, sc0));
      if (has.len) h += line(has.area ? 'Perimeter' : 'Length', Units.fmtLen(len, sc0));
      if (has.vol) h += line('Volume', Units.fmtVol(vol, sc0));
      if (has.count) h += line('Count', String(count));
    }
    r.innerHTML = h;
    r.style.display = h ? '' : 'none';
  }

  // ---------- scale panel ----------
  function renderScale() {
    const box = $('#scale'), d = doc();
    box.innerHTML = '';
    if (!d) return;
    const sc = MK.scaleFor(d, d.pi);
    const sect = el('div', { class: 'sect' }, el('h3', {}, 'Scale', el('b', {}, sc.unset ? 'Not set' : sc.label)));
    if (sc.unset) sect.append(el('p', { class: 'warn' }, 'Set a scale before measuring.'));
    const sel = el('select', {}, el('option', { value: '' }, 'Choose a preset…'), Units.PRESETS.map((p, i) => el('option', { value: i, selected: !sc.unset && p.label === sc.label }, p.label)));
    sel.addEventListener('change', () => { if (sel.value !== '') setScale(Object.assign({}, Units.PRESETS[+sel.value], { prec: sc.prec ?? 2 })); });
    sect.append(el('div', { class: 'row' }, el('label', {}, 'Preset'), sel));
    const pa = el('input', { type: 'number', value: +(sc.paper).toFixed(4), step: 'any', min: 0 }), re = el('input', { type: 'number', value: +(sc.real).toFixed(4), step: 'any', min: 0 });
    const un = el('select', {}, ['ft', 'in', 'yd', 'm', 'cm', 'mm'].map((u) => el('option', { selected: u === sc.unit }, u)));
    const applyCustom = () => { const p = +pa.value, r = +re.value; if (p > 0 && r > 0) setScale({ label: `${pa.value} in = ${re.value} ${un.value}`, paper: p, real: r, unit: un.value, prec: sc.prec ?? 2, arch: false }); };
    [pa, re].forEach((i) => { i.addEventListener('change', applyCustom); i.addEventListener('keydown', (e) => e.stopPropagation()); });
    un.addEventListener('change', applyCustom);
    sect.append(el('div', { class: 'row' }, el('label', {}, 'Custom'), pa, el('span', {}, 'in on paper')), el('div', { class: 'row' }, el('label', {}, 'equals'), re, un));
    const pr = el('select', {}, [0, 1, 2, 3].map((n) => el('option', { value: n, selected: (sc.prec ?? 2) === n }, n === 0 ? '1' : '0.' + '0'.repeat(n - 1) + '1')));
    pr.addEventListener('change', () => setScale(Object.assign({}, sc, { unset: false, prec: +pr.value })));
    sect.append(el('div', { class: 'row' }, el('label', {}, 'Precision'), pr));
    if (sc.unit === 'ft') { const c = el('input', { type: 'checkbox' }); c.checked = !!sc.arch; c.addEventListener('change', () => setScale(Object.assign({}, sc, { unset: false, arch: c.checked }))); sect.append(el('label', { class: 'check' }, c, 'Show lengths as feet-inches')); }
    const all = el('input', { type: 'checkbox' });
    all.checked = S.applyAll;
    all.addEventListener('change', () => (S.applyAll = all.checked));
    sect.append(el('label', { class: 'check' }, all, 'Apply scale changes to all pages'), el('div', { class: 'btnrow' }, el('button', { onclick: () => setTool('calibrate') }, 'Calibrate…')));
    box.append(sect);
  }

  // ---------- tool chest ----------
  async function addToChest() {
    const t = propTarget();
    if (!t) return;
    const { id, page, pts, author, date, text, type: _t, ...look } = t.v;
    const r = await dialog('Add to Tool Chest', 'Saves this tool with its colors, subject and label so you can reuse it.', [{ k: 'name', label: 'Name', value: t.v.subject || t.v.label || TYPES[t.type].name }], 'Add');
    if (!r || !r.name.trim()) return;
    S.chest.push({ name: r.name.trim(), tool: look.cloud && t.type === 'polygon' ? 'cloud' : t.type, props: look });
    store('mk.chest', S.chest);
    renderChest();
    toast('Added to Tool Chest');
  }
  function renderChest() {
    const box = $('#chestPane');
    box.innerHTML = '';
    if (!S.chest.length) box.append(el('div', { class: 'hint' }, 'Saved tools appear here. Set up a markup the way you want it, then choose “Add to Tool Chest” in Properties.'));
    S.chest.forEach((c, i) => box.append(el('div', { class: 'chest-item', title: 'Use this tool', onclick: () => setTool(c.tool, c.props) },
      el('span', { class: 'sw', style: `border-color:${c.props.stroke};background:${c.props.fill || 'transparent'}` }),
      el('span', { class: 'nm' }, c.name, el('div', { class: 'ty' }, TYPES[toolType(c.tool)].name)),
      el('span', { class: 'x', title: 'Remove', onclick: (e) => { e.stopPropagation(); S.chest.splice(i, 1); store('mk.chest', S.chest); renderChest(); } }, '×'))));
  }

  // ---------- markups list ----------
  const COLS = [['subject', 'Subject'], ['label', 'Label'], ['type', 'Type'], ['page', 'Page', 1], ['len', 'Length', 1], ['area', 'Area', 1], ['vol', 'Volume', 1], ['count', 'Count', 1], ['comment', 'Comment']];
  function listRows(d) {
    const f = S.list.filter.toLowerCase();
    return d.markups.filter((m) => S.list.scope === 'all' || m.page === d.pi).map((m) => {
      const sc = MK.scaleFor(d, m.page), c = Units.calc(m, sc), isText = m.type === 'text' || m.type === 'callout';
      return Object.assign({ m, sc, subject: m.subject || TYPES[m.type].name, label: m.label || '', type: TYPES[m.type].name, page: m.page + 1, comment: isText ? m.text || '' : m.comment || '' }, c);
    }).filter((r) => !f || `${r.subject} ${r.label} ${r.type} ${r.comment}`.toLowerCase().includes(f));
  }
  function totals(rows) {
    const t = { len: {}, area: {}, vol: {}, count: 0 };
    for (const r of rows) {
      const u = r.sc.unit;
      if (r.len != null && r.area == null) t.len[u] = (t.len[u] || 0) + r.len;
      if (r.area != null) t.area[u] = (t.area[u] || 0) + r.area;
      if (r.vol != null) t.vol[u] = (t.vol[u] || 0) + r.vol;
      if (r.count != null) t.count += r.count;
    }
    const j = (o, names) => Object.keys(o).map((u) => `${Units.fmtNum(o[u], 2)} ${names ? names[u] : u}`).join(' + ');
    return { len: j(t.len), area: j(t.area, Units.AREA_U), vol: j(t.vol, Units.VOL_U), count: t.count ? String(t.count) : '' };
  }
  function buildListBar() {
    const bar = $('#listbar');
    const f = el('input', { type: 'search', placeholder: 'Filter…', style: 'width:130px' });
    f.addEventListener('input', () => { S.list.filter = f.value; renderList(); });
    f.addEventListener('keydown', (e) => e.stopPropagation());
    const scope = el('select', {}, el('option', { value: 'all' }, 'All pages'), el('option', { value: 'page' }, 'This page'));
    scope.addEventListener('change', () => { S.list.scope = scope.value; renderList(); });
    const grp = el('select', {}, [['none', 'No grouping'], ['subject', 'Group by subject'], ['page', 'Group by page'], ['type', 'Group by type']].map(([v, t]) => el('option', { value: v }, t)));
    grp.addEventListener('change', () => { S.list.group = grp.value; renderList(); });
    bar.append(el('span', { class: 'ttl' }, 'Markups'), f, scope, grp, el('span', { class: 'tot', id: 'ltot' }),
      el('button', { onclick: () => cmd('csv') }, 'Export CSV'), el('button', { title: 'Show or hide the list', onclick: () => { $('#list').classList.toggle('collapsed'); viewChanged(); } }, '▾'));
    $('#ltable thead').append(el('tr', {}, COLS.map(([k, t, num]) => el('th', { class: num ? 'num' : '', onclick: () => { S.list.dir = S.list.sort === k ? -S.list.dir : 1; S.list.sort = k; renderList(); } }, t))));
  }
  function renderList() {
    const tb = $('#ltable tbody'), d = doc();
    tb.innerHTML = '';
    $('#ltot').innerHTML = '';
    if (!d) return;
    const rows = listRows(d), { sort, dir, group } = S.list;
    const cmp = (a, b, k) => { const x = a[k] ?? (typeof b[k] === 'number' ? -Infinity : ''), y = b[k] ?? (typeof a[k] === 'number' ? -Infinity : ''); return typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true }); };
    rows.sort((a, b) => (group !== 'none' ? cmp(a, b, group) : 0) || cmp(a, b, sort) * dir);
    const fmt = (r, k) => (r[k] == null ? '' : k === 'len' ? Units.fmtLen(r.len, r.sc) : k === 'area' ? Units.fmtArea(r.area, r.sc) : k === 'vol' ? Units.fmtVol(r.vol, r.sc) : r[k]);
    let cur = null;
    rows.forEach((r, idx) => {
      if (group !== 'none' && r[group] !== cur) {
        cur = r[group];
        const g = rows.filter((x) => x[group] === cur), t = totals(g);
        tb.append(el('tr', { class: 'grp' }, el('td', { colspan: 4 }, `${group === 'page' ? 'Page ' : ''}${cur}  (${g.length})`), el('td', { class: 'num' }, t.len), el('td', { class: 'num' }, t.area), el('td', { class: 'num' }, t.vol), el('td', { class: 'num' }, t.count), el('td', {})));
      }
      const tr = el('tr', { class: d.sel.has(r.m.id) ? 'sel' : '', 'data-id': r.m.id }, COLS.map(([k, , num], ci) => el('td', { class: num ? 'num' : '', html: (ci === 0 ? `<span class="sw" style="background:${esc(r.m.stroke)}"></span>` : '') + esc(fmt(r, k)) })));
      tr.addEventListener('click', async (e) => {
        if (e.shiftKey || e.metaKey) d.sel.has(r.m.id) ? d.sel.delete(r.m.id) : d.sel.add(r.m.id);
        else d.sel = new Set([r.m.id]);
        if (S.tool !== 'select') setTool('select');
        if (r.m.page !== d.pi) await gotoPage(r.m.page); else refresh();
      });
      tr.addEventListener('dblclick', () => zoomTo(r.m));
      tb.append(tr);
    });
    const t = totals(rows), parts = [`<b>${rows.length}</b> markup${rows.length === 1 ? '' : 's'}`];
    if (t.area) parts.push(`Area <b>${t.area}</b>`);
    if (t.len) parts.push(`Length <b>${t.len}</b>`);
    if (t.vol) parts.push(`Volume <b>${t.vol}</b>`);
    if (t.count) parts.push(`Count <b>${t.count}</b>`);
    $('#ltot').innerHTML = parts.join(' &nbsp;·&nbsp; ');
  }
  function zoomTo(m) {
    const d = doc(), bb = Shapes.itemsBBox(Shapes.build(m, envFor(d)), measure);
    if (!bb) return;
    const a = toScreen(d, { x: bb.x0, y: bb.y0 }), b = toScreen(d, { x: bb.x1, y: bb.y1 }), W = stage.clientWidth, H = stage.clientHeight;
    const w = Math.abs(b.x - a.x) || 1, h = Math.abs(b.y - a.y) || 1, f = Math.min(8, Math.min((W * 0.6) / w, (H * 0.6) / h));
    zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, f);
    const c = toScreen(d, { x: (bb.x0 + bb.x1) / 2, y: (bb.y0 + bb.y1) / 2 });
    d.view.ox += W / 2 - c.x; d.view.oy += H / 2 - c.y;
    viewChanged();
  }
  function csv() {
    const d = doc();
    if (!d) return;
    const q = (v) => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const lines = [['Subject', 'Label', 'Type', 'Page', 'Length', 'Length Unit', 'Area', 'Area Unit', 'Volume', 'Volume Unit', 'Count', 'Comment', 'Author'].join(',')];
    const rows = listRows(d).sort((a, b) => a.subject.localeCompare(b.subject) || a.page - b.page);
    const n = (v) => (v == null ? '' : (+v).toFixed(3).replace(/\.?0+$/, ''));
    for (const r of rows) lines.push([r.subject, r.label, r.type, r.page, n(r.len), r.len != null ? r.sc.unit : '', n(r.area), r.area != null ? Units.AREA_U[r.sc.unit] : '', n(r.vol), r.vol != null ? Units.VOL_U[r.sc.unit] : '', r.count ?? '', r.comment, r.m.author || ''].map(q).join(','));
    saveText(d.name.replace(/\.pdf$/i, '') + ' - markups.csv', lines.join('\r\n') + '\r\n');
  }

  // ---------- search ----------
  async function runSearch(q, dir) {
    const d = doc();
    if (!d) return;
    q = q.trim().toLowerCase();
    if (!q) { d.search = null; $('#qcnt').textContent = ''; return draw(); }
    if (!d.search || d.search.q !== q) {
      busy('Searching…');
      const hits = [];
      for (let i = 0; i < d.n; i++) {
        const page = await d.pdf.getPage(i + 1), tc = await page.getTextContent();
        for (const it of tc.items) {
          if (!it.str) continue;
          const low = it.str.toLowerCase();
          let at = -1;
          while ((at = low.indexOf(q, at + 1)) >= 0) {
            const t = it.transform, L = Math.hypot(t[0], t[1]) || 1, ux = t[0] / L, uy = t[1] / L, h = it.height || L, w = it.width || 0;
            const s0 = (at / it.str.length) * w, s1 = ((at + q.length) / it.str.length) * w, vx = -uy, vy = ux;
            const P = (s, v) => ({ x: t[4] + ux * s + vx * v, y: t[5] + uy * s + vy * v });
            hits.push({ page: i, quad: [P(s0, -h * 0.2), P(s1, -h * 0.2), P(s1, h * 0.85), P(s0, h * 0.85)] });
          }
        }
      }
      busy(null);
      d.search = { q, hits, at: -1 };
      if (hits.length) { const first = hits.findIndex((h) => h.page >= d.pi); d.search.at = (first < 0 ? 0 : first) - dir; }
    }
    const s = d.search;
    if (!s.hits.length) { $('#qcnt').textContent = '0'; return draw(); }
    s.at = (s.at + dir + s.hits.length) % s.hits.length;
    $('#qcnt').textContent = `${s.at + 1}/${s.hits.length}`;
    const h = s.hits[s.at];
    if (h.page !== d.pi) await gotoPage(h.page);
    const c = toScreen(d, h.quad[0]);
    if (c.x < 20 || c.y < 20 || c.x > stage.clientWidth - 20 || c.y > stage.clientHeight - 20) { d.view.ox += stage.clientWidth / 2 - c.x; d.view.oy += stage.clientHeight / 2 - c.y; viewChanged(); }
    draw();
  }

  // ---------- page operations ----------
  async function pageOp(op) {
    const d = doc();
    if (!d) return;
    if (d.locked) return toast('This PDF cannot be modified.');
    commitEdit();
    try {
      if (op === 'rotate') { busy('Rotating…'); d.bytes = await IO.rotatePage(d.bytes, d.pi, 90); }
      else if (op === 'delete') {
        if (d.n < 2) return toast('A document needs at least one page.');
        const r = await dialog('Delete page', `Delete page ${d.pi + 1} and its markups? This cannot be undone.`, [], 'Delete');
        if (!r) return;
        busy('Deleting…');
        d.bytes = await IO.deletePage(d.bytes, d.pi);
        d.markups = d.markups.filter((m) => m.page !== d.pi);
        d.markups.forEach((m) => { if (m.page > d.pi) m.page--; });
        const np = {};
        for (const k in d.scales.pages) if (+k !== d.pi) np[+k > d.pi ? +k - 1 : k] = d.scales.pages[k];
        d.scales.pages = np;
      } else if (op === 'insert') {
        const files = await pickFiles();
        if (!files.length) return;
        busy('Inserting…');
        const r = await IO.insertPages(d.bytes, d.pi + 1, files[0].bytes);
        d.bytes = r.bytes;
        d.markups.forEach((m) => { if (m.page > d.pi) m.page += r.count; });
        const np = {};
        for (const k in d.scales.pages) np[+k > d.pi ? +k + r.count : k] = d.scales.pages[k];
        d.scales.pages = np;
      }
      await reloadPdf(d);
    } catch (e) { console.error(e); toast('That page operation failed.'); }
    busy(null);
  }

  // ---------- files ----------
  const fileInput = $('#file');
  let pickResolve = null;
  fileInput.addEventListener('change', async () => {
    const out = [];
    for (const f of fileInput.files) out.push({ name: f.name, path: null, bytes: new Uint8Array(await f.arrayBuffer()) });
    fileInput.value = '';
    if (pickResolve) { const r = pickResolve; pickResolve = null; r(out); }
  });
  async function pickFiles() {
    if (native) {
      const list = await native.postMessage({ cmd: 'pick' });
      const out = [];
      for (const f of list || []) out.push({ name: f.name, path: f.path, bytes: new Uint8Array(await (await fetch(f.url)).arrayBuffer()) });
      return out;
    }
    return new Promise((res) => { pickResolve = res; fileInput.click(); });
  }
  function b64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }
  function download(name, blob) { const a = el('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }
  async function saveText(name, text) {
    if (native) { const r = await native.postMessage({ cmd: 'saveText', name, text }); if (r && r.ok) toast('Exported ' + r.name); }
    else { download(name, new Blob([text], { type: 'text/csv' })); toast('Exported ' + name); }
  }
  async function save(as) {
    const d = doc();
    if (!d) return false;
    if (d.locked) { toast('This PDF is protected or damaged and cannot be saved with markups.'); return false; }
    commitEdit();
    busy('Saving…');
    try {
      const out = await IO.exportPdf(d);
      if (native) {
        const r = await native.postMessage({ cmd: 'save', name: d.name, path: as ? null : d.path, data: b64(out) });
        if (!r || !r.ok) { busy(null); return false; }
        d.path = r.path; d.name = r.name;
      } else download(d.name, new Blob([out], { type: 'application/pdf' }));
      d.dirty = false;
      MK.lastSaved = out;
      toast('Saved ' + d.name);
      renderTabs();
      busy(null);
      return true;
    } catch (e) { console.error(e); busy(null); toast('Save failed: ' + (e.message || e)); return false; }
  }
  async function openFiles() { for (const f of await pickFiles()) await openBytes(f.name, f.path, f.bytes); }

  window.addEventListener('dragover', (e) => { e.preventDefault(); stage.classList.add('drop'); });
  window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) stage.classList.remove('drop'); });
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    stage.classList.remove('drop');
    for (const f of e.dataTransfer.files) if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') await openBytes(f.name, null, new Uint8Array(await f.arrayBuffer()));
  });
  window.addEventListener('beforeunload', (e) => { if (!native && S.docs.some((d) => d.dirty)) { e.preventDefault(); e.returnValue = ''; } });

  // ---------- commands & keyboard ----------
  const inField = () => { const a = document.activeElement; return !!a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && !['checkbox', 'range', 'file'].includes(a.type))); };
  document.addEventListener('change', (e) => { if (e.target.tagName === 'SELECT' || e.target.type === 'checkbox' || e.target.type === 'range') e.target.blur(); });
  document.addEventListener('click', (e) => { const t = e.target.closest && e.target.closest('button'); if (t) t.blur(); });
  function cmd(name) {
    const d = doc(), W = stage.clientWidth / 2, H = stage.clientHeight / 2;
    switch (name) {
      case 'open': return openFiles();
      case 'save': return save(false);
      case 'saveAs': return save(true);
      case 'csv': return csv();
      case 'close': return d && closeDoc(S.cur);
      case 'undo': return inField() ? document.execCommand('undo') : undo();
      case 'redo': return inField() ? document.execCommand('redo') : redo();
      case 'copy': return copySel();
      case 'cut': copySel(); return deleteSel();
      case 'paste': return paste();
      case 'duplicate': copySel(); return paste();
      case 'delete': return deleteSel();
      case 'selectAll':
        if (inField()) return document.activeElement.select && document.activeElement.select();
        if (d) { setTool('select'); d.sel = new Set(d.markups.filter((m) => m.page === d.pi).map((m) => m.id)); refresh(); }
        return;
      case 'zoomIn': return zoomAt(W, H, 1.25);
      case 'zoomOut': return zoomAt(W, H, 0.8);
      case 'fit': return fit();
      case 'actual': return d && zoomAt(W, H, 96 / 72 / d.view.s);
      case 'nextPage': return d && gotoPage(d.pi + 1);
      case 'prevPage': return d && gotoPage(d.pi - 1);
      case 'firstPage': return d && gotoPage(0);
      case 'lastPage': return d && gotoPage(d.n - 1);
      case 'find': return $('#q').focus();
      default: if (name.startsWith('tool:')) setTool(name.slice(5));
    }
  }
  document.addEventListener('keydown', (e) => {
    if (inField()) return;
    const d = doc(), mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
    if (mod) {
      const map = { o: 'open', s: e.shiftKey ? 'saveAs' : 'save', z: e.shiftKey ? 'redo' : 'undo', y: 'redo', d: 'duplicate', a: 'selectAll', f: 'find', w: 'close', '0': 'fit', '=': 'zoomIn', '+': 'zoomIn', '-': 'zoomOut', c: 'copy', x: 'cut', v: 'paste' };
      if (map[k]) { e.preventDefault(); cmd(map[k]); }
      return;
    }
    if (k === ' ') { if (!S.space) { S.space = true; over.style.cursor = 'grab'; } e.preventDefault(); return; }
    if (k === 'escape') { if (S.draft || S.drag) cancelDraft(); else if (S.tool !== 'select') setTool('select'); else if (d && d.sel.size) { d.sel.clear(); refresh(); } return; }
    if (k === 'enter') { if (S.draft) finishDraft(); return; }
    if (k === 'backspace' || k === 'delete') {
      e.preventDefault();
      if (S.draft && TYPES[S.draft.type].mode !== 'two') { S.draft.pts.pop(); if (!S.draft.pts.length) cancelDraft(); else draw(); }
      else deleteSel();
      return;
    }
    if (k.startsWith('arrow') && d && d.sel.size) {
      e.preventDefault();
      const st = (e.shiftKey ? 10 : 1) / d.view.s, a = toPdf(d, 0, 0), b = toPdf(d, k === 'arrowleft' ? -st : k === 'arrowright' ? st : 0, k === 'arrowup' ? -st : k === 'arrowdown' ? st : 0);
      if (!e.repeat) pushUndo(d);
      for (const m of selected(d)) m.pts.forEach((p) => { p.x += (b.x - a.x) * d.view.s; p.y += (b.y - a.y) * d.view.s; });
      return refresh();
    }
    if (k === 'pagedown' || k === 'arrowright' || k === 'arrowdown') { e.preventDefault(); return cmd('nextPage'); }
    if (k === 'pageup' || k === 'arrowleft' || k === 'arrowup') { e.preventDefault(); return cmd('prevPage'); }
    if (k === 'home') return cmd('firstPage');
    if (k === 'end') return cmd('lastPage');
    if (HOTKEY[k] && !e.altKey) setTool(HOTKEY[k]);
  });
  document.addEventListener('keyup', (e) => { if (e.key === ' ') { S.space = false; over.style.cursor = S.tool === 'pan' ? 'grab' : S.tool === 'select' ? 'default' : 'crosshair'; } });
  for (const ev of ['copy', 'cut', 'paste']) document.addEventListener(ev, (e) => { if (!inField()) { e.preventDefault(); cmd(ev); } });

  // ---------- boot ----------
  buildBar();
  buildListBar();
  renderChest();
  setTool('select');
  new ResizeObserver(() => { viewChanged(); }).observe(stage);

  window.App = {
    cmd, S, doc, openBytes, setTool, save, toScreen, toPdf,
    hasUnsaved: () => S.docs.some((d) => d.dirty),
    /** Called by the Mac shell: files = [{name, path, url}] */
    async nativeOpen(files) {
      for (const f of files) {
        const at = S.docs.findIndex((d) => d.path && d.path === f.path);
        if (at >= 0) { await switchDoc(at); continue; }
        try { await openBytes(f.name, f.path, new Uint8Array(await (await fetch(f.url)).arrayBuffer())); } catch (e) { toast('Could not open ' + f.name); }
      }
    },
  };
  if (native) native.postMessage({ cmd: 'ready' });
})();
