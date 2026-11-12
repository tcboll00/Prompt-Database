/* Markline PDF I/O: markups are stored as standard PDF annotations (with appearance
   streams, so every viewer draws them) plus a private JSON copy for exact round-trips. */
(function () {
  'use strict';
  const MK = window.MK;
  const { PDFDocument, PDFName, PDFString, PDFHexString, PDFNumber, PDFArray, PDFDict, PDFRef, StandardFonts, degrees } = window.PDFLib;
  const N = (s) => PDFName.of(s);
  const KEY = 'MKLData', DOCKEY = 'MKLDoc';

  MK.uid = () => 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  MK.scaleFor = (d, pi) => d.scales.pages[pi] || d.scales.all || MK.Units.DEFAULT_SCALE;

  const n2 = (v) => { const s = (+v).toFixed(3); return s.replace(/\.?0+$/, '') || '0'; };
  const rgb = (hex) => [1, 3, 5].map((i) => n2(parseInt(hex.slice(i, i + 2), 16) / 255)).join(' ');
  const rgbArr = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const toHex = (c) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, '0')).join('');

  function makeCleaner(font) {
    const ok = new Map();
    const can = (ch) => {
      if (!ok.has(ch)) { try { font.encodeText(ch); ok.set(ch, true); } catch (e) { ok.set(ch, false); } }
      return ok.get(ch);
    };
    return (s) => Array.from(String(s).replace(/\t/g, '    ')).map((ch) => (ch === '\n' || can(ch) ? ch : '?')).join('');
  }

  function toContent(items, font, gsNames) {
    const gs = (CA, ca, bm) => {
      const k = `${n2(CA)}_${n2(ca)}_${bm || ''}`;
      if (!gsNames.has(k)) gsNames.set(k, { name: 'GS' + gsNames.size, CA, ca, bm });
      return gsNames.get(k).name;
    };
    let s = '';
    for (const it of items) {
      if (it.k === 'path') {
        const st = it.stroke && it.w > 0;
        if (!st && !it.fill) continue;
        s += `q /${gs(st ? it.alpha : 1, it.fill ? it.fillAlpha : 1, it.blend)} gs 1 J 1 j `;
        if (st) s += `${n2(it.w)} w ${rgb(it.stroke)} RG ` + (it.dash ? `0 J [${it.dash.map(n2).join(' ')}] 0 d ` : '');
        if (it.fill) s += `${rgb(it.fill)} rg `;
        for (const op of it.ops) {
          if (op[0] === 'M') s += `${n2(op[1])} ${n2(op[2])} m `;
          else if (op[0] === 'L') s += `${n2(op[1])} ${n2(op[2])} l `;
          else if (op[0] === 'C') s += op.slice(1).map(n2).join(' ') + ' c ';
          else s += 'h ';
        }
        s += (st && it.fill ? 'B' : st ? 'S' : 'f') + ' Q\n';
      } else if (it.text) {
        const r = (it.angle * Math.PI) / 180, c = n2(Math.cos(r)), sn = n2(Math.sin(r)), ns = n2(-Math.sin(r));
        s += `q /${gs(1, it.alpha)} gs BT ${rgb(it.color)} rg /F1 ${n2(it.size)} Tf ${c} ${sn} ${ns} ${c} ${n2(it.x)} ${n2(it.y)} Tm ${font.encodeText(it.text).toString()} Tj ET Q\n`;
      }
    }
    return s;
  }

  const SUBTYPE = {
    text: 'FreeText', callout: 'FreeText', line: 'Line', arrow: 'Line', length: 'Line', rect: 'Square', highlight: 'Square', ellipse: 'Circle',
    polygon: 'Polygon', area: 'Polygon', perimeter: 'Polygon', volume: 'Polygon', polyline: 'PolyLine', polylength: 'PolyLine', pen: 'Ink', hlpen: 'Ink', count: 'Ink',
  };
  const INTENT = { callout: 'FreeTextCallout', length: 'LineDimension', area: 'PolygonDimension', perimeter: 'PolygonDimension', volume: 'PolygonDimension', polylength: 'PolyLineDimension', arrow: 'LineArrow' };

  function pdfDate(ms) {
    const d = new Date(ms || Date.now()), p = (n) => String(n).padStart(2, '0');
    return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
  }

  /** Returns Uint8Array of the document with all markups written as annotations. */
  async function exportPdf(d) {
    const pdf = await PDFDocument.load(d.bytes, { updateMetadata: false });
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const ctx = pdf.context, pages = pdf.getPages();
    const clean = makeCleaner(font);
    const measure = (t, s) => font.widthOfTextAtSize(t, s);
    const U = MK.Units;
    for (const m of d.markups) {
      const page = pages[m.page];
      if (!page) continue;
      const rot = ((page.getRotation().angle % 360) + 360) % 360;
      const sc = MK.scaleFor(d, m.page);
      const items = MK.Shapes.build(m, { scale: sc, measure, rot, clean });
      const bb = MK.Shapes.itemsBBox(items, measure);
      if (!bb) continue;
      const gsNames = new Map();
      const content = toContent(items, font, gsNames);
      const ext = {};
      for (const g of gsNames.values()) ext[g.name] = Object.assign({ Type: 'ExtGState', CA: g.CA, ca: g.ca }, g.bm ? { BM: 'Multiply' } : {});
      const ap = ctx.register(ctx.flateStream(content, {
        Type: 'XObject', Subtype: 'Form', FormType: 1, BBox: [bb.x0, bb.y0, bb.x1, bb.y1],
        Resources: { ExtGState: ext, Font: { F1: font.ref } },
      }));
      const flat = (pts) => pts.flatMap((p) => [p.x, p.y]);
      const o = {
        Type: 'Annot', Subtype: SUBTYPE[m.type], Rect: [bb.x0, bb.y0, bb.x1, bb.y1], F: 4, AP: { N: ap },
        C: rgbArr(m.stroke || '#000000'), CA: m.alpha ?? 1, BS: { Type: 'Border', W: m.w ?? 1, S: m.dash ? 'D' : 'S' },
      };
      if (m.dash) o.BS.D = [3, 2];
      if (m.fill) o.IC = rgbArr(m.fill);
      if (INTENT[m.type]) o.IT = INTENT[m.type];
      const P = m.pts;
      if (o.Subtype === 'Line') { o.L = flat(P); o.LE = ['None', m.type === 'arrow' ? 'ClosedArrow' : m.type === 'length' ? 'Butt' : 'None']; }
      else if (o.Subtype === 'Polygon' || o.Subtype === 'PolyLine') { o.Vertices = flat(P); if (m.cloud) o.BE = { S: 'C', I: 1 }; }
      else if (o.Subtype === 'Ink') o.InkList = m.type === 'count' ? P.map((p) => [p.x, p.y, p.x, p.y]) : [flat(P)];
      else if (m.type === 'callout') o.CL = [P[0].x, P[0].y, (P[1].x + P[2].x) / 2, (P[1].y + P[2].y) / 2];
      if (MK.TYPES[m.type].measure && m.type !== 'count') {
        const f = U.factor(sc);
        const nf = (u, c) => ({ Type: 'NumberFormat', U: PDFString.of(u), C: c, F: 'D', D: Math.pow(10, sc.prec ?? 2) });
        o.Measure = { Type: 'Measure', Subtype: 'RL', R: PDFString.of(sc.label || ''), X: [nf(sc.unit, f)], D: [nf(sc.unit, 1)], A: [nf(U.AREA_U[sc.unit], 1)] };
      }
      const dict = ctx.obj(o);
      const isText = m.type === 'text' || m.type === 'callout';
      const contents = isText ? m.text || '' : MK.TYPES[m.type].measure ? U.caption(m, sc) + (m.comment ? '\n' + m.comment : '') : m.comment || '';
      dict.set(N('Contents'), PDFHexString.fromText(contents));
      dict.set(N('T'), PDFHexString.fromText(m.author || 'Markline'));
      dict.set(N('Subj'), PDFHexString.fromText(m.subject || MK.TYPES[m.type].name));
      dict.set(N('NM'), PDFString.of(m.id));
      dict.set(N('M'), PDFString.of(pdfDate(m.date)));
      if (isText) dict.set(N('DA'), PDFString.of(`${rgb(m.tc || m.stroke)} rg /Helv ${n2(m.fs || 12)} Tf`));
      const copy = Object.assign({}, m);
      delete copy.page;
      dict.set(N(KEY), PDFHexString.fromText(JSON.stringify(copy)));
      let annots = page.node.Annots();
      if (!annots) { annots = ctx.obj([]); page.node.set(N('Annots'), annots); }
      annots.push(ctx.register(dict));
    }
    pdf.catalog.set(N(DOCKEY), PDFHexString.fromText(JSON.stringify({ v: 1, scales: d.scales })));
    return pdf.save();
  }

  // ---------- import ----------
  function reader(ctx) {
    const get = (a, k) => a.lookup(N(k));
    const num = (v) => { if (v instanceof PDFRef) v = ctx.lookup(v); return v instanceof PDFNumber ? v.asNumber() : 0; };
    return {
      get,
      name(a, k) { const v = get(a, k); return v instanceof PDFName ? v.decodeText() : null; },
      str(a, k) { const v = get(a, k); return v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : ''; },
      nums(a, k) { const v = get(a, k); return v instanceof PDFArray ? v.asArray().map(num) : null; },
      num(a, k, def) { const v = get(a, k); return v instanceof PDFNumber ? v.asNumber() : def; },
      color(a, k) {
        const c = this.nums(a, k);
        if (!c || !c.length) return null;
        if (c.length === 1) return toHex([c[0], c[0], c[0]]);
        if (c.length === 3) return toHex(c);
        if (c.length === 4) return toHex([1 - Math.min(1, c[0] + c[3]), 1 - Math.min(1, c[1] + c[3]), 1 - Math.min(1, c[2] + c[3])]);
        return null;
      },
    };
  }
  const pairs = (arr) => { const o = []; for (let i = 0; i + 1 < arr.length; i += 2) o.push({ x: arr[i], y: arr[i + 1] }); return o; };

  /** Convert a foreign (Bluebeam, Acrobat, …) annotation into Markline markups; [] if unsupported. */
  function convert(a, R) {
    const sub = R.name(a, 'Subtype'), it = R.name(a, 'IT') || '';
    const rect = R.nums(a, 'Rect');
    const common = { id: MK.uid(), author: R.str(a, 'T'), subject: R.str(a, 'Subj'), comment: R.str(a, 'Contents'), date: Date.now() };
    const stroke = R.color(a, 'C'), fill = R.color(a, 'IC');
    const bs = R.get(a, 'BS');
    let w = bs instanceof PDFDict ? R.num(bs, 'W', 1) : (R.nums(a, 'Border') || [0, 0, 1])[2];
    const dash = bs instanceof PDFDict && R.name(bs, 'S') === 'D';
    const style = { stroke: stroke || '#000000', w: stroke ? w : 0, alpha: R.num(a, 'CA', 1), dash };
    const mk = (type, pts, extra) => Object.assign({}, MK.BASE[type], common, style, { type, pts }, extra);
    const be = R.get(a, 'BE'), cloud = be instanceof PDFDict && R.name(be, 'S') === 'C';
    switch (sub) {
      case 'Square': case 'Circle': {
        if (!rect) return [];
        const rd = R.nums(a, 'RD') || [0, 0, 0, 0];
        const pts = [{ x: Math.min(rect[0], rect[2]) + rd[0], y: Math.min(rect[1], rect[3]) + rd[1] }, { x: Math.max(rect[0], rect[2]) - rd[2], y: Math.max(rect[1], rect[3]) - rd[3] }];
        return [mk(sub === 'Square' ? 'rect' : 'ellipse', pts, { fill, fillAlpha: 1, cloud })];
      }
      case 'Line': {
        const L = R.nums(a, 'L');
        if (!L || L.length < 4) return [];
        let pts = pairs(L);
        const le = R.get(a, 'LE'), ends = le instanceof PDFArray ? le.asArray().map((x) => (x instanceof PDFName ? x.decodeText() : '')) : [];
        if (it === 'LineDimension') return [mk('length', pts, { tc: style.stroke, comment: '' })];
        const a0 = /Arrow/.test(ends[0] || ''), a1 = /Arrow/.test(ends[1] || '');
        if (a0 && !a1) pts = pts.reverse();
        return [mk(a0 || a1 ? 'arrow' : 'line', pts)];
      }
      case 'Polygon': case 'PolyLine': {
        const v = R.nums(a, 'Vertices');
        if (!v || v.length < 4) return [];
        const pts = pairs(v);
        if (it === 'PolygonDimension' && pts.length > 2) return [mk('area', pts, { fill: fill || style.stroke, fillAlpha: fill ? 0.35 : 0.25, tc: style.stroke, comment: '' })];
        if (it === 'PolyLineDimension') return [mk('polylength', pts, { tc: style.stroke, comment: '' })];
        if (sub === 'Polygon' && pts.length > 2) return [mk('polygon', pts, { fill, fillAlpha: 1, cloud })];
        return [mk('polyline', pts)];
      }
      case 'Ink': {
        const il = R.get(a, 'InkList');
        if (!(il instanceof PDFArray)) return [];
        const out = [];
        for (let i = 0; i < il.size(); i++) {
          const s = il.lookup(i);
          if (!(s instanceof PDFArray)) continue;
          const pts = pairs(s.asArray().map((x) => (x instanceof PDFNumber ? x.asNumber() : 0)));
          if (pts.length > 1) out.push(mk('pen', pts, { id: MK.uid() }));
        }
        return out;
      }
      case 'Highlight': {
        if (!rect) return [];
        return [mk('highlight', [{ x: rect[0], y: rect[1] }, { x: rect[2], y: rect[3] }], { fill: stroke || '#ffe600', fillAlpha: 0.4, w: 0, stroke: stroke || '#ffe600' })];
      }
      case 'FreeText': {
        if (!rect) return [];
        const rd = R.nums(a, 'RD') || [0, 0, 0, 0];
        const b0 = { x: Math.min(rect[0], rect[2]) + rd[0], y: Math.min(rect[1], rect[3]) + rd[1] }, b1 = { x: Math.max(rect[0], rect[2]) - rd[2], y: Math.max(rect[1], rect[3]) - rd[3] };
        const da = R.str(a, 'DA');
        const fsM = /([\d.]+)\s+Tf/.exec(da), colM = /([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/.exec(da);
        const tc = colM ? toHex([+colM[1], +colM[2], +colM[3]]) : '#000000';
        // For FreeText, /C is the background and the border follows the text colour.
        const extra = { text: common.comment, comment: '', fs: fsM && +fsM[1] > 0 ? +fsM[1] : 12, tc, stroke: tc, w, fill: stroke, fillAlpha: 1 };
        const cl = R.nums(a, 'CL');
        if (cl && cl.length >= 4) return [mk('callout', [{ x: cl[0], y: cl[1] }, b0, b1], extra)];
        return [mk('text', [b0, b1], extra)];
      }
    }
    return [];
  }

  /** Reads a PDF, lifts editable annotations out of it. Returns { bytes, markups, scales }. */
  async function importPdf(bytes) {
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    const ctx = pdf.context, R = reader(ctx);
    const markups = [];
    let scales = { all: null, pages: {} }, changed = false;
    const dk = pdf.catalog.lookup(N(DOCKEY));
    if (dk instanceof PDFHexString || dk instanceof PDFString) {
      try { const j = JSON.parse(dk.decodeText()); if (j.scales) scales = Object.assign(scales, j.scales); } catch (e) { /* ignore */ }
    }
    pdf.getPages().forEach((page, pi) => {
      const annots = page.node.Annots();
      if (!annots) return;
      const drop = new Set();
      for (let i = 0; i < annots.size(); i++) {
        const ref = annots.get(i);
        const a = annots.lookupMaybe(i, PDFDict);
        if (!a) continue;
        let got = [];
        const raw = a.lookup(N(KEY));
        if (raw instanceof PDFHexString || raw instanceof PDFString) {
          try { const m = JSON.parse(raw.decodeText()); if (m && MK.TYPES[m.type] && Array.isArray(m.pts)) got = [m]; } catch (e) { /* fall through */ }
        }
        if (!got.length) {
          try { got = convert(a, R); } catch (e) { got = []; }
          if (got.length && !scales.pages[pi] && !scales.all) {
            const ms = a.lookup(N('Measure'));
            if (ms instanceof PDFDict) {
              const X = ms.lookup(N('X'));
              const nf = X instanceof PDFArray ? X.lookupMaybe(0, PDFDict) : null;
              const u = nf ? (/^\s*(ft|in|yd|mm|cm|m)\b/i.exec(R.str(nf, 'U')) || [])[1] : null;
              const c = nf ? R.num(nf, 'C', 0) : 0;
              if (u && c > 0) scales.pages[pi] = { label: R.str(ms, 'R') || 'Imported scale', paper: 1, real: c * 72, unit: u.toLowerCase(), prec: 2 };
            }
          }
        }
        if (!got.length) continue;
        for (const m of got) { m.page = pi; markups.push(m); }
        drop.add(ref);
        const pop = a.get(N('Popup'));
        if (pop instanceof PDFRef) drop.add(pop);
        const ap = a.get(N('AP'));
        const apd = ap instanceof PDFRef ? ctx.lookup(ap) : ap;
        if (apd instanceof PDFDict) { const n = apd.get(N('N')); if (n instanceof PDFRef) ctx.delete(n); }
        if (ap instanceof PDFRef) ctx.delete(ap);
      }
      if (drop.size) {
        changed = true;
        for (let i = annots.size() - 1; i >= 0; i--) {
          const ref = annots.get(i);
          if (drop.has(ref)) { annots.remove(i); if (ref instanceof PDFRef) ctx.delete(ref); }
        }
      }
    });
    return { bytes: changed ? await pdf.save() : bytes, markups, scales };
  }

  // ---------- page operations (operate on the annotation-free base bytes) ----------
  async function rotatePage(bytes, pi, delta) {
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    const p = pdf.getPage(pi);
    p.setRotation(degrees((((p.getRotation().angle + delta) % 360) + 360) % 360));
    return pdf.save();
  }
  async function deletePage(bytes, pi) {
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    pdf.removePage(pi);
    return pdf.save();
  }
  async function insertPages(bytes, at, otherBytes) {
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    const other = await PDFDocument.load(otherBytes, { updateMetadata: false });
    const copied = await pdf.copyPages(other, other.getPageIndices());
    copied.forEach((p, i) => pdf.insertPage(at + i, p));
    return { bytes: await pdf.save(), count: copied.length };
  }

  MK.IO = { exportPdf, importPdf, rotatePage, deletePage, insertPages };
})();
