// Linked notes: everything between the LinkStore (links.js) and the screen.
//   - resolving an anchor to where it is NOW (an item is found by its id in whichever panel has it, a PDF by its content hash in whichever
//     panel has it open), and saying so plainly when it cannot be found (deleted item, PDF not open, PDF replaced by a different file)
//   - going there: the panel is shown (also when the layout does not have it any more), the page is opened, the place is highlighted
//   - making a link: "pick mode" - choose the two ends (an item, a PDF page, a dragged region, a dragged passage of text), in either order
//   - drawing the link marks on the pages and answering a press on them
import * as M from "./model.js";
import * as R from "./render.js";
import { LinkStore, anchorKey, anchorShape, sameAnchor } from "./links.js";
import { pageTextData, rectsForRange, caretAt, quoteText } from "./pdftext.js";
import { el, toast, popup, closePopup, dialog, icon } from "./ui.js";
import { MODES } from "./smartlink.js";

const TEAL = "#00897b", SMART = "#7e57c2", WARN = "#ef6c00", PANELS = ["pdf", "pdf2", "nb", "nb2", "board", "board2"];
const idSets = new WeakMap();                                       // items array -> Set of the ids in it (pages are replaced, never edited, so this stays right)
const idsOf = (items) => { let s = idSets.get(items); if (!s) { s = new Set(); for (const d of items) if (d.id) s.add(d.id); idSets.set(items, s); } return s; };
const clean = (s, n = 90) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);

export function itemPreview(d) {
  if (!d) return "";
  if (d.t === "text" || d.t === "note" || d.t === "node") return clean(d.text) || (d.t === "note" ? "Note" : "Text");
  return { pen: "Drawing", mark: "Marker", hl: "Highlight", image: "Image", rect: "Rectangle", ellipse: "Ellipse", line: "Line", arrow: "Arrow", shape: "Shape" }[d.t] || "Item";
}

/** What kind of thing an item is, in words ("Text box", "Drawing" ...). */
export function itemKind(d) {
  if (!d) return "Item";
  return { text: "Text box", note: "Note", node: "Mind map node", pen: "Drawing", mark: "Marker", hl: "Highlight", image: "Image", rect: "Shape", ellipse: "Shape", line: "Shape", arrow: "Shape", shape: "Shape" }[d.t] || "Item";
}

const ACTIONS = {
  link: { icon: "chain", label: "Link", title: "Link two things that already exist: a note, text box or drawing with a PDF page, region or passage. Select the note first, or just press Link." },
  quote: { icon: "quote", label: "Quote", title: "Quote: drag across text in the PDF and that text goes into your notes, linked to its page. (Link connects things you already have; Quote brings the text in.)" },
};
export class LinkController {
  constructor(app) {
    this.app = app; this.store = new LinkStore(); this.pick = null; this.rev = 0; this.cache = new Map(); this.cacheRev = -1;
    this.guide = el("div", { class: "linkguide linkbar", hidden: true, role: "region", "aria-label": "Link two things" });
    app.root.append(this.guide);
    this.store.onChange(() => { this.rev++; this.renderAll(); });
  }
  /** Something that links can depend on changed (content edited, a PDF opened ...). */
  touch() { this.rev++; }
  /**
   * Delete every link whose end is gone: an item that was deleted (on any page of any panel: notebooks, boards, PDF annotations), a PDF that was closed or replaced.
   * Called after every change of content and whenever a PDF is opened or closed, so a link never outlives what it connects. Not while a workspace is being loaded
   * (the panels are filled one after the other; the app sweeps once when it is done, which also cleans up files that were saved with such links).
   * -> the number of links deleted
   */
  sweep() {
    const st = this.store, app = this.app;
    if (app.restoring || (!st.size && !st.graveSize)) return 0;
    const ids = new Set(), docs = new Set(); let opening = false;
    for (const p of Object.values(app.panels)) {
      for (const pg of p.pages || []) for (const id of idsOf(pg.items)) ids.add(id);
      if (p.kind === "pdf" && p.pdf) { if (p.pdf.hash) docs.add(p.pdf.hash); else opening = true; }       // (a PDF without identity yet: leave the PDF ends alone for now)
    }
    const res = st.prune({ hasItem: (id) => ids.has(id), hasDoc: opening ? null : (h) => docs.has(h) });
    if (res.removed.length || res.revived.length) app.scheduleAutosave();
    return res.removed.length;
  }
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
  /** "Text box", "Note", "PDF page", "PDF region", "PDF text" ... */
  kindOf(a) { if (a.k === "item") { const r = this.resolve(a); return r.item ? itemKind(r.item) : "Item"; } return { page: "PDF page", region: "PDF region", text: "PDF text" }[anchorShape(a)]; }
  describe(a) {
    const r = this.resolve(a);
    if (a.k === "item") return { title: r.item ? itemPreview(r.item) : a.pv || "Item", where: r.state === "ok" ? `${r.panel.label} · page ${r.page + 1}` : r.why, ok: r.state === "ok", icon: "note" };
    const shape = anchorShape(a), what = shape === "text" ? `“${clean(a.quote.text, 60)}”` : shape === "region" ? "region" : "";
    return { title: [a.name || "PDF", `p. ${a.page + 1}`, what].filter(Boolean).join(" · "), where: r.state === "ok" ? "" : r.why, ok: r.state === "ok", icon: "pdf" };
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
  itemAnchor(panel, idx, page = panel.cur) {
    const pg = panel.pages[page], d = pg && pg.items[idx];
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
      if (a && this.store.forItem(a.id).length) { this.openMenu(panel, this.app.linkBtn, [{ key: anchorKey(a), anchor: a, links: this.store.forItem(a.id) }], { add: () => this.begin(a) }); return; }
    }
    this.begin(a);
  }
  begin(a) {
    this.pick = { a }; this.say();
    for (const p of Object.values(this.app.panels)) { p.root.classList.add("linkpick"); p.releaseToolCursor(); if (p.tool !== "pan") p.cancelAction?.(); }
    if (a && a.k === "item") this.showPdfFor();
    if (this.app.active) this.app.active.render();
  }
  /** After a note was chosen first, the other end is a PDF place: if a PDF is open but not on screen, bring it back. */
  async showPdfFor() {
    const shown = this.app.order.some((k) => { const p = this.app.panels[k]; return p && p.kind === "pdf" && p.pdf; });
    if (shown) return;
    const hidden = PANELS.find((k) => { const p = this.app.panels[k]; return p && p.kind === "pdf" && p.pdf; });
    if (hidden) { await this.app.revealPanel(hidden, this.app.active); this.say(); }
  }
  /** The guide card: the two ends chosen so far and, in one sentence, what to do next. */
  say() {
    const k = this.pick;
    this.syncButtons();
    this.guide.hidden = !k; if (!k) return;
    if (k.quote) { this.guide.replaceChildren(icon("chain"), el("div", { class: "lgchips" }, el("span", { class: "lgstep" }, "Quote: drag across text in the PDF. The passage goes into your notes, linked to its page.")), el("button", { class: "btn small", type: "button", onclick: () => this.cancel() }, "Cancel")); return; }
    const a = k.a, step = a ? 2 : 1;
    const pdfOpen = Object.values(this.app.panels).some((p) => p.kind === "pdf" && p.pdf);
    // One slim row: [chain] (1 From ...) -> (2 To ...) [Step n of 2] [Cancel]. The instruction for the next step lives in the empty chip itself (full text in its tooltip),
    // so the bar stays a single line on a normal window and only wraps on a narrow one.
    let hint, short;
    if (!a) { hint = "Choose the first end. Tap a note, text box or drawing — or, in a PDF, tap a page, drag a box around a region, or drag across text."; short = "Tap a note, text box or drawing, or a PDF page / region / text"; }
    else if (a.k === "pdf") { hint = "Now choose the other end: tap the note, text box or drawing that should be linked to this PDF place."; short = "Tap the note or drawing to link it to"; }
    else if (!pdfOpen) { hint = "Now choose what it points to. No PDF is open yet: open one (Open PDF), then tap a page."; short = "Tap a note, or open a PDF first"; }
    else { hint = "Now choose what it points to. In the PDF, tap a page to link the whole page, drag a box to link a region, or drag across text to link a passage."; short = "Tap a PDF page, drag a box, or drag across text"; }
    const chip = (n, an) => {
      const done = !!an, now = step === n, label = n === 1 ? "From" : "To";
      return el("button", { class: "lchip" + (done ? " done" : "") + (now ? " now" : ""), type: "button", disabled: !done || n !== 1, title: done ? (n === 1 ? "Click to choose a different first end" : "") : (now ? hint : ""),
        onclick: () => { if (n === 1 && done) { this.pick.a = null; this.say(); } } },
        el("span", { class: "lnum" }, done ? "✓" : String(n)),
        done ? el("span", { class: "ltxt" }, el("span", { class: "lkind" }, `${label} · ${this.kindOf(an)}`), el("span", { class: "ltitle" }, this.describe(an).title))
          : el("span", { class: "ltxt" }, el("span", { class: "lkind" }, label), el("span", { class: "lph" }, now ? short : "After the first")));
    };
    this.guide.replaceChildren(
      icon("chain"),
      el("div", { class: "lgchips" }, chip(1, a), el("span", { class: "larrow" }, "→"), chip(2, null)),
      el("span", { class: "lgstep" }, `Step ${step} of 2`),
      el("button", { class: "btn small", type: "button", title: "Stop linking (Esc)", onclick: () => this.cancel() }, "Cancel"));
  }
  cancel() {
    if (!this.pick) return;
    this.pick = null; this.guide.hidden = true; this.syncButtons();
    for (const p of Object.values(this.app.panels)) { p.root.classList.remove("linkpick"); p.pickPrev = null; if (p.action && p.action.type === "pick") p.action = null; p.render(); }
  }
  /** The two ways of tying notes to a PDF, as buttons. The top bar and the Sources panel both make theirs here, so they look, read and behave the same:
   *    Link  - connects two things that already exist (a note, text box or drawing with a PDF page, region or passage); nothing new is written.
   *    Quote - brings a passage of the PDF into your notes: the text is inserted AND linked to its page in one gesture.
   *  A button is pressed while its mode is waiting for you, and pressing it again cancels. (Mind-map Node / Link in the panel toolbars are a different thing and never touch these.) */
  actionButton(kind, { small = false } = {}) {
    const info = ACTIONS[kind], b = el("button", { class: "btn" + (small ? " small" : "") + " linkact", type: "button", title: info.title, "aria-label": info.title, "aria-pressed": "false", dataset: { action: kind },
      onclick: () => (kind === "quote" ? this.quote() : this.app.startLink()) }, icon(info.icon), el("span", { class: "lbl" }, info.label));
    (this.actionBtns || (this.actionBtns = new Set())).add(b);
    this.syncButtons();
    return b;
  }
  syncButtons() {
    if (this.actionBtns && this.actionBtns.size > 24) for (const b of this.actionBtns) if (!b.isConnected && b.dataset.seen) this.actionBtns.delete(b);
    for (const b of this.actionBtns || []) {
      if (!b.isConnected && b.dataset.seen) { this.actionBtns.delete(b); continue; }
      if (b.isConnected) b.dataset.seen = "1";
      const on = !!this.pick && (b.dataset.action === "quote") === !!this.pick.quote;
      b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on));
    }
  }
  /** "Quote a passage": drag across text in a PDF; the passage becomes a quote in a notebook / board, linked to where it came from (one gesture instead of write, select, link). */
  quote() {
    if (this.pick) { this.cancel(); return; }
    const target = this.quoteTarget(); if (!target) { toast("Open a Notebook or a Board panel first: the quote goes there.", 3800); return; }
    const pdf = Object.values(this.app.panels).find((q) => q.kind === "pdf" && q.pdf && q.root && !q.root.hidden && q.pdf.hash);
    if (!pdf) { toast("Open a PDF first, then drag across the text to quote.", 3500); return; }
    this.pick = { a: null, quote: true }; this.say();
    for (const q of Object.values(this.app.panels)) { q.root.classList.add("linkpick"); q.releaseToolCursor(); if (q.tool !== "pan") q.cancelAction?.(); }
    this.app.setActive(pdf); pdf.render();
  }
  quoteTarget() {
    const ok = (q) => q && (q.kind === "nb" || q.kind === "board") && q.hasPage && q.root && !q.root.hidden;
    const a = this.app.active; if (ok(a)) return a;
    return this.app.order.map((k) => this.app.panels[k]).find(ok) || null;
  }
  makeQuote(anchor) {
    const q = this.quoteTarget(); this.cancel(); if (!q) return;
    // Only what the reader selected goes into the note: no quotation marks, no file name, no page number. Where it came from is kept in the LINK (document identity, name, page,
    // the passage and its boxes): the note shows the link mark, the Sources panel lists it, and following it opens the PDF at the passage.
    const text = String(anchor.quote.text).trim(), rtl = /[\u0590-\u08FF]/.test(text);          // (exactly the selected text: its words, its order, its paragraphs)
    const [pw] = q.pageDims(), w = Math.min(Math.max(120, pw - 100), 420), page = q.kind === "board" ? 0 : q.cur, st = q.groups.text || q.curStyle;
    let d = { t: "text", x: rtl ? Math.max(20, pw - 50 - w) : 50, y: Math.max(20, q.belowBars(page) + 10), w, dir: rtl ? "rtl" : "ltr", align: rtl ? "right" : "left", text, color: st.color, size: Math.min(st.size || 18, 18), alpha: 255, bright: 0 };
    M.ensureId(d);
    const idx = q.items.length; q.commit([...q.items, q.adaptToPage(d)], { select: idx });
    const a = this.itemAnchor(q, idx, page); if (a) this.store.add(a, anchor);
    this.app.scheduleAutosave(); toast(`Quote added to ${q.label} and linked to ${anchor.name || "the PDF"}, page ${anchor.page + 1}.`, 3600);
  }
  /** One end was chosen. */
  choose(anchor, panel) {
    if (!this.pick || !anchor) return;
    if (this.pick.quote) { if (anchor.k === "pdf" && anchor.quote) this.makeQuote(anchor); else toast("Drag across text in the PDF to quote it.", 2600); return; }
    if (!this.pick.a) { this.pick.a = anchor; this.say(); if (anchor.k === "item") this.showPdfFor(); return; }
    const first = this.pick.a, res = this.store.add(first, anchor);
    if (!res) { toast("Choose a different place for the other end."); return; }
    this.cancel();
    for (const an of [first, anchor]) { const r = this.resolve(an); if (r.panel) { r.panel.dirty = true; r.panel.ui(); } }
    this.app.scheduleAutosave();
    toast(res.created ? `Linked: “${this.describe(first).title}” ↔ “${this.describe(anchor).title}”. Press the chain mark on either one to jump to the other.` : "These two are already linked.", 4200);
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
  move(panel, e, l) {
    const a = panel.action;
    if (!a || a.type !== "pick") return;
    if (!a.moved && Math.hypot(l.x - a.l0.x, l.y - a.l0.y) < 6) return;
    a.moved = true;
    const p = panel.clampP(panel.toPage(e)), g = this.gesture(panel, a, p);
    panel.pickPrev = g ? { page: a.page, rects: g.rects, kind: g.kind } : null;
    panel.render();
  }
  /** What the drag from a.p0 to p selects on a PDF page: a passage of text (it started on text) or a region. The passage is the range of the page's text (in reading order)
   *  between the character under the start and the character under the pointer, so it is exactly what the drawn highlight covers. */
  gesture(panel, a, p) {
    if (panel.kind !== "pdf") return null;
    const start = a.data && a.data.words.length ? caretAt(a.data, a.p0, 4 / panel.view.scale + 2) : null;
    if (start && start.hit) {
      const end = caretAt(a.data, p), t = a.data.text;
      let s = Math.min(start.off, end.off), e = Math.max(start.off, end.off);
      while (s < e && /\s/.test(t[s])) s++;                                                                // (no white space at either end)
      while (e > s && /\s/.test(t[e - 1])) e--;
      const text = quoteText(a.data, s, e);
      return { kind: "text", rects: rectsForRange(a.data, s, e), text, s, e };
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
      if (g && g.kind === "text" && g.text) anchor = this.pdfAnchor(panel, a.page, { quote: { text: g.text, rects: g.rects.slice(0, 200) } });
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
      const smart = g.links.every((l) => l.src), col = broken ? WARN : smart ? SMART : TEAL;          // (links made by Smart linking are purple, the ones the user made are teal)
      if (g.anchor.k === "pdf" && g.rects.length) {
        ctx.setLineDash([5 / s, 3 / s]); ctx.lineWidth = 1.5 / s; ctx.strokeStyle = col; ctx.fillStyle = smart ? (g.anchor.quote ? "rgba(126,87,194,.20)" : "rgba(126,87,194,.07)") : g.anchor.quote ? "rgba(0,137,123,.20)" : "rgba(0,137,123,.07)";
        for (const q of g.rects) { ctx.fillRect(q[0], q[1], q[2] - q[0], q[3] - q[1]); if (!g.anchor.quote) ctx.strokeRect(q[0], q[1], q[2] - q[0], q[3] - q[1]); }
        ctx.setLineDash([]);
      }
      let cx, cy;
      if (g.bounds) { cx = Math.min(w - r, Math.max(r, g.bounds[2] + r * 0.9)); cy = Math.min(h - r, Math.max(r, g.bounds[1] - r * 0.9)); }       // (just outside the top right corner: not under the selection handles)
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
  /** "Suggested · 87%" / "Auto · 94%" for a link Smart linking made (nothing for a link the user made). */
  tag(lk) { return lk.src ? el("span", { class: "ltag " + lk.src, title: lk.src === "auto" ? "Made automatically by Smart linking" : "Suggested by Smart linking, confirmed by you" }, (lk.src === "auto" ? "Auto" : "Suggested") + (lk.score ? ` · ${Math.round(lk.score * 100)}%` : "")) : null; }
  /** A list of the links at one or more places: where each goes, a button to go there and one to remove it. */
  openMenu(panel, anchorEl, groups, { add = null, at = null } = {}) {
    const rows = [];
    for (const g of groups) for (const lk of g.links) {
      const other = this.store.otherEnd(lk, g.anchor), d = this.describe(other);
      rows.push(el("div", { class: "lrow" + (d.ok ? "" : " bad") },
        el("button", { class: "lgo", type: "button", title: "Go there", onclick: () => { closePopup(); this.go(other, { link: lk, from: panel }); } },
          icon(d.icon), el("span", { class: "ltxt" }, el("span", { class: "ltitle" }, d.title), d.where ? el("span", { class: "lwhere" }, d.where) : null)), this.tag(lk),
        el("button", { class: "btn small", type: "button", title: "Remove this link", "aria-label": "Remove this link", onclick: () => { this.store.remove(lk.id); this.app.scheduleAutosave(); closePopup(); } }, icon("trash"))));
    }
    const box = el("div", { class: "linkmenu" }, el("div", { class: "lhead" }, "Linked to"), ...rows,
      add ? el("button", { class: "mi", type: "button", onclick: () => { closePopup(); add(); } }, "Add another link…") : null);
    const a = anchorEl || el("span", { style: `position:fixed;left:${(at ? panel.stage.getBoundingClientRect().left + at.x : 100)}px;top:${(at ? panel.stage.getBoundingClientRect().top + at.y : 100)}px;width:1px;height:1px` });
    if (!anchorEl) document.body.append(a);
    popup(a, box, { onClose: () => { if (!anchorEl) a.remove(); } });
  }
  /** The list of all links: what they are for, how to make one, and every link with both ends (broken ones first). */
  async manage() {
    const ref = {};
    const list = () => {
      const all = this.store.all();
      if (!all.length) return el("div", { class: "lempty" },
        el("p", { class: "lbig" }, "No links yet."),
        el("ol", { class: "lsteps" },
          el("li", {}, el("b", {}, "Select"), " a note, text box or drawing (Select tool), or just press Link."),
          el("li", {}, "Press the ", el("b", {}, "Link"), " button in the panel toolbar."),
          el("li", {}, "Tap the ", el("b", {}, "PDF page"), " it belongs to — or drag a box around a region, or across some text.")));
      const row = (lk) => {
        const A = this.describe(lk.a), B = this.describe(lk.b);
        const end = (an, d) => el("button", { class: "lgo", type: "button", title: "Go to this end", onclick: () => { ref.close(); this.go(an, { link: lk }); } },
          icon(d.icon), el("span", { class: "ltxt" }, el("span", { class: "lkind" }, this.kindOf(an)), el("span", { class: "ltitle" }, d.title), d.where ? el("span", { class: "lwhere" }, d.where) : null));
        return el("div", { class: "lrow" + (A.ok && B.ok ? "" : " bad") + (lk.src ? " smart" : "") }, end(lk.a, A), el("span", { class: "lmid" }, el("span", { class: "larrow" }, "↔"), this.tag(lk)), end(lk.b, B),
          el("button", { class: "btn small", type: "button", title: "Remove this link", "aria-label": "Remove this link", onclick: () => { this.store.remove(lk.id); this.app.scheduleAutosave(); box.replaceChildren(head(), smartBox(), list()); } }, icon("trash")));
      };
      const bad = all.filter((lk) => !this.describe(lk.a).ok || !this.describe(lk.b).ok), good = all.filter((lk) => !bad.includes(lk));
      return el("div", { class: "linklist" },
        bad.length ? el("div", { class: "lgroup warn" }, `Needs attention (${bad.length}) — the other end is missing`) : null, ...bad.map(row),
        good.length ? el("div", { class: "lgroup" }, bad.length ? `Working (${good.length})` : `${good.length} link${good.length === 1 ? "" : "s"}`) : null, ...good.map(row));
    };
    const smartBox = () => {                                                                    // Smart linking: the setting, what it does, and its limits
      const sm = this.app.smart, nAuto = this.store.countSrc("auto");
      const sel = el("select", { "aria-label": "Smart linking", onchange: () => { sm.setMode(sel.value); box.replaceChildren(head(), smartBox(), list()); } }, MODES.map(([v, l]) => el("option", { value: v, selected: v === sm.mode }, l)));
      return el("div", { class: "smartbox" },
        el("div", { class: "smhead" }, el("b", {}, "Smart linking"), sel),
        el("p", { class: "smnote" }, "Compares only the pages you are looking at (for example PDF page 20 and Notebook page 100) and offers a link when a note closely matches a passage, even if worded differently. It runs on this device and sends nothing anywhere. It reads typed text only: handwriting, images and PDF pages without selectable text cannot be analyzed."),
        el("div", { class: "smact" },
          el("button", { class: "btn small", type: "button", onclick: () => { ref.close(); sm.scan({ manual: true }); } }, "Check the open pages now"),
          this.store.rejects.size ? el("button", { class: "btn small", type: "button", title: "Suggestions you dismissed (or that timed out) were remembered so they do not come back. This lets them be suggested again.", onclick: () => { const n = this.store.rejects.size; this.store.rejects.clear(); sm.snoozed.clear(); this.app.scheduleAutosave(); toast(`${n} dismissed suggestion${n === 1 ? "" : "s"} can be suggested again.`); box.replaceChildren(head(), smartBox(), list()); } }, `Bring back ${this.store.rejects.size} dismissed`) : null,
          nAuto ? el("button", { class: "btn small danger", type: "button", onclick: () => { const n = sm.removeAutomatic(); toast(`${n} automatic link${n === 1 ? "" : "s"} removed.`); box.replaceChildren(head(), smartBox(), list()); } }, `Remove ${nAuto} automatic link${nAuto === 1 ? "" : "s"}`) : null));
    };
    const head = () => el("p", { class: "lintro" }, "Links connect a note to the exact PDF page, region or text it is about. Press the chain mark on either end to jump to the other one.");
    const box = el("div", { class: "linkmanager" }, head(), smartBox(), list());
    const bad0 = this.store.all().filter((lk) => !this.describe(lk.a).ok || !this.describe(lk.b).ok);
    const v = await dialog({ title: "Linked notes", content: box, ref,
      buttons: [...(bad0.length ? [{ label: `Remove ${bad0.length} broken`, value: "rm", danger: true }] : []), { label: "New link", value: "new" }, { label: "Close", value: true, primary: true }] });
    if (v === "rm") { for (const lk of bad0) this.store.remove(lk.id); this.app.scheduleAutosave(); toast("Broken links removed."); }
    else if (v === "new") this.start(this.app.active || Object.values(this.app.panels)[0]);
  }
}
