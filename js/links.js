// Linked notes: the data model of connections between notebook / board content and PDF content (pure, no DOM).
//
// A link connects two ANCHORS. An anchor names a place by a STABLE identity, never by something temporary (screen position, array index,
// page number of a notebook that can be reordered):
//   { k: "item", id, slot, pv }              an item (text box, note, mind-map node, shape, drawing, highlight, ...) of any panel.
//                                            id = the item's own id (model.js ensureId); slot = the panel it was in (a hint: the item is found
//                                            wherever it is, so moving content or changing the layout does not break the link); pv = a short preview.
//   { k: "pdf", doc, name, page, rect?, quote?, pv }   a place in a PDF: doc = hash (SHA-256) of the PDF's content, so it is the same PDF in
//                                            whichever panel it is open; page = 0-based page of THAT document (a PDF never changes, so its page
//                                            numbers are stable); rect = [x0, y0, x1, y1] in page points = a region; quote = { text, rects } = a
//                                            passage of text; neither = the page as a whole.
// If the PDF is replaced by a different file its hash no longer matches: the link says so instead of silently pointing at the wrong page.
// Links are kept in ONE list (not inside the items), so a connection is found from either end, any number of links can meet at one item /
// page / region, and the notebook / PDF files themselves stay exactly as they were. The list is written to the workspace as links.json.
export const LINKS_FORMAT = "NoteFlow-links", LINKS_VERSION = 1, MAX_LINKS = 20000;
const SLOTS = ["pdf", "pdf2", "nb", "nb2", "board", "board2"];
export const newLinkId = () => "l" + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const text = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");
const rect = (r) => (Array.isArray(r) && r.length === 4 && r.every((v) => num(v) !== null) ? r.map((v) => Math.round(v * 100) / 100) : null);

/** A valid anchor from untrusted data, or null. */
export function sanitizeAnchor(a) {
  if (!a || typeof a !== "object") return null;
  if (a.k === "item") {
    const id = text(a.id, 40);
    if (!id) return null;
    return { k: "item", id, slot: SLOTS.includes(a.slot) ? a.slot : "nb", pv: text(a.pv, 160) };
  }
  if (a.k === "pdf") {
    const doc = text(a.doc, 64), page = num(a.page);
    if (!/^[0-9a-f]{8,64}$/.test(doc) || page === null || page < 0 || !Number.isInteger(page)) return null;
    const out = { k: "pdf", doc, name: text(a.name, 200), page, pv: text(a.pv, 160) };
    const r = rect(a.rect); if (r) out.rect = r;
    if (a.quote && typeof a.quote === "object" && text(a.quote.text, 1)) {
      const rects = Array.isArray(a.quote.rects) ? a.quote.rects.map(rect).filter(Boolean).slice(0, 40) : [];
      out.quote = { text: text(a.quote.text, 400), rects };
    }
    return out;
  }
  return null;
}
/** The key under which links are looked up from an anchor: an item, or a page of a PDF (regions and passages are on a page). */
export const anchorKey = (a) => (a.k === "item" ? "i:" + a.id : "p:" + a.doc + ":" + a.page);
const sig = (a) => (a.k === "item" ? "i:" + a.id : "p:" + a.doc + ":" + a.page + ":" + (a.rect ? a.rect.map(Math.round).join(",") : "") + ":" + (a.quote ? a.quote.text : ""));
export const sameAnchor = (a, b) => sig(a) === sig(b);
/** Which kind of place: "item" | "page" | "region" | "text". */
export const anchorShape = (a) => (a.k === "item" ? "item" : a.quote ? "text" : a.rect ? "region" : "page");

export class LinkStore {
  constructor() { this.links = new Map(); this.index = new Map(); this.version = 0; this.listeners = new Set(); }
  get size() { return this.links.size; }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { this.version++; for (const f of this.listeners) { try { f(this); } catch (e) { console.warn(e); } } }
  all() { return [...this.links.values()]; }
  get(id) { return this.links.get(id) || null; }
  /** Connect two anchors. -> { link, created } (an identical connection, in either direction, is not made twice) or null when the two ends are the same place. */
  add(a, b) {
    a = sanitizeAnchor(a); b = sanitizeAnchor(b);
    if (!a || !b || sameAnchor(a, b) || this.links.size >= MAX_LINKS) return null;
    for (const l of this.forKey(anchorKey(a))) if ((sameAnchor(l.a, a) && sameAnchor(l.b, b)) || (sameAnchor(l.a, b) && sameAnchor(l.b, a))) return { link: l, created: false };
    const link = { id: newLinkId(), a, b, t: Date.now() };
    this.put(link); this.emit();
    return { link, created: true };
  }
  put(link) {
    this.links.set(link.id, link);
    for (const k of new Set([anchorKey(link.a), anchorKey(link.b)])) { let s = this.index.get(k); if (!s) this.index.set(k, (s = new Set())); s.add(link.id); }
  }
  remove(id) {
    const l = this.links.get(id);
    if (!l) return false;
    this.links.delete(id);
    for (const k of new Set([anchorKey(l.a), anchorKey(l.b)])) { const s = this.index.get(k); if (s) { s.delete(id); if (!s.size) this.index.delete(k); } }
    this.emit(); return true;
  }
  clear() { if (!this.links.size) return; this.links.clear(); this.index.clear(); this.emit(); }
  forKey(key) { const s = this.index.get(key); return s ? [...s].map((id) => this.links.get(id)) : []; }
  hasKey(key) { return this.index.has(key); }
  forItem(id) { return this.forKey("i:" + id); }
  forPdfPage(doc, page) { return this.forKey("p:" + doc + ":" + page); }
  /** The anchor of the link that is NOT at `anchor`'s end (anchor = the end you are at; matched by item id / document + page). */
  otherEnd(link, anchor) { const k = anchorKey(anchor); return anchorKey(link.a) === k ? link.b : link.a; }
  /** The end of a link that is at the given key (the other one when both ends are on the same page / item). */
  endAt(link, key) { return anchorKey(link.a) === key ? link.a : link.b; }

  toJSON() { return { format: LINKS_FORMAT, version: LINKS_VERSION, links: this.all().map(({ id, a, b, t }) => ({ id, a, b, t })) }; }
  /** Replace everything by the links of a saved list (invalid entries are dropped, nothing throws). Returns how many were dropped. */
  load(raw) {
    this.links.clear(); this.index.clear();
    let data = raw, dropped = 0;
    if (typeof raw === "string") { try { data = JSON.parse(raw); } catch { data = null; } }
    const list = data && data.format === LINKS_FORMAT && Array.isArray(data.links) ? data.links : [];
    for (const l of list.slice(0, MAX_LINKS)) {
      const a = l && sanitizeAnchor(l.a), b = l && sanitizeAnchor(l.b);
      if (!a || !b || sameAnchor(a, b)) { dropped++; continue; }
      let id = text(l.id, 40) || newLinkId(); if (this.links.has(id)) id = newLinkId();
      this.put({ id, a, b, t: num(l.t) ?? 0 });
    }
    this.emit(); return dropped;
  }
}
