// Text of PDF pages: for searching them and for linking to a passage. Local processing only (pdf.js, already part of the app).
//
//   buildPageText(items, viewportTransform)  pure: pdf.js text items -> { text, words }. The words carry their offsets in text and their box in
//                                            page points (top-left origin), so a match in the text can be drawn on the page.
//   rectsForRange(data, a, b)                boxes (one per line) for the characters [a, b) of data.text
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
    if (dy <= 0) { out.add(i); continue; }                                                              // back up the page: another block or column
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
/** Put a second "\n" in front of each line that starts a paragraph; the word boxes are moved along. */
function insertBreaks(text, words, positions) {
  if (!positions.length) return { text, words };
  const pos = positions.slice().sort((a, b) => a - b); let out = "", at = 0;
  for (const q of pos) { out += text.slice(at, q) + "\n"; at = q; }
  out += text.slice(at);
  const shift = (v) => { let n = 0; while (n < pos.length && pos[n] <= v) n++; return n; };
  for (const w of words) { const d = shift(w.start); w.start += d; w.end += d; }
  return { text: out, words };
}

export function buildPageText(items, vpTransform) {
  let text = "", line = 0, last = null;
  const words = [], lineInfo = new Map();                                                                  // (per visual line: where it starts and how it is set)
  for (const it of items) {
    if (!it || typeof it.str !== "string" || !it.transform) continue;
    const t = mul(vpTransform, it.transform), fh = Math.hypot(t[2], t[3]) || 1, x = t[4], base = t[5], width = Math.abs(it.width) || 0;
    const rtl = it.dir === "rtl", x0 = x, x1 = x + width;
    if (it.str.length === 0) { if (it.hasEOL) { text += "\n"; line++; last = null; } continue; }
    if (last) {
      if (Math.abs(base - last.base) > fh * 0.5) { text += "\n"; line++; }                                   // a new line of the page
      else if (!/\s$/.test(text) && !/^\s/.test(it.str)) {                                                    // same line: a gap wider than a hair is a space
        const gap = rtl ? last.x0 - x1 : x0 - last.x1;
        if (gap > fh * 0.12) text += " ";
      }
    }
    const at = text.length;
    let li = lineInfo.get(line); if (!li) lineInfo.set(line, (li = { start: at, base, x0, x1, fh, rtl, text: "" }));
    li.x0 = Math.min(li.x0, x0, x1); li.x1 = Math.max(li.x1, x0, x1); li.fh = Math.max(li.fh, fh); if (li.text.length < 16) li.text += it.str;
    text += it.str;
    const n = it.str.length;
    for (const m of it.str.matchAll(/\S+/g)) {
      const f0 = m.index / n, f1 = (m.index + m[0].length) / n;                                                // (the word's share of the run's width)
      const a = rtl ? 1 - f1 : f0, b = rtl ? 1 - f0 : f1;
      words.push({ start: at + m.index, end: at + m.index + m[0].length, x0: x0 + width * a, x1: x0 + width * b, y0: base - fh * 0.95, y1: base + fh * 0.25, line, rtl });
    }
    last = { base, x0, x1 };
    if (it.hasEOL) { text += "\n"; line++; last = null; }
  }
  const ordered = [...lineInfo.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]), br = paragraphBreaks(ordered);
  return insertBreaks(text, words, [...br].map((i) => ordered[i].start).filter((q) => q > 0));
}

/** Boxes [x0, y0, x1, y1] (page points) of the characters [a, b) of data.text: one box per line of the page. */
export function rectsForRange(data, a, b) {
  const byLine = new Map();
  for (const w of data.words) {
    if (w.end <= a || w.start >= b) continue;
    const len = w.end - w.start, s = Math.max(a, w.start) - w.start, e = Math.min(b, w.end) - w.start, wd = w.x1 - w.x0;
    let x0 = w.x0 + wd * (s / len), x1 = w.x0 + wd * (e / len);
    if (w.rtl) { x0 = w.x1 - wd * (e / len); x1 = w.x1 - wd * (s / len); }
    const cur = byLine.get(w.line);
    if (cur) { cur[0] = Math.min(cur[0], x0); cur[2] = Math.max(cur[2], x1); cur[1] = Math.min(cur[1], w.y0); cur[3] = Math.max(cur[3], w.y1); }
    else byLine.set(w.line, [x0, w.y0, x1, w.y1]);
  }
  return [...byLine.values()];
}

const dataCache = new WeakMap();
/** Text + word boxes of page i of a pdf.js document (cached while the document is open). */
export async function pageTextData(doc, i) {
  let m = dataCache.get(doc);
  if (!m) dataCache.set(doc, (m = new Map()));
  if (m.has(i)) return m.get(i);
  await initPdfjs();
  const page = await doc.getPage(i + 1), vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const data = buildPageText(tc.items, vp.transform);
  m.set(i, data);
  if (m.size > 40) m.delete(m.keys().next().value);                                                           // (only a few pages are kept: the text of all pages lives in the store)
  return data;
}

const CACHE_V = 2;                                                           // (2: page texts now contain paragraph breaks)
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
      try { this.pages[i] = (await pageTextData(this.doc, i)).text; } catch (e) { this.pages[i] = ""; this.failed++; }
      this.done++;
      if (i % 4 === 3 || i === this.n - 1) { this.emit(); await new Promise((r) => setTimeout(r, 0)); }       // (let the page draw / scroll between batches)
    }
    if (this.stopped) return;
    if (this.cache && this.key && !this.failed) { try { await this.cache.set("ptxt:" + this.key, { v: CACHE_V, pages: this.pages }); } catch { /* cache is optional */ } }
  }
}
