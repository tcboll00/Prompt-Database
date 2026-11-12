/* Markline core: geometry, units/scales, and the shape display-list builder.
   All markup geometry lives in PDF user space (points, y up). */
(function () {
  'use strict';
  const MK = (window.MK = window.MK || {});

  // ---------- geometry ----------
  const G = (MK.G = {
    dist: (a, b) => Math.hypot(a.x - b.x, a.y - b.y),
    segDist(p, a, b) {
      const dx = b.x - a.x, dy = b.y - a.y;
      const l2 = dx * dx + dy * dy;
      let t = l2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0;
      t = Math.max(0, Math.min(1, t));
      return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    },
    polyLen(pts, closed) {
      let l = 0;
      for (let i = 1; i < pts.length; i++) l += G.dist(pts[i - 1], pts[i]);
      if (closed && pts.length > 2) l += G.dist(pts[pts.length - 1], pts[0]);
      return l;
    },
    signedArea(pts) {
      let a = 0;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i], q = pts[(i + 1) % pts.length];
        a += p.x * q.y - q.x * p.y;
      }
      return a / 2;
    },
    polyArea: (pts) => Math.abs(G.signedArea(pts)),
    centroid(pts) {
      const a = G.signedArea(pts);
      if (Math.abs(a) < 1e-9) {
        const b = G.bbox(pts);
        return { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 };
      }
      let cx = 0, cy = 0;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i], q = pts[(i + 1) % pts.length];
        const f = p.x * q.y - q.x * p.y;
        cx += (p.x + q.x) * f;
        cy += (p.y + q.y) * f;
      }
      return { x: cx / (6 * a), y: cy / (6 * a) };
    },
    pointInPoly(p, pts) {
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const a = pts[i], b = pts[j];
        if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
      }
      return inside;
    },
    bbox(pts) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of pts) {
        if (p.x < x0) x0 = p.x;
        if (p.x > x1) x1 = p.x;
        if (p.y < y0) y0 = p.y;
        if (p.y > y1) y1 = p.y;
      }
      return { x0, y0, x1, y1 };
    },
    rot(p, deg) {
      const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
      return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
    },
    ellipsePts(b, n = 40) {
      const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, rx = (b.x1 - b.x0) / 2, ry = (b.y1 - b.y0) / 2;
      const out = [];
      for (let i = 0; i < n; i++) {
        const t = (i / n) * Math.PI * 2;
        out.push({ x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) });
      }
      return out;
    },
  });

  // ---------- units & scales ----------
  const IN_PER = { in: 1, ft: 12, yd: 36, mm: 1 / 25.4, cm: 1 / 2.54, m: 39.37007874 };
  const AREA_U = { in: 'sq in', ft: 'sf', yd: 'sy', mm: 'mm²', cm: 'cm²', m: 'm²' };
  const VOL_U = { in: 'cu in', ft: 'cf', yd: 'cy', mm: 'mm³', cm: 'cm³', m: 'm³' };

  function arch(n, d) {
    return { label: `${n}" = 1'-0"`, paper: d, real: 1, unit: 'ft', arch: true, prec: 2 };
  }
  const PRESETS = [
    { label: '1:1 (inches)', paper: 1, real: 1, unit: 'in', prec: 2 },
    arch('1/16', 1 / 16), arch('3/32', 3 / 32), arch('1/8', 1 / 8), arch('3/16', 3 / 16), arch('1/4', 1 / 4),
    arch('3/8', 3 / 8), arch('1/2', 1 / 2), arch('3/4', 3 / 4), arch('1', 1), arch('1-1/2', 1.5), arch('3', 3),
    ...[10, 20, 30, 40, 50, 60, 100].map((n) => ({ label: `1" = ${n}'`, paper: 1, real: n, unit: 'ft', prec: 2 })),
    ...[10, 20, 50, 100, 200, 500].map((n) => ({ label: `1:${n} (metric)`, paper: 1, real: n * 0.0254, unit: 'm', prec: 2 })),
  ];
  const DEFAULT_SCALE = Object.assign({ unset: true }, PRESETS[0]);

  function fmtNum(v, prec) {
    return v.toLocaleString('en-US', { minimumFractionDigits: prec, maximumFractionDigits: prec });
  }
  function ftIn(v) {
    const neg = v < 0;
    let six = Math.round(Math.abs(v) * 12 * 16);
    const ft = Math.floor(six / 192);
    six -= ft * 192;
    const inch = Math.floor(six / 16);
    let num = six - inch * 16, den = 16;
    while (num && num % 2 === 0) { num /= 2; den /= 2; }
    return `${neg ? '-' : ''}${ft}'-${inch}${num ? ' ' + num + '/' + den : ''}"`;
  }

  const Units = (MK.Units = {
    PRESETS, DEFAULT_SCALE, IN_PER, AREA_U, VOL_U, fmtNum,
    factor: (sc) => sc.real / (sc.paper * 72), // real units per PDF point
    fmtLen(v, sc) {
      if (sc.unit === 'ft' && sc.arch) return ftIn(v);
      return `${fmtNum(v, sc.prec ?? 2)} ${sc.unit}`;
    },
    fmtArea: (v, sc) => `${fmtNum(v, sc.prec ?? 2)} ${AREA_U[sc.unit]}`,
    fmtVol: (v, sc) => `${fmtNum(v, sc.prec ?? 2)} ${VOL_U[sc.unit]}`,
    /** Numeric results in real-world units for a markup. */
    calc(m, sc) {
      const f = Units.factor(sc), P = m.pts, r = {};
      switch (m.type) {
        case 'length': r.len = G.dist(P[0], P[1]) * f; break;
        case 'polylength': r.len = G.polyLen(P, false) * f; break;
        case 'perimeter': r.len = G.polyLen(P, true) * f; break;
        case 'area': r.area = G.polyArea(P) * f * f; r.len = G.polyLen(P, true) * f; break;
        case 'volume':
          r.area = G.polyArea(P) * f * f; r.len = G.polyLen(P, true) * f;
          r.vol = r.area * (+m.depth || 0); break;
        case 'count': r.count = P.length; break;
      }
      return r;
    },
    caption(m, sc) {
      const r = Units.calc(m, sc);
      let v = '';
      if (m.type === 'area') v = Units.fmtArea(r.area, sc);
      else if (m.type === 'volume') v = Units.fmtVol(r.vol, sc);
      else if (r.len != null) v = Units.fmtLen(r.len, sc);
      else if (r.count != null) v = String(r.count);
      return m.label ? `${m.label}  ${v}` : v;
    },
  });

  // ---------- markup type table ----------
  const TYPES = (MK.TYPES = {
    text: { name: 'Text Box', mode: 'box' },
    callout: { name: 'Callout', mode: 'callout' },
    line: { name: 'Line', mode: 'two' },
    arrow: { name: 'Arrow', mode: 'two' },
    rect: { name: 'Rectangle', mode: 'box' },
    ellipse: { name: 'Ellipse', mode: 'box' },
    polygon: { name: 'Polygon', mode: 'multi', closed: true },
    polyline: { name: 'Polyline', mode: 'multi' },
    pen: { name: 'Pen', mode: 'free' },
    hlpen: { name: 'Highlighter', mode: 'free' },
    highlight: { name: 'Highlight Area', mode: 'box' },
    length: { name: 'Length', mode: 'two', measure: true },
    polylength: { name: 'Polylength', mode: 'multi', measure: true },
    area: { name: 'Area', mode: 'multi', closed: true, measure: true },
    perimeter: { name: 'Perimeter', mode: 'multi', closed: true, measure: true },
    volume: { name: 'Volume', mode: 'multi', closed: true, measure: true },
    count: { name: 'Count', mode: 'count', measure: true },
  });
  MK.BASE = {
    text: { stroke: '#d92b2b', w: 1, fill: null, tc: '#d92b2b', fs: 12, text: '' },
    callout: { stroke: '#d92b2b', w: 1, fill: '#ffffff', fillAlpha: 1, tc: '#d92b2b', fs: 12, text: '' },
    line: { stroke: '#d92b2b', w: 1.5 },
    arrow: { stroke: '#d92b2b', w: 1.5 },
    rect: { stroke: '#d92b2b', w: 1.5, fill: null },
    ellipse: { stroke: '#d92b2b', w: 1.5, fill: null },
    polygon: { stroke: '#d92b2b', w: 1.5, fill: null },
    polyline: { stroke: '#d92b2b', w: 1.5 },
    pen: { stroke: '#d92b2b', w: 1.5 },
    hlpen: { stroke: '#ffe600', w: 12, alpha: 0.4 },
    highlight: { stroke: '#ffe600', w: 0, fill: '#ffe600', fillAlpha: 0.4 },
    length: { stroke: '#1668d6', w: 1.25, tc: '#1668d6', fs: 10 },
    polylength: { stroke: '#1668d6', w: 1.25, tc: '#1668d6', fs: 10 },
    area: { stroke: '#1668d6', w: 1.25, fill: '#1668d6', fillAlpha: 0.25, tc: '#0b3d82', fs: 10 },
    perimeter: { stroke: '#1668d6', w: 1.5, fill: null, tc: '#1668d6', fs: 10 },
    volume: { stroke: '#7a3fc4', w: 1.25, fill: '#7a3fc4', fillAlpha: 0.25, tc: '#4a2180', fs: 10, depth: 1 },
    count: { stroke: '#1d9a4a', w: 1, size: 6 },
  };

  // ---------- text layout ----------
  function wrap(text, size, maxW, measure) {
    const lines = [];
    for (const para of String(text).split('\n')) {
      let cur = '';
      for (const word of para.split(/(\s+)/)) {
        if (!word) continue;
        if (cur && measure(cur + word, size) > maxW && word.trim()) {
          lines.push(cur.replace(/\s+$/, ''));
          cur = word.replace(/^\s+/, '');
        } else cur += word;
      }
      lines.push(cur);
    }
    return lines;
  }

  // ---------- display list ----------
  /** env: { scale, measure(text,size)->width, rot (page rotation, deg clockwise), clean(text) } */
  function build(m, env) {
    const out = [];
    const P = m.pts, w = m.w ?? 1.5, a = m.alpha ?? 1, R = env.rot || 0;
    const clean = env.clean || ((s) => s);
    const base = { stroke: w > 0 ? m.stroke : null, fill: null, w, alpha: a, fillAlpha: (m.fillAlpha ?? 0.25) * a, dash: m.dash ? [w * 3 + 2, w * 2 + 2] : null };
    const path = (ops, o) => out.push(Object.assign({ k: 'path', ops }, base, o));
    const poly = (pts, closed) => {
      const ops = pts.map((p, i) => [i ? 'L' : 'M', p.x, p.y]);
      if (closed) ops.push(['Z']);
      return ops;
    };
    const filled = (o = {}) => Object.assign({ fill: m.fill || null }, o);
    const tc = m.tc || m.stroke, fs = m.fs || 10;

    // text placed with its baseline starting at (x,y), running at `ang` degrees CCW
    const text = (str, x, y, ang, size = fs, color = tc) => out.push({ k: 'text', x, y, text: clean(str), size, color, angle: ang, alpha: a });
    // centered caption on a light plate; `ang` is the reading direction
    const caption = (str, c, ang, lift = 0) => {
      str = clean(str);
      if (!str) return;
      let va = (((ang - R) % 360) + 360) % 360; // angle as seen on screen
      if (va > 90 && va <= 270) ang += 180;
      const tw = env.measure(str, fs), pad = fs * 0.3;
      const u = G.rot({ x: 1, y: 0 }, ang), v = G.rot({ x: 0, y: 1 }, ang);
      const o = { x: c.x + v.x * lift - u.x * (tw / 2), y: c.y + v.y * lift - u.y * (tw / 2) };
      const q = (du, dv) => ({ x: o.x + u.x * du + v.x * dv, y: o.y + u.y * du + v.y * dv });
      out.push({ k: 'path', ops: poly([q(-pad, -fs * 0.5), q(tw + pad, -fs * 0.5), q(tw + pad, fs * 0.95), q(-pad, fs * 0.95)], true), stroke: null, fill: '#ffffff', w: 0, alpha: 1, fillAlpha: 0.82 * a, dash: null });
      text(str, o.x, o.y, ang);
    };
    const segAngle = (p, q) => (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI;
    const boxOf = (p, q) => ({ x0: Math.min(p.x, q.x), y0: Math.min(p.y, q.y), x1: Math.max(p.x, q.x), y1: Math.max(p.y, q.y) });
    const rectPts = (b) => [{ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y0 }, { x: b.x1, y: b.y1 }, { x: b.x0, y: b.y1 }];

    const cloud = (pts) => {
      const sgn = G.signedArea(pts) >= 0 ? 1 : -1, chord = 10 + w * 4, ops = [];
      for (let i = 0; i < pts.length; i++) {
        const A = pts[i], B = pts[(i + 1) % pts.length], L = G.dist(A, B);
        if (L < 1e-6) continue;
        const n = Math.max(1, Math.round(L / chord)), dx = (B.x - A.x) / n, dy = (B.y - A.y) / n;
        const h = (L / n) * 0.62, nx = (sgn * (B.y - A.y)) / L * h, ny = (-sgn * (B.x - A.x)) / L * h;
        if (!ops.length) ops.push(['M', A.x, A.y]);
        for (let k = 0; k < n; k++) {
          const x0 = A.x + dx * k, y0 = A.y + dy * k, x1 = x0 + dx, y1 = y0 + dy;
          ops.push(['C', x0 + nx, y0 + ny, x1 + nx, y1 + ny, x1, y1]);
        }
      }
      ops.push(['Z']);
      return ops;
    };

    const textBox = (b) => {
      // layout in a frame rotated so that "up" matches the screen for rotated pages
      const c0 = G.rot({ x: b.x0, y: b.y0 }, -R), c1 = G.rot({ x: b.x1, y: b.y1 }, -R);
      const L = boxOf(c0, c1), pad = 3 + w / 2;
      const lines = wrap(clean(m.text || ''), fs, Math.max(4, L.x1 - L.x0 - pad * 2), env.measure);
      lines.forEach((ln, i) => {
        if (!ln) return;
        const p = G.rot({ x: L.x0 + pad, y: L.y1 - pad - fs * 0.85 - i * fs * 1.2 }, R);
        text(ln, p.x, p.y, R);
      });
      return lines.length;
    };

    switch (m.type) {
      case 'line': path(poly(P)); break;
      case 'arrow': {
        path(poly(P));
        const ang = Math.atan2(P[1].y - P[0].y, P[1].x - P[0].x), s = Math.max(8, w * 5);
        const h = (da) => ({ x: P[1].x - s * Math.cos(ang + da), y: P[1].y - s * Math.sin(ang + da) });
        path(poly([P[1], h(0.42), h(-0.42)], true), { fill: m.stroke, fillAlpha: a, dash: null });
        break;
      }
      case 'length': {
        path(poly(P));
        const L = G.dist(P[0], P[1]) || 1, t = 4 + w * 2;
        const nx = (-(P[1].y - P[0].y) / L) * t, ny = ((P[1].x - P[0].x) / L) * t;
        for (const p of P) path(poly([{ x: p.x - nx, y: p.y - ny }, { x: p.x + nx, y: p.y + ny }]), { dash: null });
        caption(Units.caption(m, env.scale), { x: (P[0].x + P[1].x) / 2, y: (P[0].y + P[1].y) / 2 }, segAngle(P[0], P[1]), fs * 0.75 + w);
        break;
      }
      case 'polyline': path(poly(P)); break;
      case 'polylength': {
        path(poly(P));
        let bi = 0, bl = -1;
        for (let i = 1; i < P.length; i++) { const l = G.dist(P[i - 1], P[i]); if (l > bl) { bl = l; bi = i; } }
        if (bi) caption(Units.caption(m, env.scale), { x: (P[bi - 1].x + P[bi].x) / 2, y: (P[bi - 1].y + P[bi].y) / 2 }, segAngle(P[bi - 1], P[bi]), fs * 0.75 + w);
        break;
      }
      case 'polygon': path(m.cloud ? cloud(P) : poly(P, true), filled()); break;
      case 'area': case 'perimeter': case 'volume':
        path(poly(P, true), filled());
        if (P.length > 2) caption(Units.caption(m, env.scale), G.centroid(P), R, -fs * 0.3);
        break;
      case 'rect': { const b = boxOf(P[0], P[1]); path(m.cloud ? cloud(rectPts(b)) : poly(rectPts(b), true), filled()); break; }
      case 'highlight': path(poly(rectPts(boxOf(P[0], P[1])), true), filled({ blend: 'multiply' })); break;
      case 'ellipse': {
        const b = boxOf(P[0], P[1]), cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, rx = (b.x1 - b.x0) / 2, ry = (b.y1 - b.y0) / 2, k = 0.5523;
        path([['M', cx + rx, cy], ['C', cx + rx, cy + ry * k, cx + rx * k, cy + ry, cx, cy + ry], ['C', cx - rx * k, cy + ry, cx - rx, cy + ry * k, cx - rx, cy],
          ['C', cx - rx, cy - ry * k, cx - rx * k, cy - ry, cx, cy - ry], ['C', cx + rx * k, cy - ry, cx + rx, cy - ry * k, cx + rx, cy], ['Z']], filled());
        break;
      }
      case 'text': { const b = boxOf(P[0], P[1]); path(poly(rectPts(b), true), filled()); textBox(b); break; }
      case 'callout': {
        const b = boxOf(P[1], P[2]), tip = P[0];
        const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
        const cands = [{ x: b.x0, y: cy }, { x: b.x1, y: cy }, { x: cx, y: b.y0 }, { x: cx, y: b.y1 }];
        let at = cands[0];
        for (const c of cands) if (G.dist(c, tip) < G.dist(at, tip)) at = c;
        path(poly([at, tip]), { dash: null });
        const ang = Math.atan2(tip.y - at.y, tip.x - at.x), s = Math.max(7, w * 5);
        const h = (da) => ({ x: tip.x - s * Math.cos(ang + da), y: tip.y - s * Math.sin(ang + da) });
        path(poly([tip, h(0.4), h(-0.4)], true), { fill: m.stroke, fillAlpha: a, dash: null });
        path(poly(rectPts(b), true), filled());
        textBox(b);
        break;
      }
      case 'pen': path(poly(P), { dash: null }); break;
      case 'hlpen': path(poly(P), { dash: null, blend: 'multiply' }); break;
      case 'count': {
        const r = m.size || 6, k = 0.5523;
        for (const p of P)
          path([['M', p.x + r, p.y], ['C', p.x + r, p.y + r * k, p.x + r * k, p.y + r, p.x, p.y + r], ['C', p.x - r * k, p.y + r, p.x - r, p.y + r * k, p.x - r, p.y],
            ['C', p.x - r, p.y - r * k, p.x - r * k, p.y - r, p.x, p.y - r], ['C', p.x + r * k, p.y - r, p.x + r, p.y - r * k, p.x + r, p.y], ['Z']],
            { fill: m.stroke, fillAlpha: 0.85 * a, stroke: '#ffffff', w: Math.max(0.75, r * 0.15), dash: null });
        break;
      }
    }
    return out;
  }

  function itemsBBox(items, measure) {
    const pts = [];
    let pad = 1;
    for (const it of items) {
      if (it.k === 'path') {
        pad = Math.max(pad, (it.w || 0) * 1.5 + 1);
        for (const op of it.ops) for (let i = 1; i + 1 < op.length; i += 2) pts.push({ x: op[i], y: op[i + 1] });
      } else {
        const tw = measure(it.text, it.size), u = G.rot({ x: 1, y: 0 }, it.angle), v = G.rot({ x: 0, y: 1 }, it.angle);
        for (const [du, dv] of [[0, -it.size * 0.3], [tw, -it.size * 0.3], [tw, it.size], [0, it.size]]) pts.push({ x: it.x + u.x * du + v.x * dv, y: it.y + u.y * du + v.y * dv });
      }
    }
    if (!pts.length) return null;
    const b = G.bbox(pts);
    return { x0: b.x0 - pad, y0: b.y0 - pad, x1: b.x1 + pad, y1: b.y1 + pad };
  }

  /** Paint a display list. M = [A,B,C,D,E,F] maps PDF space to canvas pixels. */
  function paint(ctx, items, M) {
    for (const it of items) {
      ctx.save();
      if (it.k === 'path') {
        ctx.setTransform(M[0], M[1], M[2], M[3], M[4], M[5]);
        ctx.beginPath();
        for (const op of it.ops) {
          if (op[0] === 'M') ctx.moveTo(op[1], op[2]);
          else if (op[0] === 'L') ctx.lineTo(op[1], op[2]);
          else if (op[0] === 'C') ctx.bezierCurveTo(op[1], op[2], op[3], op[4], op[5], op[6]);
          else ctx.closePath();
        }
        if (it.fill) { ctx.globalAlpha = it.fillAlpha; ctx.fillStyle = it.fill; ctx.fill(); }
        if (it.stroke && it.w > 0) {
          ctx.globalAlpha = it.alpha; ctx.strokeStyle = it.stroke; ctx.lineWidth = it.w;
          ctx.lineJoin = 'round'; ctx.lineCap = 'round';
          if (it.dash) { ctx.setLineDash(it.dash); ctx.lineCap = 'butt'; }
          ctx.stroke();
        }
      } else {
        const r = (it.angle * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
        const px = M[0] * it.x + M[2] * it.y + M[4], py = M[1] * it.x + M[3] * it.y + M[5];
        const vx = M[0] * c + M[2] * s, vy = M[1] * c + M[3] * s, k = Math.hypot(M[0], M[1]);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.translate(px, py);
        ctx.rotate(Math.atan2(vy, vx));
        ctx.globalAlpha = it.alpha;
        ctx.fillStyle = it.color;
        ctx.font = `${it.size * k}px Helvetica, Arial, sans-serif`;
        ctx.fillText(it.text, 0, 0);
      }
      ctx.restore();
    }
  }

  MK.Shapes = { build, itemsBBox, paint, wrap };
})();
