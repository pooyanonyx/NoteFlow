// Drawing of NoteFlow items to a 2D canvas. The same code draws on screen and for PDF export,
// so what you see is what you export. Units are page points (1 pt = 1 user unit of the canvas).
import * as M from "./model.js";
import * as P from "./paper.js";
import * as RT from "./richtext.js";
import * as BD from "./bidi.js";

// Vazirmatn (bundled, see css/app.css) covers the Arabic script block so Persian looks the same on every device.
export const FONT_STACK = P.FONT_STACK;
const RTL_RE = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
const LTR_RE = /[A-Za-z]/;
export const TEXT_PAD = 4;

export function isRtl(line) {                                // direction of the first strong letter
  for (const ch of line) { if (RTL_RE.test(ch)) return true; if (LTR_RE.test(ch)) return false; }
  return false;
}

// ---------------------------------------------------------------- measuring
let _mctx = null;
export function measureCtx() {
  if (!_mctx) { _mctx = document.createElement("canvas").getContext("2d"); if ("textRendering" in _mctx) _mctx.textRendering = "geometricPrecision"; }   // (no hinting: widths scale exactly with the zoom, so lines wrap the same at every zoom)
  return _mctx;
}
// Text is measured through one function so the layout also runs without a browser (unit tests set their own measurer).
let provider = null, layoutCache = new WeakMap();
const metricsCache = new Map();
export let fontEpoch = 0;                                        // bumped when a font finishes loading: cached layouts are measured again
export function setMeasureProvider(p) { provider = p; metricsCache.clear(); layoutCache = new WeakMap(); }
export function bumpFontEpoch() { fontEpoch++; metricsCache.clear(); layoutCache = new WeakMap(); }
function widthOf(font, str) {
  if (provider) return provider.width(font, str);
  const c = measureCtx(); if (c.font !== font) c.font = font;
  return c.measureText(str).width;
}
/** Ascent / descent of a font as the browser's line box uses them (the baseline of a line box is half-leading + ascent). */
export function fontMetrics(font) {
  let m = metricsCache.get(font);
  if (!m) {
    if (provider) m = provider.metrics(font);
    else {
      const c = measureCtx(); c.font = font;
      const t = c.measureText("Hxg\u0645\u0639"), sz = parseFloat((/(\d+(?:\.\d+)?)px/.exec(font) || [0, 16])[1]);
      m = { asc: t.fontBoundingBoxAscent ?? sz * 0.95, desc: t.fontBoundingBoxDescent ?? sz * 0.3 };
    }
    metricsCache.set(font, m);
  }
  return m;
}
/** Explicit {dir, align} of a text / note item, or null for old items (direction then detected per line). */
export function fmtOf(d) {
  if (d.dir !== "rtl" && d.dir !== "ltr") return null;
  return { dir: d.dir, align: d.align === "center" || d.align === "right" || d.align === "left" ? d.align : (d.dir === "rtl" ? "right" : "left") };
}
/** What the format buttons show for an item: its explicit format, or the one implied by its first strong letter. */
export function effectiveFmt(d) {
  const f = fmtOf(d);
  if (f) return f;
  const rtl = isRtl(String(d.text || ""));
  return { dir: rtl ? "rtl" : "ltr", align: rtl ? "right" : "left" };
}
const segmenter = typeof Intl !== "undefined" && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
const graphemes = (s) => (segmenter ? [...segmenter.segment(s)].map((x) => x.segment) : Array.from(s));       // (keeps Persian letters + marks together)
function breakWord(ctx, word, maxWidth) {
  const parts = []; let cur = "";
  for (const g of graphemes(word)) {
    const t = cur + g;
    if (cur && ctx.measureText(t).width > maxWidth) { parts.push(cur); cur = g; } else cur = t;
  }
  if (cur) parts.push(cur);
  return parts;
}
/** Break text into lines. maxWidth = null: only explicit newlines. fmt: explicit {dir, align} or null.
 *  ruled: the line pitch is a whole number of paper rules (ruledLH) instead of 1.25 x the font size. */
export function layoutText(ctx, text, size, maxWidth = null, fmt = null, ruled = false) {
  ctx.font = `${size}px ${FONT_STACK}`;
  const lh = ruled ? ruledLH(size) : size * 1.25, lines = [];
  const push = (s) => lines.push({ text: s, w: ctx.measureText(s).width, rtl: fmt ? fmt.dir === "rtl" : isRtl(s) });
  for (const para of String(text).split("\n")) {
    if (maxWidth == null) { push(para); continue; }
    let cur = "";
    for (const word of para.split(" ")) {
      const test = cur ? cur + " " + word : word;
      if (!cur || ctx.measureText(test).width <= maxWidth) cur = test;
      else { push(cur); cur = word; }
      if (ctx.measureText(cur).width > maxWidth) {                  // a word wider than the line: break it between letters (as the text box does)
        const parts = breakWord(ctx, cur, maxWidth);
        for (let i = 0; i < parts.length - 1; i++) push(parts[i]);
        cur = parts[parts.length - 1];
      }
    }
    push(cur);
  }
  return { lines, lh, width: Math.max(0, ...lines.map((l) => l.w)), height: lines.length * lh };
}
/** Width available for the lines of a text item with a fixed box width (null = unlimited, old behaviour). */
export function textInnerWidth(d) { return d.w ? Math.max(10, d.w - 2 * TEXT_PAD) : null; }
/** [x0, y0, x1, y1] of a text item (including its padding). */
export function textBox(d) {
  const mw = textInnerWidth(d), L = layoutRich(d);
  return [d.x, d.y, d.x + (mw ? mw : L.width) + 2 * TEXT_PAD, d.y + L.height + 2 * TEXT_PAD];
}
export function noteTextWidth(d) { return Math.max(20, d.w - 16); }
/** Height a note needs to show all its text. */
export function noteNeededHeight(d, text = d.text) {
  const L = layoutText(measureCtx(), text, d.size, noteTextWidth(d), fmtOf(d));
  return L.height + M.NOTE_HEADER + 12;
}

// ------------------------------------------------------------ writing on ruled paper
// Text on lined paper behaves like handwriting on a real notebook: the line pitch of a text box is the pitch of the paper (or a whole
// multiple of it for big letters) and the first line starts in a paper row, so EVERY line of EVERY text box rests on a printed rule,
// whatever the font size and however many lines are written (there is no rounding that could add up from line to line).
//   cell i of a ruled text item spans   [top + i*lh, top + (i+1)*lh]   with   top = d.y + TEXT_PAD   (always a rule position)
//   the baseline of line i is           top + (i+1)*lh - RULED_LIFT     (a hair above the rule the line stands on)
export const RULED_LEADING = 1.2;                       // a line needs at least this many font sizes of height, else it takes one more rule
export const RULED_LIFT = 1;                            // baseline sits this far above its rule (points)
export const ruledLH = (size, pitch = M.RULE_PITCH) => pitch * Math.max(1, Math.ceil(size * RULED_LEADING / pitch - 1e-9));
/** y of the last printed rule of a lined page of height h. */
export function lastRuleY(h, pitch = M.RULE_PITCH, limit = h - M.RULE_BOTTOM) { return M.RULE_TOP + pitch * (Math.ceil((limit - M.RULE_TOP) / pitch - 1e-9) - 1); }
/** Nearest position of a paper rule (the lattice also continues above the first printed rule). */
export const nearestRule = (y, pitch = M.RULE_PITCH) => M.RULE_TOP + pitch * Math.round((y - M.RULE_TOP) / pitch);
/** Item y for a new ruled text item that the user tapped at page y = py: the first line goes in the paper row that was tapped. */
export function ruledYFromTap(py, size, pageH, pitch = M.RULE_PITCH, lastRule = lastRuleY(pageH, pitch)) {
  let n = Math.max(-1, Math.floor((py - M.RULE_TOP) / pitch));                                  // row n lies between rule n and rule n + 1
  const maxN = Math.floor((lastRule - ruledLH(size, pitch) - M.RULE_TOP) / pitch);               // the first line must still stand on a printed rule
  n = Math.min(n, Math.max(-1, maxN));
  return M.RULE_TOP + n * pitch - TEXT_PAD;
}
/** A ruled text item moved onto the paper lattice (y -> the nearest row). Other items are returned unchanged. */
export function ruledNormalize(d) {
  if (!d || d.t !== "text" || d.ruled !== true) return d;
  const y = Math.round((nearestRule(d.y + TEXT_PAD, d.rp || M.RULE_PITCH) - TEXT_PAD) * 100) / 100;
  return y === d.y ? d : { ...d, y };
}
// Where does the browser put the baseline inside a line box? (distance from the top of a line box of the given line height to its baseline)
// Measured, not computed from font metrics, so the text box that is shown while typing lands its baseline exactly on the rule that the
// canvas draws the finished text on, whatever font the browser really uses.
let _probe = null; const _baselines = new Map();
export function domBaseline(fontPx, lineHeightPx) {
  const key = fontPx.toFixed(3) + "|" + lineHeightPx.toFixed(3), hit = _baselines.get(key);
  if (hit !== undefined) return hit;
  if (!_probe) {
    _probe = document.createElement("div"); _probe.setAttribute("aria-hidden", "true");
    _probe.style.cssText = "position:fixed;left:-9999px;top:0;width:300px;margin:0;padding:0;border:0;overflow:hidden;visibility:hidden;pointer-events:none;white-space:pre;";
    _probe.innerHTML = '<span>Hx\u0645</span><span style="display:inline-block;width:0;height:0"></span>';    // a zero-height inline-block sits ON the baseline
    document.body.appendChild(_probe);
  }
  _probe.style.fontFamily = FONT_STACK; _probe.style.fontSize = fontPx + "px"; _probe.style.lineHeight = lineHeightPx + "px";
  const b = _probe.lastChild.getBoundingClientRect().bottom - _probe.getBoundingClientRect().top;
  if (!document.fonts || document.fonts.status === "loaded") _baselines.set(key, b);        // (not cached while the bundled font is still loading)
  return b;
}

// ------------------------------------------------------------------- images
const imageCache = new Map();           // base64 -> {img, ok, promise}
export let assetEpoch = 0;              // bumped when a picture finishes decoding: cached page bitmaps that show its placeholder are drawn again
let onImageLoaded = () => {};
export function setImageLoadedCallback(fn) { onImageLoaded = fn; }
export function getImage(data) {
  let e = imageCache.get(data);
  if (!e) {
    const img = new Image();
    e = { img, ok: false, failed: false };
    e.promise = new Promise((resolve) => {
      img.onload = () => { e.ok = true; assetEpoch++; resolve(); onImageLoaded(); };
      img.onerror = () => { e.failed = true; assetEpoch++; resolve(); onImageLoaded(); };
    });
    img.src = "data:image/png;base64," + data;
    if (imageCache.size > 40) imageCache.delete(imageCache.keys().next().value);
    imageCache.set(data, e);
  }
  return e;
}
export function preloadImages(items) {
  return Promise.all(items.filter((d) => d.t === "image").map((d) => getImage(d.data).promise));
}

// -------------------------------------------------------------------- paths
function strokePath(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  const n = pts.length;
  if (n === 1) ctx.lineTo(pts[0][0] + 0.01, pts[0][1]);
  else if (n === 2) ctx.lineTo(pts[1][0], pts[1][1]);
  else {
    for (let i = 1; i < n - 1; i++) {
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2);
    }
    ctx.lineTo(pts[n - 1][0], pts[n - 1][1]);
  }
}
function linePath(ctx, d, arrow) {
  ctx.beginPath();
  ctx.moveTo(d.x1, d.y1);
  ctx.lineTo(d.x2, d.y2);
  if (arrow) {
    const len = Math.hypot(d.x2 - d.x1, d.y2 - d.y1);
    if (len > 0.01) {
      const head = Math.min(Math.max(10, d.w * 4), len), ang = Math.atan2(d.y2 - d.y1, d.x2 - d.x1);
      for (const s of [1, -1]) {
        const a = ang + Math.PI - s * (28 * Math.PI / 180);
        ctx.moveTo(d.x2, d.y2);
        ctx.lineTo(d.x2 + head * Math.cos(a), d.y2 + head * Math.sin(a));
      }
    }
  }
}
const mixCss = (hex, bright) => {
  const [r, g, b] = M.adjustBrightness(M.parseHex(hex) || [0, 0, 0], bright);
  return `rgb(${r},${g},${b})`;
};

// ------------------------------------------------------------------- paper
// (drawing, geometry and settings of the papers: paper.js; `kind` may be a paper name or a page object with its settings)
export const drawPaper = P.drawPaper;

// -------------------------------------------------------------------- text
// Lines are drawn with the browser's own text engine (canvas fillText): it shapes Persian/Arabic letters and runs the
// Unicode bidi algorithm using ctx.direction as the paragraph direction. Alignment is physical (left/center/right), so
// direction and alignment are independent. fmt = null: old items (per-line detected direction, RTL lines right-aligned).
function drawTextLines(ctx, L, x, y, blockWidth, size, fill, fmt = null, ruled = false) {
  ctx.font = `${size}px ${FONT_STACK}`;
  ctx.textBaseline = "alphabetic";                            // ruled: the line stands on its rule (exact baseline); else the baseline of a browser line box, so a text box and the canvas agree
  if ("textRendering" in ctx) ctx.textRendering = "geometricPrecision";
  ctx.fillStyle = fill;
  const fm = ruled ? null : fontMetrics(ctx.font);
  L.lines.forEach((ln, i) => {
    const ly = ruled ? y + (i + 1) * L.lh - RULED_LIFT : y + i * L.lh + (L.lh - (fm.asc + fm.desc)) / 2 + fm.asc;
    const align = fmt ? fmt.align : (ln.rtl ? "right" : "left");
    ctx.direction = ln.rtl ? "rtl" : "ltr"; ctx.textAlign = align;
    const ax = align === "right" ? x + blockWidth : align === "center" ? x + blockWidth / 2 : x;
    ctx.fillText(ln.text, ax, ly);
  });
  ctx.direction = "ltr"; ctx.textAlign = "left";
}

// ------------------------------------------------------------ rich text layout
// One layout for every text box (plain or formatted, free or on the lines): paragraphs -> styled pieces -> words -> lines.
// A line is {start, end, segs, w, h, base, rtl, indent, marker, para, num}: start / end are character offsets in the box's text (used for the
// caret, for formatting and for continuing a long text on the next page); segs are the pieces to draw (single style each); h is the height of the
// line's cell (a whole number of paper rules on ruled text, else 1.25 x the biggest font size on the line); base is the baseline inside the cell.
export const listIndent = (size) => Math.max(18, size * 1.5);
export const LINE_FACTOR = 1.25;
const fontOf = (size, st) => `${st && st.i ? "italic " : ""}${st && st.b ? "bold " : ""}${size}px ${FONT_STACK}`;
const isHyphen = (c) => c === "-" || c === "\u2010" || c === "\u2013" || c === "\u2014";
const CJK_RE = /[\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF]/, NO_BREAK_BEFORE = /[)\]}\u00bb\u201d\u2019\u060c\u061b.,;:!?\u3002\u3001\u300d\u300f\uff09\u3011]/, NO_BREAK_AFTER = /[(\[{\u00ab\u201c\u2018\u300c\u300e\uff08\u3010]/;
/** Cut a piece of text into chunks; br = a line may break after the chunk (after spaces, hyphens, between CJK characters), like the browser does. */
export function chunks(str) {
  const out = []; let i = 0; const n = str.length;
  while (i < n) {
    if (str[i] === " ") { let j = i; while (j < n && str[j] === " ") j++; out.push({ s: str.slice(i, j), space: true, br: true }); i = j; continue; }
    let j = i, br = false;
    while (j < n && str[j] !== " ") {
      const c = str[j++], nx = str[j];
      if (nx !== undefined && nx !== " " && ((isHyphen(c) && /[\p{L}\p{N}]/u.test(nx)) || ((CJK_RE.test(c) || CJK_RE.test(nx)) && !NO_BREAK_BEFORE.test(nx) && !NO_BREAK_AFTER.test(c)))) { br = true; break; }
    }
    out.push({ s: str.slice(i, j), space: false, br }); i = j;
  }
  return out;
}
function unitsOf(pieces, baseSize) {                 // pieces [{text, start, st}] -> units: words with the spaces that follow them
  const units = []; let cur = null;
  for (const pc of pieces) {
    let off = pc.start; const size = pc.st.z ?? baseSize, font = fontOf(size, pc.st);
    for (const ch of chunks(pc.text)) {
      if (!cur) cur = { frags: [], space: null, wordW: 0, spaceW: 0 };
      const frag = { text: ch.s, start: off, end: off + ch.s.length, st: pc.st, size, font, w: widthOf(font, ch.s) };
      off = frag.end;
      if (ch.space) { cur.space = frag; cur.spaceW = frag.w; units.push(cur); cur = null; }
      else { cur.frags.push(frag); cur.wordW += frag.w; if (ch.br) { units.push(cur); cur = null; } }
    }
  }
  if (cur) units.push(cur);
  return units;
}
/** Break a word that is wider than a whole line: as many letters as really fit (measured as the shaped text, like the browser's text box does: kerning and the joining of Persian / Arabic letters count), then the next line. */
function breakOverlong(unit, avail, cur, w, rows) {
  const eps = 1e-6;
  for (const f of unit.frags) {
    let text = f.text, start = f.start;
    while (text) {
      const room = avail - w, whole = widthOf(f.font, text);
      if (whole <= room + eps) { cur.push({ ...f, text, start, end: start + text.length, w: whole }); w += whole; break; }
      const g = graphemes(text), ends = []; let pos = 0;
      for (const x of g) { pos += x.length; ends.push(pos); }
      let lo = 0, hi = ends.length - 1;                              // the most letters whose shaped width fits the room (binary search: widths only grow)
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (widthOf(f.font, text.slice(0, ends[mid - 1])) <= room + eps) lo = mid; else hi = mid - 1; }
      if (lo === 0) { if (cur.length) { rows.push(cur); cur = []; w = 0; continue; } lo = 1; }   // not even one letter fits an empty line: take one anyway
      const head = text.slice(0, ends[lo - 1]);
      cur.push({ ...f, text: head, start, end: start + head.length, w: widthOf(f.font, head) });
      rows.push(cur); cur = []; w = 0;
      text = text.slice(head.length); start += head.length;
    }
  }
  if (unit.space) { cur.push(unit.space); w += unit.spaceW; }
  return { cur, w };
}
function mergeSegs(frags) {                           // neighbouring pieces of one style are drawn as one
  const segs = [];
  for (const f of frags) {
    const last = segs[segs.length - 1];
    if (last && last.size === f.size && last.font === f.font && !!last.st.u === !!f.st.u && last.end === f.start) { last.text += f.text; last.end = f.end; last.w += f.w; }
    else segs.push({ text: f.text, start: f.start, end: f.end, st: f.st, size: f.size, font: f.font, w: f.w });
  }
  return segs;
}
function makeLine(frags, para, ctxp) {
  let segs = mergeSegs(frags);
  const start = segs.length ? segs[0].start : ctxp.start, end = segs.length ? segs[segs.length - 1].end : ctxp.end;
  if (segs.length) {                                  // spaces at the end of a line hang outside it (not drawn, not counted), as in the browser
    const last = segs[segs.length - 1], t = last.text.replace(/ +$/, "");
    if (t !== last.text) { if (t) { last.draw = t; last.w = widthOf(last.font, t); } else { segs.pop(); } }
  }
  const maxSize = segs.length ? Math.max(...segs.map((x) => x.size)) : ctxp.size;
  const big = segs.length ? segs.reduce((a, x) => (x.size >= a.size ? x : a), segs[0]) : null;
  return { start, end, segs, w: segs.reduce((a, x) => a + x.w, 0), maxSize, bigFont: big ? big.font : fontOf(ctxp.size, {}), para: ctxp.pi, rtl: ctxp.rtl, indent: ctxp.indent };
}
function buildLayout(d, maxWidth) {
  const size = d.size, pitch = d.rp || M.RULE_PITCH, ruled = d.ruled === true, fmt = fmtOf(d), text = String(d.text ?? "");
  const content = RT.contentOf(d), paras = RT.paragraphRanges(text), sp = RT.spans(content);
  const lines = []; let num = d.ns || 0, y = 0;
  paras.forEach((p, pi) => {
    const list = RT.listAt(content, pi), ptext = text.slice(p.start, p.end), rtl = fmt ? fmt.dir === "rtl" : isRtl(ptext);
    const indent = list ? listIndent(size) : 0, avail = maxWidth == null ? Infinity : Math.max(10, maxWidth - indent), isCont = pi === 0 && d.cont === true;
    let markerText = null;
    if (list === "n") { if (!isCont) { num++; markerText = num + "."; } } else { num = 0; if (list === "b" && !isCont) markerText = "\u2022"; }
    const pieces = sp.filter((r) => r.end > p.start && r.start < p.end).map((r) => ({ text: text.slice(Math.max(r.start, p.start), Math.min(r.end, p.end)), start: Math.max(r.start, p.start), st: r }));
    const units = unitsOf(pieces, size);
    const ctxp = { pi, rtl, indent, size, start: p.start, end: p.end };
    let cur = [], w = 0; const rows = [];
    for (const u of units) {
      if (isFinite(avail) && u.wordW > avail + 1e-6) {                // wider than a line: it starts on its own line, then breaks where the letters stop fitting
        if (cur.length) { rows.push(cur); cur = []; w = 0; }
        ({ cur, w } = breakOverlong(u, avail, cur, w, rows));
        continue;
      }
      if (cur.length && w + u.wordW > avail + 1e-6) { cur.need = w + u.wordW; rows.push(cur); cur = []; w = 0; }      // (`need`: how wide this line would have to be for the next word to fit on it)
      cur.push(...u.frags); if (u.space) cur.push(u.space); w += u.wordW + u.spaceW;
    }
    rows.push(cur);
    rows.forEach((frs, ri) => {
      const ln = makeLine(frs, p, ctxp);
      ln.num = list === "n" ? num : 0; ln.first = ri === 0; ln.need = frs.need ?? Infinity;
      if (ri === 0 && markerText) { const first = ln.segs[0]; ln.marker = { text: markerText, size: first ? first.size : size, font: fontOf(first ? first.size : size, {}) }; }
      ln.h = ruled ? pitch * Math.max(1, Math.ceil(ln.maxSize * RULED_LEADING / pitch - 1e-9)) : ln.maxSize * LINE_FACTOR;
      if (ruled) ln.base = ln.h - RULED_LIFT; else { const m = fontMetrics(ln.bigFont); ln.base = (ln.h - (m.asc + m.desc)) / 2 + m.asc; }
      ln.y = y; y += ln.h;
      if (ln.segs.length > 1) visualize(ln);
      lines.push(ln);
    });
  });
  return { lines, height: y, width: Math.max(0, ...lines.map((l) => l.w + l.indent)), content };
}
/** Pieces of a line with more than one style, in visual (left to right) order, each of one direction. */
function visualize(ln) {
  const str = ln.segs.map((s) => s.draw ?? s.text).join(""), levels = BD.resolveLevels(str, ln.rtl), pcs = []; let pos = 0;
  for (const s of ln.segs) {
    const t = s.draw ?? s.text;
    for (const r of BD.levelRuns(levels.subarray(pos, pos + t.length))) {
      const text = t.slice(r.start, r.end);
      pcs.push({ text, level: r.level, seg: s, start: s.start + r.start, end: s.start + r.end, w: r.start === 0 && r.end === t.length ? s.w : widthOf(s.font, text) });
    }
    pos += t.length;
  }
  ln.vis = BD.visualOrder(pcs); ln.visW = pcs.reduce((a, x) => a + x.w, 0);
}
/** Layout of a text item (cached per item: items are replaced, never edited in place). maxWidth null = no wrapping. */
export function layoutRich(d, maxWidth = textInnerWidth(d)) {
  if (maxWidth === textInnerWidth(d)) {
    const hit = layoutCache.get(d);
    if (hit) return hit;
    const L = buildLayout(d, maxWidth); layoutCache.set(d, L); return L;
  }
  return buildLayout(d, maxWidth);
}
// ------------------------------------------------- caret, selection and hit testing
// The caret and the selection of a text box that is being edited are computed from the layout above: the very data (fonts, widths, line breaks,
// bidi order, alignment) that draws the text. They therefore cannot disagree with the visible text. (The browser's own caret comes from a second,
// independent text engine working on an invisible copy of the text; it is rounded to device pixels, lags a frame behind the canvas and drifts
// away from the canvas text with every difference in glyph advances, so it is hidden and never trusted for the position.)
const _pieces = new WeakMap();
/** The pieces of one line in visual (left to right) order: [{start, end, text, font, size, level, w, x}] (x counted from the left end of the pieces). */
function linePieces(ln) {
  let out = _pieces.get(ln); if (out) return out;
  out = [];
  if (ln.vis) { let x = 0; for (const pc of ln.vis) { out.push({ start: pc.start, end: pc.end, text: pc.text, font: pc.seg.font, size: pc.seg.size, level: pc.level, w: pc.w, x }); x += pc.w; } }
  else if (ln.segs.length) {
    const s = ln.segs[0], t = s.draw ?? s.text, pcs = [];
    for (const r of BD.levelRuns(BD.resolveLevels(t, ln.rtl))) {
      const text = t.slice(r.start, r.end);
      pcs.push({ start: s.start + r.start, end: s.start + r.end, text, font: s.font, size: s.size, level: r.level, w: r.start === 0 && r.end === t.length ? s.w : widthOf(s.font, text) });
    }
    let x = 0; for (const pc of BD.visualOrder(pcs)) { pc.x = x; x += pc.w; out.push(pc); }
  }
  _pieces.set(ln, out); return out;
}
/** Where the pieces of a line start (left end, page units) and how wide they are: the same rules drawRichText draws with. */
function lineFrame(d, L, ln) {
  const mw = textInnerWidth(d), bw = mw ? mw : L.width, x0 = d.x + TEXT_PAD, fmt = fmtOf(d), rtl = ln.rtl;
  const cl = x0 + (rtl ? 0 : ln.indent), cr = x0 + bw - (rtl ? ln.indent : 0), cw = cr - cl, align = fmt ? fmt.align : (rtl ? "right" : "left");
  const pcs = linePieces(ln), W = pcs.length ? pcs[pcs.length - 1].x + pcs[pcs.length - 1].w : 0;
  const left = align === "right" ? cr - W : align === "center" ? cl + (cw - W) / 2 : cl;
  return { pcs, W, left, cl, cr, cw, align, top: d.y + TEXT_PAD + ln.y, rtl };
}
// distance from the left end of a piece to the place between its k-th and (k+1)-th character (the prefix is measured as shaped text)
const pieceX = (pc, k) => { const n = pc.end - pc.start; if (k <= 0) return pc.level & 1 ? pc.w : 0; if (k >= n) return pc.level & 1 ? 0 : pc.w; const w = widthOf(pc.font, pc.text.slice(0, k)); return pc.level & 1 ? pc.w - w : w; };
/** Index of the line that holds caret offset `off` (at a line break the caret belongs to the line that starts there). */
function lineAt(L, off) { let k = 0; for (let i = 0; i < L.lines.length; i++) { if (L.lines[i].start <= off) k = i; else break; } return k; }
// The spaces at the end of a line are not part of its drawn pieces (they hang: nothing is drawn, the line is not wider for them), but the caret still has to
// walk over them while they are typed: it moves by their width, in the reading direction of the line, and stops at the edge of the text area.
function caretInLine(d, L, li, off) {
  const ln = L.lines[li], f = lineFrame(d, L, ln), pcs = f.pcs, o = Math.max(ln.start, Math.min(ln.end, off));
  const hang = (x, from, font, dirRtl) => {                                                  // x of the caret after `from`, moved over the hanging spaces up to `o`
    const n = o - from; if (n <= 0) return x;
    const w = widthOf(font, " ".repeat(n));
    return dirRtl ? Math.max(f.cl, x - w) : Math.min(f.cr, x + w);
  };
  if (!pcs.length) {                                                                          // an empty line, or one that holds only spaces
    const x = f.align === "right" ? f.cr : f.align === "center" ? f.cl + f.cw / 2 : f.cl;
    return { x: hang(x, ln.start, ln.bigFont, ln.rtl), size: ln.maxSize, font: ln.bigFont, f };
  }
  const shown = pcs.reduce((a, p) => Math.max(a, p.end), 0);                                  // end of the drawn text of the line
  const c = o > ln.start ? o - 1 : o;                                                         // the caret stands behind the character before it (in front of the first one at the start of a line)
  let pc = pcs.find((p) => c >= p.start && c < p.end), k;
  if (pc) k = (o > ln.start ? c + 1 : c) - pc.start;
  else { pc = pcs.reduce((a, b) => (b.start > a.start ? b : a)); k = pc.end - pc.start; }   // behind the last letter
  let x = f.left + pc.x + pieceX(pc, k);
  if (o > shown) x = hang(f.left + pc.x + pieceX(pc, pc.end - pc.start), shown, pc.font, !!(pc.level & 1));
  return { x, size: pc.size, font: pc.font, f };
}
/** The caret of a text item at character offset `off`: {x, top, bottom, line} in page units (top / bottom span the font's ascent and descent on the line's baseline). */
export function caretAt(d, off) {
  const L = layoutRich(d), li = lineAt(L, off), ln = L.lines[li], r = caretInLine(d, L, li, off), m = fontMetrics(r.font);
  const base = r.f.top + ln.base, top = Math.max(r.f.top, base - m.asc), bottom = Math.min(r.f.top + ln.h, base + m.desc);
  return { x: r.x, top, bottom: Math.max(bottom, top + 1), line: li, size: r.size };
}
/** The highlighted areas of the selection [a, b) of a text item: [{x0, x1, top, bottom}] in page units (one or more per line). */
export function selectionRects(d, a, b) {
  const L = layoutRich(d), out = [], text = String(d.text ?? "");
  if (a > b) [a, b] = [b, a];
  L.lines.forEach((ln, li) => {
    const s = Math.max(a, ln.start), e = Math.min(b, ln.end), f = lineFrame(d, L, ln), bottom = f.top + ln.h, rects = [];
    const lastOfPara = li === L.lines.length - 1 || L.lines[li + 1].para !== ln.para;
    if (s < e) for (const pc of f.pcs) {
      const ps = Math.max(s, pc.start), pe = Math.min(e, pc.end); if (ps >= pe) continue;
      const x1 = f.left + pc.x + pieceX(pc, ps - pc.start), x2 = f.left + pc.x + pieceX(pc, pe - pc.start);
      rects.push([Math.min(x1, x2), Math.max(x1, x2)]);
    }
    const shown = f.pcs.reduce((m, p) => Math.max(m, p.end), ln.start), hs = Math.max(s, shown);
    if (hs < e) { const p1 = caretInLine(d, L, li, hs).x, p2 = caretInLine(d, L, li, e).x; rects.push([Math.min(p1, p2), Math.max(p1, p2)]); }   // (selected spaces at the end of the line)
    if (lastOfPara && b > ln.end && text[ln.end] === "\n" && a <= ln.end) {          // the paragraph break is selected too: a short tab at the end of the line (where the next letter would go)
      const r = caretInLine(d, L, li, ln.end), w = Math.max(2, r.size * 0.3);
      rects.push(ln.rtl ? [r.x - w, r.x] : [r.x, r.x + w]);
    }
    rects.sort((p, q) => p[0] - q[0]);
    const merged = [];
    for (const r of rects) { const l = merged[merged.length - 1]; if (l && r[0] <= l[1] + 0.01) l[1] = Math.max(l[1], r[1]); else merged.push(r.slice()); }
    for (const r of merged) out.push({ x0: r[0], x1: r[1], top: f.top, bottom });
  });
  return out;
}
/** Character offset nearest to the page point (px, py) of a text item (what a click there means), and the offset range of the line it fell on. */
export function offsetAtPoint(d, px, py) {
  const L = layoutRich(d); if (!L.lines.length) return 0;
  const yy = py - (d.y + TEXT_PAD); let li = L.lines.length - 1;
  for (let i = 0; i < L.lines.length; i++) if (yy < L.lines[i].y + L.lines[i].h) { li = i; break; }
  return offsetInLine(d, L, li, px);
}
function offsetInLine(d, L, li, px) {
  const ln = L.lines[li], f = lineFrame(d, L, ln), pcs = f.pcs;
  if (!pcs.length) return ln.start;
  let best = null;
  for (const pc of pcs) {                                                        // the piece under px (or the nearest one)
    const x1 = f.left + pc.x, x2 = x1 + pc.w, dist = px < x1 ? x1 - px : px > x2 ? px - x2 : 0;
    if (!best || dist < best.dist) best = { pc, dist };
  }
  const pc = best.pc, n = pc.end - pc.start, rel = px - (f.left + pc.x), ends = [0];
  for (const g of graphemes(pc.text)) ends.push(ends[ends.length - 1] + g.length);
  let bestK = 0, bestD = Infinity;
  for (const k of ends) { const dd = Math.abs(pieceX(pc, k) - rel); if (dd < bestD - 1e-9) { bestD = dd; bestK = k; } }
  return Math.min(ln.end, pc.start + Math.min(n, bestK));
}
/** Offset one line up (dir = -1) / down (+1) from `off`, keeping the horizontal position `x` (page units) the caret had; null when there is no such line. */
export function offsetVertical(d, off, dir, x) {
  const L = layoutRich(d), li = lineAt(L, off) + dir;
  if (li < 0 || li >= L.lines.length) return null;
  return offsetInLine(d, L, li, x);
}
/** Start / end offset of the line that holds `off` (Home / End). End is where the next letter would be typed: the end of the visible text of a wrapped line (its hanging spaces stay behind the break), the very end of the last line of a paragraph. */
export function lineRange(d, off) {
  const L = layoutRich(d), li = lineAt(L, off), ln = L.lines[li], lastOfPara = li === L.lines.length - 1 || L.lines[li + 1].para !== ln.para;
  const last = ln.segs[ln.segs.length - 1], shown = last ? last.start + (last.draw ?? last.text).length : ln.start;
  return { start: ln.start, end: lastOfPara ? ln.end : shown };
}

/** Per paragraph: {rtl, indent, lo, hi}. A text area of any width in [lo, hi) breaks the paragraph into exactly the lines the canvas shows (lo: its widest line,
 *  hi: the narrowest width at which some word would have moved up to the line before). The invisible editor is given the middle of that range. */
export function paragraphWraps(d) {
  const out = [];
  for (const ln of layoutRich(d).lines) {
    const o = out[ln.para] || (out[ln.para] = { rtl: ln.rtl, indent: ln.indent, lo: 0, hi: Infinity });
    o.lo = Math.max(o.lo, ln.w); o.hi = Math.min(o.hi, ln.need ?? Infinity);
  }
  return out;
}
// ------------------------------------------------- auto-sized text boxes
// A text box with g: true has no width of its own choosing: it is as wide as its text, up to the room the surface gives it, and wraps there (on a ruled page onto the
// next rule). The box grows from a fixed anchor, the edge its text is aligned to (left / right) or its middle (centre), so the text never moves while it is typed.
/** The anchor x of a text box for an alignment. */
export function anchorX(d, align) { return align === "right" ? d.x + d.w : align === "center" ? d.x + d.w / 2 : d.x; }
/** Fit an auto-sized box to its text. g = {a: anchor x, lo, hi: the usable x range of the surface}. While typing (tight false) the box keeps a little room for the caret and for the
 *  spaces typed at the end of a line; tight is the settled box (no spare room). The lines are those of the room the surface allows, so the box is exactly as wide as its widest line. */
export function growBox(d, g, tight = false) {
  const fmt = fmtOf(d), align = fmt ? fmt.align : "left", pad = 2 * TEXT_PAD;
  const room = Math.max(pad + d.size, align === "right" ? g.a - g.lo : align === "center" ? 2 * Math.min(g.a - g.lo, g.hi - g.a) : g.hi - g.a);
  const L = layoutRich({ ...d, w: room });
  let need = 0;
  L.lines.forEach((ln, i) => {
    let e = ln.indent + ln.w;
    if (!tight && (i === L.lines.length - 1 || L.lines[i + 1].para !== ln.para)) {          // typed spaces at the end of a paragraph hang, but the caret walks over them: keep room for it
      const last = ln.segs[ln.segs.length - 1], shown = last ? last.start + (last.draw ?? last.text).length : ln.start;
      if (ln.end > shown) e += widthOf(last ? last.font : ln.bigFont, " ".repeat(ln.end - shown));
    }
    need = Math.max(need, e);
  });
  const wrapped = !tight && L.lines.length > new Set(L.lines.map((l) => l.para)).size;      // while typing, a box whose text has reached the edge and wrapped spans the whole writing area (it does not shrink by a word at every wrap)
  const inner = wrapped ? room - pad : Math.min(room - pad, Math.max(need + (tight ? 0.02 : Math.max(2, d.size * 0.15)), tight ? 0 : d.size * 1.2));
  const w = Math.ceil((inner + pad) * 100) / 100, x = align === "right" ? g.a - w : align === "center" ? g.a - w / 2 : g.a;
  return { ...d, x: Math.round(x * 100) / 100, w };
}
/** Draw a text item: every line with its own direction, alignment, list marker and styled pieces. */
export function drawRichText(ctx, d) {
  const L = layoutRich(d), mw = textInnerWidth(d), bw = mw ? mw : L.width, x0 = d.x + TEXT_PAD, fmt = fmtOf(d), fill = M.cssColor(d);
  ctx.textBaseline = "alphabetic"; ctx.fillStyle = fill; if ("textRendering" in ctx) ctx.textRendering = "geometricPrecision";
  const y0 = d.y + TEXT_PAD;
  for (const ln of L.lines) {
    const base = y0 + ln.y + ln.base, rtl = ln.rtl, cl = x0 + (rtl ? 0 : ln.indent), cr = x0 + bw - (rtl ? ln.indent : 0), cw = cr - cl;
    const align = fmt ? fmt.align : (rtl ? "right" : "left");
    if (ln.marker) {
      ctx.font = ln.marker.font; ctx.direction = rtl ? "rtl" : "ltr"; ctx.textAlign = rtl ? "left" : "right";
      ctx.fillText(ln.marker.text, rtl ? cr + ln.marker.size * 0.4 : cl - ln.marker.size * 0.4, base);
    }
    const W = ln.vis ? ln.visW : ln.w, left = align === "right" ? cr - W : align === "center" ? cl + (cw - W) / 2 : cl;
    if (!ln.vis) {
      const s = ln.segs[0]; if (!s) continue;
      const t = s.draw ?? s.text;
      ctx.font = s.font; ctx.direction = rtl ? "rtl" : "ltr"; ctx.textAlign = align;
      ctx.fillText(t, align === "right" ? cr : align === "center" ? cl + cw / 2 : cl, base);
      if (s.st.u) ctx.fillRect(left, base + s.size * 0.12, s.w, Math.max(0.8, s.size * 0.06));
    } else {
      let x = left; ctx.textAlign = "left";
      for (const pc of ln.vis) {
        ctx.font = pc.seg.font; ctx.direction = pc.level & 1 ? "rtl" : "ltr";
        ctx.fillText(pc.text, x, base);
        if (pc.seg.st.u) ctx.fillRect(x, base + pc.seg.size * 0.12, pc.w, Math.max(0.8, pc.seg.size * 0.06));
        x += pc.w;
      }
    }
  }
  ctx.direction = "ltr"; ctx.textAlign = "left";
}

function drawNote(ctx, d, skipText) {
  const { x, y, w, h } = d, hd = M.NOTE_HEADER, bright = M.itemBright(d);
  ctx.save();
  ctx.globalAlpha = M.itemAlpha(d) / 255;
  ctx.translate(x, y);
  ctx.fillStyle = "rgba(0,0,0,0.22)"; ctx.fillRect(3, 4, w, h);                          // shadow
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, mixCss(d.color, Math.min(100, bright + 9))); g.addColorStop(1, mixCss(d.color, bright));
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);                                           // paper
  ctx.fillStyle = mixCss(d.color, bright - 11); ctx.fillRect(0, 0, w, hd);               // header strip
  const f = Math.min(18, w / 4, h / 4);
  ctx.fillStyle = mixCss(d.color, bright - 22);                                          // folded corner
  ctx.beginPath(); ctx.moveTo(w - f, h); ctx.lineTo(w, h - f); ctx.lineTo(w - f, h - f); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.59)"; ctx.strokeStyle = "rgba(0,0,0,0.16)"; ctx.lineWidth = 0.6;
  ctx.fillRect(w / 2 - 24, -6, 48, 14); ctx.strokeRect(w / 2 - 24, -6, 48, 14);          // piece of tape
  ctx.font = `bold 9px ${FONT_STACK}`; ctx.textBaseline = "middle"; ctx.fillStyle = "rgba(0,0,0,0.43)";
  ctx.fillText("NOTE", 8, hd / 2);
  ctx.strokeStyle = mixCss(d.color, bright - 26); ctx.lineWidth = 0.6; ctx.strokeRect(0, 0, w, h);
  if (!skipText) {
    ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
    const bw = noteTextWidth(d), fmt = fmtOf(d), L = layoutText(ctx, d.text, d.size, bw, fmt);
    drawTextLines(ctx, L, 8, hd + 4, bw, d.size, M.noteTextColor({ color: d.color, bright }), fmt);
  }
  ctx.restore();
}

// -------------------------------------------------------------------- item
/** Draw one item. opts.skipText hides the text of an item that is being edited. */
// ---- board: ink adaptation, mind-map nodes / connectors ---------------------------------------------------------------
// On a blackboard, pure black ink would vanish (and white ink on a white board). Such neutral extreme colours are DRAWN in the
// opposite shade; the stored colour never changes, so switching the background back restores the original look exactly.
function adaptHex(hex, theme) {
  const c = M.parseHex(hex);
  if (!c) return hex;
  const lum = (c[0] + c[1] + c[2]) / 3, neutral = Math.max(...c) - Math.min(...c) < 26;
  if (neutral && theme === "dark" && lum < 70) return "#f2f2f2";
  if (neutral && theme === "light" && lum > 190) return "#1a1a1a";
  return hex;
}
const themedCache = { dark: new WeakMap(), light: new WeakMap() };     // (the themed copy of an item is made once, so its cached text layout is reused)
export function themed(d, theme) {
  if (!theme || d.t === "note" || d.t === "image" || d.t === "hl" || !d.color) return d;
  const cache = themedCache[theme], hit = cache && cache.get(d);
  if (hit) return hit;
  const c = adaptHex(d.color, theme), f = d.fill ? adaptHex(d.fill, theme) : d.fill;
  const out = c === d.color && f === d.fill ? d : { ...d, color: c, ...(f !== undefined ? { fill: f } : {}) };
  if (cache) cache.set(d, out);
  return out;
}
export const BOARD_COLORS = { white: "#ffffff", black: "#20252a" };
export const boardTheme = (paper) => (paper === "black" ? "dark" : "light");
const contrastOn = (hex) => { const c = M.parseHex(hex) || [255, 255, 255]; return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) > 150 ? "#111111" : "#ffffff"; };
export const nodeFmt = (d) => fmtOf(d) || { dir: isRtl(String(d.text || "")) ? "rtl" : "ltr", align: "center" };
export const nodeEll = (d) => (d.kind === "ellipse" ? 1.35 : 1);          // an ellipse holds less text than a rectangle of the same size
/** Size (w,h) a node needs for this text. */
export function nodeFit(d, text, domTextH = 0) {
  const ell = nodeEll(d), pad = M.NODE_PAD, L = layoutText(measureCtx(), text || " ", d.size, (M.NODE_MAX_W - 2 * pad) / ell, nodeFmt({ ...d, text }));
  const textH = Math.max(L.height, domTextH);                 // domTextH: what the real text box needed (it may wrap a line differently from the canvas)
  return { w: Math.max(M.NODE_MIN_W, Math.min(M.NODE_MAX_W, Math.ceil((L.width + 2 * pad) * ell))), h: Math.max(M.NODE_MIN_H, Math.ceil((textH + 2 * pad) * ell)), textH };
}
function nodePath(ctx, d) {
  const x = Math.min(d.x1, d.x2), y = Math.min(d.y1, d.y2), w = Math.abs(d.x2 - d.x1), h = Math.abs(d.y2 - d.y1);
  ctx.beginPath();
  if (d.kind === "ellipse") ctx.ellipse(x + w / 2, y + h / 2, Math.max(0.01, w / 2), Math.max(0.01, h / 2), 0, 0, Math.PI * 2);
  else if (d.kind === "rect") ctx.rect(x, y, w, h);
  else { const r = Math.min(16, w / 2, h / 2); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
}
/** Union of the boxes of all items (page coordinates), or null. nodes = nodeIndex(items). */
export function itemBounds(d, nodes) {
  const b = d.t === "text" ? textBox(d) : M.geomBox(d, null, nodes), e = M.halfWidth(d);
  return [b[0] - e, b[1] - e, b[2] + e, b[3] + e];
}
export function contentBounds(items) {
  if (!items.length) return null;
  const nodes = M.nodeIndex(items);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const d of items) { const b = itemBounds(d, nodes); x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]); }
  return Number.isFinite(x0) ? [x0, y0, x1, y1] : null;
}
export function drawBoardBg(ctx, w, h, page, vis = null) {
  ctx.save();
  ctx.fillStyle = BOARD_COLORS[page.paper] || BOARD_COLORS.white; ctx.fillRect(0, 0, w, h);
  if (page.grid) {                                          // dotted grid, only the visible part
    const g = 40, x0 = vis ? Math.max(0, Math.floor(vis[0] / g) * g) : 0, y0 = vis ? Math.max(0, Math.floor(vis[1] / g) * g) : 0;
    const x1 = vis ? Math.min(w, vis[2] + g) : w, y1 = vis ? Math.min(h, vis[3] + g) : h;
    ctx.fillStyle = page.paper === "black" ? "#59626c" : "#c3cad4";
    for (let y = y0; y <= y1; y += g) for (let x = x0; x <= x1; x += g) ctx.fillRect(x - 1, y - 1, 2, 2);
  }
  ctx.strokeStyle = page.paper === "black" ? "#59626c" : "#8a8f98"; ctx.lineWidth = 1.5; ctx.strokeRect(0, 0, w, h);
  ctx.restore();
}
/** Render a rectangle (x,y,w,h in board units) of a board for export. theme: "dark" | "light" | null. */
export function renderBoardRegion(canvas, items, { x, y, w, h, paper = "white", grid = false, theme = null, scale = 1 }) {
  canvas.width = Math.max(1, Math.round(w * scale)); canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext("2d");
  ctx.save(); ctx.scale(scale, scale); ctx.translate(-x, -y);
  drawBoardBg(ctx, M.BOARD_W, M.BOARD_H, { paper, grid }, [x, y, x + w, y + h]);
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  const nodes = M.hasConns(items) ? M.nodeIndex(items) : null, bg = BOARD_COLORS[paper];
  for (const d of items) drawItem(ctx, d, { theme, nodes, bg });
  ctx.restore();
  return canvas;
}

export function drawItem(ctx, d, opts = {}) {
  stats.itemDraws++;
  if (opts.theme) d = themed(d, opts.theme);
  const t = d.t;
  ctx.save();
  ctx.lineJoin = "round"; ctx.lineCap = "round";
  if (t === "pen" || t === "mark") {
    ctx.strokeStyle = M.cssColor(d); ctx.lineWidth = d.w;
    ctx.lineCap = t === "mark" ? "square" : "round";
    strokePath(ctx, d.pts); ctx.stroke();
  } else if (t === "line" || t === "arrow") {
    ctx.strokeStyle = M.cssColor(d); ctx.lineWidth = d.w;
    linePath(ctx, d, t === "arrow"); ctx.stroke();
  } else if (t === "rect") {
    ctx.strokeStyle = M.cssColor(d); ctx.lineWidth = d.w; ctx.lineJoin = "miter";
    const rx = Math.min(d.x1, d.x2), ry = Math.min(d.y1, d.y2), rw = Math.abs(d.x2 - d.x1), rh = Math.abs(d.y2 - d.y1);
    if (d.fill) { ctx.fillStyle = M.cssColor({ ...d, color: d.fill }); ctx.fillRect(rx, ry, rw, rh); }   // interior first, outline on top
    ctx.strokeRect(rx, ry, rw, rh);
  } else if (t === "ellipse") {
    ctx.strokeStyle = M.cssColor(d); ctx.lineWidth = d.w;
    ctx.beginPath();
    ctx.ellipse((d.x1 + d.x2) / 2, (d.y1 + d.y2) / 2, Math.max(0.01, Math.abs(d.x2 - d.x1) / 2),
      Math.max(0.01, Math.abs(d.y2 - d.y1) / 2), 0, 0, Math.PI * 2);
    if (d.fill) { ctx.fillStyle = M.cssColor({ ...d, color: d.fill }); ctx.fill(); }
    ctx.stroke();
  } else if (t === "shape") {
    ctx.strokeStyle = M.cssColor(d); ctx.lineWidth = d.w; ctx.lineJoin = "miter";
    const pts = M.shapePoints(d);
    ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath();
    if (d.fill) { ctx.fillStyle = M.cssColor({ ...d, color: d.fill }); ctx.fill(); }
    ctx.stroke();
  } else if (t === "node") {
    ctx.lineWidth = d.w; ctx.strokeStyle = M.cssColor(d); ctx.lineJoin = "round";
    nodePath(ctx, d);
    if (d.fill) { ctx.fillStyle = M.cssColor({ ...d, color: d.fill }); ctx.fill(); }
    ctx.stroke();
    if (!opts.skipText) {
      const x = Math.min(d.x1, d.x2), y = Math.min(d.y1, d.y2), w = Math.abs(d.x2 - d.x1), h = Math.abs(d.y2 - d.y1);
      const fmt = nodeFmt(d), mw = Math.max(10, (w - 2 * M.NODE_PAD) / nodeEll(d)), L = layoutText(ctx, d.text, d.size, mw, fmt);
      drawTextLines(ctx, L, x + (w - mw) / 2, y + (h - L.height) / 2, mw, d.size, d.fill ? contrastOn(d.fill) : M.cssColor(d), fmt);
    }
  } else if (t === "conn") {
    const g = opts.nodes && M.connGeometry(d, opts.nodes);
    if (g) {
      ctx.strokeStyle = M.cssColor(d); ctx.lineWidth = d.w;
      ctx.beginPath(); g.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
      if (d.arrow !== false && d.to) {
        const s = 7 + d.w * 2.2, a = g.angle, [ex, ey] = g.end;
        ctx.fillStyle = M.cssColor(d); ctx.beginPath(); ctx.moveTo(ex, ey);
        ctx.lineTo(ex - s * Math.cos(a - 0.45), ey - s * Math.sin(a - 0.45)); ctx.lineTo(ex - s * Math.cos(a + 0.45), ey - s * Math.sin(a + 0.45)); ctx.closePath(); ctx.fill();
      }
      if (d.label && !opts.skipText) {
        const size = 15; ctx.font = `${size}px ${FONT_STACK}`; ctx.textBaseline = "middle"; ctx.textAlign = "center";
        const tw = ctx.measureText(d.label).width + 10;
        ctx.fillStyle = opts.bg || "#ffffff"; ctx.fillRect(g.mid[0] - tw / 2, g.mid[1] - size * 0.7, tw, size * 1.4);
        ctx.fillStyle = M.cssColor(d); ctx.direction = isRtl(d.label) ? "rtl" : "ltr"; ctx.fillText(d.label, g.mid[0], g.mid[1]);
      }
    }
  } else if (t === "hl") {
    ctx.fillStyle = M.cssColor(d);
    ctx.fillRect(Math.min(d.x1, d.x2), Math.min(d.y1, d.y2), Math.abs(d.x2 - d.x1), Math.abs(d.y2 - d.y1));
  } else if (t === "text") {
    if (!opts.skipText) drawRichText(ctx, d);
  } else if (t === "note") {
    drawNote(ctx, d, opts.skipText);
  } else if (t === "image") {
    const x = Math.min(d.x1, d.x2), y = Math.min(d.y1, d.y2), w = Math.abs(d.x2 - d.x1), h = Math.abs(d.y2 - d.y1);
    const e = getImage(d.data);
    ctx.globalAlpha = M.itemAlpha(d) / 255;
    if (e.ok) { ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high"; ctx.drawImage(e.img, x, y, w, h); }
    else {                                                   // not decoded (yet / ever): placeholder
      ctx.fillStyle = "#e0e0e0"; ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = e.failed ? "#b00020" : "#9e9e9e"; ctx.lineWidth = 1;
      ctx.strokeRect(x, y, w, h);
      if (e.failed) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y + h); ctx.moveTo(x + w, y); ctx.lineTo(x, y + h); ctx.stroke(); }
    }
  }
  ctx.restore();
}

/** Draw a whole page: paper (notebook) and items. Used for export; 'scale' = canvas pixels per point. */
export const stats = { itemDraws: 0, pageBuilds: 0 };    // (counters the tests use to check that finished pages are not drawn again while scrolling)
export function renderPage(canvas, w, h, items, { paper = null, scale = 2 } = {}) {
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.scale(scale, scale);
  if (paper) drawPaper(ctx, w, h, paper);
  ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();         // nothing outside the page
  const nodes = M.hasConns(items) ? M.nodeIndex(items) : null;      // mind-map connectors are drawn between their nodes (annotated-PDF / notebook export)
  for (const d of items) drawItem(ctx, d, { nodes });
  ctx.restore();
  return canvas;
}
