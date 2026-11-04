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
export const LINKS_FORMAT = "NoteFlow-links", LINKS_VERSION = 1, MAX_LINKS = 20000, MAX_REJECTS = 3000, MAX_GRAVE = 500;
// A link made by the user has no src. src "suggested" = Smart linking proposed it and the user confirmed it; src "auto" = Smart linking made it on its own
// (only when the user turned that on); score = the similarity (0..1) it was proposed with. rejects = suggestions the user said are not related (kept, so they do not come back).
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
  constructor() { this.links = new Map(); this.index = new Map(); this.version = 0; this.listeners = new Set(); this.rejects = new Set(); this.grave = new Map(); }
  /** Number of links waiting in memory for an Undo of the deletion that removed them (see prune; never saved). */
  get graveSize() { return this.grave.size; }
  get size() { return this.links.size; }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { this.version++; for (const f of this.listeners) { try { f(this); } catch (e) { console.warn(e); } } }
  all() { return [...this.links.values()]; }
  get(id) { return this.links.get(id) || null; }
  /** Connect two anchors. -> { link, created } (an identical connection, in either direction, is not made twice) or null when the two ends are the same place. */
  add(a, b, { src = null, score = null } = {}) {
    a = sanitizeAnchor(a); b = sanitizeAnchor(b);
    if (!a || !b || sameAnchor(a, b) || this.links.size >= MAX_LINKS) return null;
    for (const l of this.forKey(anchorKey(a))) if ((sameAnchor(l.a, a) && sameAnchor(l.b, b)) || (sameAnchor(l.a, b) && sameAnchor(l.b, a))) return { link: l, created: false };
    const link = { id: newLinkId(), a, b, t: Date.now() };
    if (src === "suggested" || src === "auto") { link.src = src; if (num(score) !== null) link.score = Math.round(Math.min(1, Math.max(0, score)) * 100) / 100; }
    this.put(link); this.emit();
    return { link, created: true };
  }
  put(link) {
    this.links.set(link.id, link);
    for (const k of new Set([anchorKey(link.a), anchorKey(link.b)])) { let s = this.index.get(k); if (!s) this.index.set(k, (s = new Set())); s.add(link.id); }
  }
  /** Take a link out of the list and the index (no notification). */
  detach(l) {
    this.links.delete(l.id);
    for (const k of new Set([anchorKey(l.a), anchorKey(l.b)])) { const s = this.index.get(k); if (s) { s.delete(l.id); if (!s.size) this.index.delete(k); } }
  }
  remove(id) {
    const l = this.links.get(id);
    if (!l) return false;
    this.detach(l); this.grave.delete(id);
    this.emit(); return true;
  }
  clear() { if (!this.links.size && !this.rejects.size && !this.grave.size) return; this.links.clear(); this.index.clear(); this.rejects.clear(); this.grave.clear(); this.emit(); }
  /**
   * Keep the links consistent with the content: a link whose end no longer exists is DELETED, so there are never orphaned links (nobody has to look for them).
   *   hasItem(id) -> true while the item (text box, note, node, drawing, highlight ...) is still somewhere in the workspace
   *   hasDoc(hash) -> true while that PDF is open; pass null to leave PDF ends alone (a PDF that is still being opened has no identity yet)
   * The links are lost for good, and so they are not saved: the workspace file never holds one. One exception, only in memory: a link removed because an ITEM
   * was deleted is kept aside, and comes back if that item comes back (Undo of the deletion). A link removed because its PDF went is never kept.
   * -> { removed: [link], revived: [link] }
   */
  prune({ hasItem, hasDoc = null }) {
    const itemGone = (x) => x.k === "item" && !hasItem(x.id), docGone = (x) => !!hasDoc && x.k === "pdf" && !hasDoc(x.doc);
    const removed = [], revived = [];
    for (const l of [...this.links.values()]) {
      const byItem = itemGone(l.a) || itemGone(l.b), byDoc = docGone(l.a) || docGone(l.b);
      if (!byItem && !byDoc) continue;
      this.detach(l); removed.push(l);
      if (byItem && !byDoc) { if (this.grave.size >= MAX_GRAVE) this.grave.delete(this.grave.keys().next().value); this.grave.set(l.id, l); }
    }
    for (const [id, l] of [...this.grave]) {
      if (itemGone(l.a) || itemGone(l.b)) continue;                                       // still deleted: keep waiting
      this.grave.delete(id);
      if (docGone(l.a) || docGone(l.b) || this.links.has(id) || this.links.size >= MAX_LINKS) continue;
      if (this.forKey(anchorKey(l.a)).some((o) => (sameAnchor(o.a, l.a) && sameAnchor(o.b, l.b)) || (sameAnchor(o.a, l.b) && sameAnchor(o.b, l.a)))) continue;    // (made again meanwhile)
      this.put(l); revived.push(l);
    }
    if (removed.length || revived.length) this.emit();
    return { removed, revived };
  }
  /** Remember that a suggestion (its key, see smartlink.js) is not wanted. */
  reject(key) { if (this.rejects.size >= MAX_REJECTS) this.rejects.delete(this.rejects.values().next().value); this.rejects.add(String(key).slice(0, 80)); }
  isRejected(key) { return this.rejects.has(key); }
  /** Number of links made by Smart linking (src auto / suggested), or of the given src. */
  countSrc(src = null) { let n = 0; for (const l of this.links.values()) if (src ? l.src === src : !!l.src) n++; return n; }
  forKey(key) { const s = this.index.get(key); return s ? [...s].map((id) => this.links.get(id)) : []; }
  hasKey(key) { return this.index.has(key); }
  forItem(id) { return this.forKey("i:" + id); }
  forPdfPage(doc, page) { return this.forKey("p:" + doc + ":" + page); }
  /** The anchor of the link that is NOT at `anchor`'s end (anchor = the end you are at; matched by item id / document + page). */
  otherEnd(link, anchor) { const k = anchorKey(anchor); return anchorKey(link.a) === k ? link.b : link.a; }
  /** The end of a link that is at the given key (the other one when both ends are on the same page / item). */
  endAt(link, key) { return anchorKey(link.a) === key ? link.a : link.b; }

  toJSON() {
    const out = { format: LINKS_FORMAT, version: LINKS_VERSION, links: this.all().map(({ id, a, b, t, src, score }) => ({ id, a, b, t, ...(src ? { src } : {}), ...(score !== undefined ? { score } : {}) })) };
    if (this.rejects.size) out.rejects = [...this.rejects];
    return out;
  }
  /** Replace everything by the links of a saved list (invalid entries are dropped, nothing throws). Returns how many were dropped. */
  load(raw) {
    this.links.clear(); this.index.clear(); this.rejects.clear(); this.grave.clear();
    let data = raw, dropped = 0;
    if (typeof raw === "string") { try { data = JSON.parse(raw); } catch { data = null; } }
    const list = data && data.format === LINKS_FORMAT && Array.isArray(data.links) ? data.links : [];
    for (const l of list.slice(0, MAX_LINKS)) {
      const a = l && sanitizeAnchor(l.a), b = l && sanitizeAnchor(l.b);
      if (!a || !b || sameAnchor(a, b)) { dropped++; continue; }
      let id = text(l.id, 40) || newLinkId(); if (this.links.has(id)) id = newLinkId();
      const link = { id, a, b, t: num(l.t) ?? 0 };
      if (l.src === "suggested" || l.src === "auto") { link.src = l.src; if (num(l.score) !== null) link.score = Math.min(1, Math.max(0, l.score)); }
      this.put(link);
    }
    if (data && Array.isArray(data.rejects)) for (const k of data.rejects.slice(0, MAX_REJECTS)) if (typeof k === "string") this.rejects.add(k.slice(0, 80));
    this.emit(); return dropped;
  }
}
