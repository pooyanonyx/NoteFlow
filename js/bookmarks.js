// The reader's own bookmarks in a PDF: a page and a short name. Kept per PDF (by its content hash) in the workspace settings, so they travel with the workspace file;
// workspaces from before bookmarks existed simply have none.
const MAX_PER_DOC = 200, MAX_DOCS = 50;

export class Bookmarks {
  constructor() { this.map = new Map(); this.listeners = new Set(); }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { for (const f of this.listeners) { try { f(this); } catch (e) { console.warn(e); } } }
  list(doc) { return doc && this.map.has(doc) ? this.map.get(doc).slice() : []; }
  has(doc, page) { return this.list(doc).some((b) => b.page === page); }
  /** Bookmark a page (one bookmark per page). Returns false when there is no room or no identity. */
  add(doc, page, label) {
    if (!/^[0-9a-f]{8,64}$/.test(String(doc)) || !Number.isInteger(page) || page < 0) return false;
    const l = this.map.get(doc) || []; if (l.some((b) => b.page === page)) return false;
    if (l.length >= MAX_PER_DOC || (!this.map.has(doc) && this.map.size >= MAX_DOCS)) return false;
    l.push({ page, label: String(label || `Page ${page + 1}`).replace(/\s+/g, " ").trim().slice(0, 120) || `Page ${page + 1}` });
    l.sort((a, b) => a.page - b.page); this.map.set(doc, l); this.emit(); return true;
  }
  rename(doc, page, label) { const b = (this.map.get(doc) || []).find((x) => x.page === page); const t = String(label || "").replace(/\s+/g, " ").trim().slice(0, 120); if (!b || !t || b.label === t) return false; b.label = t; this.emit(); return true; }
  remove(doc, page) { const l = this.map.get(doc); if (!l) return false; const n = l.filter((b) => b.page !== page); if (n.length === l.length) return false; if (n.length) this.map.set(doc, n); else this.map.delete(doc); this.emit(); return true; }
  toggle(doc, page, label) { return this.has(doc, page) ? (this.remove(doc, page), false) : this.add(doc, page, label); }
  clear() { if (this.map.size) { this.map.clear(); this.emit(); } }
  toJSON() { const o = {}; for (const [d, l] of this.map) o[d] = l.map((b) => ({ page: b.page, label: b.label })); return o; }
  /** From untrusted data (a workspace file). */
  load(raw) {
    this.map.clear();
    if (raw && typeof raw === "object") for (const [doc, l] of Object.entries(raw).slice(0, MAX_DOCS)) {
      if (!/^[0-9a-f]{8,64}$/.test(doc) || !Array.isArray(l)) continue;
      const seen = new Set(), out = [];
      for (const b of l.slice(0, MAX_PER_DOC)) if (b && Number.isInteger(b.page) && b.page >= 0 && !seen.has(b.page)) { seen.add(b.page); out.push({ page: b.page, label: String(b.label || `Page ${b.page + 1}`).slice(0, 120) }); }
      if (out.length) this.map.set(doc, out.sort((a, b) => a.page - b.page));
    }
    this.emit();
  }
}
