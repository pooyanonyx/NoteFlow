// PDF navigation helpers: the document outline (its own table of contents) and small page thumbnails drawn on demand.
const outlines = new WeakMap();

/** The outline of a pdf.js document as a tree [{ title, page, items }] (page = 0-based index or null when the entry points nowhere). [] when the PDF has none. Cached per document. */
export async function outlineOf(doc) {
  if (outlines.has(doc)) return outlines.get(doc);
  const job = (async () => {
    let raw = null; try { raw = await doc.getOutline(); } catch { raw = null; }
    if (!Array.isArray(raw)) return [];
    let budget = 3000;                                                     // (a broken or hostile outline cannot keep us busy for long)
    const pageOf = async (dest) => {
      try {
        const d = typeof dest === "string" ? await doc.getDestination(dest) : dest;
        if (!Array.isArray(d) || d[0] === undefined || d[0] === null) return null;
        return typeof d[0] === "object" ? await doc.getPageIndex(d[0]) : Number.isInteger(d[0]) ? d[0] : null;
      } catch { return null; }
    };
    const walk = async (list, depth) => {
      const out = [];
      for (const n of list) {
        if (--budget < 0 || depth > 8) break;
        out.push({ title: String(n.title || "").replace(/\s+/g, " ").trim().slice(0, 200) || "(untitled)", page: n.dest ? await pageOf(n.dest) : null, items: Array.isArray(n.items) && n.items.length ? await walk(n.items, depth + 1) : [] });
      }
      return out;
    };
    return walk(raw, 0);
  })();
  outlines.set(doc, job);
  return job;
}
export const flattenOutline = (tree, depth = 0) => tree.flatMap((n) => [{ title: n.title, page: n.page, depth }, ...flattenOutline(n.items, depth + 1)]);

/** Thumbnails for a list: each is drawn once, when it first scrolls into view, one after the other (never two at a time, never while the user is scrolling fast);
 *  at most `keep` stay in memory, the ones furthest from the view are dropped and redrawn if they come back. */
export class Thumbs {
  constructor(doc, { width = 112, keep = 60 } = {}) {
    this.doc = doc; this.width = width; this.keep = keep; this.cells = new Map(); this.queue = []; this.busy = false; this.dead = false; this.tick = 0;
    this.io = typeof IntersectionObserver === "function" ? new IntersectionObserver((es) => { for (const e of es) { const c = this.cells.get(e.target); if (!c) continue; c.visible = e.isIntersecting; if (e.isIntersecting) this.want(c); } }, { rootMargin: "120px" }) : null;
  }
  /** Register a placeholder element for a page; returns its canvas. */
  add(el, canvas, index) {
    const c = { el, canvas, index, done: false, visible: !this.io, used: 0 }; this.cells.set(el, c);
    if (this.io) this.io.observe(el); else this.want(c);
    return c;
  }
  want(c) { c.used = ++this.tick; if (!c.done && !this.queue.includes(c)) this.queue.push(c); this.pump(); }
  async pump() {
    if (this.busy || this.dead) return; this.busy = true;
    try {
      while (this.queue.length && !this.dead) {
        const c = this.queue.sort((a, b) => b.used - a.used).shift();                    // the most recently wanted first (what is on screen now)
        if (!c.visible || c.done || !c.el.isConnected) continue;
        await this.draw(c); await new Promise((r) => setTimeout(r, 0));
      }
    } finally { this.busy = false; }
    this.evict();
  }
  async draw(c) {
    try {
      const page = await this.doc.getPage(c.index + 1), v1 = page.getViewport({ scale: 1 }), sc = this.width / v1.width, vp = page.getViewport({ scale: sc * Math.min(2, window.devicePixelRatio || 1) });
      c.canvas.width = Math.ceil(vp.width); c.canvas.height = Math.ceil(vp.height);
      c.canvas.style.aspectRatio = `${v1.width} / ${v1.height}`;
      await page.render({ canvasContext: c.canvas.getContext("2d"), viewport: vp, background: "#ffffff" }).promise;
      c.done = true; page.cleanup?.();
    } catch (e) { if (!this.dead) c.done = false; }
  }
  evict() {
    const drawn = [...this.cells.values()].filter((c) => c.done);
    if (drawn.length <= this.keep) return;
    for (const c of drawn.sort((a, b) => a.used - b.used).slice(0, drawn.length - this.keep)) { c.canvas.width = c.canvas.height = 0; c.done = false; }     // (frees the bitmap; drawn again when it returns)
  }
  destroy() {
    this.dead = true; this.queue.length = 0; if (this.io) this.io.disconnect();
    for (const c of this.cells.values()) { c.canvas.width = c.canvas.height = 0; }
    this.cells.clear();
  }
}
