// Linked notes: everything between the LinkStore (links.js) and the screen.
//   - resolving an anchor to where it is NOW (an item is found by its id in whichever panel has it, a PDF by its content hash in whichever
//     panel has it open), and saying so plainly when it cannot be found (deleted item, PDF not open, PDF replaced by a different file)
//   - going there: the panel is shown (also when the layout does not have it any more), the page is opened, the place is highlighted
//   - making a link: "pick mode" - choose the two ends (an item, a PDF page, a dragged region, a dragged passage of text), in either order
//   - drawing the link marks on the pages and answering a press on them
import * as M from "./model.js";
import * as R from "./render.js";
import { LinkStore, anchorKey, anchorShape, sameAnchor } from "./links.js";
import { pageTextData, rectsForRange } from "./pdftext.js";
import { el, toast, popup, closePopup, dialog, icon } from "./ui.js";

const TEAL = "#00897b", WARN = "#ef6c00", PANELS = ["pdf", "pdf2", "nb", "nb2", "board", "board2"];
const idSets = new WeakMap();                                       // items array -> Set of the ids in it (pages are replaced, never edited, so this stays right)
const idsOf = (items) => { let s = idSets.get(items); if (!s) { s = new Set(); for (const d of items) if (d.id) s.add(d.id); idSets.set(items, s); } return s; };
const clean = (s, n = 90) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);

export function itemPreview(d) {
  if (!d) return "";
  if (d.t === "text" || d.t === "note" || d.t === "node") return clean(d.text) || (d.t === "note" ? "Note" : "Text");
  return { pen: "Drawing", mark: "Marker", hl: "Highlight", image: "Image", rect: "Rectangle", ellipse: "Ellipse", line: "Line", arrow: "Arrow", shape: "Shape" }[d.t] || "Item";
}

export class LinkController {
  constructor(app) {
    this.app = app; this.store = new LinkStore(); this.pick = null; this.rev = 0; this.cache = new Map(); this.cacheRev = -1;
    this.banner = el("div", { class: "linkbanner", hidden: true, role: "status" });
    app.root.append(this.banner);
    this.store.onChange(() => { this.rev++; this.renderAll(); });
  }
  /** Something that links can depend on changed (content edited, a PDF opened ...). */
  touch() { this.rev++; }
  renderAll() { for (const p of Object.values(this.app.panels)) p.render(); }

  // ------------------------------------------------------------ resolving
  panelsInOrder(hint) { const o = this.app.order; return [...new Set([hint, ...o, ...PANELS].filter((k) => k && this.app.panels[k]))].map((k) => this.app.panels[k]); }
  findItem(id, hint) {
    for (const p of this.panelsInOrder(hint)) {
      for (let i = 0; i < p.pages.length; i++) {
        const items = p.pages[i].items;
        if (idsOf(items).has(id)) { const index = items.findIndex((d) => d.id === id); if (index >= 0) return { panel: p, page: i, index, item: items[index] }; }
      }
    }
    return null;
  }
  findPdf(hash) { return this.panelsInOrder().find((p) => p.kind === "pdf" && p.pdf && p.pdf.hash === hash) || null; }
  /** Where an anchor is now. -> { state: "ok" | "missing-item" | "pdf-missing" | "pdf-replaced" | "pdf-page", panel?, page?, index?, item?, why } */
  resolve(a) {
    if (this.cacheRev !== this.rev) { this.cache.clear(); this.cacheRev = this.rev; }
    const key = a.k === "item" ? "i" + a.id : "p" + a.doc + a.page;
    let r = this.cache.get(key);
    if (!r) { r = this.resolveNow(a); this.cache.set(key, r); }
    return r;
  }
  resolveNow(a) {
    if (a.k === "item") {
      const f = this.findItem(a.id, a.slot);
      return f ? { state: "ok", ...f } : { state: "missing-item", why: "The linked item was deleted or is not in this workspace." };
    }
    const p = this.findPdf(a.doc);
    if (!p) {
      const other = this.panelsInOrder().find((q) => q.kind === "pdf" && q.pdf && a.name && q.name === a.name);
      return other ? { state: "pdf-replaced", panel: other, page: a.page, why: `“${a.name}” was linked as a different file: the PDF that is open now has other contents.` }
        : { state: "pdf-missing", why: `The PDF “${a.name || "document"}” is not open in this workspace.` };
    }
    if (a.page >= p.pages.length) return { state: "pdf-page", panel: p, why: "That page does not exist in the PDF." };
    return { state: "ok", panel: p, page: a.page };
  }
  describe(a) {
    const r = this.resolve(a);
    if (a.k === "item") return { title: r.item ? itemPreview(r.item) : a.pv || "Item", where: r.state === "ok" ? `${r.panel.label} · page ${r.page + 1}` : r.why, ok: r.state === "ok", icon: "note" };
    const shape = anchorShape(a), what = shape === "text" ? `“${clean(a.quote.text, 60)}”` : shape === "region" ? "marked region" : "page";
    return { title: `${a.name || "PDF"} · p. ${a.page + 1} · ${what}`, where: r.state === "ok" ? "" : r.why, ok: r.state === "ok", icon: "pdf" };
  }

  // ------------------------------------------------------------ going to an anchor
  /** Show the place an anchor names. opts.link: the link it belongs to (so a broken one can be removed), opts.from: the panel the user is in. */
  async go(a, { link = null, from = null } = {}) {
    let r = this.resolve(a);
    if (r.state === "pdf-replaced") {
      const c = await dialog({ title: "This PDF has changed", content: el("div", {}, el("p", {}, r.why), el("p", { class: "muted" }, "The link points to a page of the file as it was when the link was made, so the page number may not show the same thing now.")),
        buttons: [{ label: "Cancel", value: "no" }, ...(link ? [{ label: "Remove link", value: "rm", danger: true }] : []), { label: `Open page ${a.page + 1} anyway`, value: "go", primary: true }] });
      if (c === "rm" && link) this.store.remove(link.id);
      if (c !== "go") return false;
    } else if (r.state !== "ok") {
      const c = await dialog({ title: "Link not available", content: el("p", {}, r.why), buttons: [{ label: "Close", value: "no" }, ...(link ? [{ label: "Remove link", value: "rm", danger: true, primary: true }] : [])] });
      if (c === "rm" && link) this.store.remove(link.id);
      return false;
    }
    const p = r.panel;
    await this.app.revealPanel(p.key, from);
    this.app.setActive(p);
    if (a.k === "item") {
      if (p.kind !== "board") await p.goto(r.page);
      const b = p.boundsOf(r.item);
      await p.showLocation(r.page, [[b[0] - 4, b[1] - 4, b[2] + 4, b[3] + 4]], { kind: "flash", ms: 2600 });
    } else {
      const sz = p.sizeOf(a.page), rects = a.quote && a.quote.rects.length ? a.quote.rects : a.rect ? [a.rect] : [[0, 0, sz[0], sz[1]]];
      await p.goto(a.page);
      await p.showLocation(a.page, rects, { kind: "flash", ms: 2600, top: !a.rect && !a.quote });
    }
    return true;
  }

  // ------------------------------------------------------------ making anchors
  itemAnchor(panel, idx) {
    const pg = panel.pages[panel.cur], d = pg && pg.items[idx];
    if (!d || d.t === "conn") return null;
    const fresh = !d.id; M.ensureId(d);
    if (fresh) { pg.items = pg.items.slice(); panel.dirty = true; this.app.onChange(panel); }          // (a new array: the session backup writes this page again, with the id)
    return { k: "item", id: d.id, slot: panel.key, pv: itemPreview(d) };
  }
  pdfAnchor(panel, page, { rect = null, quote = null } = {}) {
    if (!panel.pdf || !panel.pdf.hash) return null;
    const a = { k: "pdf", doc: panel.pdf.hash, name: panel.name || "", page, pv: quote ? clean(quote.text, 80) : `Page ${page + 1}` };
    if (rect) a.rect = rect.map((v) => Math.round(v * 100) / 100);
    if (quote) a.quote = quote;
    return a;
  }

  // ------------------------------------------------------------ pick mode
  get picking() { return !!this.pick; }
  /** The Link button of a panel: with an item selected that already has links, a list; otherwise start making a link (from the selected item if there is one). */
  start(panel) {
    if (this.pick) { this.cancel(); return; }
    this.app.setActive(panel);
    panel.finishEdit();
    let a = null;
    if (panel.tool === "select" && panel.selected !== null) {
      a = this.itemAnchor(panel, panel.selected);
      if (a && this.store.forItem(a.id).length) { this.openMenu(panel, panel.linkBtn, [{ key: anchorKey(a), anchor: a, links: this.store.forItem(a.id) }], { add: () => this.begin(a) }); return; }
    }
    this.begin(a);
  }
  begin(a) {
    this.pick = { a }; this.say();
    for (const p of Object.values(this.app.panels)) { p.root.classList.add("linkpick"); if (p.tool !== "pan") p.cancelAction?.(); }
    if (this.app.active) this.app.active.render();
  }
  say() {
    const k = this.pick;
    this.banner.hidden = !k; if (!k) return;
    this.banner.replaceChildren(icon("chain"),
      el("span", { class: "msg" }, k.a ? el("span", {}, "Linking ", el("b", {}, `“${this.describe(k.a).title}”`), ". Now choose the other end: ") : "Choose the first end: ",
        "tap an item, or in a PDF tap a page, drag a region, or drag across text."),
      el("button", { class: "btn small", type: "button", onclick: () => this.cancel() }, "Cancel"));
  }
  cancel() {
    if (!this.pick) return;
    this.pick = null; this.banner.hidden = true;
    for (const p of Object.values(this.app.panels)) { p.root.classList.remove("linkpick"); p.pickPrev = null; if (p.action && p.action.type === "pick") p.action = null; p.render(); }
  }
  /** One end was chosen. */
  choose(anchor, panel) {
    if (!this.pick || !anchor) return;
    if (!this.pick.a) { this.pick.a = anchor; this.say(); toast("First end chosen. Now choose the other end."); return; }
    const first = this.pick.a, res = this.store.add(first, anchor);
    if (!res) { toast("Choose a different place for the other end."); return; }
    this.cancel();
    for (const an of [first, anchor]) { const r = this.resolve(an); if (r.panel) { r.panel.dirty = true; r.panel.ui(); } }
    this.app.scheduleAutosave();
    toast(res.created ? "Linked. Press the chain mark to jump to the other end." : "These two are already linked.");
  }
  /** pointer events of a panel while picking (called by Panel). Returns true when the event was taken. */
  down(panel, e, l) {
    if (!this.pick) return false;
    panel.activateAt(l.y);
    const p = panel.toPage(e), a = { type: "pick", l0: l, p0: p, moved: false, data: null, page: panel.cur };
    panel.action = a;
    if (panel.kind === "pdf" && panel.pdf) pageTextData(panel.pdf.doc, panel.cur).then((d) => { a.data = d; }).catch(() => {});
    return true;
  }
  nearestWord(data, pt, tol = 3) {
    let best = -1, bd = Infinity;
    data.words.forEach((w, i) => { const dx = Math.max(w.x0 - pt.x, 0, pt.x - w.x1), dy = Math.max(w.y0 - pt.y, 0, pt.y - w.y1), d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } });
    return { i: best, d: Math.sqrt(bd), near: bd <= tol * tol };
  }
  move(panel, e, l) {
    const a = panel.action;
    if (!a || a.type !== "pick") return;
    if (!a.moved && Math.hypot(l.x - a.l0.x, l.y - a.l0.y) < 6) return;
    a.moved = true;
    const p = panel.clampP(panel.toPage(e)), g = this.gesture(panel, a, p);
    panel.pickPrev = g ? { page: a.page, rects: g.rects, kind: g.kind } : null;
    panel.render();
  }
  /** What the drag from a.p0 to p selects on a PDF page: a passage of text (it started on a word) or a region. */
  gesture(panel, a, p) {
    if (panel.kind !== "pdf") return null;
    const start = a.data && a.data.words.length ? this.nearestWord(a.data, a.p0, 4 / panel.view.scale + 2) : null;
    if (start && start.near) {
      const end = this.nearestWord(a.data, p), lo = Math.min(start.i, end.i), hi = Math.max(start.i, end.i);
      const s = a.data.words[lo].start, t = a.data.words[hi].end;
      return { kind: "text", rects: rectsForRange(a.data, s, t), text: clean(a.data.text.slice(s, t), 400) };
    }
    const x0 = Math.min(a.p0.x, p.x), y0 = Math.min(a.p0.y, p.y), x1 = Math.max(a.p0.x, p.x), y1 = Math.max(a.p0.y, p.y);
    return { kind: "region", rects: [[x0, y0, x1, y1]], rect: [x0, y0, x1, y1] };
  }
  up(panel, e) {
    const a = panel.action; panel.action = null; panel.pickPrev = null;
    if (!a || a.type !== "pick") return;
    const p = panel.clampP(panel.toPage(e));
    let anchor = null;
    if (a.moved && panel.kind === "pdf") {
      const g = this.gesture(panel, a, p);
      if (g && g.kind === "text" && g.text) anchor = this.pdfAnchor(panel, a.page, { quote: { text: g.text, rects: g.rects.slice(0, 40) } });
      else if (g && g.kind === "region" && g.rect[2] - g.rect[0] > 8 && g.rect[3] - g.rect[1] > 8) anchor = this.pdfAnchor(panel, a.page, { rect: g.rect });
    }
    if (!anchor) {                                                                        // a tap (or a drag too small to mean anything): the item under it, else the page
      const idx = panel.hit(a.p0);
      if (idx !== null) anchor = this.itemAnchor(panel, idx);
      else if (panel.kind === "pdf") anchor = this.pdfAnchor(panel, a.page);
      else { toast("Tap a text box, note or other item to link it."); panel.render(); return; }
      if (!anchor && panel.kind === "pdf") toast("This PDF cannot be linked (its identity could not be read).");
    }
    panel.render();
    this.choose(anchor, panel);
  }

  // ------------------------------------------------------------ the marks on the pages
  /** Draw the link marks of page i (called by Panel.drawDoc with the page's own coordinates). Fills panel.linkHits with what can be pressed. */
  draw(panel, ctx, i, w, h) {
    const st = this.store;
    if (!st.size) return;
    const s = panel.view.scale, r = 11 / s, groups = new Map();
    const add = (sig, a, links, rects, bounds) => { if (!groups.has(sig)) groups.set(sig, { anchor: a, links, rects, bounds, key: anchorKey(a) }); };
    const hash = panel.kind === "pdf" && panel.pdf ? panel.pdf.hash : null;
    if (hash) for (const l of st.forPdfPage(hash, i)) for (const side of [l.a, l.b]) {
      if (side.k !== "pdf" || side.doc !== hash || side.page !== i) continue;
      const sig = JSON.stringify([side.rect, side.quote && side.quote.text]);
      if (groups.has(sig)) { groups.get(sig).links.push(l); continue; }
      const rects = side.quote ? side.quote.rects : side.rect ? [side.rect] : [];
      const b = rects.length ? [Math.min(...rects.map((q) => q[0])), Math.min(...rects.map((q) => q[1])), Math.max(...rects.map((q) => q[2])), Math.max(...rects.map((q) => q[3]))] : null;
      add(sig, side, [l], rects, b);
    }
    for (const d of panel.pages[i].items) if (d.id && st.hasKey("i:" + d.id)) add("i" + d.id, { k: "item", id: d.id, slot: panel.key }, st.forItem(d.id), [], panel.boundsOf(d));
    let stack = 0;
    ctx.save();
    for (const g of groups.values()) {
      const broken = g.links.some((l) => this.resolve(sameAnchor(l.a, g.anchor) || anchorKey(l.a) === g.key ? l.b : l.a).state !== "ok");
      const col = broken ? WARN : TEAL;
      if (g.anchor.k === "pdf" && g.rects.length) {
        ctx.setLineDash([5 / s, 3 / s]); ctx.lineWidth = 1.5 / s; ctx.strokeStyle = col; ctx.fillStyle = g.anchor.quote ? "rgba(0,137,123,.20)" : "rgba(0,137,123,.07)";
        for (const q of g.rects) { ctx.fillRect(q[0], q[1], q[2] - q[0], q[3] - q[1]); if (!g.anchor.quote) ctx.strokeRect(q[0], q[1], q[2] - q[0], q[3] - q[1]); }
        ctx.setLineDash([]);
      }
      let cx, cy;
      if (g.bounds) { cx = Math.min(w - r, Math.max(r, g.bounds[2])); cy = Math.min(h - r, Math.max(r, g.bounds[1])); }
      else { cx = w - r * 1.6; cy = Math.min(h - r, Math.max(r * 1.6, panel.belowBars(i) + r * 1.4) + stack++ * r * 2.4); }     // a whole page: its badges sit at the right edge, just below the toolbars (they follow the page while it is on screen)
      this.badge(ctx, cx, cy, r, g.links.length, col);
      const [sx, sy] = panel.pageToScreenAt(i, cx, cy);
      panel.linkHits.push({ sx, sy, r: Math.max(14, 11), group: g });
    }
    ctx.restore();
  }
  badge(ctx, x, y, r, n, col) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = r * 0.14; ctx.strokeStyle = "#fff"; ctx.stroke();
    ctx.strokeStyle = "#fff"; ctx.fillStyle = "#fff"; ctx.lineWidth = r * 0.17; ctx.lineCap = "round";
    if (n > 1) { ctx.font = `bold ${r * 1.15}px sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(String(n), x, y + r * 0.04); return; }
    const a = r * 0.34;                                                                              // two linked rings
    ctx.beginPath(); ctx.arc(x - a, y, a * 1.15, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.arc(x + a, y, a * 1.15, 0, Math.PI * 2); ctx.stroke();
  }
  /** A press on a link mark (screen position inside the panel). Returns true when it was one. */
  press(panel, l, e = null) {
    if (this.pick || !panel.linkHits.length) return false;
    const hit = panel.linkHits.find((h) => Math.hypot(h.sx - l.x, h.sy - l.y) <= h.r);
    if (!hit) return false;
    const g = hit.group;
    if (g.links.length === 1) { const lk = g.links[0]; this.go(this.store.otherEnd(lk, g.anchor), { link: lk, from: panel }); }
    else this.openMenu(panel, null, [g], { at: l });
    return true;
  }

  // ------------------------------------------------------------ lists
  /** A list of the links at one or more places: where each goes, a button to go there and one to remove it. */
  openMenu(panel, anchorEl, groups, { add = null, at = null } = {}) {
    const rows = [];
    for (const g of groups) for (const lk of g.links) {
      const other = this.store.otherEnd(lk, g.anchor), d = this.describe(other);
      rows.push(el("div", { class: "lrow" + (d.ok ? "" : " bad") },
        el("button", { class: "lgo", type: "button", title: "Go there", onclick: () => { closePopup(); this.go(other, { link: lk, from: panel }); } },
          icon(d.icon), el("span", { class: "ltxt" }, el("span", { class: "ltitle" }, d.title), d.where ? el("span", { class: "lwhere" }, d.where) : null)),
        el("button", { class: "btn small", type: "button", title: "Remove this link", "aria-label": "Remove this link", onclick: () => { this.store.remove(lk.id); this.app.scheduleAutosave(); closePopup(); } }, icon("trash"))));
    }
    const box = el("div", { class: "linkmenu" }, el("div", { class: "lhead" }, "Linked to"), ...rows,
      add ? el("button", { class: "mi", type: "button", onclick: () => { closePopup(); add(); } }, "Add another link…") : null);
    const a = anchorEl || el("span", { style: `position:fixed;left:${(at ? panel.stage.getBoundingClientRect().left + at.x : 100)}px;top:${(at ? panel.stage.getBoundingClientRect().top + at.y : 100)}px;width:1px;height:1px` });
    if (!anchorEl) document.body.append(a);
    popup(a, box, { onClose: () => { if (!anchorEl) a.remove(); } });
  }
  /** All links of the workspace. */
  async manage() {
    const draw = () => {
      const links = this.store.all();
      if (!links.length) return el("p", { class: "muted" }, "No links yet. Press Link in a panel, choose one end (a note, a text box ...) and then the other (a PDF page, a region or a passage of text).");
      return el("div", { class: "linklist" }, ...links.map((lk) => {
        const A = this.describe(lk.a), B = this.describe(lk.b);
        const end = (an, d) => el("button", { class: "lgo", type: "button", onclick: () => { ref.close(); this.go(an, { link: lk }); } },
          icon(d.icon), el("span", { class: "ltxt" }, el("span", { class: "ltitle" }, d.title), d.where ? el("span", { class: "lwhere" }, d.where) : null));
        return el("div", { class: "lrow" + (A.ok && B.ok ? "" : " bad") }, end(lk.a, A), el("span", { class: "larrow" }, "↔"), end(lk.b, B),
          el("button", { class: "btn small", type: "button", title: "Remove this link", "aria-label": "Remove this link", onclick: () => { this.store.remove(lk.id); this.app.scheduleAutosave(); box.replaceChildren(draw()); } }, icon("trash")));
      }));
    };
    const ref = {}, box = el("div", { class: "linkmanager" }, draw());
    const broken = this.store.all().filter((lk) => !this.describe(lk.a).ok || !this.describe(lk.b).ok);
    await dialog({ title: `Linked notes (${this.store.size})`, content: box, ref,
      buttons: [...(broken.length ? [{ label: `Remove ${broken.length} broken`, value: "rm", danger: true }] : []), { label: "Close", value: true, primary: true }] }).then((v) => {
      if (v === "rm") { for (const lk of broken) this.store.remove(lk.id); this.app.scheduleAutosave(); toast("Broken links removed."); }
    });
  }
}
