// Text of PDF pages: for searching them and for linking to a passage. Local processing only (pdf.js, already part of the app).
//
//   buildPageText(items, viewportTransform, { measure })
//                                            pure: pdf.js text items -> { text, words, lines }. The text is in READING ORDER, decided from where the text is on the page
//                                            (columns, lines, left to right / right to left), never from the order in which the PDF happens to draw it. The words carry
//                                            their offsets in text, their box in page points (top-left origin) and the box of every character (cl / cr), so a match in
//                                            the text, or a selection, can be drawn on the page exactly.
//   rectsForRange(data, a, b)                boxes (one per line) for the characters [a, b) of data.text
//   caretAt(data, pt)                        the place in the text under a point of the page: { off, hit }
//   quoteText(data, a, b)                    the characters [a, b) as the reader selected them: words and paragraphs kept, line wraps joined (see there)
//   PdfTextStore                             the text of every page of ONE document, filled in the background (never blocks drawing), cached
//                                            on this device by the document's hash so a big PDF is read once.
import { initPdfjs } from "./pdfio.js";

const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];

// ---------------------------------------------------------------- paragraphs
// A PDF has no paragraphs, only lines at positions. A new paragraph is recognised by what typesetting does at its start (never by "there was a line break", which is on every line):
//   - a gap between the lines clearly larger than the usual line distance of the page;  - a change of type size (a heading, a caption);  - a list marker at the start of the line;
//   - a first-line indent after a line that ended a sentence;  - a short last line that ended a sentence, followed by a line that does not continue it (no lower-case start).
const TERMINAL = /[.!?؟…:;]["”'’»)\]]*$/, BULLET = /^\s*(?:[•●▪◦‣·*–—-]\s|\(?\d{1,3}[.)]\s|\(?[A-Za-z][.)]\s)/;
const pct = (arr, q) => { const a = arr.slice().sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(q * a.length))] : 0; };
/** lines: [{ base, x0, x1, fh, rtl, text }] in reading order (one per visual line). Returns the set of INDEXES (into `lines`) of the lines that start a new paragraph (never index 0). */
export function paragraphBreaks(lines) {
  const out = new Set(); if (lines.length < 2) return out;
  const pitches = []; for (let i = 1; i < lines.length; i++) { const dy = lines[i].base - lines[i - 1].base, fh = Math.max(lines[i].fh, lines[i - 1].fh); if (dy > 0.3 * fh && dy < 4 * fh) pitches.push(dy); }
  const med = pitches.length >= 2 ? pct(pitches, 0.5) : lines.reduce((a, l) => a + l.fh, 0) / lines.length * 1.2;
  const left = pct(lines.map((l) => l.x0), 0.1), right = pct(lines.map((l) => l.x1), 0.9), width = Math.max(1, right - left);
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i - 1], c = lines[i], dy = c.base - p.base, fh = Math.max(p.fh, c.fh), ended = TERMINAL.test(p.text.trim());
    if (dy <= 0) { if (ended || BULLET.test(c.text) || !/^\s*\p{Ll}/u.test(c.text)) out.add(i); continue; }              // back up the page: another block or column (unless the sentence just goes on in the next column)
    if (dy > 1.55 * med) { out.add(i); continue; }                                                      // a blank gap
    if (Math.abs(c.fh - p.fh) / fh > 0.18) { out.add(i); continue; }                                    // another type size
    if (BULLET.test(c.text)) { out.add(i); continue; }                                                  // a list item
    const indent = c.rtl ? right - c.x1 : c.x0 - left, prevIndent = p.rtl ? right - p.x1 : p.x0 - left;
    if (ended && indent > 0.9 * fh && indent - prevIndent > 0.5 * fh) { out.add(i); continue; }          // first-line indent (a whole indented block is not cut at every sentence)
    const shortPrev = (p.x1 - p.x0) < 0.6 * width;
    if (ended && shortPrev && !/^\s*\p{Ll}/u.test(c.text)) out.add(i);                                  // the paragraph's short last line
  }
  return out;
}
// ---------------------------------------------------------------- reading order
// pdf.js hands over the text in the order the PDF DRAWS it. That is only sometimes the order it is READ in: a two-column page may be drawn row by row across both columns,
// a producer may draw words in any order, justified text arrives in pieces. A selection is a range of the text between two places, so the text must be in reading order
// or the range contains other words and misses the selected ones. The order is therefore decided from the geometry (an XY cut: columns, then stacked blocks, then lines).
const median = (a) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const sameRow = (a, b) => Math.abs(a.base - b.base) <= 0.5 * Math.max(a.fh, b.fh);
/** Spans of one block -> rows (top to bottom), each a list of spans (in reading order inside the row). */
function rowsOf(spans) {
  const sorted = spans.slice().sort((a, b) => a.base - b.base || a.x0 - b.x0), rows = [];
  for (const sp of sorted) {
    const r = rows[rows.length - 1];
    if (r && sameRow(r.ref, sp)) { r.spans.push(sp); r.ref = { base: (r.ref.base * (r.spans.length - 1) + sp.base) / r.spans.length, fh: Math.max(r.ref.fh, sp.fh) }; }
    else rows.push({ ref: { base: sp.base, fh: sp.fh }, spans: [sp] });
  }
  return rows.map((r) => { const rtl = r.spans.filter((s) => s.rtl).length * 2 > r.spans.length; return r.spans.sort((a, b) => (rtl ? b.x1 - a.x1 : a.x0 - b.x0)); });
}
/** A vertical band of white space that runs through the whole block and has real text lines on both sides: two columns. -> [left, right] or null. */
function columnSplit(spans, fh) {
  if (spans.length < 4) return null;
  const sorted = spans.slice().sort((a, b) => a.x0 - b.x0), need = Math.max(8, fh), gaps = [];
  let reach = sorted[0].x1;
  for (let i = 1; i < sorted.length; i++) { if (sorted[i].x0 - reach >= need) gaps.push([reach, sorted[i].x0]); reach = Math.max(reach, sorted[i].x1); }
  gaps.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]));
  for (const [g0, g1] of gaps) {
    const left = spans.filter((s) => s.x1 <= g0 + 0.01), right = spans.filter((s) => s.x0 >= g1 - 0.01);
    if (left.length + right.length !== spans.length) continue;
    const rl = rowsOf(left), rr = rowsOf(right);
    if (rl.length < 2 || rr.length < 2) continue;                                                           // one line with a wide gap is a line, not two columns
    const wide = (rows) => median(rows.map((r) => Math.max(...r.map((s) => s.x1)) - Math.min(...r.map((s) => s.x0)))) >= 9 * fh;     // columns of text have long lines; table cells do not (a table is read row by row)
    if (wide(rl) && wide(rr)) return [left, right];
  }
  return null;
}
/** A horizontal band of white space between two blocks of lines (a heading and its text, two paragraphs, a figure caption). -> [top, bottom] or null. */
function blockSplit(spans, fh) {
  const sorted = spans.slice().sort((a, b) => a.y0 - b.y0), need = 0.15 * fh, gaps = [];
  let reach = sorted[0].y1;
  for (let i = 1; i < sorted.length; i++) { if (sorted[i].y0 - reach >= need) gaps.push({ at: i, gap: sorted[i].y0 - reach }); reach = Math.max(reach, sorted[i].y1); }
  if (!gaps.length) return null;
  const best = Math.max(...gaps.map((g) => g.gap)), top = gaps.filter((g) => g.gap >= best * 0.999), mid = sorted.length / 2, g = top.reduce((a, b) => (Math.abs(b.at - mid) < Math.abs(a.at - mid) ? b : a));
  return [sorted.slice(0, g.at), sorted.slice(g.at)];
}
/** Spans -> lines in reading order. Every line is a list of spans; a line never mixes spans of two blocks / columns. */
function readingLines(spans, depth = 0) {
  if (!spans.length) return [];
  const fh = median(spans.map((s) => s.fh)) || 10;
  if (spans.length > 1 && depth < 40) {
    const rtl = spans.filter((s) => s.rtl).length * 2 > spans.length, cols = columnSplit(spans, fh);
    if (cols) return rtl ? [...readingLines(cols[1], depth + 1), ...readingLines(cols[0], depth + 1)] : [...readingLines(cols[0], depth + 1), ...readingLines(cols[1], depth + 1)];
    const blocks = blockSplit(spans, fh);
    if (blocks) return [...readingLines(blocks[0], depth + 1), ...readingLines(blocks[1], depth + 1)];
  }
  return rowsOf(spans);
}

// ---------------------------------------------------------------- characters
/** Cumulative share (0..1, one value per character boundary) of an item's width that each character takes. A real measurer (the canvas text engine with the item's font, see
 *  canvasMeasurer) makes a character's box fall on the character; without one the width is shared equally (tests, text only). */
function fractions(it, n, measure, fh) {
  let f = null;
  if (measure && n > 1) { try { f = measure(it, fh); } catch { f = null; } }
  if (f && f.length === n + 1 && f[n] > 0) return f;
  const u = new Array(n + 1); for (let k = 0; k <= n; k++) u[k] = k / n; return u;
}
/** A measurer for buildPageText that uses the browser's text engine: the width of every prefix of the string in the item's font (so kerning, ligatures and the joined
 *  forms of Persian letters count), scaled to the width pdf.js reports for the item. styles = textContent.styles. */
export function canvasMeasurer(styles) {
  let ctx = null;
  return (it) => {
    if (!ctx) { const c = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(1, 1) : document.createElement("canvas"); ctx = c.getContext("2d"); }
    const fam = (styles && styles[it.fontName] && styles[it.fontName].fontFamily) || "sans-serif", s = it.str, n = s.length;
    ctx.font = `100px ${fam}, sans-serif`;
    const cum = new Array(n + 1); cum[0] = 0;
    if (n <= 160) for (let k = 1; k <= n; k++) cum[k] = ctx.measureText(s.slice(0, k)).width;
    else { let acc = 0; for (let k = 0; k < n; k++) { acc += ctx.measureText(s[k]).width; cum[k + 1] = acc; } }
    const total = cum[n]; if (!(total > 0)) return null;
    return cum.map((v) => v / total);
  };
}

const SPACE_GAP = 0.12;                                                                                   // (a gap between two runs wider than this share of the type size is a space)
function lineString(line, rtl) {
  let text = "", last = null; const parts = [];
  for (const sp of line) {
    if (last && !/\s$/.test(text) && !/^\s/.test(sp.str)) { const gap = rtl ? last.x0 - sp.x1 : sp.x0 - last.x1; if (gap > sp.fh * SPACE_GAP) text += " "; }
    parts.push({ sp, at: text.length }); text += sp.str; last = sp;
  }
  return { text, parts };
}

/** pdf.js text items -> { text, words, lines } (see the top of this file). measure: optional, see fractions(). */
export function buildPageText(items, vpTransform, { measure = null } = {}) {
  const spans = [];
  for (const it of items) {
    if (!it || typeof it.str !== "string" || !it.transform || !it.str.trim()) continue;
    const t = mul(vpTransform, it.transform), fh = Math.hypot(t[2], t[3]) || 1, x = t[4], base = t[5], width = Math.abs(it.width) || 0;
    spans.push({ it, str: it.str, x0: x, x1: x + width, base, fh, rtl: it.dir === "rtl", y0: base - fh * 0.95, y1: base + fh * 0.25 });
  }
  if (!spans.length) return { text: "", words: [] };
  const lines = readingLines(spans).map((ls) => {
    const rtl = ls.filter((s) => s.rtl).length * 2 > ls.length, { text, parts } = lineString(ls, rtl);
    return { spans: ls, parts, rtl, text, base: median(ls.map((s) => s.base)), x0: Math.min(...ls.map((s) => s.x0)), x1: Math.max(...ls.map((s) => s.x1)), fh: Math.max(...ls.map((s) => s.fh)), y0: Math.min(...ls.map((s) => s.y0)), y1: Math.max(...ls.map((s) => s.y1)) };
  });
  const br = paragraphBreaks(lines);
  let text = "", at = 0; const words = [], outLines = [];
  lines.forEach((ln, li) => {
    if (li) { text += br.has(li) ? "\n\n" : "\n"; }
    const start = text.length; text += ln.text;
    for (const { sp, at: rel } of ln.parts) {
      const n = sp.str.length, f = fractions(sp.it, n, measure, sp.fh), width = sp.x1 - sp.x0;
      for (const m of sp.str.matchAll(/\S+/g)) {
        const cl = [], cr = [];
        for (let k = m.index; k < m.index + m[0].length; k++) {
          const a = sp.rtl ? sp.x1 - width * f[k + 1] : sp.x0 + width * f[k], b = sp.rtl ? sp.x1 - width * f[k] : sp.x0 + width * f[k + 1];
          cl.push(a); cr.push(b);
        }
        words.push({ start: start + rel + m.index, end: start + rel + m.index + m[0].length, x0: Math.min(...cl), x1: Math.max(...cr), y0: sp.y0, y1: sp.y1, line: li, rtl: sp.rtl, cl, cr });
      }
    }
    outLines.push({ start, end: text.length, x0: ln.x0, x1: ln.x1, y0: ln.y0, y1: ln.y1, rtl: ln.rtl });
  });
  return { text, words, lines: outLines };
}

/** Boxes [x0, y0, x1, y1] (page points) of the characters [a, b) of data.text: one box per line of the page, exact to the character. */
export function rectsForRange(data, a, b) {
  const byLine = new Map();
  for (const w of data.words) {
    if (w.end <= a || w.start >= b) continue;
    const s = Math.max(a, w.start) - w.start, e = Math.min(b, w.end) - w.start;
    let x0, x1;
    if (w.cl && w.cl.length === w.end - w.start) { x0 = Infinity; x1 = -Infinity; for (let k = s; k < e; k++) { x0 = Math.min(x0, w.cl[k]); x1 = Math.max(x1, w.cr[k]); } }
    else { const len = w.end - w.start, wd = w.x1 - w.x0; x0 = w.x0 + wd * (s / len); x1 = w.x0 + wd * (e / len); if (w.rtl) { x0 = w.x1 - wd * (e / len); x1 = w.x1 - wd * (s / len); } }
    const cur = byLine.get(w.line);
    if (cur) { cur[0] = Math.min(cur[0], x0); cur[2] = Math.max(cur[2], x1); cur[1] = Math.min(cur[1], w.y0); cur[3] = Math.max(cur[3], w.y1); }
    else byLine.set(w.line, [x0, w.y0, x1, w.y1]);
  }
  return [...byLine.values()];
}

// ---------------------------------------------------------------- selecting
/** The place in data.text under a point (page points): { off, hit, dist }. off = the caret position (0..text.length) the point is nearest to, the way a text cursor sits between
 *  two characters; hit = the point is on (or within tol of) a character; dist = how far the nearest character is. */
export function caretAt(data, pt, tol = 3) {
  const words = data.words; if (!words || !words.length) return { off: 0, hit: false, dist: Infinity };
  const lines = data.lines || [], rows = new Map();                                                       // line -> its words
  for (const w of words) { let r = rows.get(w.line); if (!r) rows.set(w.line, (r = [])); r.push(w); }
  // 1. the line under the point (the nearest one when the point is between lines); columns: a line whose x range holds the point wins over one that is only as close in y
  let best = null, bd = Infinity;
  for (const [li, ws] of rows) {
    const L = lines[li] || { x0: Math.min(...ws.map((w) => w.x0)), x1: Math.max(...ws.map((w) => w.x1)), y0: Math.min(...ws.map((w) => w.y0)), y1: Math.max(...ws.map((w) => w.y1)) };
    const dx = Math.max(L.x0 - pt.x, 0, pt.x - L.x1), dy = Math.max(L.y0 - pt.y, 0, pt.y - L.y1), d = dy * 1e4 + dx;          // (the line the point is level with wins, however far along it is; else the nearest line, then the nearest column)
    if (d < bd) { bd = d; best = ws; }
  }
  // 2. the character of that line nearest to the point
  let cell = null, cd = Infinity;
  for (const w of best) for (let k = 0; k < w.end - w.start; k++) {
    const l = w.cl ? w.cl[k] : w.x0, r = w.cr ? w.cr[k] : w.x1, dx = Math.max(l - pt.x, 0, pt.x - r), dy = Math.max(w.y0 - pt.y, 0, pt.y - w.y1), d = Math.hypot(dx, dy * 2);
    if (d < cd) { cd = d; cell = { w, k, l, r }; }
  }
  if (!cell) return { off: 0, hit: false, dist: Infinity };
  const mid = (cell.l + cell.r) / 2, before = cell.w.rtl ? pt.x >= mid : pt.x < mid;
  return { off: cell.w.start + cell.k + (before ? 0 : 1), hit: cd <= tol, dist: cd };
}

const LIG = { "\uFB00": "ff", "\uFB01": "fi", "\uFB02": "fl", "\uFB03": "ffi", "\uFB04": "ffl", "\uFB05": "st", "\uFB06": "st" };
const LIST_ITEM = /^\s*(?:[•●▪◦‣·*–—-]|\(?\d{1,3}[.)]|\(?[A-Za-z][.)])(?:\s|$)/;
/** The characters [a, b) of data.text as the reader selected them. The selected words keep their order; the line breaks of the PDF (which only come from the width of its page) are
 *  not part of the text: a wrapped line continues with a space, a word hyphenated at the end of a line is joined again; a paragraph break stays a blank line and a list keeps one item
 *  per line. Nothing is added: no quotation marks, no file name, no page number. */
export function quoteText(data, a, b) {
  const raw = data.text.slice(Math.max(0, a), Math.max(0, b)).replace(/[\uFB00-\uFB06]/g, (c) => LIG[c]).replace(/\u00AD/g, "").replace(/[\u00A0\u2007\u202F]/g, " ");
  const paras = raw.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).map((p) => {
    let out = "";
    for (const line of p.split("\n")) {
      const t = line.trim(); if (!t) continue;
      if (!out) { out = t; continue; }
      if (/[\p{L}]-$/u.test(out) && /^\p{Ll}/u.test(t)) out = out.slice(0, -1) + t;                         // a word broken at the end of a line: connec- / tion
      else out += " " + t;
    }
    return out.replace(/[ \t]{2,}/g, " ");
  });
  let res = "";
  paras.forEach((p, i) => { if (i) res += LIST_ITEM.test(p) && LIST_ITEM.test(paras[i - 1]) ? "\n" : "\n\n"; res += p; });
  return res;
}

const dataCache = new WeakMap();
/** Text + word boxes of page i of a pdf.js document (cached while the document is open). Characters are placed with the browser's text engine (see canvasMeasurer). */
export async function pageTextData(doc, i) {
  let m = dataCache.get(doc);
  if (!m) dataCache.set(doc, (m = new Map()));
  if (m.has(i)) return m.get(i);
  await initPdfjs();
  const page = await doc.getPage(i + 1), vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const data = buildPageText(tc.items, vp.transform, { measure: canvasMeasurer(tc.styles) });
  m.set(i, data);
  if (m.size > 40) m.delete(m.keys().next().value);                                                           // (only a few pages are kept: the text of all pages lives in the store)
  return data;
}
/** Only the text of page i (no character boxes: reading the whole document for search must stay cheap). It is the same text pageTextData gives. */
async function pageTextOnly(doc, i) {
  const m = dataCache.get(doc); if (m && m.has(i)) return m.get(i).text;
  await initPdfjs();
  const page = await doc.getPage(i + 1), vp = page.getViewport({ scale: 1 });
  return buildPageText((await page.getTextContent()).items, vp.transform).text;
}

const CACHE_V = 3;                                                           // (2: page texts contain paragraph breaks; 3: they are in reading order)
export class PdfTextStore {
  /** key: the document's hash (null = cannot be cached). cache: {get(k), set(k, v)} or null. */
  constructor(doc, key, cache = null) {
    this.doc = doc; this.key = key; this.cache = cache;
    this.n = doc.numPages; this.pages = new Array(this.n).fill(undefined); this.done = 0;
    this.job = null; this.stopped = false; this.listeners = new Set(); this.failed = 0;
  }
  get complete() { return this.done >= this.n; }
  get(i) { return this.pages[i]; }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { for (const f of this.listeners) { try { f(this); } catch (e) { console.warn(e); } } }
  /** Read all pages (once). Resolves when done or stopped. */
  start() { return (this.job ||= this.run()); }
  stop() { this.stopped = true; this.listeners.clear(); }
  async run() {
    if (this.cache && this.key) {
      try {
        const c = await this.cache.get("ptxt:" + this.key);
        if (c && c.v === CACHE_V && Array.isArray(c.pages) && c.pages.length === this.n && c.pages.every((s) => typeof s === "string")) {
          this.pages = c.pages; this.done = this.n; this.emit(); return;
        }
      } catch { /* no cache: read the pages */ }
    }
    for (let i = 0; i < this.n && !this.stopped; i++) {
      try { this.pages[i] = await pageTextOnly(this.doc, i); } catch (e) { this.pages[i] = ""; this.failed++; }
      this.done++;
      if (i % 4 === 3 || i === this.n - 1) { this.emit(); await new Promise((r) => setTimeout(r, 0)); }       // (let the page draw / scroll between batches)
    }
    if (this.stopped) return;
    if (this.cache && this.key && !this.failed) { try { await this.cache.set("ptxt:" + this.key, { v: CACHE_V, pages: this.pages }); } catch { /* cache is optional */ } }
  }
}
